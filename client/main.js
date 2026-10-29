/**
 * Shadow Clash client entry point.
 *
 * Wires the DOM screens, Socket.IO transport, input controller, renderer and
 * HUD into one small state machine:
 *
 *   menu -> search -> accept -> lobby -> game -> result -> lobby/search/menu
 *
 * The server is authoritative for everything inside a fight. The client only
 * sends the unified input object and predicts its own movement for smoothness.
 */

import { Network } from './network.js';
import { InputController } from './input.js';
import { Renderer } from './renderer.js';
import { MenuUI } from './ui/menu.js';
import { CharacterSelectUI } from './ui/characterSelect.js';
import { MatchmakingUI } from './ui/matchmaking.js';
import { LobbyUI } from './ui/lobby.js';
import { HUD } from './ui/hud.js';

const PROFILE_KEY = 'shadowclash.profile.v1';
const TAB_KEY = 'shadowclash.tab.v1';
const LEASE_KEY = 'shadowclash.lease.v1';
const MUTED_KEY = 'shadowclash.muted.v1';
const LEASE_MS = 8000;
const MAX_NICKNAME_LENGTH = 12;
const EMOTES = new Set(['GG', 'Nice!', 'Rematch?', 'Good luck!', 'Well played!', 'Oops!']);
const SCREEN_IDS = {
  menu: 'screen-menu',
  select: 'screen-select',
  search: 'screen-search',
  lobby: 'screen-lobby',
  game: 'screen-game',
  result: 'screen-result'
};

function $(id) {
  return document.getElementById(id);
}

function parseJSON(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function storageGet(store, key) {
  try {
    return store.getItem(key);
  } catch (error) {
    return null;
  }
}

function storageSet(store, key, value) {
  try {
    store.setItem(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

function storageRemove(store, key) {
  try {
    store.removeItem(key);
  } catch (error) {
    // Ignore unavailable storage.
  }
}

function randomId(prefix) {
  if (window.crypto?.randomUUID) {
    return `${prefix}_${window.crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
  }
  const random = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `${prefix}_${random.slice(0, 18)}`;
}

function normalizeNickname(value) {
  return Array.from(String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim())
    .slice(0, MAX_NICKNAME_LENGTH)
    .join('');
}

function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function reasonLabel(reason) {
  const labels = {
    ko: 'K.O.',
    timeout: 'TIME UP',
    forfeit: 'FORFEIT',
    disconnect: 'DISCONNECT'
  };
  return labels[reason] || String(reason || 'MATCH COMPLETE').toUpperCase();
}

function plural(value, one, many) {
  return `${value} ${value === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Tiny synthesized sound engine (no external assets)
// ---------------------------------------------------------------------------

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = storageGet(localStorage, MUTED_KEY) === '1';
    this.volume = 0.7;
    this.lastPing = 0;
  }

  ensure() {
    if (this.muted) return null;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    try {
      this.ctx = new AudioCtor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    } catch (error) {
      this.ctx = null;
      this.master = null;
    }
    return this.ctx;
  }

  setVolume(volume) {
    const next = Math.max(0, Math.min(1, Number(volume) || 0));
    this.volume = next;
    if (!this.master || !this.ctx) return;
    try {
      this.master.gain.setTargetAtTime(this.muted ? 0 : next, this.ctx.currentTime, 0.02);
    } catch (error) {
      // Ignore audio graph errors.
    }
  }

  unlock() {
    const ctx = this.ensure();
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  }

  setMuted(muted) {
    this.muted = !!muted;
    storageSet(localStorage, MUTED_KEY, this.muted ? '1' : '0');
    if (this.muted && this.master) {
      try {
        this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
      } catch (error) {
        // Ignore.
      }
    } else if (!this.muted) {
      this.unlock();
      if (this.master) {
        try {
          this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
        } catch (error) {
          // Ignore.
        }
      }
    }
  }

  tone({ freq = 220, endFreq = 0, duration = 0.12, type = 'sine', gain = 0.08, delay = 0 }) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const start = ctx.currentTime + Math.max(0, delay);
    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), start);
    if (endFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + duration);
    }
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(envelope).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  noise({ duration = 0.09, gain = 0.05, delay = 0, filterFreq = 1400, type = 'bandpass' }) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const start = ctx.currentTime + Math.max(0, delay);
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.8;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(envelope).connect(this.master);
    source.start(start);
  }

  playEvent(event) {
    if (!event || this.muted) return;
    switch (event.type) {
      case 'hit':
        this.noise({ duration: event.heavy ? 0.18 : 0.07, gain: event.heavy ? 0.14 : 0.06, filterFreq: event.heavy ? 500 : 1300 });
        this.tone({ freq: event.heavy ? 120 : 190, endFreq: event.heavy ? 45 : 110, duration: event.heavy ? 0.22 : 0.08, type: 'triangle', gain: event.heavy ? 0.15 : 0.045 });
        break;
      case 'block':
        this.tone({ freq: 620, endFreq: 940, duration: 0.06, type: 'square', gain: 0.025 });
        this.noise({ duration: 0.05, gain: 0.035, filterFreq: 2600, type: 'highpass' });
        break;
      case 'ko':
        this.noise({ duration: 0.5, gain: 0.16, filterFreq: 320, type: 'lowpass' });
        this.tone({ freq: 90, endFreq: 28, duration: 0.7, type: 'sine', gain: 0.2 });
        break;
      case 'projectileHit':
        this.noise({ duration: 0.12, gain: 0.07, filterFreq: 1800 });
        this.tone({ freq: 300, endFreq: 80, duration: 0.12, type: 'sawtooth', gain: 0.035 });
        break;
      case 'skillStart':
        this.tone({ freq: 180, endFreq: 620, duration: 0.16, type: 'sawtooth', gain: 0.035 });
        break;
      case 'ultimateStart':
        this.tone({ freq: 110, endFreq: 880, duration: 0.55, type: 'sawtooth', gain: 0.06 });
        this.noise({ duration: 0.5, gain: 0.03, filterFreq: 900, type: 'bandpass' });
        break;
      case 'ultimateHit':
        this.noise({ duration: 0.6, gain: 0.18, filterFreq: 420, type: 'lowpass' });
        this.tone({ freq: 65, endFreq: 24, duration: 0.8, type: 'sine', gain: 0.22 });
        this.tone({ freq: 440, endFreq: 60, duration: 0.35, type: 'sawtooth', gain: 0.05, delay: 0.04 });
        break;
      case 'areaAttack':
        this.noise({ duration: 0.2, gain: 0.08, filterFreq: 700, type: 'lowpass' });
        break;
      case 'teleport':
        this.tone({ freq: 620, endFreq: 160, duration: 0.14, type: 'sine', gain: 0.04 });
        break;
      case 'buff':
      case 'shieldCast':
      case 'healCast':
        this.tone({ freq: 520, endFreq: 780, duration: 0.16, type: 'sine', gain: 0.035 });
        break;
      case 'timeUp':
        this.tone({ freq: 620, duration: 0.16, type: 'square', gain: 0.055 });
        this.tone({ freq: 420, duration: 0.24, type: 'square', gain: 0.05, delay: 0.18 });
        break;
      case 'fight':
        this.tone({ freq: 220, duration: 0.1, type: 'sawtooth', gain: 0.055 });
        this.tone({ freq: 330, duration: 0.1, type: 'sawtooth', gain: 0.05, delay: 0.07 });
        this.tone({ freq: 440, duration: 0.18, type: 'sawtooth', gain: 0.05, delay: 0.14 });
        break;
      case 'roundStart':
        this.tone({ freq: 330, duration: 0.1, type: 'triangle', gain: 0.035 });
        break;
      default:
        break;
    }
  }

  countdownTick(seconds) {
    if (this.muted) return;
    this.tone({ freq: seconds <= 1 ? 880 : 540, duration: 0.07, type: 'triangle', gain: 0.035 });
  }

  alert() {
    if (this.muted) return;
    this.tone({ freq: 620, endFreq: 880, duration: 0.16, type: 'sine', gain: 0.05 });
    this.tone({ freq: 940, duration: 0.12, type: 'sine', gain: 0.04, delay: 0.13 });
  }

  emote() {
    if (this.muted) return;
    this.tone({ freq: 740, endFreq: 980, duration: 0.08, type: 'sine', gain: 0.025 });
  }
}

// ---------------------------------------------------------------------------
// Main application
// ---------------------------------------------------------------------------

class ShadowClashApp {
  constructor() {
    this.network = new Network();
    this.audio = new SoundEngine();
    this.input = new InputController({
      enabled: false,
      onGamepadChange: (pad) => {
        if (pad) this.toast(`Gamepad connected: ${pad.id.slice(0, 32)}`, 'success', 2500);
      }
    });
    this.renderer = new Renderer($('game-canvas'));
    this.hud = new HUD();

    this.heroes = [];
    this.heroById = new Map();
    this.profile = this.loadProfile();
    this.currentScreen = 'menu';
    this.registered = false;
    this.everConnected = false;
    this.hasConnected = false;
    this.registrationPending = false;
    this.registrationTimer = null;

    this.room = null;
    this.gameActive = false;
    this.spectator = false;
    this.localId = this.profile.playerId;
    this.latestSnapshot = null;
    this.matchCode = null;
    this.result = null;
    this.resultTimer = null;
    this.rematchVotes = [];
    this.rematchRequested = false;

    this.pendingAccept = null;
    this.pendingInvite = null;
    this.lastInviteCode = '';
    this.afterRegister = null;
    this.queueActive = false;
    this.joinInFlight = false;
    this.createRoomTimer = null;

    this.nicknameOpen = false;
    this.nicknameSubmitting = false;
    this.nicknameSubmitTimer = null;
    this.joinModalOpen = false;
    this.confirmResolve = null;

    this.selectReturn = 'menu';
    this.lastEmoteAt = 0;
    this.lastInputSent = 0;
    this.lastCountdownSecond = null;
    this.lastSnapshotPhase = '';
    this.seenAudioEvents = new Set();
    this.lastConnectErrorAt = 0;
    this.lastFrame = performance.now();
    this.departed = false;
    this.connectionTimer = null;

    this.buildUI();
    this.bindStaticControls();
    this.bindNetwork();
    this.input.attach();
    this.startLoop();
    this.startIdentityHeartbeat();
    this.bindLifecycle();
  }

  // -----------------------------------------------------------------------
  // Identity + profile
  // -----------------------------------------------------------------------

  loadProfile() {
    const shared = parseJSON(storageGet(localStorage, PROFILE_KEY)) || {};
    const tab = parseJSON(storageGet(sessionStorage, TAB_KEY));
    const lease = parseJSON(storageGet(localStorage, LEASE_KEY));
    const now = Date.now();
    let tabId = tab?.tabId || randomId('tab');
    let playerId = tab?.playerId || null;

    if (!playerId) {
      const sharedId = typeof shared.playerId === 'string' && shared.playerId
        ? shared.playerId
        : randomId('guest');
      const leasedByAnotherTab = lease &&
        lease.owner !== tabId &&
        now - Number(lease.at || 0) < LEASE_MS;
      playerId = leasedByAnotherTab ? randomId('guest') : sharedId;
    }

    if (!shared.playerId) shared.playerId = playerId;
    shared.rating = Number.isFinite(Number(shared.rating)) ? Number(shared.rating) : 1000;
    shared.wins = Number.isFinite(Number(shared.wins)) ? Number(shared.wins) : 0;
    shared.losses = Number.isFinite(Number(shared.losses)) ? Number(shared.losses) : 0;

    this.tabId = tabId;
    this.playerId = playerId;
    storageSet(sessionStorage, TAB_KEY, JSON.stringify({ tabId, playerId }));
    storageSet(localStorage, PROFILE_KEY, JSON.stringify(shared));
    storageSet(localStorage, LEASE_KEY, JSON.stringify({ owner: tabId, at: now }));

    return {
      playerId,
      nickname: normalizeNickname(shared.nickname || ''),
      heroId: typeof shared.heroId === 'string' ? shared.heroId : '',
      rating: shared.rating,
      wins: shared.wins,
      losses: shared.losses
    };
  }

  saveProfile() {
    const existing = parseJSON(storageGet(localStorage, PROFILE_KEY)) || {};
    if (!existing.playerId) existing.playerId = this.profile.playerId;
    existing.nickname = this.profile.nickname || '';
    existing.heroId = this.profile.heroId || '';
    existing.rating = this.profile.rating ?? 1000;
    existing.wins = this.profile.wins ?? 0;
    existing.losses = this.profile.losses ?? 0;
    storageSet(localStorage, PROFILE_KEY, JSON.stringify(existing));
  }

  startIdentityHeartbeat() {
    this.identityTimer = setInterval(() => {
      const lease = parseJSON(storageGet(localStorage, LEASE_KEY));
      if (!lease || lease.owner === this.tabId) {
        storageSet(localStorage, LEASE_KEY, JSON.stringify({ owner: this.tabId, at: Date.now() }));
      }
    }, 2500);
  }

  releaseIdentityLease() {
    const lease = parseJSON(storageGet(localStorage, LEASE_KEY));
    if (lease?.owner === this.tabId) {
      storageSet(localStorage, LEASE_KEY, JSON.stringify({ owner: this.tabId, at: 0 }));
    }
  }

  bindLifecycle() {
    window.addEventListener('pagehide', () => {
      this.releaseIdentityLease();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.gameActive && this.network.connected) {
        this.network.emit('requestSnapshot');
      }
    });
    const unlockAudio = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('beforeunload', () => this.releaseIdentityLease());
  }

  // -----------------------------------------------------------------------
  // UI construction
  // -----------------------------------------------------------------------

  buildUI() {
    this.menu = new MenuUI({
      onRandom: () => this.startRandomMatch(),
      onInvite: () => this.createPrivateRoom(),
      onJoin: () => this.openJoinModal(),
      onChangeHero: () => this.openCharacterSelect(),
      onProfile: () => this.openNickname(true),
      onAudio: () => this.toggleMute(),
      onHome: () => this.goHome()
    });

    this.matchmaking = new MatchmakingUI({
      onCancel: () => this.cancelSearch(),
      onFightBot: () => this.fightBot(),
      onKeepWaiting: () => {},
      onAccept: () => this.acceptMatch(),
      onDecline: () => this.declineMatch()
    });

    this.lobby = new LobbyUI({
      onLeave: () => this.requestLeave(),
      onReady: (ready) => this.setReady(ready),
      onKick: (playerId) => this.kickPlayer(playerId),
      onChangeHero: () => this.openCharacterSelect(),
      onEmote: (text) => this.sendEmote(text),
      onToast: (message, type) => this.toast(message, type)
    });

    this.characterSelect = new CharacterSelectUI();
    this.menu.setProfile(this.profile);
    this.menu.setMuted(this.audio.muted);
  }

  bindStaticControls() {
    // Nickname form ---------------------------------------------------------
    const nicknameForm = $('nickname-form');
    const nicknameInput = $('nickname-input');
    const nicknameCount = $('nickname-count');
    const updateNicknameCount = () => {
      const nickname = normalizeNickname(nicknameInput?.value || '');
      if (nicknameCount) nicknameCount.textContent = `${Array.from(nickname).length} / ${MAX_NICKNAME_LENGTH}`;
    };
    nicknameInput?.addEventListener('input', updateNicknameCount);
    nicknameForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitNickname();
    });

    // Join room modal -------------------------------------------------------
    $('join-close')?.addEventListener('click', () => this.closeJoinModal());
    $('join-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = normalizeCode($('join-code')?.value);
      if (code.length < 4) {
        this.toast('Enter the 4-letter room code.', 'warn');
        return;
      }
      this.joinRoom(code, false);
    });
    $('join-spectate')?.addEventListener('click', () => {
      const code = normalizeCode($('join-code')?.value);
      if (code.length < 4) {
        this.toast('Enter a room code to spectate.', 'warn');
        return;
      }
      this.joinRoom(code, true);
    });
    $('join-modal')?.addEventListener('click', (event) => {
      if (event.target === $('join-modal')) this.closeJoinModal();
    });
    $('join-code')?.addEventListener('input', (event) => {
      event.target.value = normalizeCode(event.target.value);
    });

    // Confirm modal ---------------------------------------------------------
    $('confirm-yes')?.addEventListener('click', () => this.resolveConfirm(true));
    $('confirm-no')?.addEventListener('click', () => this.resolveConfirm(false));
    $('confirm-modal')?.addEventListener('click', (event) => {
      if (event.target === $('confirm-modal')) this.resolveConfirm(false);
    });

    // Game controls ---------------------------------------------------------
    $('btn-forfeit')?.addEventListener('click', () => this.requestLeave());
    document.querySelectorAll('#game-emotes [data-emote]').forEach((button) => {
      button.addEventListener('click', () => this.sendEmote(button.dataset.emote));
    });

    // Result controls -------------------------------------------------------
    $('btn-rematch')?.addEventListener('click', () => this.requestRematch());
    $('btn-result-hero')?.addEventListener('click', () => this.openCharacterSelect());
    $('btn-back-lobby')?.addEventListener('click', () => this.returnToLobby());
    $('btn-find-new')?.addEventListener('click', () => this.findNewOpponent());

    // Escape closes non-critical overlays.
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (this.confirmResolve) {
        this.resolveConfirm(false);
      } else if (this.joinModalOpen) {
        this.closeJoinModal();
      } else if (this.nicknameOpen && this.profile.nickname) {
        this.closeNickname();
      }
    });
  }

  // -----------------------------------------------------------------------
  // Boot
  // -----------------------------------------------------------------------

  async boot() {
    this.showScreen('menu');
    this.menu.setProfile(this.profile);
    this.captureInviteLink();
    await this.loadHeroes();
    this.network.connect();
    if (!this.profile.nickname) {
      this.openNickname();
    }
  }

  captureInviteLink() {
    let code = '';
    let spectate = false;
    try {
      const params = new URLSearchParams(window.location.search);
      code = normalizeCode(params.get('room') || params.get('code') || '');
      spectate = params.get('spectate') === '1' || params.get('watch') === '1';
      if (code) {
        this.pendingInvite = { code, spectate };
        this.lastInviteCode = code;
        this.toast(
          spectate ? `Invite detected — spectating room ${code}.` : `Invite detected — joining room ${code}.`,
          'success',
          4500
        );
        const url = `${window.location.pathname}${window.location.hash || ''}`;
        window.history.replaceState({}, document.title, url);
      }
    } catch (error) {
      // Ignore malformed URLs.
    }
  }

  async loadHeroes() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const response = await fetch('/api/characters', {
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const heroes = await response.json();
      if (!Array.isArray(heroes)) throw new Error('Unexpected character payload');
      this.heroes = heroes.filter((hero) => hero && typeof hero.id === 'string');
      this.heroById = new Map(this.heroes.map((hero) => [hero.id, hero]));
      this.renderer.preloadHeroes(this.heroes);
      this.resolveHero();
      if (!this.heroes.length) {
        this.toast('No valid heroes were found on the server. Add a hero folder and restart.', 'error', 9000);
        this.menu.setBusy(true);
      }
    } catch (error) {
      console.error('[client] Failed to load characters:', error);
      this.toast('Could not load fighters. Is the server running?', 'error', 7000);
      this.menu.setHero(null);
      this.menu.setBusy(true);
      setTimeout(() => {
        if (!this.heroes.length) this.loadHeroes();
      }, 4000);
    }
  }

  resolveHero() {
    let hero = this.heroById.get(this.profile.heroId);
    if (!hero) {
      hero = this.heroes[0] || null;
      this.profile.heroId = hero?.id || '';
      this.saveProfile();
    }
    this.menu.setHero(hero);
  }

  currentHero() {
    return this.heroById.get(this.profile.heroId) || this.heroes[0] || null;
  }

  // -----------------------------------------------------------------------
  // Socket wiring
  // -----------------------------------------------------------------------

  bindNetwork() {
    this.network.on('connect', () => {
      const reconnecting = this.everConnected || this.gameActive || !!this.room;
      this.everConnected = true;
      this.hasConnected = true;
      this.registered = false;
      if (this.profile.nickname) {
        if (reconnecting) {
          this.showConnection('Reconnecting…', 'Restoring your session.');
          this.clearConnectionTimer();
          this.connectionTimer = setTimeout(() => {
            if (this.network.connected) this.hideConnection();
          }, 4500);
        }
        this.registerCurrent();
      } else if (!this.nicknameOpen) {
        this.openNickname();
      }
    });

    this.network.on('disconnect', (payload = {}) => {
      this.registered = false;
      this.input.setEnabled(false);
      this.registrationPending = false;
      if (this.gameActive || this.room) {
        this.showConnection('Connection lost', 'Reconnecting and restoring your match…');
        this.toast('Connection lost — trying to reconnect.', 'warn', 4500);
      } else {
        this.toast('Connection lost — reconnecting…', 'warn', 3500);
      }
      // Socket.IO retries transport disconnects automatically, but a server-side
      // namespace disconnect needs a manual nudge.
      if (payload.reason === 'io server disconnect') {
        setTimeout(() => {
          if (this.network.socket && !this.network.socket.connected) this.network.socket.connect();
        }, 1200);
      }
    });

    this.network.on('connect_error', (payload = {}) => {
      const now = Date.now();
      if (now - this.lastConnectErrorAt < 3000) return;
      this.lastConnectErrorAt = now;
      if (this.everConnected) {
        this.showConnection('Reconnecting…', payload.message || 'Waiting for the server.');
      } else if (now > 0) {
        this.showConnection('Connecting…', payload.message || 'Looking for the game server.');
      }
    });

    this.network.on('nicknameSet', (payload) => this.onNicknameSet(payload));
    this.network.on('presence', (payload) => this.onPresence(payload));
    this.network.on('queueStatus', (payload) => this.onQueueStatus(payload));
    this.network.on('botOffer', (payload) => this.onBotOffer(payload));
    this.network.on('matchFound', (payload) => this.onMatchFound(payload));
    this.network.on('matchAcceptStatus', (payload) => this.onMatchAcceptStatus(payload));
    this.network.on('matchCancelled', (payload) => this.onMatchCancelled(payload));
    this.network.on('roomUpdate', (payload) => this.onRoomUpdate(payload));
    this.network.on('gameStart', (payload) => this.onGameStart(payload));
    this.network.on('snapshot', (payload) => this.onSnapshot(payload));
    this.network.on('matchEnd', (payload) => this.onMatchEnd(payload));
    this.network.on('rematchUpdate', (payload) => this.onRematchUpdate(payload));
    this.network.on('opponentLeft', (payload) => this.onOpponentLeft(payload));
    this.network.on('opponentReconnected', (payload) => this.onOpponentReconnected(payload));
    this.network.on('emote', (payload) => this.onEmote(payload));
    this.network.on('roomError', (payload) => this.onRoomError(payload));
    this.network.on('roomLeft', () => this.onRoomLeft());
  }

  registerCurrent() {
    if (!this.profile.nickname) {
      this.openNickname();
      return;
    }
    this.registrationPending = true;
    const sent = this.network.emit('setNickname', {
      playerId: this.profile.playerId,
      nickname: this.profile.nickname,
      heroId: this.profile.heroId,
      profile: {
        rating: this.profile.rating,
        wins: this.profile.wins,
        losses: this.profile.losses
      }
    });
    if (!sent) return;
    if (this.registrationTimer) clearTimeout(this.registrationTimer);
    this.registrationTimer = setTimeout(() => {
      this.registrationPending = false;
      this.setNicknameBusy(false);
    }, 7000);
  }

  onNicknameSet(payload) {
    if (!payload) return;
    this.registered = true;
    this.registrationPending = false;
    if (this.registrationTimer) clearTimeout(this.registrationTimer);
    this.registrationTimer = null;
    this.applyProfile(payload);
    this.setNicknameBusy(false);

    if (this.nicknameSubmitting || !this.nicknameOpen) this.closeNickname();
    this.nicknameSubmitting = false;

    if (this.gameActive && !this.spectator) this.input.setEnabled(true);

    if (this.pendingInvite) {
      const invite = this.pendingInvite;
      this.pendingInvite = null;
      this.joinRoom(invite.code, invite.spectate);
      return;
    }

    if (this.afterRegister) {
      const action = this.afterRegister;
      this.afterRegister = null;
      action();
      return;
    }

    if (!this.room && !this.gameActive) {
      this.clearConnectionTimer();
      this.hideConnection();
    }
  }

  applyProfile(payload) {
    if (!payload) return;
    this.profile = {
      ...this.profile,
      playerId: payload.playerId || this.profile.playerId,
      nickname: normalizeNickname(payload.nickname || this.profile.nickname),
      rating: Number.isFinite(Number(payload.rating)) ? Number(payload.rating) : this.profile.rating,
      wins: Number.isFinite(Number(payload.wins)) ? Number(payload.wins) : this.profile.wins,
      losses: Number.isFinite(Number(payload.losses)) ? Number(payload.losses) : this.profile.losses
    };
    if (payload.heroId && this.heroById.has(payload.heroId)) {
      this.profile.heroId = payload.heroId;
    }
    this.localId = this.profile.playerId;
    this.saveProfile();
    this.menu.setProfile(this.profile);
    this.menu.setHero(this.currentHero());
    $('profile-avatar').textContent = initials(this.profile.nickname);
  }

  onPresence(payload = {}) {
    this.menu.setPresence(payload);
    if (payload.heroes && !this.heroes.length) {
      // A second attempt is harmless if characters were added while offline.
      this.loadHeroes();
    }
  }

  // -----------------------------------------------------------------------
  // Nickname
  // -----------------------------------------------------------------------

  openNickname(editing = false) {
    if (this.nicknameOpen && editing) {
      $('nickname-input')?.focus();
      return;
    }
    this.nicknameOpen = true;
    this.nicknameSubmitting = false;
    const input = $('nickname-input');
    if (input) {
      input.value = this.profile.nickname || '';
      setTimeout(() => {
        input.focus();
        input.select();
      }, 80);
    }
    const count = $('nickname-count');
    if (count) count.textContent = `${Array.from(this.profile.nickname || '').length} / ${MAX_NICKNAME_LENGTH}`;
    const hint = $('nickname-hint');
    if (hint) hint.textContent = editing ? 'Changing your nickname' : '1–12 characters';
    this.setNicknameBusy(false);
    $('nickname-modal')?.classList.remove('hidden');
  }

  closeNickname() {
    this.nicknameOpen = false;
    this.nicknameSubmitting = false;
    this.setNicknameBusy(false);
    $('nickname-modal')?.classList.add('hidden');
  }

  setNicknameBusy(busy) {
    const button = $('nickname-submit');
    if (!button) return;
    button.disabled = !!busy;
    button.textContent = busy ? 'Entering…' : 'Enter the arena';
  }

  submitNickname() {
    const input = $('nickname-input');
    const hint = $('nickname-hint');
    const nickname = normalizeNickname(input?.value);
    if (!nickname) {
      if (hint) hint.textContent = 'Choose a nickname first.';
      input?.focus();
      return;
    }
    if (!this.network.connected) {
      this.toast('Still connecting to the server — try again in a moment.', 'warn');
      this.registerCurrent();
      return;
    }

    this.nicknameSubmitting = true;
    this.setNicknameBusy(true);
    this.profile.nickname = nickname;
    this.saveProfile();
    this.menu.setProfile(this.profile);
    if (hint) hint.textContent = 'Registering…';

    const sent = this.network.emit('setNickname', {
      playerId: this.profile.playerId,
      nickname,
      heroId: this.profile.heroId,
      profile: {
        rating: this.profile.rating,
        wins: this.profile.wins,
        losses: this.profile.losses
      }
    });

    if (!sent) {
      this.nicknameSubmitting = false;
      this.setNicknameBusy(false);
      this.toast('Could not reach the server. Retrying connection…', 'error');
      return;
    }

    if (this.nicknameSubmitTimer) clearTimeout(this.nicknameSubmitTimer);
    this.nicknameSubmitTimer = setTimeout(() => {
      if (!this.nicknameOpen) return;
      this.nicknameSubmitting = false;
      this.setNicknameBusy(false);
      if (hint) hint.textContent = 'The server did not answer. Try again.';
    }, 6000);
  }

  // -----------------------------------------------------------------------
  // Menu actions
  // -----------------------------------------------------------------------

  startRandomMatch() {
    if (!this.ensureReady(() => this.startRandomMatch())) return;
    this.departed = false;
    if (this.room) {
      this.toast('Leave your current room before searching.', 'warn');
      return;
    }
    if (this.gameActive) return;

    this.queueActive = true;
    this.pendingAccept = null;
    this.matchmaking.reset();
    this.matchmaking.show({ elapsed: 0 });
    this.showScreen('search');
    this.menu.setBusy(false);
    this.network.emit('queueJoin');
    this.audio.alert();
  }

  cancelSearch() {
    this.network.emit('queueCancel');
    this.queueActive = false;
    this.pendingAccept = null;
    this.matchmaking.reset();
    if (this.currentScreen === 'search') this.showScreen('menu');
  }

  fightBot() {
    this.matchmaking.hideBotOffer();
    this.matchmaking.hide();
    this.queueActive = false;
    this.network.emit('queueBot');
  }

  createPrivateRoom() {
    if (!this.ensureReady(() => this.createPrivateRoom())) return;
    this.departed = false;
    if (this.room) {
      this.toast('You are already in a room.', 'warn');
      return;
    }
    this.menu.setBusy(true);
    this.network.emit('roomCreate');
    if (this.createRoomTimer) clearTimeout(this.createRoomTimer);
    this.createRoomTimer = setTimeout(() => this.menu.setBusy(false), 6000);
  }

  openJoinModal(prefill = '') {
    if (!this.ensureReady(() => this.openJoinModal(prefill))) return;
    this.departed = false;
    this.joinModalOpen = true;
    const input = $('join-code');
    if (input) {
      input.value = normalizeCode(prefill || this.pendingInvite?.code || this.lastInviteCode || '');
      setTimeout(() => input.focus(), 80);
    }
    $('join-modal')?.classList.remove('hidden');
  }

  closeJoinModal() {
    this.joinModalOpen = false;
    $('join-modal')?.classList.add('hidden');
  }

  joinRoom(code, spectator = false) {
    const normalized = normalizeCode(code);
    if (normalized.length < 4) {
      this.toast('That room code looks too short.', 'warn');
      return;
    }
    if (!this.ensureReady(() => this.joinRoom(normalized, spectator))) return;
    this.departed = false;
    if (!this.network.connected) {
      this.toast('Not connected yet — try again once the overlay disappears.', 'warn');
      return;
    }
    if (this.room && this.room.code === normalized) {
      this.closeJoinModal();
      this.showScreen(this.room.state === 'lobby' ? 'lobby' : this.currentScreen);
      return;
    }
    if (this.room) {
      this.toast('Leave your current room first.', 'warn');
      return;
    }
    if (this.joinInFlight) return;

    this.joinInFlight = true;
    this.lastInviteCode = normalized;
    this.pendingInvite = null;
    this.network.emit('roomJoin', { code: normalized, spectate: spectator === true });
  }

  goHome() {
    if (this.currentScreen === 'menu') return;
    if (this.currentScreen === 'search') {
      this.cancelSearch();
      return;
    }
    if (this.room || this.gameActive) {
      this.requestLeave();
      return;
    }
    this.showScreen('menu');
  }

  toggleMute() {
    this.audio.setMuted(!this.audio.muted);
    this.menu.setMuted(this.audio.muted);
    if (!this.audio.muted) {
      this.audio.unlock();
      this.audio.alert();
    }
  }

  // -----------------------------------------------------------------------
  // Character select
  // -----------------------------------------------------------------------

  openCharacterSelect() {
    if (this.gameActive || this.currentScreen === 'game') return;
    if (!this.heroes.length) {
      this.toast('No fighters are available on the server.', 'error');
      return;
    }
    this.selectReturn = this.currentScreen === 'select' ? 'menu' : this.currentScreen;
    const state = this.room?.state;
    const context = state === 'lobby'
      ? 'LOBBY — CHANGE FIGHTER'
      : state === 'result'
        ? 'NEXT MATCH — CHANGE FIGHTER'
        : 'ROSTER';

    this.characterSelect.open({
      heroes: this.heroes,
      currentId: this.profile.heroId,
      context,
      onChoose: (heroId) => this.chooseHero(heroId),
      onCancel: () => this.showScreen(this.selectReturn || 'menu')
    });
    this.showScreen('select');
  }

  chooseHero(heroId) {
    const hero = this.heroById.get(heroId);
    if (!hero) return;
    this.profile.heroId = hero.id;
    this.saveProfile();
    this.menu.setHero(hero);
    if (this.registered) this.network.emit('chooseHero', { heroId: hero.id });

    if (this.room?.state === 'lobby') {
      this.showScreen('lobby');
    } else if (this.room?.state === 'result') {
      this.showScreen('result');
    } else {
      this.showScreen('menu');
    }
  }

  // -----------------------------------------------------------------------
  // Lobby actions
  // -----------------------------------------------------------------------

  setReady(ready) {
    if (!this.room) return;
    this.network.emit('roomReady', {
      ready: ready === true,
      heroId: this.profile.heroId
    });
    const button = $('lobby-ready');
    if (button) {
      button.disabled = true;
      button.textContent = ready ? 'Un-ready…' : 'Readying…';
    }
  }

  async kickPlayer(playerId) {
    if (!this.room || !playerId) return;
    const target = (this.room.players || []).find((player) => player.playerId === playerId);
    const ok = await this.askConfirm({
      title: 'Remove player?',
      copy: `${target?.nickname || 'This player'} will be removed from the room.`,
      confirmLabel: 'Kick'
    });
    if (!ok) return;
    this.network.emit('roomKick', { playerId });
  }

  sendEmote(text) {
    if (!EMOTES.has(text)) return;
    if (!this.room) {
      this.toast('Join a room to use quick chat.', 'warn');
      return;
    }
    const now = Date.now();
    if (now - this.lastEmoteAt < 1200) return;
    this.lastEmoteAt = now;
    this.network.emit('emote', { text });
  }

  async requestLeave() {
    if (!this.room && !this.gameActive) {
      this.showScreen('menu');
      return;
    }
    if (this.gameActive && !this.spectator) {
      const ok = await this.askConfirm({
        title: 'Forfeit match?',
        copy: 'Leaving now counts as a loss and ends the match for both fighters.',
        confirmLabel: 'Forfeit'
      });
      if (!ok) return;
      this.leaveToMenu();
      return;
    }
    if (this.gameActive && this.spectator) {
      const ok = await this.askConfirm({
        title: 'Stop spectating?',
        copy: 'You can rejoin with the room code while the match is still live.',
        confirmLabel: 'Leave'
      });
      if (!ok) return;
      this.leaveToMenu();
      return;
    }
    if (this.room?.state === 'lobby') {
      const isHost = this.room.hostId === this.profile.playerId;
      const isSpectator = !(this.room.players || []).some((player) => player.playerId === this.profile.playerId);
      const ok = await this.askConfirm({
        title: isSpectator ? 'Stop spectating?' : 'Leave room?',
        copy: isHost
          ? 'You are the host. Leaving closes the room for everyone.'
          : isSpectator
            ? 'You will return to the main menu.'
            : 'You will return to the main menu.',
        confirmLabel: 'Leave'
      });
      if (!ok) return;
      this.leaveToMenu();
      return;
    }
    const ok = await this.askConfirm({
      title: 'Leave room?',
      copy: 'You will return to the main menu.',
      confirmLabel: 'Leave'
    });
    if (!ok) return;
    this.leaveToMenu();
  }

  leaveToMenu() {
    this.departed = true;
    if (this.network.connected && (this.room || this.spectator)) this.network.emit('roomLeave');
    this.resetRoomState();
    this.showScreen('menu');
  }

  resetRoomState() {
    this.room = null;
    this.gameActive = false;
    this.spectator = false;
    this.localId = this.profile.playerId;
    this.latestSnapshot = null;
    this.matchCode = null;
    this.result = null;
    this.rematchVotes = [];
    this.rematchRequested = false;
    this.pendingAccept = null;
    this.queueActive = false;
    this.joinInFlight = false;
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.resultTimer = null;
    this.input.setEnabled(false);
    this.hud.hideDisconnect();
    this.hud.clearAnnounce();
    this.matchmaking.reset();
    this.menu.setBusy(false);
  }

  // -----------------------------------------------------------------------
  // Matchmaking events
  // -----------------------------------------------------------------------

  onQueueStatus(payload = {}) {
    if (!payload || !payload.status) return;
    if (payload.status === 'searching') {
      this.queueActive = true;
      this.menu.setBusy(false);
      if (this.currentScreen !== 'search' && !this.room && !this.gameActive) {
        this.matchmaking.reset();
        this.matchmaking.show({ elapsed: payload.elapsed || 0 });
        this.showScreen('search');
      }
      this.matchmaking.update(payload);
      return;
    }

    if (payload.status === 'idle') {
      this.queueActive = false;
      this.menu.setBusy(false);
      if (!this.room && !this.gameActive && this.currentScreen === 'search') {
        this.matchmaking.reset();
        this.showScreen('menu');
      }
      return;
    }

    if (payload.status === 'error') {
      this.queueActive = false;
      this.menu.setBusy(false);
      this.matchmaking.reset();
      if (!this.room && !this.gameActive && this.currentScreen === 'search') this.showScreen('menu');
      this.toast(payload.message || 'Matchmaking failed.', 'error');
    }
  }

  onBotOffer(payload = {}) {
    if (this.currentScreen !== 'search' || this.room) return;
    this.matchmaking.showBotOffer();
    this.toast(payload.message || 'No rival found yet. You can fight a bot.', 'warn', 5000);
    this.audio.alert();
  }

  onMatchFound(payload = {}) {
    if (!payload || !payload.opponent) return;
    this.pendingAccept = payload;
    if (this.currentScreen !== 'search') {
      this.matchmaking.show({ elapsed: 0 });
      this.showScreen('search');
    }
    this.matchmaking.showMatchFound({
      opponent: payload.opponent,
      acceptWindow: payload.acceptWindow || 5,
      deadline: payload.deadline,
      localName: this.profile.nickname || 'You'
    }, payload);
    this.matchmaking.hideBotOffer();
    this.audio.alert();
  }

  acceptMatch() {
    if (!this.pendingAccept) return;
    this.network.emit('matchAccept');
  }

  declineMatch() {
    if (this.pendingAccept) this.network.emit('matchDecline');
    this.pendingAccept = null;
    this.queueActive = false;
    this.matchmaking.reset();
    this.showScreen('menu');
  }

  onMatchAcceptStatus(payload = {}) {
    this.matchmaking.updateAcceptStatus(payload);
    if (payload.both) {
      this.matchmaking.hideBotOffer();
      this.audio.alert();
    }
  }

  onMatchCancelled(payload = {}) {
    this.pendingAccept = null;
    this.matchmaking.hideMatchFound();
    if (this.room || this.gameActive) return;

    const messages = {
      declined: payload.by === this.profile.playerId
        ? 'Match declined.'
        : 'Opponent declined the match.',
      timeout: 'The accept window expired.',
      cancelled: 'Match cancelled.',
      disconnect: 'Opponent disconnected.'
    };
    const message = messages[payload.reason] || 'Match cancelled.';
    this.toast(message, payload.requeued ? 'warn' : 'info');

    if (payload.requeued) {
      this.queueActive = true;
      if (this.currentScreen !== 'search') {
        this.matchmaking.reset();
        this.matchmaking.show({ elapsed: 0 });
        this.showScreen('search');
      }
    } else {
      this.queueActive = false;
      this.matchmaking.reset();
      if (this.currentScreen === 'search') this.showScreen('menu');
    }
  }

  // -----------------------------------------------------------------------
  // Room + match lifecycle
  // -----------------------------------------------------------------------

  onRoomUpdate(room) {
    if (!room) return;
    this.room = room;
    this.departed = false;
    this.joinInFlight = false;
    this.clearConnectionTimer();
    this.hideConnection();
    this.closeJoinModal();
    this.menu.setBusy(false);
    if (this.createRoomTimer) clearTimeout(this.createRoomTimer);
    this.createRoomTimer = null;

    const localPlayer = (room.players || []).find((player) => player.playerId === this.profile.playerId);
    if (localPlayer?.heroId && this.heroById.has(localPlayer.heroId)) {
      this.profile.heroId = localPlayer.heroId;
      this.saveProfile();
      this.menu.setHero(this.currentHero());
    }

    const isSpectator = !localPlayer;
    if (room.state === 'lobby') {
      this.spectator = isSpectator;
      this.gameActive = false;
      this.latestSnapshot = null;
      this.matchCode = null;
      this.result = null;
      this.rematchVotes = [];
      if (this.resultTimer) clearTimeout(this.resultTimer);
      this.resultTimer = null;
      this.input.setEnabled(false);
      this.hud.hideDisconnect();
      this.hud.clearAnnounce();
      this.hideConnection();
      this.matchmaking.reset();
      this.lobby.update(room, this.profile.playerId);
      this.showScreen('lobby');
      return;
    }

    this.lobby.update(room, this.profile.playerId);
    if (room.state === 'result') {
      if (this.currentScreen === 'select') this.showScreen('result');
      if (this.result) {
        const originalPlayers = this.result.room?.players || [];
        const currentIds = new Set((room.players || []).map((player) => player.playerId));
        const missing = originalPlayers.filter((player) => !currentIds.has(player.playerId));
        if (missing.length) {
          this.result.opponentLeft = true;
          const name = missing.find((player) => player.playerId !== this.profile.playerId)?.nickname || 'Opponent';
          const status = $('result-rematch-status');
          if (status && !this.spectator) status.textContent = `${name} left the room.`;
          const button = $('btn-rematch');
          if (button) button.disabled = true;
        } else {
          // A hero change can legitimately update the result cards. A partial
          // room (someone already left) must not erase the opponent's card.
          this.result.room = room;
          this.renderResult(this.result);
        }
      }
      return;
    }

    if (room.state === 'playing' && !this.gameActive) {
      // The authoritative gameStart event normally handles this. If it was
      // missed, ask for the current state rather than leaving a stale lobby.
      this.network.emit('requestSnapshot');
    }
    this.hideConnection();
  }

  onGameStart(payload) {
    if (!payload || !Array.isArray(payload.players)) return;
    this.departed = false;
    const spectator = payload.spectator === true;
    const localPlayer = payload.players.find((player) => player.playerId === this.profile.playerId);
    if (!spectator && !localPlayer) {
      // A reconnect can race a room cleanup. Do not claim a fighter that is not
      // ours — the server will send us to the menu when the room is gone.
      this.toast('That match is no longer available.', 'warn');
      this.resetRoomState();
      this.showScreen('menu');
      return;
    }

    this.room = payload.room || this.room;
    this.spectator = spectator;
    this.localId = spectator ? null : this.profile.playerId;
    this.matchCode = payload.roomCode || this.room?.code || null;
    this.gameActive = true;
    this.result = null;
    this.rematchVotes = [];
    this.rematchRequested = false;
    this.seenAudioEvents.clear();
    this.lastCountdownSecond = null;
    this.lastSnapshotPhase = '';
    this.latestSnapshot = payload.state || null;
    this.pendingAccept = null;
    this.queueActive = false;

    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.resultTimer = null;
    this.matchmaking.reset();
    this.closeJoinModal();
    this.closeNickname();
    if (this.confirmResolve) this.resolveConfirm(false);
    this.hideConnection();
    this.clearConnectionTimer();

    const state = payload.state;
    this.renderer.setMatch({ ...payload, localId: this.localId });
    if (state) this.renderer.setSnapshot(state, true);
    this.hud.setMatch(payload, this.localId, this.spectator);
    if (state) this.hud.update(state, this.network.ping, this.spectator);
    if (this.room) this.lobby.update(this.room, this.profile.playerId);

    this.input.setEnabled(!this.spectator);
    this.showScreen('game');
    this.audio.alert();
    if (!this.spectator) {
      this.toast(
        payload.mode === 'bot' ? 'CPU match starting — good luck!' : 'Match found — good luck!',
        'success',
        2600
      );
    }
    this.lastInputSent = 0;
  }

  onSnapshot(snapshot) {
    if (!snapshot || !this.gameActive) return;
    if (this.matchCode && snapshot.roomCode && snapshot.roomCode !== this.matchCode) return;
    this.latestSnapshot = snapshot;
    this.renderer.setSnapshot(snapshot);
    this.hud.update(snapshot, this.network.ping, this.spectator);
    this.processSnapshotAudio(snapshot);
  }

  processSnapshotAudio(snapshot) {
    for (const event of snapshot.events || []) {
      if (event.id != null) {
        if (this.seenAudioEvents.has(event.id)) continue;
        this.seenAudioEvents.add(event.id);
      }
      this.audio.playEvent(event);
    }

    if (snapshot.phase === 'countdown') {
      const seconds = Math.max(0, Math.ceil((snapshot.countdown || 0) / 60));
      if (seconds !== this.lastCountdownSecond) {
        this.lastCountdownSecond = seconds;
        if (seconds > 0 && seconds <= 3) this.audio.countdownTick(seconds);
      }
    } else if (this.lastSnapshotPhase === 'countdown' && snapshot.phase === 'playing') {
      this.lastCountdownSecond = null;
    }
    this.lastSnapshotPhase = snapshot.phase;
  }

  onMatchEnd(payload) {
    if (!payload || this.departed) return;
    if (this.matchCode && payload.roomCode && payload.roomCode !== this.matchCode) return;

    this.gameActive = false;
    this.input.setEnabled(false);
    this.rematchVotes = [];
    this.rematchRequested = false;
    this.result = payload;
    this.room = payload.room || this.room;
    this.hideConnection();
    this.clearConnectionTimer();

    const localProfile = payload.profiles?.[this.profile.playerId];
    if (localProfile) {
      this.profile.rating = Number(localProfile.rating ?? this.profile.rating);
      this.profile.wins = Number(localProfile.wins ?? this.profile.wins);
      this.profile.losses = Number(localProfile.losses ?? this.profile.losses);
      if (localProfile.nickname) this.profile.nickname = localProfile.nickname;
      this.saveProfile();
      this.menu.setProfile(this.profile);
    }

    this.renderResult(payload);
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.resultTimer = setTimeout(() => {
      if (this.result !== payload) return;
      if (this.currentScreen === 'game' || this.currentScreen === 'result') {
        this.showScreen('result');
      }
    }, 1150);
  }

  onRematchUpdate(payload = {}) {
    this.rematchVotes = Array.isArray(payload.votes) ? payload.votes : [];
    if (!this.result) return;
    const status = $('result-rematch-status');
    const button = $('btn-rematch');
    if (payload.starting) {
      if (status) status.textContent = 'Rematch accepted — starting…';
      if (button) {
        button.disabled = true;
        button.textContent = 'Starting…';
      }
      return;
    }
    if (payload.expired) {
      this.rematchRequested = false;
      if (status) status.textContent = 'Rematch request expired.';
      if (button) {
        button.disabled = this.spectator;
        button.textContent = this.room?.mode === 'bot' ? 'Rematch vs CPU' : 'Rematch';
      }
      return;
    }
    if (payload.cancelled) {
      this.rematchRequested = false;
      if (status) status.textContent = 'Rematch cancelled.';
      if (button) {
        button.disabled = this.spectator;
        button.textContent = this.room?.mode === 'bot' ? 'Rematch vs CPU' : 'Rematch';
      }
      return;
    }

    const localRequested = this.rematchVotes.includes(this.profile.playerId);
    const opponentRequested = this.rematchVotes.some((id) => id !== this.profile.playerId);
    this.rematchRequested = localRequested;
    if (button && !this.spectator) {
      button.disabled = localRequested;
      button.textContent = localRequested
        ? 'Waiting…'
        : opponentRequested
          ? 'Accept Rematch'
          : this.room?.mode === 'bot'
            ? 'Rematch vs CPU'
            : 'Rematch';
    }
    if (status) {
      if (localRequested && opponentRequested) status.textContent = 'Both fighters ready — starting…';
      else if (localRequested) status.textContent = 'Waiting for your opponent to accept…';
      else if (opponentRequested) status.textContent = 'Opponent wants a rematch — accept to start.';
      else status.textContent = this.spectator
        ? 'Spectators cannot request a rematch.'
        : 'Both fighters must accept a rematch.';
    }
  }

  onOpponentLeft(payload = {}) {
    const name = payload.nickname || 'Opponent';
    if (payload.forfeit) {
      this.hud.hideDisconnect();
      this.toast(`${name} forfeited the match.`, 'warn', 5000);
      if (this.result) {
        this.result.opponentLeft = true;
        const status = $('result-rematch-status');
        if (status) status.textContent = `${name} left the room.`;
        const button = $('btn-rematch');
        if (button) button.disabled = true;
      }
      return;
    }
    if (payload.reconnectIn > 0) {
      this.hud.showDisconnect(payload.reconnectIn);
      this.toast(`${name} disconnected — ${payload.reconnectIn}s to reconnect.`, 'warn', 5000);
      return;
    }
    this.toast(`${name} left the room.`, 'info');
    if (this.result) {
      this.result.opponentLeft = true;
      const status = $('result-rematch-status');
      if (status) status.textContent = `${name} left the room.`;
      const button = $('btn-rematch');
      if (button) button.disabled = true;
    }
  }

  onOpponentReconnected(payload = {}) {
    this.hud.hideDisconnect();
    this.toast(`${payload.nickname || 'Opponent'} reconnected.`, 'success', 3000);
    if (this.result && !this.spectator) {
      const button = $('btn-rematch');
      if (button && !this.rematchRequested) button.disabled = false;
    }
  }

  onEmote(payload = {}) {
    if (!payload.text) return;
    if (this.gameActive) {
      this.renderer.showEmote(payload.playerId, payload.text);
      this.audio.emote();
    } else if (this.room) {
      this.toast(`${payload.nickname || 'Fighter'}: ${payload.text}`, 'info', 2600);
      this.audio.emote();
    }
  }

  onRoomError(payload = {}) {
    const code = payload.code || 'SERVER_ERROR';
    const message = payload.message || 'Something went wrong.';
    this.joinInFlight = false;
    this.menu.setBusy(false);
    this.nicknameSubmitting = false;
    this.setNicknameBusy(false);
    this.registrationPending = false;

    if (code === 'KICKED') {
      this.closeJoinModal();
      this.closeNickname();
      this.resetRoomState();
      this.showScreen('menu');
      this.toast(message, 'error', 6000);
      return;
    }

    if (code === 'ROOM_CLOSED' || code === 'ROOM_EXPIRED' || code === 'NO_CHARACTERS') {
      this.closeJoinModal();
      this.resetRoomState();
      this.showScreen('menu');
      this.toast(message, 'error', 7000);
      return;
    }

    if (code === 'ROOM_NOT_FOUND' || code === 'ROOM_FULL' || code === 'MATCH_STARTED') {
      this.toast(message, code === 'MATCH_STARTED' ? 'warn' : 'error', 6000);
      if (code === 'MATCH_STARTED' && !this.room && !this.gameActive) {
        this.openJoinModal(this.lastInviteCode);
      }
      if (this.room?.state === 'result' && this.currentScreen === 'select') {
        this.showScreen('result');
      }
      return;
    }

    if (code === 'INVALID_NICKNAME') {
      const hint = $('nickname-hint');
      if (hint) hint.textContent = message;
      if (!this.nicknameOpen) this.openNickname(true);
      return;
    }

    if (code === 'NOT_IN_RESULT' || code === 'NOT_IN_ROOM' || code === 'NOT_PRIVATE') {
      const button = $('btn-rematch');
      if (button && this.result) {
        button.disabled = this.spectator;
        button.textContent = this.room?.mode === 'bot' ? 'Rematch vs CPU' : 'Rematch';
      }
      if (code === 'NOT_IN_ROOM' && !this.room) {
        this.resetRoomState();
        this.showScreen('menu');
      }
    }

    if (this.pendingInvite) {
      this.lastInviteCode = this.pendingInvite.code;
      this.pendingInvite = null;
      this.showScreen('menu');
      this.openJoinModal(this.lastInviteCode);
    }

    this.toast(message, code === 'RATE_LIMITED' ? 'warn' : 'error', 5500);
  }

  onRoomLeft() {
    if (this.room) {
      this.resetRoomState();
    }
    if (this.currentScreen === 'lobby' || this.currentScreen === 'game' || this.currentScreen === 'result') {
      this.showScreen('menu');
    }
  }

  // -----------------------------------------------------------------------
  // Result actions
  // -----------------------------------------------------------------------

  requestRematch() {
    if (!this.room || this.spectator) return;
    if (this.room.state !== 'result') return;
    const button = $('btn-rematch');
    if (button) {
      button.disabled = true;
      button.textContent = 'Waiting…';
    }
    const status = $('result-rematch-status');
    if (status) status.textContent = 'Rematch requested — waiting for your opponent…';
    this.rematchRequested = true;
    this.network.emit('rematchRequest', { accept: true });
  }

  returnToLobby() {
    if (!this.room || this.room.mode !== 'private') return;
    const button = $('btn-back-lobby');
    if (button) button.disabled = true;
    $('btn-rematch')?.setAttribute('disabled', 'disabled');
    const status = $('result-rematch-status');
    if (status) status.textContent = 'Returning to the lobby…';
    this.network.emit('returnToLobby');
  }

  findNewOpponent() {
    if (this.spectator) {
      this.leaveToMenu();
      return;
    }
    const hadRoom = !!this.room;
    if (hadRoom) {
      this.departed = true;
      if (this.network.connected) this.network.emit('roomLeave');
      this.resetRoomState();
    }
    this.showScreen('menu');
    const start = () => this.startRandomMatch();
    if (hadRoom) setTimeout(start, 120);
    else start();
  }

  renderResult(result) {
    if (!result) return;
    const room = result.room || this.room;
    const players = room?.players || [];
    const localId = this.spectator ? null : this.profile.playerId;
    const localPlayer = players.find((player) => player.playerId === localId);
    const winnerId = result.winnerId;
    const loserId = result.loserId;
    const localWon = !!localId && winnerId === localId;
    const localLost = !!localId && loserId === localId;
    const draw = !localWon && !localLost && !!localId;

    const title = $('result-title');
    if (title) {
      title.classList.remove('lose', 'draw');
      if (this.spectator) {
        title.textContent = `${result.winnerName || 'Winner'} WINS`;
      } else if (localWon) {
        title.textContent = 'YOU WIN';
      } else if (localLost) {
        title.textContent = 'YOU LOSE';
        title.classList.add('lose');
      } else {
        title.textContent = draw ? 'DRAW' : 'MATCH COMPLETE';
        title.classList.add('draw');
      }
    }

    const kicker = $('result-kicker');
    if (kicker) {
      if (this.spectator) kicker.textContent = 'SPECTATOR RESULT';
      else if (room?.mode === 'bot') kicker.textContent = 'CPU MATCH COMPLETE';
      else if (room?.mode === 'private') kicker.textContent = 'PRIVATE MATCH COMPLETE';
      else kicker.textContent = 'RANKED MATCH COMPLETE';
    }

    const reason = $('result-reason');
    if (reason) {
      const label = reasonLabel(result.reason);
      reason.textContent = this.spectator
        ? `${label} — ${result.winnerName || 'WINNER'} TAKES IT`
        : `${label}${localWon ? ' — VICTORY' : localLost ? ' — DEFEAT' : ''}`;
    }

    const score = result.score || result.roundWins || {};
    const winnerRounds = Number(score[winnerId] ?? 0);
    const loserRounds = Number(score[loserId] ?? 0);
    const scoreEl = $('result-score');
    if (scoreEl) scoreEl.textContent = `${winnerRounds} — ${loserRounds}`;

    const ordered = [...players].sort((a, b) => {
      if (a.playerId === localId) return -1;
      if (b.playerId === localId) return 1;
      if (a.playerId === winnerId) return -1;
      if (b.playerId === winnerId) return 1;
      return 0;
    });

    const container = $('result-players');
    if (container) {
      container.innerHTML = ordered.map((player) => {
        const hero = player.hero || this.heroById.get(player.heroId) || {};
        const profile = result.profiles?.[player.playerId];
        const rating = Number(profile?.rating ?? player.rating ?? 1000);
        const delta = result.ratings?.[player.playerId]?.delta;
        const isWinner = player.playerId === winnerId;
        const isLocal = !this.spectator && player.playerId === localId;
        const portrait = hero.portrait
          ? `<img src="${escapeHtml(hero.portrait)}" alt="" />`
          : `<div class="portrait-fallback">${escapeHtml(initials(player.nickname))}</div>`;
        const deltaHtml = Number.isFinite(Number(delta)) && Number(delta) !== 0
          ? `<em class="${Number(delta) < 0 ? 'negative' : ''}">${Number(delta) > 0 ? '+' : ''}${Number(delta)} ELO</em>`
          : `<em>${escapeHtml(hero.displayName || player.heroId || 'Fighter')}</em>`;
        return `
          <div class="result-player${isWinner ? ' winner' : ''}">
            <div class="result-player-avatar">${portrait}</div>
            <div class="result-player-info">
              <strong>${escapeHtml(player.nickname || 'Fighter')}${isLocal ? ' (You)' : ''}</strong>
              <span>${escapeHtml(hero.displayName || player.heroId || 'Fighter')} · ${rating} ELO</span>
              ${deltaHtml}
            </div>
          </div>`;
      }).join('');
      container.querySelectorAll('img').forEach((img) => {
        img.addEventListener('error', () => {
          img.replaceWith(Object.assign(document.createElement('div'), {
            className: 'portrait-fallback',
            textContent: '?'
          }));
        });
      });
    }

    const rematchButton = $('btn-rematch');
    const heroButton = $('btn-result-hero');
    const lobbyButton = $('btn-back-lobby');
    const findButton = $('btn-find-new');
    const status = $('result-rematch-status');
    const opponent = players.find((player) => player.playerId !== this.profile.playerId);
    const opponentGone = this.result?.opponentLeft || !opponent || opponent.disconnected;

    if (rematchButton) {
      rematchButton.disabled = this.spectator || opponentGone;
      rematchButton.textContent = this.spectator
        ? 'Spectating'
        : room?.mode === 'bot'
          ? 'Rematch vs CPU'
          : 'Rematch';
    }
    if (heroButton) {
      heroButton.disabled = this.spectator;
      heroButton.classList.toggle('hidden', this.spectator);
    }
    if (lobbyButton) {
      lobbyButton.classList.toggle('hidden', this.spectator || room?.mode !== 'private');
      lobbyButton.disabled = false;
    }
    if (findButton) {
      findButton.textContent = this.spectator ? 'Leave Spectating' : 'Find New Opponent';
    }
    if (status) {
      if (this.spectator) status.textContent = 'Spectators cannot request a rematch.';
      else if (opponentGone) status.textContent = 'Your opponent is no longer available.';
      else if (room?.mode === 'bot') status.textContent = 'The CPU is ready for an instant rematch.';
      else status.textContent = 'Both fighters must accept a rematch.';
    }
  }

  // -----------------------------------------------------------------------
  // Screens, overlays, confirm, toast
  // -----------------------------------------------------------------------

  showScreen(name) {
    const target = SCREEN_IDS[name] ? $(SCREEN_IDS[name]) : null;
    if (!target) return;
    document.querySelectorAll('.screen').forEach((screen) => {
      screen.classList.toggle('active', screen === target);
    });
    document.body.classList.toggle('in-game', name === 'game');
    document.body.classList.toggle('in-result', name === 'result');
    this.currentScreen = name;
    if (name === 'game') {
      window.scrollTo(0, 0);
    } else if (name === 'menu') {
      this.menu.setProfile(this.profile);
      this.menu.setHero(this.currentHero());
    }
  }

  showConnection(title, copy) {
    const overlay = $('connection-overlay');
    if (!overlay) return;
    $('connection-title').textContent = title;
    $('connection-copy').textContent = copy;
    overlay.classList.remove('hidden');
  }

  hideConnection() {
    $('connection-overlay')?.classList.add('hidden');
  }

  clearConnectionTimer() {
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
  }

  askConfirm({ title, copy, confirmLabel = 'Confirm' }) {
    if (this.confirmResolve) this.confirmResolve(false);
    return new Promise((resolve) => {
      this.confirmResolve = resolve;
      $('confirm-title').textContent = title || 'Are you sure?';
      $('confirm-copy').textContent = copy || '';
      $('confirm-yes').textContent = confirmLabel || 'Confirm';
      $('confirm-modal')?.classList.remove('hidden');
    });
  }

  resolveConfirm(value) {
    const resolve = this.confirmResolve;
    this.confirmResolve = null;
    $('confirm-modal')?.classList.add('hidden');
    resolve?.(value === true);
  }

  toast(message, type = 'info', duration = 3800) {
    if (!message) return;
    const container = $('toasts');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast${type && type !== 'info' ? ` ${type}` : ''}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 240);
    }, Math.max(1200, duration));
  }

  // -----------------------------------------------------------------------
  // Network readiness
  // -----------------------------------------------------------------------

  ensureReady(action = null) {
    if (!this.heroes.length) {
      this.toast('No fighters are loaded. Check the server console.', 'error', 6000);
      return false;
    }
    if (this.registered) return true;

    if (!this.network.connected) {
      this.toast('Connecting to the server…', 'warn');
      this.showConnection('Connecting…', 'Waiting for the game server.');
      if (this.network.socket && !this.network.socket.connected) this.network.socket.connect();
      return false;
    }

    if (!this.profile.nickname) {
      if (typeof action === 'function') this.afterRegister = action;
      this.openNickname();
      return false;
    }

    if (typeof action === 'function') this.afterRegister = action;
    if (!this.registrationPending) this.registerCurrent();
    return false;
  }

  // -----------------------------------------------------------------------
  // Game loop
  // -----------------------------------------------------------------------

  startLoop() {
    const frame = (now) => {
      const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
      this.lastFrame = now;

      if (this.currentScreen === 'game') {
        this.input.update();
        this.renderer.render(dt, this.input.state);

        if (
          this.gameActive &&
          !this.spectator &&
          this.registered &&
          this.network.connected &&
          now - this.lastInputSent >= 33
        ) {
          this.lastInputSent = now;
          this.network.emit('input', { input: this.input.snapshot() });
        }
      }

      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const app = new ShadowClashApp();
window.shadowClash = app;
app.boot();
