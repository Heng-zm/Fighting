'use strict';

/**
 * In-memory matchmaking queue.
 *
 * Runs a pairing pass every second. The longest-waiting player is matched with
 * the oldest compatible opponent. Rating windows start at +/-100 and widen by
 * 50 every 5 seconds of waiting.
 */

const { RoomError } = require('./roomManager');

const ACCEPT_WINDOW_MS = 5000;
const BOT_OFFER_AFTER_MS = 30000;
const BASE_RATING_RANGE = 100;
const RANGE_GROWTH_PER_5S = 50;

function ratingWindow(waitMs) {
  return BASE_RATING_RANGE + Math.floor(waitMs / 5000) * RANGE_GROWTH_PER_5S;
}

class Matchmaker {
  constructor({ io, registry, rooms }) {
    this.io = io;
    this.registry = registry;
    this.rooms = rooms;
    /** @type {Map<string, object>} playerId -> queue entry */
    this.queue = new Map();
    /** @type {Map<string, object>} playerId -> shared acceptance record */
    this.pending = new Map();
    this.timer = setInterval(() => this.tick(), 1000);
    if (this.timer.unref) this.timer.unref();
  }

  get searchingCount() {
    return this.queue.size;
  }

  queueStatusFor(entry) {
    const waited = Date.now() - entry.joinedAt;
    const window = ratingWindow(waited);
    return {
      status: 'searching',
      playerId: entry.playerId,
      elapsed: Math.floor(waited / 1000),
      since: entry.joinedAt,
      rating: entry.rating,
      range: {
        min: Math.max(0, entry.rating - window),
        max: entry.rating + window,
        width: window
      },
      waiting: this.queue.size,
      online: this.registry.countOnline()
    };
  }

  sendQueueStatus(entry) {
    const player = this.registry.getById(entry.playerId);
    if (!player || !player.socketId) return;
    this.io.to(player.socketId).emit('queueStatus', this.queueStatusFor(entry));
  }

  sendQueueIdle(player) {
    if (!player || !player.socketId) return;
    this.io.to(player.socketId).emit('queueStatus', { status: 'idle', waiting: this.queue.size });
  }

  /** Add a player to the search queue. */
  join(player) {
    if (!player || !player.connected) throw new RoomError('NOT_CONNECTED', 'Reconnect before searching.');
    if (this.pending.has(player.playerId)) {
      throw new RoomError('MATCH_PENDING', 'You already have a match waiting for acceptance.');
    }
    if (player.status === 'in_room' || player.status === 'in_match') {
      throw new RoomError('ALREADY_IN_ROOM', 'Leave your current room before searching.');
    }
    if (this.queue.has(player.playerId)) {
      this.sendQueueStatus(this.queue.get(player.playerId));
      return this.queue.get(player.playerId);
    }

    const entry = {
      playerId: player.playerId,
      nickname: player.nickname,
      rating: player.rating,
      joinedAt: Date.now(),
      lastStatusAt: 0,
      botOffered: false
    };
    this.queue.set(player.playerId, entry);
    this.registry.setStatus(player, 'queue', null);
    this.sendQueueStatus(entry);
    return entry;
  }

  /** Remove a player from the queue. */
  cancel(playerId) {
    const entry = this.queue.get(playerId);
    this.queue.delete(playerId);
    const player = this.registry.getById(playerId);
    if (player && player.status === 'queue') this.registry.setStatus(player, 'idle', null);
    if (entry) this.sendQueueIdle(player);
    if (this.pending.has(playerId)) this.decline(playerId, 'cancelled');
    return !!entry;
  }

  removeFromQueue(playerId) {
    this.queue.delete(playerId);
  }

  /** Called on disconnect; cleans the queue and forfeits any acceptance. */
  handleDisconnect(playerId) {
    this.queue.delete(playerId);
    if (this.pending.has(playerId)) this.decline(playerId, 'disconnect');
  }

  /** Resend a pending offer after a reconnect. */
  resendPending(player) {
    const pending = this.pending.get(player.playerId);
    if (!pending || !player.socketId) return false;
    const otherId = pending.playerIds.find((id) => id !== player.playerId);
    const opponent = this.registry.getById(otherId);
    this.io.to(player.socketId).emit('matchFound', {
      roomCode: pending.room.code,
      opponent: opponent
        ? { playerId: opponent.playerId, nickname: opponent.nickname, rating: opponent.rating }
        : { playerId: otherId, nickname: 'Opponent', rating: 1000 },
      acceptWindow: Math.max(1, Math.ceil((pending.deadline - Date.now()) / 1000)),
      deadline: pending.deadline
    });
    return true;
  }

  /** Mark that a player accepted the match-found prompt. */
  accept(playerId) {
    const pending = this.pending.get(playerId);
    if (!pending) return false;
    pending.accepted.add(playerId);
    const otherId = pending.playerIds.find((id) => id !== playerId);
    const other = this.registry.getById(otherId);
    if (other && other.socketId) {
      this.io.to(other.socketId).emit('matchAcceptStatus', {
        playerId,
        accepted: true,
        acceptedCount: pending.accepted.size
      });
    }

    if (pending.accepted.size >= 2) {
      clearTimeout(pending.timer);
      const room = pending.room;
      for (const id of pending.playerIds) this.pending.delete(id);
      this.io.to(room.code).emit('matchAcceptStatus', { accepted: true, both: true });
      this.rooms.completeAcceptance(room);
      return true;
    }
    return false;
  }

  /** Decline or fail an acceptance; the other player is requeued. */
  decline(playerId, reason = 'declined') {
    const pending = this.pending.get(playerId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    const room = pending.room;
    const playerIds = [...pending.playerIds];
    for (const id of playerIds) this.pending.delete(id);

    this.rooms.discardRoom(room);

    for (const id of playerIds) {
      const player = this.registry.getById(id);
      if (!player) continue;
      if (player.status === 'in_room' || player.status === 'in_match') {
        this.registry.setStatus(player, 'idle', null);
      }
      const requeued = id !== playerId && player.connected;
      const payload = {
        reason,
        by: playerId,
        roomCode: room.code,
        requeued
      };
      if (player.socketId) this.io.to(player.socketId).emit('matchCancelled', payload);

      // Everyone except the player who declined/left returns to the queue.
      if (requeued) {
        try {
          this.join(player);
        } catch (error) {
          // Status validation failed; leave them idle.
        }
      } else {
        this.sendQueueIdle(player);
      }
    }
    return true;
  }

  /** Time out an acceptance window. Only players who accepted are requeued. */
  timeout(pending) {
    clearTimeout(pending.timer);
    const room = pending.room;
    const ids = [...pending.playerIds];
    for (const id of ids) this.pending.delete(id);
    this.rooms.discardRoom(room);

    for (const id of ids) {
      const player = this.registry.getById(id);
      if (!player) continue;
      if (player.status === 'in_room' || player.status === 'in_match') {
        this.registry.setStatus(player, 'idle', null);
      }
      if (player.socketId) {
        this.io.to(player.socketId).emit('matchCancelled', {
          reason: 'timeout',
          roomCode: room.code,
          requeued: pending.accepted.has(id) && player.connected
        });
      }
      if (pending.accepted.has(id) && player.connected) {
        try {
          this.join(player);
        } catch (error) {
          // Ignore; they can queue again from the menu.
        }
      } else {
        this.sendQueueIdle(player);
      }
    }
  }

  /** Pair two queue entries and create an acceptance room. */
  pair(entryA, entryB) {
    const playerA = this.registry.getById(entryA.playerId);
    const playerB = this.registry.getById(entryB.playerId);
    if (!playerA || !playerB || !playerA.connected || !playerB.connected) return false;
    if (playerA.status !== 'queue' || playerB.status !== 'queue') return false;

    let room;
    try {
      room = this.rooms.createMatchRoom(playerA, playerB);
    } catch (error) {
      console.warn('[matchmaker] Could not create match room:', error.message);
      return false;
    }

    this.queue.delete(playerA.playerId);
    this.queue.delete(playerB.playerId);

    const pending = {
      room,
      playerIds: [playerA.playerId, playerB.playerId],
      otherPlayerId: playerB.playerId,
      accepted: new Set(),
      deadline: Date.now() + ACCEPT_WINDOW_MS,
      timer: null
    };
    this.pending.set(playerA.playerId, pending);
    this.pending.set(playerB.playerId, pending);
    pending.timer = setTimeout(() => this.timeout(pending), ACCEPT_WINDOW_MS + 250);
    if (pending.timer.unref) pending.timer.unref();

    const emitFound = (player, opponent) => {
      if (!player.socketId) return;
      this.io.to(player.socketId).emit('matchFound', {
        roomCode: room.code,
        opponent: {
          playerId: opponent.playerId,
          nickname: opponent.nickname,
          rating: opponent.rating
        },
        acceptWindow: ACCEPT_WINDOW_MS / 1000,
        deadline: pending.deadline
      });
    };
    emitFound(playerA, playerB);
    emitFound(playerB, playerA);
    return true;
  }

  /**
   * Start an immediate match against a CPU opponent. Only valid for a currently
   * queued player who has seen the bot offer.
   */
  startBotMatch(playerId) {
    const entry = this.queue.get(playerId);
    if (!entry) throw new RoomError('NOT_QUEUED', 'You are not searching for a match.');
    const player = this.registry.getById(playerId);
    if (!player || !player.connected) throw new RoomError('NOT_CONNECTED', 'Reconnect before fighting a bot.');
    this.queue.delete(playerId);
    this.registry.setStatus(player, 'idle', null);
    try {
      return this.rooms.createBotRoom(player);
    } catch (error) {
      // Return the player to the queue if bot room creation failed.
      try {
        this.join(player);
      } catch (err) {
        // Ignore.
      }
      throw error;
    }
  }

  /** One matchmaking pass per second. */
  tick() {
    this.cleanupStale();
    const now = Date.now();

    // Offer a bot after 30 seconds of waiting.
    for (const entry of this.queue.values()) {
      const player = this.registry.getById(entry.playerId);
      if (!player || !player.connected) continue;
      if (now - entry.joinedAt >= BOT_OFFER_AFTER_MS && !entry.botOffered) {
        entry.botOffered = true;
        if (player.socketId) {
          this.io.to(player.socketId).emit('botOffer', {
            waitSeconds: Math.floor((now - entry.joinedAt) / 1000),
            message: 'No opponent yet. Fight a bot or keep waiting.'
          });
        }
      }
      if (now - entry.lastStatusAt >= 5000) {
        entry.lastStatusAt = now;
        this.sendQueueStatus(entry);
      }
    }

    const entries = [...this.queue.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    let paired = 0;
    for (let i = 0; i < entries.length && paired < 5; i += 1) {
      const a = entries[i];
      if (!this.queue.has(a.playerId)) continue;
      const playerA = this.registry.getById(a.playerId);
      if (!playerA || !playerA.connected) continue;

      for (let j = i + 1; j < entries.length; j += 1) {
        const b = entries[j];
        if (!this.queue.has(b.playerId)) continue;
        const playerB = this.registry.getById(b.playerId);
        if (!playerB || !playerB.connected) continue;

        const windowA = ratingWindow(now - a.joinedAt);
        const windowB = ratingWindow(now - b.joinedAt);
        const allowed = Math.max(windowA, windowB);
        if (Math.abs(a.rating - b.rating) > allowed) continue;

        if (this.pair(a, b)) {
          paired += 1;
          break;
        }
      }
    }
  }

  cleanupStale() {
    for (const [playerId, entry] of this.queue) {
      const player = this.registry.getById(playerId);
      if (!player || !player.connected || player.status !== 'queue') {
        this.queue.delete(playerId);
      }
    }
    for (const pending of new Set(this.pending.values())) {
      if (!this.rooms.rooms.has(pending.room.code)) {
        clearTimeout(pending.timer);
        for (const id of pending.playerIds) this.pending.delete(id);
      }
    }
  }

  close() {
    clearInterval(this.timer);
    for (const pending of new Set(this.pending.values())) clearTimeout(pending.timer);
  }
}

module.exports = {
  Matchmaker,
  ACCEPT_WINDOW_MS,
  BOT_OFFER_AFTER_MS,
  ratingWindow
};
