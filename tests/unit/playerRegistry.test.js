import { describe, it, expect } from 'vitest';
import { PlayerRegistry, cleanNickname, cleanPlayerId } from '../../server/playerRegistry';

describe('PlayerRegistry & Sanitization', () => {
  it('cleans nicknames and removes control characters', () => {
    expect(cleanNickname('  Fighter \n\t ')).toBe('Fighter');
    expect(cleanNickname('<script>alert(1)</script>')).toBe('<script>aler'); // max 12 chars
    expect(cleanNickname('')).toBe('');
    expect(cleanNickname(null)).toBe('');
    expect(cleanNickname('VeryLongPlayerNickname')).toBe('VeryLongPlay');
  });

  it('validates and sanitizes playerId format', () => {
    const valid = 'user_123456';
    expect(cleanPlayerId(valid)).toBe(valid);

    const invalid = 'bad id with spaces';
    expect(cleanPlayerId(invalid)).toMatch(/^guest_[a-f0-9]{16}$/);
  });

  it('registers player and updates profile', () => {
    const registry = new PlayerRegistry();
    const player = registry.register({
      socketId: 'sock_1',
      nickname: 'BladeMaster',
      playerId: 'player_001',
      heroId: 'flame',
      profile: { rating: 1250, wins: 5, losses: 2 }
    });

    expect(player.playerId).toBe('player_001');
    expect(player.nickname).toBe('BladeMaster');
    expect(player.rating).toBe(1250);
    expect(player.wins).toBe(5);
    expect(player.losses).toBe(2);
    expect(registry.countOnline()).toBe(1);

    const profile = registry.profile(player);
    expect(profile.playerId).toBe('player_001');
    expect(profile.socketId).toBeUndefined(); // private socket ID must not leak
  });

  it('handles duplicate session takeover gracefully', () => {
    const registry = new PlayerRegistry();
    const p1 = registry.register({
      socketId: 'sock_tab1',
      nickname: 'BladeMaster',
      playerId: 'player_001'
    });
    expect(registry.getBySocket('sock_tab1')).toBe(p1);

    // Tab 2 connects with the same playerId
    const p2 = registry.register({
      socketId: 'sock_tab2',
      nickname: 'BladeMaster',
      playerId: 'player_001'
    });

    expect(p1).toBe(p2);
    expect(registry.getBySocket('sock_tab1')).toBeNull();
    expect(registry.getBySocket('sock_tab2')).toBe(p2);
    expect(registry.countOnline()).toBe(1);
  });
});

