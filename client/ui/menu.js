/**
 * Main menu view.
 */

function setImage(img, fallback, src) {
  if (!img) return;
  if (src) {
    img.src = src;
    img.dataset.fallback = fallback ? fallback.id : '';
    img.style.visibility = 'visible';
    if (fallback) fallback.style.display = 'none';
  } else {
    img.removeAttribute('src');
    img.style.visibility = 'hidden';
    if (fallback) fallback.style.display = 'grid';
  }
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

export class MenuUI {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.els = {
      brandHome: document.getElementById('brand-home'),
      profileChip: document.getElementById('profile-chip'),
      profileAvatar: document.getElementById('profile-avatar'),
      profileName: document.getElementById('profile-name'),
      profileRating: document.getElementById('profile-rating'),
      profileRecord: document.getElementById('profile-record'),
      audio: document.getElementById('btn-audio'),
      statOnline: document.getElementById('stat-online'),
      statSearching: document.getElementById('stat-searching'),
      statHeroes: document.getElementById('stat-heroes'),
      onlineCount: document.getElementById('online-count'),
      portrait: document.getElementById('menu-portrait'),
      portraitFallback: document.getElementById('menu-portrait-fallback'),
      heroName: document.getElementById('menu-hero-name'),
      heroTagline: document.getElementById('menu-hero-tagline'),
      changeFighter: document.getElementById('btn-change-fighter'),
      random: document.getElementById('btn-random'),
      invite: document.getElementById('btn-invite'),
      join: document.getElementById('btn-join')
    };
    this.bind();
  }

  bind() {
    this.els.random?.addEventListener('click', () => this.callbacks.onRandom?.());
    this.els.invite?.addEventListener('click', () => this.callbacks.onInvite?.());
    this.els.join?.addEventListener('click', () => this.callbacks.onJoin?.());
    this.els.changeFighter?.addEventListener('click', () => this.callbacks.onChangeHero?.());
    this.els.profileChip?.addEventListener('click', () => this.callbacks.onProfile?.());
    this.els.audio?.addEventListener('click', () => this.callbacks.onAudio?.());
    this.els.brandHome?.addEventListener('click', () => this.callbacks.onHome?.());

    this.els.portrait?.addEventListener('error', () => {
      this.els.portrait.style.visibility = 'hidden';
      if (this.els.portraitFallback) {
        this.els.portraitFallback.style.display = 'grid';
        this.els.portraitFallback.textContent = this.els.heroName?.textContent?.charAt(0) || '?';
      }
    });
  }

  setHero(hero) {
    this.hero = hero || null;
    if (!hero) {
      setImage(this.els.portrait, this.els.portraitFallback, '');
      if (this.els.heroName) this.els.heroName.textContent = 'NO FIGHTER';
      if (this.els.heroTagline) this.els.heroTagline.textContent = 'Waiting for heroes to load…';
      return;
    }
    if (this.els.portraitFallback) this.els.portraitFallback.textContent = initials(hero.displayName);
    setImage(this.els.portrait, this.els.portraitFallback, hero.portrait);
    if (this.els.heroName) this.els.heroName.textContent = hero.displayName;
    if (this.els.heroTagline) this.els.heroTagline.textContent = hero.tagline || hero.description || '';
  }

  setProfile(profile) {
    if (!profile) return;
    if (this.els.profileName) this.els.profileName.textContent = profile.nickname || 'Guest';
    if (this.els.profileAvatar) this.els.profileAvatar.textContent = initials(profile.nickname);
    if (this.els.profileRating) this.els.profileRating.textContent = String(profile.rating ?? 1000);
    if (this.els.profileRecord) {
      this.els.profileRecord.textContent = `${profile.wins ?? 0}W / ${profile.losses ?? 0}L`;
    }
  }

  setPresence(presence) {
    if (!presence) return;
    const online = presence.online ?? 0;
    const searching = presence.searching ?? 0;
    if (this.els.onlineCount) this.els.onlineCount.textContent = String(online);
    if (this.els.statOnline) this.els.statOnline.textContent = String(online);
    if (this.els.statSearching) this.els.statSearching.textContent = String(searching);
    if (this.els.statHeroes && presence.heroes != null) {
      this.els.statHeroes.textContent = String(presence.heroes);
    }
  }

  setMuted(muted) {
    if (!this.els.audio) return;
    this.els.audio.classList.toggle('muted', muted);
    this.els.audio.textContent = muted ? '♪' : '♪';
    this.els.audio.title = muted ? 'Enable sound' : 'Mute sound';
    this.els.audio.setAttribute('aria-label', muted ? 'Enable sound' : 'Mute sound');
  }

  setBusy(busy) {
    for (const button of [this.els.random, this.els.invite, this.els.join]) {
      if (button) button.disabled = !!busy;
    }
  }
}
