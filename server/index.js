'use strict';

/**
 * Shadow Clash server entry point.
 *
 * - Express serves the client and character assets.
 * - Socket.IO carries all realtime traffic.
 * - A fixed-step 60 Hz loop advances every active room.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { PlayerRegistry, cleanNickname, cleanPlayerId } = require('./playerRegistry');
const { CharacterLoader, CHARACTERS_DIR } = require('./characterLoader');
const { RoomManager, RoomError, DISCONNECT_GRACE_MS } = require('./roomManager');
const { Matchmaker } = require('./matchmaker');
const gameLoop = require('./gameLoop');

const PORT = Number(process.env.PORT) || 3000;
const TICK_MS = 1000 / 60;
const CLIENT_DIR = path.join(__dirname, '..', 'client');

const app = express();
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// Character loading
// ---------------------------------------------------------------------------
const characters = new CharacterLoader().load();

app.get('/api/characters', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(characters.allPublic());
});

app.get('/api/characters/:id', (req, res) => {
  const hero = characters.getPublic(req.params.id);
  if (!hero) return res.status(404).json({ error: 'Character not found' });
  res.json(hero);
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    heroes: characters.characters.size,
    uptimeSeconds: Math.floor(process.uptime())
  });
});

// Character assets (sprites, icons, optional sounds).
app.use('/characters', express.static(CHARACTERS_DIR, { fallthrough: true, maxAge: '1h' }));
// Client files.
app.use(express.static(CLIENT_DIR, { extensions: ['html'], maxAge: '1h' }));
app.get('/', (req, res) => res.sendFile(path.join(CLIENT_DIR, 'index.html')));

const server = http.createServer(app);
const io = new Server(server, {
  serveClient: true,
  pingInterval: 20000,
  pingTimeout: 15000,
  maxHttpBufferSize: 1e6
});

const registry = new PlayerRegistry();
const rooms = new RoomManager(io, registry, characters);
const matchmaker = new Matchmaker({ io, registry, rooms });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function broadcastPresence() {
  io.emit('presence', {
    online: registry.countOnline(),
    searching: matchmaker.searchingCount,
    rooms: [...rooms.rooms.values()].filter((room) => room.state === 'playing').length,
    heroes: characters.characters.size
  });
}

function sendError(socket, code, message) {
  socket.emit('roomError', { code, message });
}

function allowRate(socket, key, limit = 5, windowMs = 10000) {
  const now = Date.now();
  if (!socket.data.rateBuckets) socket.data.rateBuckets = {};
  const recent = (socket.data.rateBuckets[key] || []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    socket.data.rateBuckets[key] = recent;
    return false;
  }
  recent.push(now);
  socket.data.rateBuckets[key] = recent;
  return true;
}

function getPlayer(socket) {
  const playerId = socket.data.playerId;
  return playerId ? registry.getById(playerId) : null;
}

function requirePlayer(socket) {
  const player = getPlayer(socket);
  if (!player || !player.connected) {
    sendError(socket, 'NOT_REGISTERED', 'Set a nickname before doing that.');
    return null;
  }
  return player;
}

function currentRoomFor(player) {
  if (!player) return null;
  return rooms.roomForPlayer(player.playerId) ||
    (player.roomCode ? rooms.rooms.get(player.roomCode) : null);
}

function withErrors(socket, handler) {
  return (...args) => {
    try {
      handler(...args);
    } catch (error) {
      if (error instanceof RoomError) {
        sendError(socket, error.code, error.message);
      } else {
        console.error('[socket] Unhandled handler error:', error);
        sendError(socket, 'SERVER_ERROR', 'Something went wrong on the server.');
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Socket handlers
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.data.rateBuckets = {};
  socket.emit('presence', {
    online: registry.countOnline(),
    searching: matchmaker.searchingCount,
    rooms: 0,
    heroes: characters.characters.size
  });

  socket.on('setNickname', withErrors(socket, (payload = {}) => {
    if (!allowRate(socket, 'setNickname', 10, 10000)) {
      return sendError(socket, 'RATE_LIMITED', 'Too many nickname updates. Wait a moment.');
    }
    const nickname = cleanNickname(payload.nickname);
    if (!nickname) return sendError(socket, 'INVALID_NICKNAME', 'Choose a nickname (1-12 characters).');
    const requestedId = cleanPlayerId(payload.playerId);
    const previous = registry.getById(requestedId);
    const previousSocketId = previous ? previous.socketId : null;

    const player = registry.register({
      socketId: socket.id,
      nickname,
      playerId: requestedId,
      heroId: payload.heroId,
      profile: payload.profile
    });
    socket.data.playerId = player.playerId;

    // If the same identity opened a second tab, take over the session.
    if (previousSocketId && previousSocketId !== socket.id) {
      const stale = io.sockets.sockets.get(previousSocketId);
      if (stale) stale.disconnect(true);
    }

    socket.emit('nicknameSet', registry.profile(player));

    // Reconnect into a room if this identity still owns a slot.
    if (player.roomCode) {
      const room = rooms.handleReconnect(player);
      if (room) matchmaker.resendPending(player);
    }
    broadcastPresence();
  }));

  socket.on('queueJoin', withErrors(socket, () => {
    const player = requirePlayer(socket);
    if (!player) return;
    if (!allowRate(socket, 'queueJoin', 5, 10000)) {
      socket.emit('queueStatus', {
        status: 'error',
        code: 'RATE_LIMITED',
        message: 'Too many queue attempts. Wait a few seconds.'
      });
      return;
    }
    try {
      matchmaker.join(player);
    } catch (error) {
      if (error instanceof RoomError) {
        socket.emit('queueStatus', { status: 'error', code: error.code, message: error.message });
      } else {
        throw error;
      }
    }
    broadcastPresence();
  }));

  socket.on('queueCancel', withErrors(socket, () => {
    const player = requirePlayer(socket);
    if (!player) return;
    matchmaker.cancel(player.playerId);
    broadcastPresence();
  }));

  socket.on('matchAccept', withErrors(socket, () => {
    const player = requirePlayer(socket);
    if (!player) return;
    matchmaker.accept(player.playerId);
  }));

  socket.on('matchDecline', withErrors(socket, () => {
    const player = requirePlayer(socket);
    if (!player) return;
    matchmaker.decline(player.playerId, 'declined');
    broadcastPresence();
  }));

  socket.on('queueBot', withErrors(socket, () => {
    const player = requirePlayer(socket);
    if (!player) return;
    if (!allowRate(socket, 'queueBot', 5, 10000)) {
      return socket.emit('queueStatus', {
        status: 'error',
        message: 'Too many bot requests. Wait a few seconds.'
      });
    }
    matchmaker.startBotMatch(player.playerId);
    broadcastPresence();
  }));

  socket.on('roomCreate', withErrors(socket, () => {
    const player = requirePlayer(socket);
    if (!player) return;
    if (!allowRate(socket, 'roomCreate', 5, 10000)) {
      return sendError(socket, 'RATE_LIMITED', 'Too many room creations. Wait a few seconds.');
    }
    rooms.createPrivateRoom(player);
    broadcastPresence();
  }));

  socket.on('roomJoin', withErrors(socket, (payload = {}) => {
    const player = requirePlayer(socket);
    if (!player) return;
    if (!allowRate(socket, 'roomJoin', 10, 10000)) {
      return sendError(socket, 'RATE_LIMITED', 'Too many join attempts. Wait a few seconds.');
    }
    rooms.joinRoom(player, payload.code, payload.spectate === true);
    broadcastPresence();
  }));

  socket.on('roomLeave', withErrors(socket, () => {
    const player = requirePlayer(socket);
    if (!player) return;
    rooms.leaveRoom(player.playerId);
    socket.emit('roomLeft');
    broadcastPresence();
  }));

  socket.on('roomReady', withErrors(socket, (payload = {}) => {
    const player = requirePlayer(socket);
    if (!player) return;
    const room = currentRoomFor(player);
    if (!room) return sendError(socket, 'NOT_IN_ROOM', 'You are not in a room.');
    rooms.setReady(room, player.playerId, payload.ready === true, payload.heroId || null);
  }));

  socket.on('roomKick', withErrors(socket, (payload = {}) => {
    const player = requirePlayer(socket);
    if (!player) return;
    const room = currentRoomFor(player);
    if (!room) return sendError(socket, 'NOT_IN_ROOM', 'You are not in a room.');
    rooms.kick(room, player.playerId, String(payload.playerId || ''));
  }));

  socket.on('chooseHero', withErrors(socket, (payload = {}) => {
    const player = requirePlayer(socket);
    if (!player) return;
    rooms.chooseHero(player, payload.heroId);
  }));

  socket.on('rematchRequest', withErrors(socket, (payload = {}) => {
    const player = requirePlayer(socket);
    if (!player) return;
    const room = currentRoomFor(player);
    if (!room) return sendError(socket, 'NOT_IN_ROOM', 'You are not in a room.');
    rooms.requestRematch(room, player.playerId, payload.accept !== false);
  }));

  socket.on('returnToLobby', withErrors(socket, (payload = {}) => {
    const player = requirePlayer(socket);
    if (!player) return;
    const room = rooms.roomForPlayer(player.playerId);
    if (!room) return sendError(socket, 'NOT_IN_ROOM', 'You are not in a room.');
    rooms.returnToLobby(room, player.playerId);
  }));

  socket.on('input', (payload = {}) => {
    const player = getPlayer(socket);
    if (!player) return;
    const room = rooms.roomForPlayer(player.playerId);
    if (!room || !room.game || room.state !== 'playing') return;
    gameLoop.receiveInput(room.game, player.playerId, payload.input);
  });

  socket.on('emote', withErrors(socket, (payload = {}) => {
    const player = requirePlayer(socket);
    if (!player) return;
    const text = String(payload.text || '').trim().slice(0, 24);
    const allowed = new Set(['GG', 'Nice!', 'Rematch?', 'Good luck!', 'Well played!', 'Oops!']);
    if (!allowed.has(text)) return;
    const room = currentRoomFor(player);
    if (!room) return;
    room.lastActivity = Date.now();
    io.to(room.code).emit('emote', {
      playerId: player.playerId,
      nickname: player.nickname,
      text
    });
  }));

  // Application-level latency probe. The client measures round-trip time.
  socket.on('ping', (payload) => {
    socket.emit('pong', {
      t: payload && typeof payload.t === 'number' ? payload.t : null,
      serverTime: Date.now()
    });
  });

  socket.on('requestSnapshot', withErrors(socket, () => {
    const player = requirePlayer(socket);
    if (!player) return;
    const room = rooms.roomForPlayer(player.playerId);
    if (room && room.game) socket.emit('snapshot', gameLoop.buildSnapshot(room));
  }));

  socket.on('disconnect', () => {
    const player = registry.getBySocket(socket.id);
    if (!player) return; // stale socket (identity was taken over)
    if (player.socketId !== socket.id) return;

    matchmaker.handleDisconnect(player.playerId);
    rooms.handleDisconnect(player);
    if (player.status === 'queue') registry.setStatus(player, 'idle', null);
    registry.markDisconnected(player);
    broadcastPresence();
  });
});

// ---------------------------------------------------------------------------
// Fixed-step game loop (60 ticks/sec) + 30 Hz snapshots
// ---------------------------------------------------------------------------
let lastTime = Date.now();
let accumulator = 0;
let tickNumber = 0;

const loopTimer = setInterval(() => {
  const now = Date.now();
  accumulator += now - lastTime;
  lastTime = now;

  let steps = 0;
  while (accumulator >= TICK_MS && steps < 5) {
    accumulator -= TICK_MS;
    tickNumber += 1;
    steps += 1;

    for (const room of rooms.rooms.values()) {
      if (room.state !== 'playing' || !room.game) continue;
      gameLoop.tickRoom(room);

      // 30 snapshots per second are enough for interpolation and keep the
      // payload small. Important events are included in each snapshot.
      if (tickNumber % 2 === 0 && room.state === 'playing') {
        const snapshot = gameLoop.buildSnapshot(room);
        io.to(room.code).emit('snapshot', snapshot);
        gameLoop.clearEvents(room.game);
      }
    }
  }
  if (steps === 5) accumulator = 0; // avoid a death spiral after a long pause
}, 10);

const presenceTimer = setInterval(broadcastPresence, 3000);

// ---------------------------------------------------------------------------
// Startup / shutdown
// ---------------------------------------------------------------------------
function start() {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  ⚔  SHADOW CLASH');
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  Heroes:  ${[...characters.characters.keys()].join(', ') || 'none'}`);
    console.log('');
  });
}

function shutdown(signal) {
  console.log(`\n[server] ${signal}; shutting down.`);
  clearInterval(loopTimer);
  clearInterval(presenceTimer);
  matchmaker.close();
  io.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (require.main === module) start();

module.exports = {
  app,
  server,
  io,
  registry,
  rooms,
  matchmaker,
  characters,
  start,
  DISCONNECT_GRACE_MS
};
