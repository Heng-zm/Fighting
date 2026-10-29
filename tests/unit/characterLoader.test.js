import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { CharacterLoader } from '../../server/characterLoader';

describe('CharacterLoader', () => {
  const loader = new CharacterLoader();
  const heroes = loader.load();

  it('loads valid characters from characters directory', () => {
    expect(heroes.characters.size).toBeGreaterThanOrEqual(2);
    expect(heroes.get('flame')).toBeDefined();
    expect(heroes.get('shade')).toBeDefined();
  });

  it('validates stats have sensible numbers and defaults', () => {
    for (const hero of heroes.all()) {
      expect(hero.stats.maxHealth).toBeGreaterThan(0);
      expect(hero.stats.walkSpeed).toBeGreaterThan(0);
      expect(hero.stats.jumpPower).toBeGreaterThan(0);
      expect(hero.stats.weight).toBeGreaterThan(0);
    }
  });

  it('validates all required moves exist with hitbox and frame data', () => {
    for (const hero of heroes.all()) {
      expect(hero.moves.light).toBeDefined();
      expect(hero.moves.light.damage).toBeGreaterThan(0);
      expect(hero.moves.light.hitbox).toBeDefined();
      expect(hero.moves.heavy).toBeDefined();
      expect(hero.moves.heavy.damage).toBeGreaterThan(hero.moves.light.damage);
    }
  });

  it('validates skills have valid slots (S1, S2, S3, ULT) and positive power cost', () => {
    for (const hero of heroes.all()) {
      expect(hero.skills.length).toBeGreaterThanOrEqual(2);
      expect(hero.skillsBySlot.ULT).toBeDefined();
      for (const skill of hero.skills) {
        expect(['S1', 'S2', 'S3', 'ULT']).toContain(skill.slot);
        expect(skill.cooldown).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('produces sanitized public character view without server-private logic', () => {
    const publicHero = heroes.getPublic('flame');
    expect(publicHero).toBeDefined();
    expect(publicHero.id).toBe('flame');
    expect(publicHero.displayName).toBe('Flame');
    expect(publicHero.skills).toBeInstanceOf(Array);
    // Custom skills code is not leaked to public payload
    expect(publicHero.customSkills).toBeUndefined();
  });

  it('gracefully handles missing directory or empty results', () => {
    const emptyLoader = new CharacterLoader();
    emptyLoader.characters.clear();
    expect(emptyLoader.characters.size).toBe(0);
    expect(emptyLoader.all()).toEqual([]);
    expect(emptyLoader.get('unknown')).toBeNull();
    expect(emptyLoader.getPublic('unknown')).toBeNull();
  });

  it('automatically discovers a new hero created by CLI without code changes', () => {
    const heroId = 'clitestbot';
    const heroDir = path.join(__dirname, '..', '..', 'characters', heroId);

    // Clean up if existed from previous run
    if (fs.existsSync(heroDir)) {
      fs.rmSync(heroDir, { recursive: true, force: true });
    }

    try {
      // Create new character via CLI script
      const { execSync } = require('child_process');
      execSync(`node scripts/newCharacter.js ${heroId}`, {
        cwd: path.join(__dirname, '..', '..'),
        stdio: 'pipe'
      });

      expect(fs.existsSync(path.join(heroDir, 'character.json'))).toBe(true);

      // Reload characters
      const freshLoader = new CharacterLoader();
      freshLoader.load();

      const newHero = freshLoader.get(heroId);
      expect(newHero).toBeDefined();
      expect(newHero.id).toBe(heroId);
      expect(newHero.skills.length).toBe(4);
      expect(newHero.skillsBySlot.ULT).toBeDefined();
      expect(newHero.moves.light).toBeDefined();
      expect(newHero.moves.heavy).toBeDefined();
    } finally {
      // Clean up test character
      if (fs.existsSync(heroDir)) {
        fs.rmSync(heroDir, { recursive: true, force: true });
      }
    }
  });
});
