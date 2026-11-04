import { clamp } from './util.js';

const KEYS = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'jet', ShiftRight: 'jet', Space: 'jet',
};
const STICK_DEADZONE = 0.14;

/** Keyboard, on-screen buttons and the joystick feed the same state, so they can be mixed. */
export class Input {
  constructor() {
    this.keys = new Set();
    this.pads = new Set();
    this.pointers = new Map();
    this.stick = { x: 0, y: 0, pointer: null };

    addEventListener('keydown', (e) => {
      const a = KEYS[e.code];
      if (!a || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.pads.clear();
      this.pointers.clear();
      this.releaseStick();
    });

    document.querySelectorAll('[data-drive]').forEach((btn) => {
      const action = btn.dataset.drive;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, action);
        this.sync();
        navigator.vibrate?.(8);
      });
      const release = (e) => {
        this.pointers.delete(e.pointerId);
        this.sync();
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    this.buttons = [...document.querySelectorAll('[data-drive]')];
    this.bindStick();
  }

  bindStick() {
    const base = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    this.knob = knob;
    const move = (e) => {
      const r = base.getBoundingClientRect();
      const radius = r.width / 2;
      let dx = (e.clientX - (r.left + radius)) / radius;
      let dy = (e.clientY - (r.top + radius)) / radius;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      knob.style.transform = `translate(${dx * radius * 0.62}px,${dy * radius * 0.62}px)`;
      const curve = (v) => {
        const a = Math.abs(v);
        return a < STICK_DEADZONE ? 0 : Math.sign(v) * ((a - STICK_DEADZONE) / (1 - STICK_DEADZONE));
      };
      this.stick.x = curve(dx);
      this.stick.y = curve(dy);
    };
    base.addEventListener('pointerdown', (e) => {
      if (this.stick.pointer !== null) return;
      e.preventDefault();
      base.setPointerCapture(e.pointerId);
      this.stick.pointer = e.pointerId;
      knob.classList.add('held');
      base.classList.add('on');
      move(e);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stick.pointer) move(e);
    });
    const release = (e) => {
      if (e.pointerId === this.stick.pointer) this.releaseStick();
    };
    base.addEventListener('pointerup', release);
    base.addEventListener('pointercancel', release);
    base.addEventListener('lostpointercapture', release);
    base.addEventListener('contextmenu', (e) => e.preventDefault());
    this.stickBase = base;
  }

  releaseStick() {
    this.stick.x = 0;
    this.stick.y = 0;
    this.stick.pointer = null;
    this.knob.style.transform = '';
    this.knob.classList.remove('held');
    this.stickBase.classList.remove('on');
  }

  sync() {
    this.pads = new Set(this.pointers.values());
  }

  active(action) {
    if (this.pads.has(action)) return true;
    for (const code of this.keys) if (KEYS[code] === action) return true;
    return false;
  }

  read() {
    const forward = this.active('forward'), back = this.active('back');
    const left = this.active('left'), right = this.active('right');
    let throttle = clamp((forward ? 1 : 0) - (back ? 1 : 0) - this.stick.y, -1, 1);
    const turn = clamp((left ? 1 : 0) - (right ? 1 : 0) - this.stick.x, -1, 1);
    // The gamepad A button is a one-thumb jet: it launches forward with the stick centered.
    const jetGo = this.active('jetGo');
    if (jetGo && throttle === 0) throttle = 1;
    for (const b of this.buttons) b.classList.toggle('on', this.active(b.dataset.drive));
    return { throttle, turn, jet: this.active('jet') || jetGo };
  }
}
