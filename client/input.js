/**
 * Unified input controller.
 *
 * Produces exactly the object the server expects:
 * { left, right, up, down, light, heavy, block, skill1, skill2, skill3, ult }
 *
 * Keyboard, Gamepad API and the on-screen touch controls are merged into one
 * state. Presses are latched briefly so a very quick tap still reaches the
 * server on the next network frame.
 */

const ACTIONS = [
  'left', 'right', 'up', 'down', 'light', 'heavy', 'block',
  'skill1', 'skill2', 'skill3', 'ult'
];

const LATCH_MS = 90;

const KEY_ACTIONS = {
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyW: 'up',
  ArrowUp: 'up',
  Space: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyJ: 'light',
  KeyK: 'heavy',
  KeyL: 'block',
  ShiftLeft: 'block',
  ShiftRight: 'block',
  KeyU: 'skill1',
  KeyI: 'skill2',
  KeyO: 'skill3',
  KeyP: 'ult'
};

const GAME_KEYS = new Set(Object.keys(KEY_ACTIONS));

const KEY_HINTS = {
  left: 'A / ←',
  right: 'D / →',
  up: 'W / ↑',
  down: 'S / ↓',
  light: 'J',
  heavy: 'K',
  block: 'L',
  skill1: 'U',
  skill2: 'I',
  skill3: 'O',
  ult: 'P'
};

function emptyState() {
  const state = {};
  for (const action of ACTIONS) state[action] = false;
  return state;
}

function isTextTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export class InputController {
  constructor(options = {}) {
    /** The single shared input object required by the protocol. */
    this.state = emptyState();
    this.enabled = options.enabled !== false;
    this.heldKeys = new Set();
    this.touchHeld = new Set();
    this.latches = {};
    this.gamepadIndex = null;
    this.gamepadState = emptyState();
    this.joyVector = { x: 0, y: 0 };
    this.joystickPointer = null;
    this.bound = false;
    this.onGamepadChange = options.onGamepadChange || null;
    this.boundKeyDown = this.onKeyDown.bind(this);
    this.boundKeyUp = this.onKeyUp.bind(this);
    this.boundBlur = this.clearHeld.bind(this);
  }

  attach() {
    if (this.bound) return this;
    this.bound = true;

    window.addEventListener('keydown', this.boundKeyDown, { passive: false });
    window.addEventListener('keyup', this.boundKeyUp, { passive: false });
    window.addEventListener('blur', this.boundBlur);
    document.addEventListener('visibilitychange', this.boundBlur);

    window.addEventListener('gamepadconnected', (event) => {
      this.gamepadIndex = event.gamepad.index;
      this.onGamepadChange?.(event.gamepad);
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
      this.gamepadState = emptyState();
      this.onGamepadChange?.(null);
    });

    this.bindTouchControls();
    this.bindJoystick();
    return this;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) {
      this.clearHeld();
      for (const action of ACTIONS) this.state[action] = false;
    }
  }

  clearHeld() {
    this.heldKeys.clear();
    this.touchHeld.clear();
    this.latches = {};
    this.joyVector = { x: 0, y: 0 };
    this.joystickPointer = null;
    this.resetJoystick();
  }

  onKeyDown(event) {
    const action = KEY_ACTIONS[event.code];
    if (!action) return;
    if (isTextTarget(event.target)) return;
    if (GAME_KEYS.has(event.code)) event.preventDefault();
    if (!this.enabled) return;
    if (!this.heldKeys.has(event.code)) {
      this.heldKeys.add(event.code);
      this.latch(action);
    }
  }

  onKeyUp(event) {
    if (!KEY_ACTIONS[event.code]) return;
    if (isTextTarget(event.target)) return;
    event.preventDefault();
    this.heldKeys.delete(event.code);
  }

  latch(action) {
    this.latches[action] = performance.now() + LATCH_MS;
  }

  bindTouchControls() {
    const buttons = document.querySelectorAll('.touch-btn[data-action]');
    for (const button of buttons) {
      const action = button.dataset.action;
      if (!ACTIONS.includes(action)) continue;

      const press = (event) => {
        if (!this.enabled) return;
        event.preventDefault();
        event.stopPropagation();
        button.classList.add('active');
        this.touchHeld.add(action);
        this.latch(action);
        try {
          button.setPointerCapture(event.pointerId);
        } catch (error) {
          // Older browsers may not support pointer capture here.
        }
      };

      const release = (event) => {
        event.preventDefault();
        button.classList.remove('active');
        this.touchHeld.delete(action);
      };

      button.addEventListener('pointerdown', press);
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    }
  }

  bindJoystick() {
    const zone = document.getElementById('joystick-zone');
    const joystick = document.getElementById('joystick');
    const knob = document.getElementById('joystick-knob');
    if (!zone || !joystick || !knob) return;

    const TRAVEL = 44;
    this.joyOrigin = { x: 0, y: 0 };

    const placeAt = (event) => {
      const rect = zone.getBoundingClientRect();
      const half = (joystick.offsetWidth || 136) / 2 + 4;
      this.joyOrigin.x = Math.max(half, Math.min(rect.width - half, event.clientX - rect.left));
      this.joyOrigin.y = Math.max(half, Math.min(rect.height - half, event.clientY - rect.top));
      joystick.style.left = `${this.joyOrigin.x}px`;
      joystick.style.top = `${this.joyOrigin.y}px`;
    };

    const update = (event) => {
      const rect = zone.getBoundingClientRect();
      let dx = event.clientX - rect.left - this.joyOrigin.x;
      let dy = event.clientY - rect.top - this.joyOrigin.y;
      const distance = Math.hypot(dx, dy);
      if (distance > TRAVEL) {
        dx = (dx / distance) * TRAVEL;
        dy = (dy / distance) * TRAVEL;
      }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.joyVector = { x: dx / TRAVEL, y: dy / TRAVEL };
      joystick.classList.toggle('dir-left', this.joyVector.x < -0.3);
      joystick.classList.toggle('dir-right', this.joyVector.x > 0.3);
      joystick.classList.toggle('dir-up', this.joyVector.y < -0.38);
      joystick.classList.toggle('dir-down', this.joyVector.y > 0.38);
    };

    const release = (event) => {
      if (this.joystickPointer !== event.pointerId) return;
      if (event.cancelable) event.preventDefault();
      this.joystickPointer = null;
      this.joyVector = { x: 0, y: 0 };
      this.resetJoystick();
    };

    zone.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      if (this.joystickPointer !== null) return;
      event.preventDefault();
      this.joystickPointer = event.pointerId;
      try {
        zone.setPointerCapture(event.pointerId);
      } catch (error) {
        // Ignore unsupported capture.
      }
      joystick.classList.add('active');
      placeAt(event);
      update(event);
    });
    zone.addEventListener('pointermove', (event) => {
      if (this.joystickPointer !== event.pointerId) return;
      event.preventDefault();
      update(event);
    });
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);
    zone.addEventListener('lostpointercapture', release);
    zone.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  resetJoystick() {
    const joystick = document.getElementById('joystick');
    const knob = document.getElementById('joystick-knob');
    if (joystick) {
      joystick.classList.remove('active', 'dir-left', 'dir-right', 'dir-up', 'dir-down');
      joystick.style.left = '';
      joystick.style.top = '';
    }
    if (knob) knob.style.transform = 'translate(-50%, -50%)';
  }

  pollGamepad() {
    if (!navigator.getGamepads) return {};
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = this.gamepadIndex != null ? pads[this.gamepadIndex] : null;
    if (!pad) {
      pad = Array.from(pads).find((entry) => entry && entry.connected) || null;
    }
    if (!pad) {
      this.gamepadState = emptyState();
      return this.gamepadState;
    }
    this.gamepadIndex = pad.index;

    const button = (index) => !!(pad.buttons[index] && pad.buttons[index].pressed);
    const axisX = pad.axes[0] || 0;
    const axisY = pad.axes[1] || 0;
    const dpadLeft = button(14);
    const dpadRight = button(15);
    const dpadUp = button(12);
    const dpadDown = button(13);

    const next = emptyState();
    next.left = dpadLeft || axisX < -0.35;
    next.right = dpadRight || axisX > 0.35;
    next.down = dpadDown || axisY > 0.5;
    next.up = dpadUp || axisY < -0.55;
    next.light = button(0);   // A
    next.heavy = button(1);   // B
    next.skill1 = button(2);  // X
    next.skill2 = button(3);  // Y
    next.block = button(4) || button(6); // LB / LT
    next.skill3 = button(5);  // RB
    next.ult = button(7);     // RT

    for (const action of ACTIONS) {
      if (next[action] && !this.gamepadState[action]) this.latch(action);
    }
    this.gamepadState = next;
    return next;
  }

  /** Merge every input source and update the shared state object. */
  update() {
    if (!this.enabled) {
      for (const action of ACTIONS) this.state[action] = false;
      return this.state;
    }

    const pad = this.pollGamepad();
    const now = performance.now();
    const keyboard = {};
    for (const code of this.heldKeys) {
      const action = KEY_ACTIONS[code];
      if (action) keyboard[action] = true;
    }

    const joy = this.joyVector;
    const joyLeft = joy.x < -0.3;
    const joyRight = joy.x > 0.3;
    const joyUp = joy.y < -0.38;
    const joyDown = joy.y > 0.38;
    if (joyUp && !this.joyUpHeld) this.latch('up');
    this.joyUpHeld = joyUp;

    for (const action of ACTIONS) {
      const latched = this.latches[action] > now;
      this.state[action] = !!(
        keyboard[action] ||
        pad[action] ||
        this.touchHeld.has(action) ||
        (action === 'left' && joyLeft) ||
        (action === 'right' && joyRight) ||
        (action === 'up' && joyUp) ||
        (action === 'down' && joyDown) ||
        latched
      );
    }
    return this.state;
  }

  /** Snapshot safe to send over the wire. */
  snapshot() {
    const out = {};
    for (const action of ACTIONS) out[action] = this.state[action] === true;
    return out;
  }

  static hintFor(action) {
    return KEY_HINTS[action] || '';
  }

  static get actions() {
    return ACTIONS;
  }
}

export { ACTIONS };
