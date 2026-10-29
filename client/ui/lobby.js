/**
 * Private / matchmade lobby.
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initials(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

export class LobbyUI {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.room = null;
    this.localId = null;
    this.els = {
      back: document.getElementById('lobby-back'),
      mode: document.getElementById('lobby-mode'),
      roomMiniWrap: document.getElementById('room-code-mini-wrap'),
      roomMini: document.getElementById('room-code-mini'),
      codeCard: document.getElementById('room-code-card'),
      code: document.getElementById('room-code'),
      copy: document.getElementById('btn-copy-link'),
      share: document.getElementById('btn-share-room'),
      slots: document.getElementById('lobby-slots'),
      ready: document.getElementById('lobby-ready'),
      changeHero: document.getElementById('btn-lobby-hero'),
      leave: document.getElementById('lobby-leave'),
      status: document.getElementById('lobby-status'),
      spectators: document.getElementById('spectator-note'),
      emotes: document.getElementById('lobby-emotes')
    };
    this.bind();
  }

  bind() {
    this.els.back?.addEventListener('click', () => this.callbacks.onLeave?.());
    this.els.leave?.addEventListener('click', () => this.callbacks.onLeave?.());
    this.els.copy?.addEventListener('click', () => this.copyLink());
    this.els.share?.addEventListener('click', () => this.shareRoom());
    this.els.ready?.addEventListener('click', () => {
      const local = this.localPlayer();
      if (!local) return;
      this.callbacks.onReady?.(!local.ready);
    });
    this.els.changeHero?.addEventListener('click', () => this.callbacks.onChangeHero?.());
    this.els.emotes?.querySelectorAll('[data-emote]').forEach((button) => {
      button.addEventListener('click', () => this.callbacks.onEmote?.(button.dataset.emote));
    });
  }

  localPlayer() {
    if (!this.room || !this.localId) return null;
    return (this.room.players || []).find((player) => player.playerId === this.localId) || null;
  }

  inviteLink() {
    if (!this.room) return '';
    return `${location.origin}/?room=${encodeURIComponent(this.room.code)}`;
  }

  async copyLink() {
    const link = this.inviteLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.callbacks.onToast?.('Invite link copied to clipboard.', 'success');
    } catch (error) {
      this.fallbackCopy(link);
    }
  }

  fallbackCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      const ok = document.execCommand('copy');
      this.callbacks.onToast?.(ok ? 'Invite link copied to clipboard.' : text, ok ? 'success' : 'warn');
    } catch (error) {
      this.callbacks.onToast?.('Copy failed — share the code manually.', 'error');
    }
    area.remove();
  }

  async shareRoom() {
    const link = this.inviteLink();
    if (!link) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Shadow Clash',
          text: `Join my private room ${this.room.code} in Shadow Clash!`,
          url: link
        });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    this.copyLink();
  }

  update(room, localId) {
    if (!room) return;
    this.room = room;
    this.localId = localId;
    const code = room.code || '----';
    const modeLabel = room.mode === 'private'
      ? 'PRIVATE ROOM'
      : room.mode === 'bot'
        ? 'CPU MATCH'
        : 'MATCH LOBBY';
    if (this.els.mode) this.els.mode.textContent = modeLabel;
    if (this.els.code) this.els.code.textContent = code;
    if (this.els.roomMini) this.els.roomMini.textContent = code;
    if (this.els.roomMiniWrap) this.els.roomMiniWrap.classList.toggle('hidden', room.mode !== 'private');
    if (this.els.codeCard) this.els.codeCard.classList.toggle('hidden', room.mode !== 'private');

    this.renderSlots();
    this.updateReady();
    this.updateStatus();
    if (this.els.spectators) {
      const count = room.spectators || 0;
      this.els.spectators.textContent = `Watching: ${count}`;
    }
  }

  updateReady() {
    const local = this.localPlayer();
    if (!this.els.ready) return;
    if (!local) {
      this.els.ready.textContent = 'Spectating';
      this.els.ready.disabled = true;
      this.els.ready.className = 'btn primary wide';
      if (this.els.changeHero) this.els.changeHero.disabled = true;
      return;
    }
    this.els.ready.disabled = false;
    this.els.ready.textContent = local.ready ? 'Ready ✓' : 'Ready';
    this.els.ready.className = local.ready ? 'btn secondary wide' : 'btn primary wide';
    if (this.els.changeHero) this.els.changeHero.disabled = false;
  }

  updateStatus() {
    if (!this.els.status || !this.room) return;
    const players = this.room.players || [];
    const local = this.localPlayer();
    const opponent = players.find((player) => player.playerId !== this.localId);
    const disconnected = players.find((player) => player.disconnected);
    if (!local) {
      this.els.status.textContent = 'Spectating this lobby. You will enter the match when it begins.';
    } else if (disconnected) {
      this.els.status.textContent = `${disconnected.nickname} disconnected — their slot is held for 15s.`;
    } else if (players.length < 2) {
      this.els.status.textContent = this.room.mode === 'private'
        ? 'Waiting for a challenger — share the invite link above.'
        : 'Waiting for an opponent…';
    } else if (local.ready && opponent && !opponent.ready) {
      this.els.status.textContent = 'Waiting for your opponent to ready up…';
    } else if (!local.ready && opponent?.ready) {
      this.els.status.textContent = `${opponent.nickname} is ready. Ready up to begin.`;
    } else if (!local.ready) {
      this.els.status.textContent = 'Choose your fighter, then ready up.';
    } else {
      this.els.status.textContent = 'Both fighters ready — starting…';
    }
  }

  renderSlots() {
    if (!this.els.slots || !this.room) return;
    const players = this.room.players || [];
    const hostId = this.room.hostId;
    const cards = [];

    for (let index = 0; index < 2; index += 1) {
      const player = players[index];
      if (!player) {
        cards.push(`
          <div class="lobby-slot empty">
            <div class="slot-top"><span class="slot-label">SLOT ${index + 1}</span></div>
            <div class="empty-slot-inner">
              <div class="empty-icon">+</div>
              <strong>Waiting for challenger</strong>
              <span>${this.room.mode === 'private' ? 'Send the invite link to a friend.' : 'Searching for a rival…'}</span>
            </div>
          </div>`);
        continue;
      }

      const isLocal = player.playerId === this.localId;
      const isHost = player.playerId === hostId;
      const hero = player.hero || {};
      const badges = [
        isHost ? '<span class="slot-badge host">HOST</span>' : '',
        isLocal ? '<span class="slot-badge">YOU</span>' : '',
        player.isBot ? '<span class="slot-badge">CPU</span>' : '',
        player.disconnected ? '<span class="slot-badge offline">OFFLINE</span>' : '',
        player.ready ? '<span class="slot-badge ready">READY</span>' : ''
      ].join('');
      const canKick = this.localId === hostId && !isLocal && !player.isBot && this.room.state === 'lobby';
      const glow = hero.theme?.glow || 'rgba(255,122,24,0.16)';

      cards.push(`
        <div class="lobby-slot filled" style="--slot-glow:${escapeHtml(glow)}">
          <div class="slot-top">
            <span class="slot-label">${isLocal ? 'YOU' : isHost ? 'HOST' : 'CHALLENGER'}</span>
            <div class="slot-badges">${badges}</div>
          </div>
          ${canKick ? `<button class="kick-btn" data-kick="${escapeHtml(player.playerId)}">KICK</button>` : ''}
          <div class="slot-body">
            <div class="slot-avatar">
              <div class="portrait-fallback">${escapeHtml(initials(player.nickname))}</div>
              ${hero.portrait ? `<img src="${escapeHtml(hero.portrait)}" alt="" />` : ''}
            </div>
            <div class="slot-info">
              <strong>${escapeHtml(player.nickname || 'Fighter')}</strong>
              <span>${escapeHtml(hero.displayName || player.heroId || 'Fighter')}</span>
              <em>${escapeHtml(player.rating ?? 1000)} ELO</em>
            </div>
          </div>
        </div>`);
    }

    this.els.slots.innerHTML = cards.join('');
    this.els.slots.querySelectorAll('[data-kick]').forEach((button) => {
      button.addEventListener('click', () => this.callbacks.onKick?.(button.dataset.kick));
    });
    this.els.slots.querySelectorAll('.slot-avatar img').forEach((img) => {
      img.addEventListener('error', () => img.remove());
    });
  }
}
