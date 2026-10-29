/**
 * Character select screen. Purely driven by /api/characters data so a new
 * folder dropped into /characters appears here automatically.
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

function statBar(label, value, max) {
  const percent = Math.max(2, Math.min(100, (Number(value) || 0) / max * 100));
  return `
    <div class="stat-row">
      <span>${escapeHtml(label)}</span>
      <div class="stat-bar"><i style="width:${percent.toFixed(1)}%"></i></div>
      <strong>${escapeHtml(value)}</strong>
    </div>`;
}

function skillRow(skill) {
  const icon = skill.icon
    ? `<img src="${escapeHtml(skill.icon)}" alt="" loading="lazy" />`
    : `<span class="skill-key">${escapeHtml(skill.slot)}</span>`;
  return `
    <div class="skill-row">
      <div class="skill-icon">${icon}</div>
      <div class="skill-info">
        <strong>${escapeHtml(skill.displayName || skill.id)}</strong>
        <span>${escapeHtml(skill.description || skill.type || '')}</span>
      </div>
      <div class="skill-meta">
        ${escapeHtml(skill.slot)}<br />
        ${skill.powerCost ? `${skill.powerCost} PWR` : 'FREE'}<br />
        ${escapeHtml(skill.cooldown)}s CD
      </div>
    </div>`;
}

export class CharacterSelectUI {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.grid = document.getElementById('hero-grid');
    this.detail = document.getElementById('hero-detail');
    this.context = document.getElementById('select-context');
    this.back = document.getElementById('select-back');
    this.heroes = [];
    this.selectedId = null;
    this.onChoose = null;
    this.onCancel = null;

    this.back?.addEventListener('click', () => {
      const fn = this.onCancel;
      this.onCancel = null;
      this.onChoose = null;
      fn?.();
    });
  }

  open({ heroes, currentId, context = 'ROSTER', onChoose, onCancel }) {
    this.heroes = heroes || [];
    this.selectedId = this.heroes.some((hero) => hero.id === currentId)
      ? currentId
      : this.heroes[0]?.id || null;
    this.onChoose = onChoose;
    this.onCancel = onCancel;
    if (this.context) this.context.textContent = context;
    this.renderGrid();
    this.renderDetail();
  }

  renderGrid() {
    if (!this.grid) return;
    if (!this.heroes.length) {
      this.grid.innerHTML = '<div class="detail-empty">No heroes were found on the server.</div>';
      return;
    }
    this.grid.innerHTML = this.heroes.map((hero) => {
      const selected = hero.id === this.selectedId ? ' selected' : '';
      const glow = hero.theme?.glow || 'rgba(255,122,24,0.3)';
      const accent = hero.theme?.accent || '#ffd166';
      return `
        <button class="hero-card${selected}" data-hero="${escapeHtml(hero.id)}"
          style="--card-glow:${escapeHtml(glow)};--card-accent:${escapeHtml(accent)}">
          <span class="hero-card-tag">PLAYABLE</span>
          <div class="hero-card-portrait">
            <div class="portrait-fallback">${escapeHtml(initials(hero.displayName))}</div>
            ${hero.portrait ? `<img src="${escapeHtml(hero.portrait)}" alt="${escapeHtml(hero.displayName)}" loading="lazy" />` : ''}
          </div>
          <div class="hero-card-body">
            <strong>${escapeHtml(hero.displayName)}</strong>
            <span>${escapeHtml(hero.tagline || 'Challenger')}</span>
          </div>
        </button>`;
    }).join('');

    this.grid.querySelectorAll('.hero-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.selectedId = card.dataset.hero;
        this.grid.querySelectorAll('.hero-card').forEach((entry) => {
          entry.classList.toggle('selected', entry === card);
        });
        this.renderDetail();
      });
      const img = card.querySelector('img');
      const fallback = card.querySelector('.portrait-fallback');
      img?.addEventListener('error', () => {
        img.style.display = 'none';
        if (fallback) fallback.style.display = 'grid';
      });
    });
  }

  renderDetail() {
    if (!this.detail) return;
    const hero = this.heroes.find((entry) => entry.id === this.selectedId);
    if (!hero) {
      this.detail.innerHTML = '<div class="detail-empty">Select a hero to inspect their moves.</div>';
      return;
    }
    const stats = hero.stats || {};
    const moves = hero.moves || {};
    const skills = [...(hero.skills || [])].sort((a, b) => {
      const order = { S1: 1, S2: 2, S3: 3, ULT: 4 };
      return (order[a.slot] || 9) - (order[b.slot] || 9);
    });
    const glow = hero.theme?.glow || 'rgba(255,122,24,0.35)';
    const moveRow = (name, move) => `
      <div class="move-row">
        <strong>${escapeHtml(name)}</strong>
        <em>${escapeHtml(move?.damage ?? '—')} DMG · ${escapeHtml(move?.startupFrames ?? '—')}/${escapeHtml(move?.activeFrames ?? '—')}/${escapeHtml(move?.recoveryFrames ?? '—')} F</em>
      </div>`;

    this.detail.innerHTML = `
      <div class="detail-banner" style="--detail-glow:${escapeHtml(glow)}">
        <div class="portrait-fallback">${escapeHtml(initials(hero.displayName))}</div>
        ${hero.portrait ? `<img src="${escapeHtml(hero.portrait)}" alt="${escapeHtml(hero.displayName)}" />` : ''}
      </div>
      <div class="detail-body">
        <div class="detail-name-row">
          <h3>${escapeHtml(hero.displayName)}</h3>
          <span class="eyebrow-small">${escapeHtml(hero.id)}</span>
        </div>
        <p class="detail-tagline">${escapeHtml(hero.tagline || 'Challenger')}</p>
        <p class="detail-description">${escapeHtml(hero.description || '')}</p>
        <div class="stat-grid">
          ${statBar('Health', stats.maxHealth ?? 1000, 1600)}
          ${statBar('Speed', stats.walkSpeed ?? 4, 8)}
          ${statBar('Jump', stats.jumpPower ?? 16, 24)}
          ${statBar('Weight', stats.weight ?? 1, 2)}
        </div>
        <div class="detail-section-title"><span>Basic attacks</span><span>start / active / recovery</span></div>
        <div class="move-list">
          ${moveRow('Light', moves.light)}
          ${moveRow('Heavy', moves.heavy)}
        </div>
        <div class="detail-section-title"><span>Skills</span><span>U · I · O · P</span></div>
        <div class="skill-list">
          ${skills.map(skillRow).join('') || '<div class="detail-empty">No skills configured.</div>'}
        </div>
        <button class="btn primary wide" id="btn-pick-hero">Pick ${escapeHtml(hero.displayName)}</button>
      </div>`;

    const img = this.detail.querySelector('.detail-banner img');
    const fallback = this.detail.querySelector('.detail-banner .portrait-fallback');
    img?.addEventListener('error', () => {
      img.style.display = 'none';
      if (fallback) fallback.style.display = 'grid';
    });

    this.detail.querySelector('#btn-pick-hero')?.addEventListener('click', () => {
      const choose = this.onChoose;
      this.onChoose = null;
      this.onCancel = null;
      choose?.(hero.id);
    });
  }
}
