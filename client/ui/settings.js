/**
 * Settings & Accessibility UI Controller.
 *
 * Controls sound volume, reduced motion & flashing, color-blind accessible HP bars,
 * touch button scaling & opacity, and keybindings reference.
 */

const SETTINGS_KEY = 'shadowclash.settings.v1';

export class SettingsUI {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.settings = this.load();
    this.els = {
      modal: document.getElementById('settings-modal'),
      closeBtn: document.getElementById('settings-close'),
      openBtn: document.getElementById('btn-settings'),
      soundSlider: document.getElementById('setting-sound-volume'),
      soundValue: document.getElementById('setting-sound-val'),
      motionToggle: document.getElementById('setting-reduce-motion'),
      colorblindToggle: document.getElementById('setting-colorblind'),
      touchScaleSlider: document.getElementById('setting-touch-scale'),
      touchScaleVal: document.getElementById('setting-touch-scale-val'),
      touchOpacitySlider: document.getElementById('setting-touch-opacity'),
      touchOpacityVal: document.getElementById('setting-touch-opacity-val')
    };

    this.bind();
    this.applyAll();
  }

  load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return { ...this.defaults(), ...JSON.parse(raw) };
    } catch (e) {
      // Fallback
    }
    return this.defaults();
  }

  defaults() {
    let prefersReducedMotion = false;
    try {
      prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    } catch (e) {
      // matchMedia is unavailable in some embedded browsers.
    }
    return {
      soundVolume: 70,
      reduceMotion: prefersReducedMotion,
      colorblind: false,
      touchScale: 100,
      touchOpacity: 85
    };
  }

  save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch (e) {}
  }

  bind() {
    this.els.openBtn?.addEventListener('click', () => this.open());
    this.els.closeBtn?.addEventListener('click', () => this.close());
    this.els.modal?.addEventListener('click', (e) => {
      if (e.target === this.els.modal) this.close();
    });

    this.els.soundSlider?.addEventListener('input', (e) => {
      this.settings.soundVolume = Number(e.target.value);
      if (this.els.soundValue) this.els.soundValue.textContent = `${this.settings.soundVolume}%`;
      this.save();
      this.callbacks.onVolumeChange?.(this.settings.soundVolume / 100);
    });

    this.els.motionToggle?.addEventListener('change', (e) => {
      this.settings.reduceMotion = e.target.checked;
      this.save();
      this.applyMotion();
      this.callbacks.onReduceMotionChange?.(this.settings.reduceMotion);
    });

    this.els.colorblindToggle?.addEventListener('change', (e) => {
      this.settings.colorblind = e.target.checked;
      this.save();
      this.applyColorblind();
    });

    this.els.touchScaleSlider?.addEventListener('input', (e) => {
      this.settings.touchScale = Number(e.target.value);
      if (this.els.touchScaleVal) this.els.touchScaleVal.textContent = `${this.settings.touchScale}%`;
      this.save();
      this.applyTouchSettings();
    });

    this.els.touchOpacitySlider?.addEventListener('input', (e) => {
      this.settings.touchOpacity = Number(e.target.value);
      if (this.els.touchOpacityVal) this.els.touchOpacityVal.textContent = `${this.settings.touchOpacity}%`;
      this.save();
      this.applyTouchSettings();
    });
  }

  applyAll() {
    if (this.els.soundSlider) this.els.soundSlider.value = this.settings.soundVolume;
    if (this.els.soundValue) this.els.soundValue.textContent = `${this.settings.soundVolume}%`;
    if (this.els.motionToggle) this.els.motionToggle.checked = this.settings.reduceMotion;
    if (this.els.colorblindToggle) this.els.colorblindToggle.checked = this.settings.colorblind;
    if (this.els.touchScaleSlider) this.els.touchScaleSlider.value = this.settings.touchScale;
    if (this.els.touchScaleVal) this.els.touchScaleVal.textContent = `${this.settings.touchScale}%`;
    if (this.els.touchOpacitySlider) this.els.touchOpacitySlider.value = this.settings.touchOpacity;
    if (this.els.touchOpacityVal) this.els.touchOpacityVal.textContent = `${this.settings.touchOpacity}%`;

    this.applyMotion();
    this.applyColorblind();
    this.applyTouchSettings();
    this.callbacks.onVolumeChange?.(this.settings.soundVolume / 100);
  }

  applyMotion() {
    document.body.classList.toggle('reduce-motion', this.settings.reduceMotion);
  }

  applyColorblind() {
    document.body.classList.toggle('colorblind-mode', this.settings.colorblind);
  }

  applyTouchSettings() {
    const scale = this.settings.touchScale / 100;
    const opacity = this.settings.touchOpacity / 100;
    document.documentElement.style.setProperty('--touch-scale', String(scale));
    document.documentElement.style.setProperty('--touch-opacity', String(opacity));
  }

  open() {
    this.els.modal?.classList.remove('hidden');
  }

  close() {
    this.els.modal?.classList.add('hidden');
  }
}
