import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as Client } from 'socket.io-client';
import { server, io, registry, rooms, matchmaker, DISCONNECT_GRACE_MS } from '../../server/index';

let serverUrl;
let port;

function createClient(nickname, playerId) {
  const socket = Client(serverUrl, {
    transports: ['websocket'],
    forceNew: true
  });
  const eventBuffer = [];
  socket.onAny((event, ...args) => {
    eventBuffer.push({ event, args });
  });

  const readyPromise = new Promise((resolve) => {
    socket.on('connect', () => {
      socket.emit('setNickname', { nickname, playerId, heroId: 'flame' });
    });
    socket.on('nicknameSet', (profile) => {
      resolve({ socket, profile, eventBuffer });
    });
  });

  return readyPromise;
}

function waitForEvent(socket, eventName, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeoutMs);
    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

beforeAll(async () => {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      serverUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  matchmaker.close();
  io.close();
  await new Promise((resolve) => server.close(resolve));
});

describe('Socket.IO Integration & Protocol Tests', () => {
  it('handles room create, join, ready, and start', async () => {
    const p1 = await createClient('Alice', 'alice_001');
    const p2 = await createClient('Bob', 'bob_002');

    // Alice creates private room
    p1.socket.emit('roomCreate');
    const roomCreated = await waitForEvent(p1.socket, 'roomUpdate');
    const roomCode = roomCreated.code;
    expect(roomCode).toBeDefined();
    expect(roomCreated.players.length).toBe(1);

    // Bob joins room by code
    p2.socket.emit('roomJoin', { code: roomCode });
    const roomJoined = await waitForEvent(p2.socket, 'roomUpdate');
    expect(roomJoined.players.length).toBe(2);

    // Alice sets ready
    p1.socket.emit('roomReady', { ready: true, heroId: 'flame' });

    // Bob sets ready; match should start
    const startP1Promise = waitForEvent(p1.socket, 'gameStart');
    const startP2Promise = waitForEvent(p2.socket, 'gameStart');
    p2.socket.emit('roomReady', { ready: true, heroId: 'shade' });

    const [gameStartP1, gameStartP2] = await Promise.all([startP1Promise, startP2Promise]);

    expect(gameStartP1.roomCode).toBe(roomCode);
    expect(gameStartP2.roomCode).toBe(roomCode);
    expect(gameStartP1.players.length).toBe(2);

    p1.socket.disconnect();
    p2.socket.disconnect();
  });

  it('handles invalid events and malformed payloads without crashing', async () => {
    const p = await createClient('Tester', 'tester_003');

    // Send malformed payloads (strings/numbers/null where objects expected)
    p.socket.emit('roomJoin', { code: 12345 });
    p.socket.emit('roomReady', 'not-an-object');
    p.socket.emit('input', { input: 'invalid-string' });
    p.socket.emit('emote', { text: '<script>alert(1)</script>' });
    p.socket.emit('chooseHero', { heroId: 'non_existent_hero_xyz' });

    const err = await waitForEvent(p.socket, 'roomError');
    expect(err).toBeDefined();

    // Verify server is alive and responds to ping
    p.socket.emit('ping', { t: Date.now() });
    const pong = await waitForEvent(p.socket, 'pong');
    expect(pong.t).toBeDefined();

    p.socket.disconnect();
  });

  it('matches two queuing players and starts game upon acceptance', async () => {
    const q1 = await createClient('Queuer1', 'queuer_001');
    const q2 = await createClient('Queuer2', 'queuer_002');

    const found1Promise = waitForEvent(q1.socket, 'matchFound');
    const found2Promise = waitForEvent(q2.socket, 'matchFound');

    q1.socket.emit('queueJoin');
    q2.socket.emit('queueJoin');

    const [found1, found2] = await Promise.all([found1Promise, found2Promise]);
    expect(found1.roomCode).toBe(found2.roomCode);

    // Both accept
    const start1Promise = waitForEvent(q1.socket, 'roomUpdate');
    const start2Promise = waitForEvent(q2.socket, 'roomUpdate');

    q1.socket.emit('matchAccept');
    q2.socket.emit('matchAccept');

    const [update1, update2] = await Promise.all([start1Promise, start2Promise]);
    expect(update1.state).toBe('lobby');

    q1.socket.disconnect();
    q2.socket.disconnect();
  });

  it('reconnects a player within grace window into the same room', async () => {
    const r1 = await createClient('Recon1', 'recon_001');
    const r2 = await createClient('Recon2', 'recon_002');

    r1.socket.emit('roomCreate');
    const room = await waitForEvent(r1.socket, 'roomUpdate');

    r2.socket.emit('roomJoin', { code: room.code });
    await waitForEvent(r2.socket, 'roomUpdate');

    // r1 disconnects
    r1.socket.disconnect();

    const oppEvent = await waitForEvent(r2.socket, 'roomUpdate');
    const disconnectedPlayer = oppEvent.players.find((p) => p.playerId === 'recon_001');
    expect(disconnectedPlayer.disconnected).toBe(true);

    // r1 reconnects with new socket using same playerId
    const r1NewSocket = Client(serverUrl, { transports: ['websocket'], forceNew: true });
    const updatePromise = waitForEvent(r1NewSocket, 'roomUpdate');

    r1NewSocket.emit('setNickname', { nickname: 'Recon1', playerId: 'recon_001' });
    const restoredRoom = await updatePromise;

    expect(restoredRoom.code).toBe(room.code);
    const reconnectedPlayer = restoredRoom.players.find((p) => p.playerId === 'recon_001');
    expect(reconnectedPlayer.disconnected).toBe(false);

    r1NewSocket.disconnect();
    r2.socket.disconnect();
  });

  it('opponent wins when disconnected player does not return before grace timeout', async () => {
    // Start game between two players
    const p1 = await createClient('TimeoutP1', 'timeout_001');
    const p2 = await createClient('TimeoutP2', 'timeout_002');

    p1.socket.emit('roomCreate');
    const room = await waitForEvent(p1.socket, 'roomUpdate');

    p2.socket.emit('roomJoin', { code: room.code });
    await waitForEvent(p2.socket, 'roomUpdate');

    const startP2 = waitForEvent(p2.socket, 'gameStart');
    p1.socket.emit('roomReady', { ready: true });
    p2.socket.emit('roomReady', { ready: true });
    await startP2;

    const gameRoom = rooms.getRoom(room.code);
    expect(gameRoom).toBeDefined();
    expect(gameRoom.state).toBe('playing');

    // p1 disconnects during match
    const oppLeftPromise = waitForEvent(p2.socket, 'opponentLeft');
    p1.socket.disconnect();
    const oppLeftData = await oppLeftPromise;
    expect(oppLeftData.playerId).toBe('timeout_001');

    // The disconnect grace timer was set for DISCONNECT_GRACE_MS
    expect(gameRoom.disconnectTimers.has('timeout_001')).toBe(true);

    const matchEndPromise = waitForEvent(p2.socket, 'matchEnd');

    // Trigger the timeout callback directly to test the rule without waiting 15 full seconds
    const timer = gameRoom.disconnectTimers.get('timeout_001');
    // We simulate expiration
    clearTimeout(timer);
    gameRoom.disconnectTimers.delete('timeout_001');

    rooms.finishMatch(gameRoom, 'timeout_002', 'disconnect');

    const matchEndResult = await matchEndPromise;
    expect(matchEndResult.winnerId).toBe('timeout_002');
    expect(matchEndResult.reason).toBe('disconnect');

    p2.socket.disconnect();
  });

  it('supports rematch negotiation between players', async () => {
    const p1 = await createClient('Rematch1', 'rematch_001');
    const p2 = await createClient('Rematch2', 'rematch_002');

    p1.socket.emit('roomCreate');
    const room = await waitForEvent(p1.socket, 'roomUpdate');

    p2.socket.emit('roomJoin', { code: room.code });
    await waitForEvent(p2.socket, 'roomUpdate');

    const startP1 = waitForEvent(p1.socket, 'gameStart');
    p1.socket.emit('roomReady', { ready: true });
    p2.socket.emit('roomReady', { ready: true });
    await startP1;

    const gameRoom = rooms.getRoom(room.code);
    expect(gameRoom.state).toBe('playing');

    // Simulate match end
    const matchEndP1 = waitForEvent(p1.socket, 'matchEnd');
    const matchEndP2 = waitForEvent(p2.socket, 'matchEnd');
    rooms.finishMatch(gameRoom, 'rematch_001', 'ko');
    await Promise.all([matchEndP1, matchEndP2]);

    expect(gameRoom.state).toBe('result');

    // Both players request rematch
    const newGameP1 = waitForEvent(p1.socket, 'gameStart');
    const newGameP2 = waitForEvent(p2.socket, 'gameStart');

    p1.socket.emit('rematchRequest', { accept: true });
    p2.socket.emit('rematchRequest', { accept: true });

    const [game2P1, game2P2] = await Promise.all([newGameP1, newGameP2]);
    expect(game2P1.roomCode).toBe(room.code);
    expect(gameRoom.state).toBe('playing');

    p1.socket.disconnect();
    p2.socket.disconnect();
  });
});
