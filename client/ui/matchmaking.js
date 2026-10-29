/**
 * Matchmaking search screen, bot offer and the 5-second accept dialog.
 */

const RING_CIRCUMFERENCE = 2 * Math.PI * 44;

function formatTimer(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export class MatchmakingUI {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.els = {
      timer: document.getElementById('search-timer'),
      range: document.getElementById('search-range'),
      waiting: document.getElementById('search-waiting'),
      botOffer: document.getElementById('bot-offer'),
      cancel: document.getElementById('btn-cancel-search'),
      fightBot: document.getElementById('btn-fight-bot'),
      keepWaiting: document.getElementById('btn-keep-waiting'),
      modal: document.getElementById('match-found-backdrop'),
      youName: document.getElementById('mf-you-name'),
      opponent: document.getElementById('mf-opponent'),
      opponentRating: document.getElementById('mf-opponent-rating'),
      countdown: document.getElementById('mf-countdown'),
      ring: document.getElementById('mf-ring'),
      status: document.getElementById('mf-status'),
      accept: document.getElementById('mf-accept'),
      decline: document.getElementById('mf-decline')
    };

    this.startedAt = Date.now();
    this.timerId = null;
    this.acceptTimer = null;
    this.deadline = 0;
    this.acceptWindow = 5;
    this.accepted = false;
    this.pending = null;

    this.els.cancel?.addEventListener('click', () => this.callbacks.onCancel?.());
    this.els.fightBot?.addEventListener('click', () => this.callbacks.onFightBot?.());
    this.els.keepWaiting?.addEventListener('click', () => {
      this.hideBotOffer();
      this.callbacks.onKeepWaiting?.();
    });
    this.els.accept?.addEventListener('click', () => this.accept());
    this.els.decline?.addEventListener('click', () => this.decline());
  }

  show({ elapsed = 0 } = {}) {
    this.startedAt = Date.now() - Math.max(0, elapsed) * 1000;
    this.hideBotOffer();
    if (this.els.waiting) this.els.waiting.textContent = 'Waiting for another fighter…';
    if (this.els.range) this.els.range.textContent = 'Rating window ±100';
    this.renderTimer();
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = setInterval(() => this.renderTimer(), 250);
  }

  hide() {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = null;
  }

  renderTimer() {
    if (this.els.timer) {
      this.els.timer.textContent = formatTimer((Date.now() - this.startedAt) / 1000);
    }
    if (!this.els.range) return;
    const seconds = Math.floor((Date.now() - this.startedAt) / 1000);
    const width = 100 + Math.floor(seconds / 5) * 50;
    this.els.range.textContent = `Rating window ±${width}`;
  }

  update(status = {}) {
    if (status.status === 'searching') {
      if (typeof status.since === 'number') this.startedAt = status.since;
      if (status.range && this.els.range) {
        this.els.range.textContent = `Rating window ${status.range.min}–${status.range.max}`;
      }
      if (this.els.waiting && typeof status.waiting === 'number') {
        this.els.waiting.textContent = status.waiting > 1
          ? `${status.waiting} fighters searching…`
          : 'Waiting for another fighter…';
      }
      this.renderTimer();
    } else if (status.status === 'error') {
      this.hide();
      this.hideBotOffer();
    }
  }

  showBotOffer() {
    this.els.botOffer?.classList.remove('hidden');
  }

  hideBotOffer() {
    this.els.botOffer?.classList.add('hidden');
  }

  showMatchFound({ opponent, acceptWindow = 5, deadline, localName = 'You' }, pending = {}) {
    this.pending = pending;
    this.accepted = false;
    this.acceptWindow = Math.max(1, acceptWindow || 5);
    this.deadline = typeof deadline === 'number' ? deadline : Date.now() + this.acceptWindow * 1000;
    if (this.els.youName) this.els.youName.textContent = localName;
    if (this.els.opponent) this.els.opponent.textContent = opponent?.nickname || 'Opponent';
    if (this.els.opponentRating) this.els.opponentRating.textContent = `${opponent?.rating ?? 1000} ELO`;
    if (this.els.status) this.els.status.textContent = 'Both fighters must accept.';
    if (this.els.accept) {
      this.els.accept.disabled = false;
      this.els.accept.textContent = 'Accept';
    }
    if (this.els.decline) this.els.decline.disabled = false;
    this.els.modal?.classList.remove('hidden');
    this.updateAcceptTimer();
    if (this.acceptTimer) clearInterval(this.acceptTimer);
    this.acceptTimer = setInterval(() => this.updateAcceptTimer(), 100);
  }

  updateAcceptTimer() {
    const remainingMs = Math.max(0, this.deadline - Date.now());
    const remaining = remainingMs / 1000;
    if (this.els.countdown) this.els.countdown.textContent = String(Math.max(0, Math.ceil(remaining)));
    if (this.els.ring) {
      const fraction = Math.min(1, Math.max(0, remaining / this.acceptWindow));
      this.els.ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - fraction));
    }
    if (remainingMs <= 0) {
      if (this.acceptTimer) clearInterval(this.acceptTimer);
      this.acceptTimer = null;
      if (this.els.status && !this.accepted) this.els.status.textContent = 'Accept window expired.';
      if (this.els.accept) this.els.accept.disabled = true;
      if (this.els.decline) this.els.decline.disabled = true;
    }
  }

  accept() {
    if (this.accepted) return;
    this.accepted = true;
    if (this.els.accept) {
      this.els.accept.disabled = true;
      this.els.accept.textContent = 'Accepted';
    }
    if (this.els.status) this.els.status.textContent = 'Waiting for opponent to accept…';
    this.callbacks.onAccept?.();
  }

  decline() {
    if (this.els.decline) this.els.decline.disabled = true;
    this.callbacks.onDecline?.();
    this.hideMatchFound();
  }

  updateAcceptStatus(payload = {}) {
    if (!this.els.status) return;
    if (payload.both) {
      this.els.status.textContent = 'Match accepted! Entering the lobby…';
      if (this.els.accept) this.els.accept.disabled = true;
      return;
    }
    if (payload.accepted && !payload.both) {
      this.els.status.textContent = this.accepted
        ? 'Opponent accepted. Waiting…'
        : 'Opponent accepted. Your turn.';
    }
  }

  hideMatchFound() {
    this.els.modal?.classList.add('hidden');
    if (this.acceptTimer) clearInterval(this.acceptTimer);
    this.acceptTimer = null;
    this.accepted = false;
    this.pending = null;
  }

  reset() {
    this.hide();
    this.hideBotOffer();
    this.hideMatchFound();
  }
}
