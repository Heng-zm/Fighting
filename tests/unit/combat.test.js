import { describe, it, expect } from 'vitest';
import {
  ARENA,
  PHYSICS,
  overlaps,
  hurtbox,
  worldHitbox,
  applyDamage,
  grantShield,
  heal,
  applyEffects,
  tickStatuses,
  endRound,
  clamp
} from '../../server/combat';

function mockPlayer(id, options = {}) {
  return {
    id,
    nickname: `Player_${id}`,
    x: options.x ?? 400,
    y: ARENA.groundY,
    vx: 0,
    vy: 0,
    facing: options.facing ?? 1,
    grounded: options.grounded !== false,
    health: options.health ?? 100,
    maxHealth: 100,
    power: options.power ?? 0,
    state: 'idle',
    anim: 'idle',
    blocking: options.blocking ?? false,
    crouching: options.crouching ?? false,
    action: null,
    hitstun: 0,
    blockstun: 0,
    invuln: options.invuln ?? 0,
    statuses: [],
    shield: options.shield ?? null,
    cooldowns: { S1: 0, S2: 0, S3: 0, ULT: 0 },
    combo: 0,
    comboTimer: 0
  };
}

function mockGame(p1, p2) {
  return {
    roomCode: 'TEST',
    tick: 1,
    phase: 'playing',
    countdown: 0,
    round: 1,
    timeLeft: 99 * 60,
    players: [p1, p2],
    roundWins: { [p1.id]: 0, [p2.id]: 0 },
    roundEnded: false,
    roundEndTimer: 0,
    roundEndReason: null,
    roundWinnerId: null,
    events: [],
    eventSeq: 0,
    projectiles: [],
    cinematic: null
  };
}

describe('Combat Engine Math & Mechanics', () => {
  it('calculates bounding box overlaps correctly', () => {
    const boxA = { x: 10, y: 10, w: 50, h: 50 };
    const boxB = { x: 30, y: 30, w: 50, h: 50 };
    const boxC = { x: 100, y: 100, w: 20, h: 20 };

    expect(overlaps(boxA, boxB)).toBe(true);
    expect(overlaps(boxA, boxC)).toBe(false);
  });

  it('calculates hurtbox smaller when crouching', () => {
    const standing = mockPlayer('p1', { crouching: false, grounded: true });
    const crouching = mockPlayer('p2', { crouching: true, grounded: true });

    const hbStanding = hurtbox(standing);
    const hbCrouching = hurtbox(crouching);

    expect(hbCrouching.h).toBeLessThan(hbStanding.h);
  });

  it('calculates worldHitbox facing right vs facing left', () => {
    const pRight = mockPlayer('p1', { x: 200, facing: 1 });
    const pLeft = mockPlayer('p2', { x: 200, facing: -1 });
    const localHb = { x: 20, y: -50, w: 40, h: 30 };

    const wRight = worldHitbox(pRight, localHb);
    const wLeft = worldHitbox(pLeft, localHb);

    expect(wRight.x).toBe(220); // 200 + 20
    expect(wLeft.x).toBe(140);  // 200 - 20 - 40
  });

  it('deals full damage and causes hitstun when target is not blocking', () => {
    const attacker = mockPlayer('p1', { x: 300, facing: 1 });
    const defender = mockPlayer('p2', { x: 350, facing: -1, blocking: false });
    const game = mockGame(attacker, defender);

    const res = applyDamage(game, defender, attacker, 20, { knockback: 5, hitstun: 15 });

    expect(res.damage).toBe(20);
    expect(res.blocked).toBe(false);
    expect(defender.health).toBe(80);
    expect(defender.hitstun).toBe(15);
    expect(defender.vx).toBeGreaterThan(0); // knocked to the right away from attacker
    expect(attacker.combo).toBe(1);
    expect(attacker.power).toBeGreaterThan(0);
    expect(defender.power).toBeGreaterThan(0);
  });

  it('reduces damage and applies blockstun when defender is blocking from front', () => {
    const attacker = mockPlayer('p1', { x: 300, facing: 1 });
    const defender = mockPlayer('p2', { x: 350, facing: -1, blocking: true, grounded: true });
    const game = mockGame(attacker, defender);

    const res = applyDamage(game, defender, attacker, 20, { knockback: 5, blockstun: 12 });

    expect(res.blocked).toBe(true);
    expect(res.damage).toBeLessThan(20); // ~16% chip damage
    expect(defender.blockstun).toBe(12);
    expect(defender.hitstun).toBe(0);
  });

  it('absorbs damage with active shield before affecting health', () => {
    const attacker = mockPlayer('p1', { x: 300 });
    const defender = mockPlayer('p2', { x: 350 });
    const game = mockGame(attacker, defender);

    grantShield(game, defender, 15, 3);
    expect(defender.shield.amount).toBe(15);

    const res = applyDamage(game, defender, attacker, 10);
    expect(res.damage).toBe(0);
    expect(res.shieldAbsorbed).toBe(10);
    expect(defender.health).toBe(100);
    expect(defender.shield.amount).toBe(5);

    // Second hit breaks the shield and deals remaining damage to health
    const res2 = applyDamage(game, defender, attacker, 10);
    expect(res2.damage).toBe(5);
    expect(defender.health).toBe(95);
    expect(defender.shield).toBeNull();
  });

  it('power gauge caps at 100 and cannot go below 0', () => {
    const p = mockPlayer('p1', { power: 98 });
    const game = mockGame(p, mockPlayer('p2'));

    applyDamage(game, p, null, 50);
    expect(p.power).toBeLessThanOrEqual(100);
    expect(p.power).toBeGreaterThanOrEqual(0);
  });

  it('ends round on KO and awards win', () => {
    const attacker = mockPlayer('p1', { x: 300 });
    const defender = mockPlayer('p2', { x: 350, health: 10 });
    const game = mockGame(attacker, defender);

    applyDamage(game, defender, attacker, 25);

    expect(defender.health).toBe(0);
    expect(defender.state).toBe('ko');
    expect(game.roundEnded).toBe(true);
    expect(game.roundWinnerId).toBe('p1');
    expect(game.roundWins['p1']).toBe(1);
  });

  it('handles draw when timeout occurs with equal health', () => {
    const p1 = mockPlayer('p1', { health: 75 });
    const p2 = mockPlayer('p2', { health: 75 });
    const game = mockGame(p1, p2);

    endRound(game, null, 'timeout');

    expect(game.roundEnded).toBe(true);
    expect(game.roundWinnerId).toBeNull();
    expect(game.roundWins['p1']).toBe(0);
    expect(game.roundWins['p2']).toBe(0);
  });
});

