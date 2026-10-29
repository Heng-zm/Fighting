import { describe, it, expect } from 'vitest';
import { RoomManager } from '../../server/roomManager';

describe('Room Code Generation & Collisions', () => {
  it('generates uppercase codes without ambiguous characters (0, O, 1, I)', () => {
    const mockIo = { sockets: { sockets: new Map() }, to: () => ({ emit: () => {} }) };
    const mockRegistry = { setStatus: () => {} };
    const mockCharacters = { all: () => [{ id: 'flame' }] };
    const manager = new RoomManager(mockIo, mockRegistry, mockCharacters);

    const generated = new Set();
    const ambiguousChars = ['0', 'O', '1', 'I'];

    for (let i = 0; i < 500; i++) {
      const code = manager.newCode();
      expect(code.length).toBeGreaterThanOrEqual(4);
      expect(code).toBe(code.toUpperCase());
      for (const ch of ambiguousChars) {
        expect(code.includes(ch)).toBe(false);
      }
      generated.add(code);
    }

    // High randomness across 500 codes
    expect(generated.size).toBeGreaterThan(450);

    clearInterval(manager.cleanupTimer);
  });

  it('handles room code collision by retrying or extending length', () => {
    const mockIo = { sockets: { sockets: new Map() }, to: () => ({ emit: () => {} }) };
    const mockRegistry = { setStatus: () => {} };
    const mockCharacters = { all: () => [{ id: 'flame' }] };
    const manager = new RoomManager(mockIo, mockRegistry, mockCharacters);

    // Pre-populate rooms
    const existingCode = manager.newCode();
    manager.rooms.set(existingCode, { code: existingCode });

    const newCode = manager.newCode();
    expect(newCode).not.toBe(existingCode);
    expect(manager.rooms.has(newCode)).toBe(false);

    clearInterval(manager.cleanupTimer);
  });
});

