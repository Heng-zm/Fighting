'use strict';

/**
 * In-memory player registry.
 *
 * The client owns a persistent guest id (stored in localStorage), so players can
 * be restored after a socket reconnect or a page reload. Everything else here is
 * ephemeral and intentionally lives only in memory.
 */

const crypto = require('crypto');

const MAX_NICKNAME_LENGTH = 12;
const VALID_STATUSES = new Set(['idle', 'queue', 'in_room', 'in_match']);

/** Remove control characters and trim a nickname to 12 visible characters. */
function cleanNickname(raw) {
  const text = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, MAX_NICKNAME_LENGTH).join('');
}

function cleanPlayerId(raw) {
  const id = String(raw == null ? '' : raw).trim();
  if (/^[A-Za-z0-9_-]{6,64}$/.test(id)) return id;
  return `guest_${crypto.randomBytes(8).toString('hex')}`;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

class PlayerRegistry {
  constructor() {
    /** @type {Map<string, object>} playerId -> player record */
    this.players = new Map();
    /** @type {Map<string, string>} socketId -> playerId */
    this.socketToPlayer = new Map();
  }

  /**
   * Register (or restore) a player and bind them to a socket.
   * When a player reconnects, their old socket mapping is discarded.
   */
  register({ socketId, nickname, playerId, heroId, profile }) {
    const id = cleanPlayerId(playerId);
    let player = this.players.get(id);
    const isNew = !player;

    if (!player) {
      player = {
        playerId: id,
        nickname: 'Fighter',
        socketId: null,
        connected: false,
        status: 'idle',
        roomCode: null,
        rating: 1000,
        wins: 0,
        losses: 0,
        heroId: null,
        createdAt: Date.now(),
        lastSeen: Date.now()
      };
      this.players.set(id, player);

      // Adopt the locally persisted profile for brand new identities. This keeps
      // progression visible across server restarts while the game is in-memory.
      if (profile && typeof profile === 'object') {
        player.rating = clampInt(profile.rating, 0, 5000, 1000);
        player.wins = clampInt(profile.wins, 0, 999999, 0);
        player.losses = clampInt(profile.losses, 0, 999999, 0);
      }
    }

    if (player.socketId && player.socketId !== socketId) {
      this.socketToPlayer.delete(player.socketId);
    }
    player.socketId = socketId;
    player.connected = true;
    player.lastSeen = Date.now();
    player.nickname = cleanNickname(nickname) || player.nickname || 'Fighter';
    if (heroId) player.heroId = String(heroId);
    this.socketToPlayer.set(socketId, id);
    return player;
  }

  getById(playerId) {
    return this.players.get(playerId) || null;
  }

  getBySocket(socketId) {
    const id = this.socketToPlayer.get(socketId);
    return id ? this.players.get(id) || null : null;
  }

  markDisconnected(player) {
    if (!player) return;
    player.connected = false;
    player.lastSeen = Date.now();
    if (player.socketId) this.socketToPlayer.delete(player.socketId);
    player.socketId = null;
  }

  setStatus(player, status, roomCode = null) {
    if (!player) return;
    if (!VALID_STATUSES.has(status)) return;
    player.status = status;
    player.roomCode = roomCode;
    player.lastSeen = Date.now();
  }

  /** Public shape shared with the client. Never includes socket information. */
  profile(player) {
    return {
      playerId: player.playerId,
      nickname: player.nickname,
      rating: player.rating,
      wins: player.wins,
      losses: player.losses,
      heroId: player.heroId,
      status: player.status,
      online: player.connected
    };
  }

  countOnline() {
    let count = 0;
    for (const player of this.players.values()) if (player.connected) count += 1;
    return count;
  }

  countSearching() {
    let count = 0;
    for (const player of this.players.values()) {
      if (player.connected && player.status === 'queue') count += 1;
    }
    return count;
  }

  /** Drop long-dead identities to keep memory bounded. */
  cleanup(maxAgeMs = 1000 * 60 * 60 * 6) {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, player] of this.players) {
      if (!player.connected && !player.roomCode && player.lastSeen < cutoff) {
        this.players.delete(id);
      }
    }
  }
}

module.exports = {
  PlayerRegistry,
  cleanNickname,
  cleanPlayerId,
  MAX_NICKNAME_LENGTH
};
