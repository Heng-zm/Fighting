'use strict';

/**
 * Room lifecycle: private invite rooms, matchmade rooms, CPU rooms, ready state,
 * rematches, disconnects/reconnects and result bookkeeping.
 */

const crypto = require('crypto');
const { createGameState, buildSnapshot, clearEvents, sanitizeInput } = require('./gameLoop');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 confusion
const ROOM_IDLE_MS = 10 * 60 * 1000;
const DISCONNECT_GRACE_MS = 15 * 1000;
const REMATCH_TIMEOUT_MS = 30 * 1000;

class RoomError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function randomCode(length = 4) {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

class GameRoom {
  constructor(code, mode) {
    this.code = code;
    this.mode = mode; // private | random | bot
    this.state = 'lobby'; // accepting | lobby | playing | result | closed
    this.hostId = null;
    this.players = new Map();
    this.spectators = new Map();
    this.game = null;
    this.matchResult = null;
    this.acceptVotes = new Set();
    this.acceptDeadline = 0;
    this.rematchVotes = new Set();
    this.rematchTimer = null;
    this.disconnectTimers = new Map();
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.onMatchEnd = null;
  }
}

class RoomManager {
  constructor(io, registry, characters) {
    this.io = io;
    this.registry = registry;
    this.characters = characters;
    /** @type {Map<string, GameRoom>} */
    this.rooms = new Map();
    this.cleanupTimer = setInterval(() => this.cleanup(), 60 * 1000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  getDefaultHeroId() {
    const first = this.characters.all()[0];
    return first ? first.id : null;
  }

  ensureCharacters() {
    if (!this.getDefaultHeroId()) {
      throw new RoomError('NO_CHARACTERS', 'No valid heroes are loaded on the server.');
    }
  }

  newCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const code = randomCode(4);
      if (!this.rooms.has(code)) return code;
    }
    return randomCode(6);
  }

  roomForPlayer(playerId) {
    for (const room of this.rooms.values()) {
      if (room.players.has(playerId)) return room;
    }
    return null;
  }

  /** Create a private invite room and add the host. */
  createPrivateRoom(player) {
    this.ensureCharacters();
    if (this.roomForPlayer(player.playerId) || player.status === 'in_room' || player.status === 'in_match') {
      throw new RoomError('ALREADY_IN_ROOM', 'You are already in a room.');
    }
    const room = new GameRoom(this.newCode(), 'private');
    room.hostId = player.playerId;
    this.rooms.set(room.code, room);
    this.addPlayer(room, player, { ready: false });
    this.broadcastRoom(room);
    return room;
  }

  /** Build an acceptance room for two matched players. */
  createMatchRoom(playerA, playerB) {
    this.ensureCharacters();
    if (this.roomForPlayer(playerA.playerId) || this.roomForPlayer(playerB.playerId)) {
      throw new RoomError('ALREADY_IN_ROOM', 'A player is already in a room.');
    }
    const room = new GameRoom(this.newCode(), 'random');
    room.state = 'accepting';
    room.hostId = playerA.playerId;
    room.acceptDeadline = Date.now() + 5000;
    this.rooms.set(room.code, room);
    this.addPlayer(room, playerA, { ready: false, silent: true });
    this.addPlayer(room, playerB, { ready: false, silent: true });
    return room;
  }

  /** Create and immediately start a match against a CPU hero. */
  createBotRoom(player) {
    this.ensureCharacters();
    if (this.roomForPlayer(player.playerId)) {
      throw new RoomError('ALREADY_IN_ROOM', 'You are already in a room.');
    }
    const room = new GameRoom(this.newCode(), 'bot');
    room.hostId = player.playerId;
    this.rooms.set(room.code, room);

    const heroes = this.characters.all();
    const chosen = heroes.find((hero) => hero.id !== player.heroId) || heroes[0];
    const playerHeroId = this.characters.get(player.heroId) ? player.heroId : heroes[0].id;
    this.addPlayer(room, player, { ready: true, heroId: playerHeroId, silent: true });
    this.addPlayer(
      room,
      {
        playerId: `bot_${crypto.randomBytes(4).toString('hex')}`,
        nickname: `CPU ${chosen.displayName}`,
        heroId: chosen.id
      },
      { ready: true, isBot: true, heroId: chosen.id, silent: true }
    );

    this.startGame(room);
    return room;
  }

  addPlayer(room, player, options = {}) {
    if (room.players.size >= 2) throw new RoomError('ROOM_FULL', 'This room is full.');
    const isBot = options.isBot === true;
    const requestedHero = options.heroId || player.heroId;
    const hero = this.characters.get(requestedHero) || this.characters.all()[0];
    if (!hero) throw new RoomError('NO_CHARACTERS', 'No heroes are loaded.');

    const roomPlayer = {
      playerId: player.playerId,
      nickname: player.nickname || 'Fighter',
      socketId: isBot ? null : player.socketId,
      heroId: hero.id,
      hero,
      heroPublic: this.characters.toPublic(hero),
      ready: options.ready === true,
      disconnected: false,
      isBot,
      rating: isBot ? 1000 : player.rating || 1000
    };
    room.players.set(roomPlayer.playerId, roomPlayer);
    if (!isBot) {
      this.registry.setStatus(player, room.state === 'playing' ? 'in_match' : 'in_room', room.code);
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) socket.join(room.code);
    }
    room.lastActivity = Date.now();
    if (!options.silent) this.broadcastRoom(room);
    return roomPlayer;
  }

  getRoom(code) {
    return this.rooms.get(String(code || '').trim().toUpperCase()) || null;
  }

  getRoomForPlayer(playerId) {
    return this.roomForPlayer(playerId);
  }

  emitToPlayer(room, playerId, event, payload) {
    const roomPlayer = room.players.get(playerId);
    if (!roomPlayer || roomPlayer.isBot || !roomPlayer.socketId) return;
    this.io.to(roomPlayer.socketId).emit(event, payload);
  }

  emitToHumans(room, event, payload, filter = null) {
    for (const roomPlayer of room.players.values()) {
      if (roomPlayer.isBot || !roomPlayer.socketId) continue;
      if (filter && !filter(roomPlayer)) continue;
      this.io.to(roomPlayer.socketId).emit(event, payload);
    }
  }

  serializeRoom(room) {
    return {
      code: room.code,
      mode: room.mode,
      state: room.state,
      hostId: room.hostId,
      createdAt: room.createdAt,
      expiresAt: room.lastActivity + ROOM_IDLE_MS,
      players: [...room.players.values()].map((player) => ({
        playerId: player.playerId,
        nickname: player.nickname,
        heroId: player.heroId,
        hero: player.heroPublic,
        ready: player.ready,
        disconnected: player.disconnected,
        isBot: player.isBot,
        isHost: player.playerId === room.hostId,
        rating: player.rating
      })),
      spectators: room.spectators.size,
      rematchVotes: [...room.rematchVotes],
      acceptDeadline: room.acceptDeadline || 0,
      matchResult: room.matchResult
        ? {
            winnerId: room.matchResult.winnerId,
            loserId: room.matchResult.loserId,
            score: room.matchResult.score,
            reason: room.matchResult.reason
          }
        : null
    };
  }

  broadcastRoom(room) {
    if (room.state === 'closed') return;
    const payload = this.serializeRoom(room);
    this.io.to(room.code).emit('roomUpdate', payload);
  }

  /** Join an invite room, or watch a room as a spectator. */
  joinRoom(player, rawCode, spectator = false) {
    const code = String(rawCode || '').trim().toUpperCase();
    const room = this.getRoom(code);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'Room not found. Check the code and try again.');
    if (room.state === 'closed') throw new RoomError('ROOM_NOT_FOUND', 'Room not found.');

    const existing = this.roomForPlayer(player.playerId);
    if (existing && existing.code !== room.code) {
      throw new RoomError('ALREADY_IN_ROOM', 'You are already in another room.');
    }

    if (spectator) {
      if (existing && existing.code === room.code) {
        // Already in this room (as player or spectator); just resend state.
        this.sendCurrentView(player, room);
        return room;
      }
      this.ensureCharacters();
      room.spectators.set(player.socketId, {
        socketId: player.socketId,
        playerId: player.playerId,
        nickname: player.nickname
      });
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) socket.join(room.code);
      this.registry.setStatus(player, 'in_room', room.code);
      room.lastActivity = Date.now();
      this.broadcastRoom(room);
      this.sendCurrentView(player, room);
      return room;
    }

    if (existing && existing.code === room.code) {
      this.broadcastRoom(room);
      return room;
    }
    if (room.players.has(player.playerId)) {
      this.broadcastRoom(room);
      return room;
    }
    if (room.state !== 'lobby') {
      if (room.state === 'playing' || room.state === 'result') {
        throw new RoomError('MATCH_STARTED', 'This match has already started. You can spectate instead.');
      }
      throw new RoomError('ROOM_NOT_FOUND', 'That room is no longer joinable.');
    }
    if (room.players.size >= 2) {
      throw new RoomError('ROOM_FULL', 'This room is full.');
    }

    this.addPlayer(room, player, { ready: false });
    this.broadcastRoom(room);
    return room;
  }

  /** Send a lobby update or the live game to a joining spectator. */
  sendCurrentView(player, room) {
    const socket = this.io.sockets.sockets.get(player.socketId);
    if (!socket) return;
    if (room.state === 'playing' || room.state === 'result') {
      socket.emit('gameStart', this.buildGameStartPayload(room, true));
      if (room.state === 'result' && room.matchResult) {
        socket.emit('matchEnd', this.buildMatchEndPayload(room));
      }
    } else {
      socket.emit('roomUpdate', this.serializeRoom(room));
    }
  }

  buildGameStartPayload(room, spectator = false) {
    return {
      roomCode: room.code,
      mode: room.mode,
      spectator,
      room: this.serializeRoom(room),
      players: [...room.players.values()].map((player) => ({
        playerId: player.playerId,
        nickname: player.nickname,
        heroId: player.heroId,
        isBot: player.isBot,
        hero: player.heroPublic,
        connected: player.isBot || !player.disconnected
      })),
      state: buildSnapshot(room)
    };
  }

  sendGameStart(room) {
    for (const roomPlayer of room.players.values()) {
      if (roomPlayer.isBot || !roomPlayer.socketId) continue;
      this.io.to(roomPlayer.socketId).emit('gameStart', this.buildGameStartPayload(room, false));
    }
    for (const spectator of room.spectators.values()) {
      this.io.to(spectator.socketId).emit('gameStart', this.buildGameStartPayload(room, true));
    }
  }

  chooseHero(player, heroId) {
    const hero = this.characters.get(String(heroId || ''));
    if (!hero) throw new RoomError('UNKNOWN_HERO', 'That fighter does not exist.');
    player.heroId = hero.id;

    const room = this.roomForPlayer(player.playerId);
    if (!room) {
      this.io.to(player.socketId).emit('nicknameSet', this.registry.profile(player));
      return null;
    }
    const roomPlayer = room.players.get(player.playerId);
    if (!roomPlayer) return null;
    if (room.state === 'playing') {
      throw new RoomError('MATCH_STARTED', 'You cannot change fighters during a match.');
    }
    roomPlayer.heroId = hero.id;
    roomPlayer.hero = hero;
    roomPlayer.heroPublic = this.characters.toPublic(hero);
    if (room.state === 'lobby') roomPlayer.ready = false;
    room.lastActivity = Date.now();
    this.broadcastRoom(room);
    return room;
  }

  setReady(room, playerId, ready, heroId = null) {
    if (!room || room.state !== 'lobby') {
      throw new RoomError('NOT_IN_LOBBY', 'Ready can only be toggled in the lobby.');
    }
    const roomPlayer = room.players.get(playerId);
    if (!roomPlayer) throw new RoomError('NOT_IN_ROOM', 'You are not in this room.');
    if (heroId) {
      const hero = this.characters.get(String(heroId));
      if (!hero) throw new RoomError('UNKNOWN_HERO', 'That fighter does not exist.');
      roomPlayer.heroId = hero.id;
      roomPlayer.hero = hero;
      roomPlayer.heroPublic = this.characters.toPublic(hero);
      const registryPlayer = this.registry.getById(playerId);
      if (registryPlayer) registryPlayer.heroId = hero.id;
    }
    roomPlayer.ready = !!ready;
    room.lastActivity = Date.now();

    const humans = [...room.players.values()].filter((p) => !p.isBot);
    const bothReady = room.players.size === 2 &&
      humans.every((p) => p.ready && !p.disconnected);

    if (bothReady) {
      this.startGame(room);
    } else {
      this.broadcastRoom(room);
    }
    return room;
  }

  startGame(room) {
    if (room.state === 'playing') return;
    if (room.players.size !== 2) throw new RoomError('NOT_ENOUGH_PLAYERS', 'Two fighters are required.');
    this.ensureCharacters();

    for (const roomPlayer of room.players.values()) {
      if (!roomPlayer.hero) {
        const hero = this.characters.get(roomPlayer.heroId) || this.characters.all()[0];
        roomPlayer.hero = hero;
        roomPlayer.heroId = hero.id;
        roomPlayer.heroPublic = this.characters.toPublic(hero);
      }
      roomPlayer.ready = true;
      roomPlayer.disconnected = roomPlayer.isBot ? false : roomPlayer.disconnected;
    }

    room.state = 'playing';
    room.matchResult = null;
    room.rematchVotes.clear();
    if (room.rematchTimer) clearTimeout(room.rematchTimer);
    room.rematchTimer = null;
    room.lastActivity = Date.now();
    room.game = createGameState(room);
    room.onMatchEnd = (winnerId, reason) => this.finishMatch(room, winnerId, reason);

    for (const roomPlayer of room.players.values()) {
      if (roomPlayer.isBot) continue;
      const registryPlayer = this.registry.getById(roomPlayer.playerId);
      if (registryPlayer) this.registry.setStatus(registryPlayer, 'in_match', room.code);
    }

    this.sendGameStart(room);
    // The initial payload already contains all events up to countdown start.
    clearEvents(room.game);
  }

  /** Called by matchmaker when both players accepted a random match. */
  completeAcceptance(room) {
    if (!room || room.state !== 'accepting') return false;
    room.state = 'lobby';
    room.acceptDeadline = 0;
    room.acceptVotes.clear();
    room.lastActivity = Date.now();
    this.broadcastRoom(room);
    return true;
  }

  /** Drop an acceptance room without notifying its players (matchmaker does). */
  discardRoom(room) {
    if (!room) return;
    this.clearRoomTimers(room);
    room.state = 'closed';
    this.rooms.delete(room.code);
    for (const roomPlayer of room.players.values()) {
      if (roomPlayer.isBot) continue;
      const player = this.registry.getById(roomPlayer.playerId);
      if (player) {
        this.registry.setStatus(player, 'idle', null);
        const socket = this.io.sockets.sockets.get(roomPlayer.socketId);
        if (socket) socket.leave(room.code);
      }
    }
    for (const spectator of room.spectators.values()) {
      const socket = this.io.sockets.sockets.get(spectator.socketId);
      if (socket) socket.leave(room.code);
    }
    room.players.clear();
    room.spectators.clear();
  }

  /** Notify everyone and close a room permanently. */
  closeRoom(room, code = 'ROOM_CLOSED', message = 'The room was closed.') {
    if (!room || room.state === 'closed') return;
    this.clearRoomTimers(room);
    room.state = 'closed';
    this.rooms.delete(room.code);

    const payload = { code, message };
    for (const roomPlayer of room.players.values()) {
      if (roomPlayer.isBot) continue;
      if (roomPlayer.socketId) {
        this.io.to(roomPlayer.socketId).emit('roomError', payload);
        const socket = this.io.sockets.sockets.get(roomPlayer.socketId);
        if (socket) socket.leave(room.code);
      }
      const player = this.registry.getById(roomPlayer.playerId);
      if (player) this.registry.setStatus(player, 'idle', null);
    }
    for (const spectator of room.spectators.values()) {
      this.io.to(spectator.socketId).emit('roomError', payload);
      const socket = this.io.sockets.sockets.get(spectator.socketId);
      if (socket) socket.leave(room.code);
      const player = this.registry.getById(spectator.playerId);
      if (player) this.registry.setStatus(player, 'idle', null);
    }
    room.players.clear();
    room.spectators.clear();
  }

  kick(room, hostId, targetId) {
    if (!room) throw new RoomError('NOT_IN_ROOM', 'You are not in this room.');
    if (room.hostId !== hostId) throw new RoomError('NOT_HOST', 'Only the host can kick players.');
    if (hostId === targetId) throw new RoomError('CANNOT_KICK_SELF', 'You cannot kick yourself.');
    if (room.state !== 'lobby') throw new RoomError('MATCH_STARTED', 'Players can only be kicked in the lobby.');
    const target = room.players.get(targetId);
    if (!target) throw new RoomError('NOT_IN_ROOM', 'That player is not in this room.');

    room.players.delete(targetId);
    if (target.socketId) {
      this.io.to(target.socketId).emit('roomError', {
        code: 'KICKED',
        message: 'The host removed you from the room.'
      });
      const socket = this.io.sockets.sockets.get(target.socketId);
      if (socket) socket.leave(room.code);
    }
    const targetPlayer = this.registry.getById(targetId);
    if (targetPlayer) this.registry.setStatus(targetPlayer, 'idle', null);
    room.lastActivity = Date.now();
    this.broadcastRoom(room);
  }

  clearRoomTimers(room) {
    for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
    room.disconnectTimers.clear();
    if (room.rematchTimer) clearTimeout(room.rematchTimer);
    room.rematchTimer = null;
  }

  /** Explicitly leave a room from the lobby, during a match, or after it. */
  leaveRoom(playerId) {
    const player = this.registry.getById(playerId);
    const room = this.roomForPlayer(playerId) ||
      (player && player.roomCode ? this.rooms.get(player.roomCode) : null);
    if (!room) {
      if (player) this.registry.setStatus(player, 'idle', null);
      return null;
    }

    // Spectator departure.
    const spectatorEntry = [...room.spectators.values()].find((s) => s.playerId === playerId);
    if (spectatorEntry && !room.players.has(playerId)) {
      room.spectators.delete(spectatorEntry.socketId);
      if (player) this.registry.setStatus(player, 'idle', null);
      const socket = this.io.sockets.sockets.get(spectatorEntry.socketId);
      if (socket) socket.leave(room.code);
      this.broadcastRoom(room);
      return room;
    }

    const roomPlayer = room.players.get(playerId);
    if (!roomPlayer) {
      if (player) this.registry.setStatus(player, 'idle', null);
      return room;
    }

    const timer = room.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      room.disconnectTimers.delete(playerId);
    }

    // Leaving a live match forfeits it to the opponent.
    if (room.state === 'playing' && !room.matchResult) {
      const opponent = [...room.players.values()].find((p) => p.playerId !== playerId);
      if (opponent) this.finishMatch(room, opponent.playerId, 'forfeit');
      else room.state = 'result';
    }

    room.players.delete(playerId);
    if (roomPlayer.socketId) {
      const socket = this.io.sockets.sockets.get(roomPlayer.socketId);
      if (socket) socket.leave(room.code);
    }
    if (player) this.registry.setStatus(player, 'idle', null);
    room.lastActivity = Date.now();

    if (room.players.size === 0) {
      this.clearRoomTimers(room);
      room.state = 'closed';
      this.rooms.delete(room.code);
      return room;
    }

    if (room.state === 'lobby' && room.hostId === playerId) {
      // A host abandoning the lobby closes it; guests are notified.
      const remainingHost = [...room.players.values()].find((p) => !p.isBot);
      if (remainingHost) room.hostId = remainingHost.playerId;
      this.closeRoom(room, 'ROOM_CLOSED', 'The host left the room.');
      return room;
    }

    if (room.state === 'result') {
      this.emitToHumans(room, 'opponentLeft', {
        playerId,
        nickname: roomPlayer.nickname,
        left: true,
        forfeit: false
      });
      this.broadcastRoom(room);
      return room;
    }

    this.broadcastRoom(room);
    return room;
  }

  /** Mark a player as temporarily disconnected. Their slot survives 15 seconds. */
  handleDisconnect(player) {
    if (!player) return null;

    const room = this.roomForPlayer(player.playerId) ||
      (player.roomCode ? this.rooms.get(player.roomCode) : null);

    if (!room) {
      if (player.status === 'in_room' || player.status === 'in_match') {
        this.registry.setStatus(player, 'idle', null);
      }
      return null;
    }

    // Spectators are dropped immediately.
    const spectatorEntry = [...room.spectators.values()].find((s) => s.playerId === player.playerId);
    if (spectatorEntry && !room.players.has(player.playerId)) {
      room.spectators.delete(spectatorEntry.socketId);
      this.registry.setStatus(player, 'idle', null);
      this.broadcastRoom(room);
      return room;
    }

    const roomPlayer = room.players.get(player.playerId);
    if (!roomPlayer) return room;
    roomPlayer.disconnected = true;
    roomPlayer.ready = false;
    roomPlayer.socketId = null;
    room.lastActivity = Date.now();
    this.broadcastRoom(room);

    if (room.state === 'playing') {
      this.emitToHumans(room, 'opponentLeft', {
        playerId: player.playerId,
        nickname: roomPlayer.nickname,
        forfeit: false,
        reconnectIn: DISCONNECT_GRACE_MS / 1000
      }, (p) => p.playerId !== player.playerId);
    }

    const existing = room.disconnectTimers.get(player.playerId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      room.disconnectTimers.delete(player.playerId);
      if (!this.rooms.has(room.code)) return;
      const current = room.players.get(player.playerId);
      if (!current || !current.disconnected) return;

      if (room.state === 'playing' && !room.matchResult) {
        const opponent = [...room.players.values()].find((p) => p.playerId !== player.playerId);
        if (opponent && (opponent.isBot || opponent.disconnected === false)) {
          this.finishMatch(room, opponent.playerId, 'disconnect');
          this.emitToHumans(room, 'opponentLeft', {
            playerId: player.playerId,
            nickname: current.nickname,
            forfeit: true,
            reconnectIn: 0
          }, (p) => p.playerId !== player.playerId);
        } else {
          this.closeRoom(room, 'ROOM_CLOSED', 'Both players disconnected.');
        }
        return;
      }

      if (room.state === 'result') {
        room.players.delete(player.playerId);
        const registryPlayer = this.registry.getById(player.playerId);
        if (registryPlayer) this.registry.setStatus(registryPlayer, 'idle', null);
        if (room.players.size === 0) {
          this.clearRoomTimers(room);
          room.state = 'closed';
          this.rooms.delete(room.code);
        } else {
          this.broadcastRoom(room);
        }
        return;
      }

      if (room.state === 'lobby') {
        if (room.hostId === player.playerId) {
          this.closeRoom(room, 'ROOM_CLOSED', 'The host disconnected.');
        } else {
          room.players.delete(player.playerId);
          const registryPlayer = this.registry.getById(player.playerId);
          if (registryPlayer) this.registry.setStatus(registryPlayer, 'idle', null);
          this.broadcastRoom(room);
        }
      }
    }, DISCONNECT_GRACE_MS);

    if (timer.unref) timer.unref();
    room.disconnectTimers.set(player.playerId, timer);
    return room;
  }

  /** Restore a player into their previous room after a socket reconnect. */
  handleReconnect(player) {
    if (!player || !player.roomCode) return null;
    const room = this.rooms.get(player.roomCode);
    if (!room) {
      this.registry.setStatus(player, 'idle', null);
      return null;
    }

    const timer = room.disconnectTimers.get(player.playerId);
    if (timer) {
      clearTimeout(timer);
      room.disconnectTimers.delete(player.playerId);
    }

    const roomPlayer = room.players.get(player.playerId);
    if (roomPlayer) {
      roomPlayer.disconnected = false;
      roomPlayer.socketId = player.socketId;
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) socket.join(room.code);
      this.registry.setStatus(
        player,
        room.state === 'playing' ? 'in_match' : 'in_room',
        room.code
      );
      room.lastActivity = Date.now();
      this.broadcastRoom(room);
      this.emitToHumans(room, 'opponentReconnected', {
        playerId: player.playerId,
        nickname: player.nickname
      }, (p) => p.playerId !== player.playerId);

      if (room.state === 'playing' && room.game) {
        this.io.to(player.socketId).emit('gameStart', this.buildGameStartPayload(room, false));
      } else if (room.state === 'result' && room.matchResult) {
        this.io.to(player.socketId).emit('matchEnd', this.buildMatchEndPayload(room));
      } else {
        this.io.to(player.socketId).emit('roomUpdate', this.serializeRoom(room));
      }
      return room;
    }

    const spectatorEntry = [...room.spectators.values()].find((s) => s.playerId === player.playerId);
    if (spectatorEntry) {
      room.spectators.delete(spectatorEntry.socketId);
      spectatorEntry.socketId = player.socketId;
      spectatorEntry.nickname = player.nickname;
      room.spectators.set(player.socketId, spectatorEntry);
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) socket.join(room.code);
      this.registry.setStatus(player, 'in_room', room.code);
      this.sendCurrentView(player, room);
      this.broadcastRoom(room);
      return room;
    }

    this.registry.setStatus(player, 'idle', null);
    return null;
  }

  buildMatchEndPayload(room) {
    if (!room || !room.matchResult) return null;
    return {
      roomCode: room.code,
      ...room.matchResult,
      room: this.serializeRoom(room)
    };
  }

  /**
   * Finish a match exactly once. Natural KOs, timeouts, forfeits and disconnect
   * timeouts all end up here. Updates Elo ratings and win/loss records.
   */
  finishMatch(room, winnerId, reason = 'ko') {
    if (!room || room.matchResult || !room.game) return null;
    const winnerEntry = room.players.get(winnerId);
    const loserEntry = [...room.players.values()].find((p) => p.playerId !== winnerId);
    if (!winnerEntry || !loserEntry) return null;

    const game = room.game;
    const score = {
      [winnerEntry.playerId]: game.roundWins[winnerEntry.playerId] || 0,
      [loserEntry.playerId]: game.roundWins[loserEntry.playerId] || 0
    };

    game.phase = 'match_end';
    game.matchEnded = true;
    game.winnerId = winnerEntry.playerId;
    game.loserId = loserEntry.playerId;
    game.cinematic = null;
    if (!game.events.some((event) => event.type === 'matchEnd')) {
      game.events.push({
        id: ++game.eventSeq,
        type: 'matchEnd',
        tick: game.tick,
        winnerId: winnerEntry.playerId,
        loserId: loserEntry.playerId,
        wins: { ...game.roundWins }
      });
    }

    const profiles = {};
    const ratings = {};

    // Elo-like rating for human-vs-human matches. Bot matches still count toward
    // wins/losses so the profile stays meaningful, but do not change rating.
    const winnerRegistry = winnerEntry.isBot ? null : this.registry.getById(winnerEntry.playerId);
    const loserRegistry = loserEntry.isBot ? null : this.registry.getById(loserEntry.playerId);

    if (winnerRegistry) {
      winnerRegistry.wins += 1;
      winnerEntry.wins = winnerRegistry.wins;
    }
    if (loserRegistry) {
      loserRegistry.losses += 1;
      loserEntry.losses = loserRegistry.losses;
    }

    if (winnerRegistry && loserRegistry && room.mode !== 'bot') {
      const expectedWinner = 1 / (1 + 10 ** ((loserRegistry.rating - winnerRegistry.rating) / 400));
      const delta = Math.max(1, Math.round(32 * (1 - expectedWinner)));
      const beforeWinner = winnerRegistry.rating;
      const beforeLoser = loserRegistry.rating;
      winnerRegistry.rating = Math.max(0, beforeWinner + delta);
      loserRegistry.rating = Math.max(0, beforeLoser - delta);
      ratings[winnerEntry.playerId] = {
        before: beforeWinner,
        after: winnerRegistry.rating,
        delta: winnerRegistry.rating - beforeWinner
      };
      ratings[loserEntry.playerId] = {
        before: beforeLoser,
        after: loserRegistry.rating,
        delta: loserRegistry.rating - beforeLoser
      };
    }

    for (const [id, entry] of room.players) {
      if (entry.isBot) continue;
      entry.rating = this.registry.getById(id)?.rating || entry.rating;
      const registryPlayer = this.registry.getById(id);
      if (registryPlayer) {
        profiles[id] = this.registry.profile(registryPlayer);
        this.registry.setStatus(registryPlayer, 'in_room', room.code);
      }
    }

    room.state = 'result';
    room.matchResult = {
      winnerId: winnerEntry.playerId,
      loserId: loserEntry.playerId,
      winnerName: winnerEntry.nickname,
      loserName: loserEntry.nickname,
      reason,
      score,
      roundWins: { ...game.roundWins },
      ratings,
      profiles,
      endedAt: Date.now()
    };
    room.rematchVotes.clear();
    if (room.rematchTimer) clearTimeout(room.rematchTimer);
    room.rematchTimer = null;
    this.clearRoomTimers(room);
    room.lastActivity = Date.now();

    // Send one final snapshot so clients see the KO frame, then the result.
    try {
      this.io.to(room.code).emit('snapshot', buildSnapshot(room));
      clearEvents(game);
    } catch (error) {
      console.error('[rooms] Failed to send final snapshot:', error.message);
    }
    this.io.to(room.code).emit('matchEnd', this.buildMatchEndPayload(room));
    this.broadcastRoom(room);
    return room.matchResult;
  }

  /** Ask for a rematch. Both humans must accept; a CPU auto-accepts. */
  requestRematch(room, playerId, accept = true) {
    if (!room || room.state !== 'result' || !room.matchResult) {
      throw new RoomError('NOT_IN_RESULT', 'The match has not finished.');
    }
    if (!room.players.has(playerId)) throw new RoomError('NOT_IN_ROOM', 'You are not in this room.');

    if (!accept) {
      room.rematchVotes.delete(playerId);
      if (room.rematchTimer) clearTimeout(room.rematchTimer);
      room.rematchTimer = null;
      this.io.to(room.code).emit('rematchUpdate', {
        votes: [...room.rematchVotes],
        cancelled: true,
        starting: false
      });
      return false;
    }

    room.rematchVotes.add(playerId);
    const humans = [...room.players.values()].filter((p) => !p.isBot);
    const allHumansReady = humans.every((p) => room.rematchVotes.has(p.playerId) && !p.disconnected);

    if (room.mode === 'bot' || (allHumansReady && humans.length > 0)) {
      if (room.rematchTimer) clearTimeout(room.rematchTimer);
      room.rematchTimer = null;
      this.io.to(room.code).emit('rematchUpdate', {
        votes: [...room.rematchVotes],
        starting: true
      });
      room.lastActivity = Date.now();
      this.startGame(room);
      return true;
    }

    if (!room.rematchTimer) {
      room.rematchTimer = setTimeout(() => {
        if (!room.matchResult) return;
        room.rematchVotes.clear();
        room.rematchTimer = null;
        this.io.to(room.code).emit('rematchUpdate', {
          votes: [],
          expired: true,
          starting: false
        });
      }, REMATCH_TIMEOUT_MS);
      if (room.rematchTimer.unref) room.rematchTimer.unref();
    }

    this.io.to(room.code).emit('rematchUpdate', {
      votes: [...room.rematchVotes],
      starting: false,
      deadline: Date.now() + REMATCH_TIMEOUT_MS
    });
    return false;
  }

  /** Private rooms can return both players to the lobby after a match. */
  returnToLobby(room, playerId) {
    if (!room || room.state !== 'result') {
      throw new RoomError('NOT_IN_RESULT', 'The match has not finished.');
    }
    if (room.mode !== 'private') {
      throw new RoomError('NOT_PRIVATE', 'Only private rooms have a lobby.');
    }
    if (!room.players.has(playerId)) throw new RoomError('NOT_IN_ROOM', 'You are not in this room.');

    room.state = 'lobby';
    room.game = null;
    room.matchResult = null;
    room.rematchVotes.clear();
    if (room.rematchTimer) clearTimeout(room.rematchTimer);
    room.rematchTimer = null;
    this.clearRoomTimers(room);
    for (const roomPlayer of room.players.values()) {
      roomPlayer.ready = false;
      if (roomPlayer.isBot) continue;
      const registryPlayer = this.registry.getById(roomPlayer.playerId);
      if (registryPlayer) this.registry.setStatus(registryPlayer, 'in_room', room.code);
    }
    room.lastActivity = Date.now();
    this.broadcastRoom(room);
    return room;
  }

  cleanup() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      const idle = room.state !== 'playing' && now - room.lastActivity > ROOM_IDLE_MS;
      const empty = room.players.size === 0;
      const tooOld = now - room.createdAt > 2 * 60 * 60 * 1000;
      if (idle || empty || tooOld) {
        this.closeRoom(room, 'ROOM_EXPIRED', 'This room expired after being idle.');
      }
    }
    this.registry.cleanup();
  }
}

module.exports = {
  RoomManager,
  GameRoom,
  RoomError,
  ROOM_IDLE_MS,
  DISCONNECT_GRACE_MS,
  REMATCH_TIMEOUT_MS
};
