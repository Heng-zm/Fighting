import { describe, it, expect, vi } from 'vitest';
import { Matchmaker } from '../../server/matchmaker';

function createMockDeps() {
  const sockets = new Map();
  const io = {
    to: vi.fn((socketId) => ({
      emit: vi.fn((event, data) => {})
    })),
    emit: vi.fn()
  };
  const registry = {
    players: new Map(),
    getById: vi.fn((id) => registry.players.get(id)),
    setStatus: vi.fn((p, status, roomCode) => {
      if (p) {
        p.status = status;
        p.roomCode = roomCode;
      }
    }),
    countOnline: vi.fn(() => 10)
  };
  const rooms = {
    rooms: new Map(),
    createMatchRoom: vi.fn((p1, p2) => {
      const room = { code: 'TEST_ROOM', players: new Map() };
      return room;
    }),
    completeAcceptance: vi.fn(),
    discardRoom: vi.fn()
  };
  return { io, registry, rooms };
}

describe('Matchmaker Unit Tests', () => {
  it('prevents duplicate queueing for the same player', () => {
    const deps = createMockDeps();
    const mm = new Matchmaker(deps);

    const player1 = {
      playerId: 'p1',
      socketId: 's1',
      nickname: 'Hero1',
      rating: 1000,
      status: 'idle',
      connected: true
    };
    deps.registry.players.set('p1', player1);

    const entry1 = mm.join(player1);
    expect(entry1).toBeDefined();
    expect(mm.queue.size).toBe(1);

    // Second join should return existing entry without creating duplicates
    const entry2 = mm.join(player1);
    expect(entry2.playerId).toBe('p1');
    expect(mm.queue.size).toBe(1);

    mm.close();
  });

  it('widens rating range over time (starts +/-100 and grows by 50 every 5s)', () => {
    const deps = createMockDeps();
    const mm = new Matchmaker(deps);

    const player = {
      playerId: 'p1',
      socketId: 's1',
      nickname: 'Hero1',
      rating: 1200,
      status: 'idle',
      connected: true
    };
    deps.registry.players.set('p1', player);

    const entry = mm.join(player);
    const statusAt0 = mm.queueStatusFor(entry);
    expect(statusAt0.range.width).toBe(100);
    expect(statusAt0.range.min).toBe(1100);
    expect(statusAt0.range.max).toBe(1300);

    // Simulate 5 seconds elapsed
    entry.joinedAt = Date.now() - 5000;
    const statusAt5 = mm.queueStatusFor(entry);
    expect(statusAt5.range.width).toBe(150);

    // Simulate 10 seconds elapsed
    entry.joinedAt = Date.now() - 10000;
    const statusAt10 = mm.queueStatusFor(entry);
    expect(statusAt10.range.width).toBe(200);

    mm.close();
  });

  it('pairs two compatible players and emits matchFound', () => {
    const deps = createMockDeps();
    const mm = new Matchmaker(deps);

    const player1 = {
      playerId: 'p1',
      socketId: 's1',
      nickname: 'Hero1',
      rating: 1000,
      status: 'idle',
      connected: true
    };
    const player2 = {
      playerId: 'p2',
      socketId: 's2',
      nickname: 'Hero2',
      rating: 1050,
      status: 'idle',
      connected: true
    };
    deps.registry.players.set('p1', player1);
    deps.registry.players.set('p2', player2);

    mm.join(player1);
    mm.join(player2);

    expect(mm.queue.size).toBe(2);

    // Trigger pairing pass
    mm.tick();

    expect(deps.rooms.createMatchRoom).toHaveBeenCalled();
    expect(mm.pending.has('p1')).toBe(true);
    expect(mm.pending.has('p2')).toBe(true);
    expect(mm.queue.size).toBe(0);

    mm.close();
  });

  it('completes match when both players accept', () => {
    const deps = createMockDeps();
    const mm = new Matchmaker(deps);

    const p1 = { playerId: 'p1', socketId: 's1', nickname: 'H1', rating: 1000, connected: true };
    const p2 = { playerId: 'p2', socketId: 's2', nickname: 'H2', rating: 1000, connected: true };
    deps.registry.players.set('p1', p1);
    deps.registry.players.set('p2', p2);

    mm.join(p1);
    mm.join(p2);
    mm.tick();

    expect(mm.pending.has('p1')).toBe(true);

    mm.accept('p1');
    expect(deps.rooms.completeAcceptance).not.toHaveBeenCalled();

    mm.accept('p2');
    expect(deps.rooms.completeAcceptance).toHaveBeenCalled();
    expect(mm.pending.has('p1')).toBe(false);
    expect(mm.pending.has('p2')).toBe(false);

    mm.close();
  });

  it('cancels match and dispatches opponent if one declines', () => {
    const deps = createMockDeps();
    const mm = new Matchmaker(deps);

    const p1 = { playerId: 'p1', socketId: 's1', nickname: 'H1', rating: 1000, connected: true };
    const p2 = { playerId: 'p2', socketId: 's2', nickname: 'H2', rating: 1000, connected: true };
    deps.registry.players.set('p1', p1);
    deps.registry.players.set('p2', p2);

    mm.join(p1);
    mm.join(p2);
    mm.tick();

    mm.decline('p1', 'declined');
    expect(deps.rooms.discardRoom).toHaveBeenCalled();
    expect(mm.pending.has('p1')).toBe(false);
    expect(mm.pending.has('p2')).toBe(false);

    mm.close();
  });
});

