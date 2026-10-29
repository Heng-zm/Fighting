/**
 * In-match HUD: health/power, round pips, cooldowns, combo counters,
 * round announcements, ping and disconnect state.
 */

const STATUS_LABELS = {
  burn: 'BURN',
  poison: 'POISON',
  slow: 'SLOW',
  stun: 'STUN',
  buff: 'BUFF'
};

const SLOT_KEYS = { S1: 'U', S2: 'I', S3: 'O', ULT: 'P' };
const SLOT_ORDER = ['S1', 'S2', 'S3', 'ULT'];

export class HUD {
  constructor() {
    this.els = {
      localName: document.getElementById('hud-local-name'),
      remoteName: document.getElementById('hud-remote-name'),
      localBot: document.getElementById('hud-local-bot'),
      remoteBot: document.getElementById('hud-remote-bot'),
      localHealth: document.getElementById('hud-local-health'),
      remoteHealth: document.getElementById('hud-remote-health'),
      localChip: document.getElementById('hud-local-health-chip'),
      remoteChip: document.getElementById('hud-remote-health-chip'),
      localPower: document.getElementById('hud-local-power'),
      remotePower: document.getElementById('hud-remote-power'),
      localPowerText: document.getElementById('hud-local-power-text'),
      remotePowerText: document.getElementById('hud-remote-power-text'),
      localPips: document.getElementById('hud-local-pips'),
      remotePips: document.getElementById('hud-remote-pips'),
      localStatuses: document.getElementById('hud-local-statuses'),
      remoteStatuses: document.getElementById('hud-remote-statuses'),
      round: document.getElementById('hud-round'),
      timer: document.getElementById('hud-timer'),
      ping: document.getElementById('hud-ping'),
      comboLocal: document.getElementById('hud-combo-local'),
      comboRemote: document.getElementById('hud-combo-remote'),
      announce: document.getElementById('hud-announce'),
      announceMain: document.getElementById('announce-main'),
      announceSub: document.getElementById('announce-sub'),
      skillBar: document.getElementById('skill-bar'),
      disconnect: document.getElementById('disconnect-banner'),
      disconnectText: document.getElementById('disconnect-text'),
      spectator: document.getElementById('spectator-banner'),
      gameEmotes: document.getElementById('game-emotes'),
      forfeit: document.getElementById('btn-forfeit')
    };

    this.localHudId = null;
    this.remoteHudId = null;
    this.localMeta = null;
    this.remoteMeta = null;
    this.spectator = false;
    this.skillEls = [];
    this.healthShown = { local: null, remote: null };
    this.chipTimers = { local: null, remote: null };
    this.statusSigs = { local: '', remote: '' };
    this.lastCountdown = null;
    this.lastPhase = '';
    this.lastRound = null;
    this.seenEvents = new Set();
    this.announceTimer = null;
    this.disconnectTimer = null;
    this.disconnectUntil = 0;
    this.disconnectState = false;
  }

  setMatch(payload, localId, spectator = false) {
    this.spectator = spectator;
    this.localHudId = null;
    this.remoteHudId = null;
    this.localMeta = null;
    this.remoteMeta = null;
    this.healthShown = { local: null, remote: null };
    this.statusSigs = { local: '', remote: '' };
    this.lastCountdown = null;
    this.lastPhase = '';
    this.lastRound = null;
    this.seenEvents.clear();
    this.clearAnnounce();
    this.hideDisconnect();
    this.hideCombo('local');
    this.hideCombo('remote');

    const players = payload.players || [];
    let local = null;
    let remote = null;
    if (spectator) {
      local = players[0] || null;
      remote = players[1] || null;
    } else {
      local = players.find((player) => player.playerId === localId) || players[0] || null;
      remote = players.find((player) => player.playerId !== local?.playerId) || null;
    }
    this.localHudId = local?.playerId || null;
    this.remoteHudId = remote?.playerId || null;
    this.localMeta = local;
    this.remoteMeta = remote;

    this.setName('local', local);
    this.setName('remote', remote);
    this.renderPips(this.els.localPips, 0);
    this.renderPips(this.els.remotePips, 0);
    this.buildSkillBar(local);
    this.els.skillBar?.classList.toggle('hidden', spectator || !local);
    this.els.gameEmotes?.classList.toggle('hidden', spectator);
    this.els.spectator?.classList.toggle('hidden', !spectator);
    if (this.els.forfeit) this.els.forfeit.textContent = spectator ? '⚑ Leave' : '⚑ Leave';
  }

  setName(side, player) {
    const nameEl = side === 'local' ? this.els.localName : this.els.remoteName;
    const botEl = side === 'local' ? this.els.localBot : this.els.remoteBot;
    if (nameEl) nameEl.textContent = player?.nickname || (this.spectator ? 'FIGHTER' : 'WAITING');
    if (botEl) botEl.classList.toggle('hidden', !player?.isBot);
  }

  buildSkillBar(local) {
    if (!this.els.skillBar) return;
    this.skillEls = [];
    this.els.skillBar.innerHTML = '';
    const hero = local?.hero;
    if (!hero) {
      this.els.skillBar.classList.add('hidden');
      return;
    }

    for (const slot of SLOT_ORDER) {
      const skill = (hero.skills || []).find((entry) => entry.slot === slot);
      const root = document.createElement('div');
      root.className = 'skill-slot';
      root.dataset.slot = slot;
      if (!skill) root.classList.add('hidden');
      root.title = skill
        ? `${skill.displayName} — ${skill.cooldown}s cooldown${skill.powerCost ? `, ${skill.powerCost} power` : ''}`
        : `No ${slot} skill`;

      const art = document.createElement('div');
      art.className = 'skill-art';
      if (skill?.icon) {
        const img = document.createElement('img');
        img.src = skill.icon;
        img.alt = '';
        img.addEventListener('error', () => {
          img.remove();
          const glyph = document.createElement('span');
          glyph.className = 'skill-glyph';
          glyph.textContent = slot;
          art.prepend(glyph);
        });
        art.appendChild(img);
      } else {
        const glyph = document.createElement('span');
        glyph.className = 'skill-glyph';
        glyph.textContent = slot;
        art.appendChild(glyph);
      }
      const shade = document.createElement('div');
      shade.className = 'cd-shade';
      const text = document.createElement('div');
      text.className = 'cd-text';
      art.append(shade, text);

      const key = document.createElement('span');
      key.className = 'key-hint';
      key.textContent = SLOT_KEYS[slot] || slot;
      const power = document.createElement('span');
      power.className = 'power-hint';
      power.textContent = slot === 'ULT' ? '100 PWR' : skill?.powerCost ? `${skill.powerCost} PWR` : 'FREE';

      root.append(art, key, power);
      this.els.skillBar.appendChild(root);
      this.skillEls.push({ slot, skill, root, shade, text });
    }

    // Touch buttons mirror availability and cooldown readouts.
    document.querySelectorAll('.touch-btn[data-slot]').forEach((button) => {
      const slot = button.dataset.slot;
      const skill = (hero.skills || []).find((entry) => entry.slot === slot);
      button.classList.toggle('noskill', !skill);
      const cd = button.querySelector('.touch-cd');
      if (cd) cd.textContent = '';
    });
  }

  update(snapshot, latency = 0, spectator = false) {
    if (!snapshot) return;
    const local = snapshot.players.find((player) => player.id === this.localHudId);
    const remote = snapshot.players.find((player) => player.id === this.remoteHudId);

    if (local) this.updateHealth('local', local);
    if (remote) this.updateHealth('remote', remote);
    if (local) this.updatePower('local', local);
    if (remote) this.updatePower('remote', remote);
    if (local) this.renderPips(this.els.localPips, local.wins || 0);
    if (remote) this.renderPips(this.els.remotePips, remote.wins || 0);
    if (local) this.updateStatuses('local', local.statuses);
    if (remote) this.updateStatuses('remote', remote.statuses);

    if (this.els.round) {
      this.els.round.textContent = snapshot.phase === 'match_end' ? 'MATCH END' : `ROUND ${snapshot.round || 1}`;
    }
    if (this.els.timer) {
      const timer = snapshot.timer ?? 99;
      this.els.timer.textContent = String(timer);
      this.els.timer.classList.toggle('urgent', snapshot.phase === 'playing' && timer <= 10);
    }
    if (this.els.ping) {
      const ms = Math.max(0, Math.round(latency || 0));
      this.els.ping.textContent = `PING ${ms}ms`;
      this.els.ping.classList.remove('good', 'mid', 'bad');
      this.els.ping.classList.add(ms < 90 ? 'good' : ms < 170 ? 'mid' : 'bad');
    }

    this.updateCooldowns(local, snapshot);
    this.updateCombos(local, remote, snapshot);
    this.processEvents(snapshot);
    this.updatePhase(snapshot);
    this.updateDisconnect(remote);
    if (this.els.forfeit) {
      this.els.forfeit.classList.toggle('hidden', spectator);
    }
  }

  updateHealth(side, player) {
    const pct = Math.max(0, Math.min(100, (player.health / Math.max(1, player.maxHealth)) * 100));
    const fill = side === 'local' ? this.els.localHealth : this.els.remoteHealth;
    const chip = side === 'local' ? this.els.localChip : this.els.remoteChip;
    if (!fill) return;
    fill.style.width = `${pct}%`;
    fill.classList.toggle('low', pct <= 25);
    if (!chip) return;

    const previous = this.healthShown[side];
    if (previous == null) {
      chip.style.transition = 'none';
      chip.style.width = `${pct}%`;
      void chip.offsetWidth;
      chip.style.transition = '';
    } else if (pct < previous - 0.05) {
      chip.style.transition = 'none';
      chip.style.width = `${previous}%`;
      void chip.offsetWidth;
      chip.style.transition = '';
      chip.style.width = `${pct}%`;
    } else if (pct > previous) {
      chip.style.width = `${pct}%`;
    }
    this.healthShown[side] = pct;
  }

  updatePower(side, player) {
    const power = Math.max(0, Math.min(100, player.power || 0));
    const fill = side === 'local' ? this.els.localPower : this.els.remotePower;
    const text = side === 'local' ? this.els.localPowerText : this.els.remotePowerText;
    if (fill) fill.style.width = `${power}%`;
    if (text) text.textContent = String(Math.round(power));
  }

  renderPips(container, wins) {
    if (!container) return;
    while (container.children.length < 2) {
      const pip = document.createElement('i');
      container.appendChild(pip);
    }
    [...container.children].forEach((pip, index) => {
      pip.classList.toggle('won', index < wins);
    });
  }

  updateStatuses(side, statuses = []) {
    const container = side === 'local' ? this.els.localStatuses : this.els.remoteStatuses;
    if (!container) return;
    const signature = statuses.map((status) => status.type).join('|');
    if (signature === this.statusSigs[side]) return;
    this.statusSigs[side] = signature;
    container.innerHTML = '';
    for (const status of statuses) {
      const pill = document.createElement('span');
      pill.className = `status-pill ${status.type}`;
      pill.textContent = STATUS_LABELS[status.type] || status.type.toUpperCase();
      if (status.remaining != null) {
        pill.title = `${Math.ceil(status.remaining / 60)}s remaining`;
      }
      container.appendChild(pill);
    }
  }

  updateCooldowns(local, snapshot) {
    if (!local) return;
    for (const entry of this.skillEls) {
      if (!entry.skill) continue;
      const remaining = local.cooldowns?.[entry.slot] || 0;
      const total = Math.max(1, Math.round((entry.skill.cooldown || 1) * 60));
      const fraction = Math.max(0, Math.min(1, remaining / total));
      entry.shade.style.transform = `scaleY(${fraction})`;
      entry.text.textContent = remaining > 0 ? String(Math.ceil(remaining / 60)) : '';
      const hasPower = entry.slot === 'ULT'
        ? (local.power || 0) >= 100
        : (local.power || 0) >= (entry.skill.powerCost || 0);
      const ready = remaining <= 0 && hasPower;
      entry.root.classList.toggle('ready', ready && entry.slot !== 'ULT');
      entry.root.classList.toggle('ult-ready', ready && entry.slot === 'ULT');

      const touch = document.querySelector(`.touch-btn[data-slot="${entry.slot}"]`);
      const cd = touch?.querySelector('.touch-cd');
      if (cd) cd.textContent = remaining > 0 ? String(Math.ceil(remaining / 60)) : '';
      touch?.classList.toggle('ready', ready);
    }
    if (this.els.skillBar) this.els.skillBar.classList.toggle('hidden', this.spectator);
  }

  updateCombos(local, remote, snapshot) {
    const showLocal = !!local && local.combo >= 2 && snapshot.phase === 'playing';
    const showRemote = !!remote && remote.combo >= 2 && snapshot.phase === 'playing';
    if (this.els.comboLocal) {
      this.els.comboLocal.classList.toggle('hidden', !showLocal);
      if (showLocal) this.els.comboLocal.textContent = `×${local.combo} COMBO`;
    }
    if (this.els.comboRemote) {
      this.els.comboRemote.classList.toggle('hidden', !showRemote);
      if (showRemote) this.els.comboRemote.textContent = `×${remote.combo} COMBO`;
    }
  }

  hideCombo(side) {
    const el = side === 'local' ? this.els.comboLocal : this.els.comboRemote;
    el?.classList.add('hidden');
  }

  processEvents(snapshot) {
    for (const event of snapshot.events || []) {
      if (event.id != null) {
        if (this.seenEvents.has(event.id)) continue;
        this.seenEvents.add(event.id);
      }
      if (event.type === 'fight') {
        this.announce('FIGHT!', 'ROUND ' + (event.round || snapshot.round || 1), 850);
      } else if (event.type === 'roundEnd') {
        const winner = snapshot.players.find((player) => player.id === event.winnerId);
        const reason = event.reason === 'timeout' ? 'TIME UP' : 'K.O.';
        this.announce(reason, winner ? `${winner.nickname} TAKES THE ROUND` : 'ROUND OVER', 1600);
      } else if (event.type === 'matchEnd') {
        this.lastCountdown = null;
      }
    }
  }

  updatePhase(snapshot) {
    if (snapshot.phase === 'countdown') {
      const seconds = Math.max(1, Math.ceil((snapshot.countdown || 0) / 60));
      if (seconds !== this.lastCountdown) {
        this.lastCountdown = seconds;
        this.announce(String(seconds), `ROUND ${snapshot.round || 1}`, 1050);
      }
    } else if (snapshot.phase === 'playing') {
      if (this.lastPhase === 'countdown' && this.lastCountdown !== null) {
        this.announce('FIGHT!', '', 800);
        this.lastCountdown = null;
      }
    } else if (snapshot.phase === 'round_end' && this.lastPhase !== 'round_end') {
      const winner = snapshot.players.find((player) => player.id === snapshot.roundWinnerId);
      const reason = snapshot.roundEndReason === 'timeout' ? 'TIME UP' : 'K.O.';
      this.announce(reason, winner ? `${winner.nickname} TAKES THE ROUND` : 'ROUND OVER', 1500);
    }
    if (this.lastRound !== snapshot.round && snapshot.phase === 'countdown') {
      this.lastRound = snapshot.round;
      this.lastCountdown = null;
    }
    this.lastPhase = snapshot.phase;
  }

  updateDisconnect(remote) {
    if (!remote) return;
    if (remote.connected === false && !this.disconnectState) {
      this.showDisconnect(15);
    } else if (remote.connected !== false && this.disconnectState) {
      this.hideDisconnect();
    }
  }

  showDisconnect(seconds = 15) {
    if (!this.els.disconnect || this.spectator) return;
    this.disconnectState = true;
    this.disconnectUntil = Date.now() + Math.max(0, seconds) * 1000;
    this.els.disconnect.classList.remove('hidden');
    const render = () => {
      const left = Math.max(0, Math.ceil((this.disconnectUntil - Date.now()) / 1000));
      if (this.els.disconnectText) {
        const name = this.remoteMeta?.nickname || 'Opponent';
        this.els.disconnectText.textContent = left > 0
          ? `${name} disconnected — ${left}s to reconnect`
          : `${name} disconnected — waiting for the result`;
      }
      if (left <= 0 && this.disconnectTimer) {
        clearInterval(this.disconnectTimer);
        this.disconnectTimer = null;
      }
    };
    render();
    if (this.disconnectTimer) clearInterval(this.disconnectTimer);
    this.disconnectTimer = setInterval(render, 250);
  }

  hideDisconnect() {
    this.disconnectState = false;
    this.els.disconnect?.classList.add('hidden');
    if (this.disconnectTimer) clearInterval(this.disconnectTimer);
    this.disconnectTimer = null;
  }

  announce(main, sub = '', duration = 1200, small = false) {
    if (!this.els.announce) return;
    if (this.announceTimer) clearTimeout(this.announceTimer);
    if (this.els.announceMain) {
      this.els.announceMain.textContent = main;
      this.els.announceMain.style.animation = 'none';
      void this.els.announceMain.offsetWidth;
      this.els.announceMain.style.animation = '';
    }
    if (this.els.announceSub) this.els.announceSub.textContent = sub;
    this.els.announce.classList.toggle('announce-small', small);
    this.els.announce.classList.remove('show');
    void this.els.announce.offsetWidth;
    this.els.announce.classList.add('show');
    this.announceTimer = setTimeout(() => {
      this.els.announce?.classList.remove('show');
      this.announceTimer = null;
    }, duration);
  }

  clearAnnounce() {
    if (this.announceTimer) clearTimeout(this.announceTimer);
    this.announceTimer = null;
    this.els.announce?.classList.remove('show');
  }
}
