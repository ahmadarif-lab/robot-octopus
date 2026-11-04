import { t } from './i18n.js';
const CHOICE_KEY = 'oc8-quality';
const AUTO_TIER_KEY = 'oc8-quality-auto-tier';

export const ORDER = ['high', 'mid', 'low'];
// Getters, so each read follows the language chosen at that moment.
export const LABEL = {
  get auto() { return t('AUTO'); },
  get high() { return t('HIGH'); },
  get mid() { return t('MEDIUM'); },
  get low() { return t('LOW'); },
};

/* Each level trades away what costs most for what is least noticed while playing. */
const TIERS = {
  high: { pixel: 2, shadow: 2048, props: 1, radius: 3, fauna: 1, schools: 4, bubbles: 1, snow: 1, pistons: true, fog: 0.0115 },
  mid: { pixel: 1.5, shadow: 1024, props: 0.6, radius: 3, fauna: 0.6, schools: 3, bubbles: 0.6, snow: 0.6, pistons: true, fog: 0.0115 },
  low: { pixel: 1, shadow: 0, props: 0.25, radius: 2, fauna: 0.35, schools: 2, bubbles: 0.3, snow: 0.3, pistons: false, fog: 0.017 },
};

const WINDOW_MS = 2000;
const FPS_DOWN = 27; // Below this it feels bad. Sits under 30, so 30 Hz battery-saver screens are not punished.
const FPS_UP = 52;
const WINDOWS_TO_RAISE = 3;
const MS_IGNORED = 400; // A gap this long is a tab switch or a hitch, not the device's real speed.

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode can block storage; the choice then lasts for this visit only.
  }
};

/** A first guess from the hardware, so weak devices skip a slow first few seconds. */
function guessTier() {
  const touch = matchMedia('(pointer: coarse)').matches;
  const memory = navigator.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  if (touch) return memory <= 3 || cores <= 4 ? 'low' : 'mid';
  return memory <= 4 || cores <= 4 ? 'mid' : 'high';
}

export class Quality {
  constructor(targets, onAutoChange) {
    this.targets = targets;
    this.onAutoChange = onAutoChange;
    const stored = read(CHOICE_KEY);
    this.choice = stored === 'auto' || TIERS[stored] ? stored : 'auto';
    const lastAuto = read(AUTO_TIER_KEY);
    this.tier = this.choice === 'auto' ? (TIERS[lastAuto] ? lastAuto : guessTier()) : this.choice;
    this.fps = 0;
    this.frames = 0;
    this.elapsed = 0;
    this.goodWindows = 0;
    this.sinceChange = 0;
    this.raiseAfter = 30000;
    this.apply();
  }

  set(choice) {
    this.choice = choice;
    write(CHOICE_KEY, choice);
    this.resetWindow();
    this.goodWindows = 0;
    this.sinceChange = 0;
    this.raiseAfter = 30000;
    if (choice !== 'auto' && choice !== this.tier) {
      this.tier = choice;
      this.apply();
    }
  }

  resetWindow() {
    this.frames = 0;
    this.elapsed = 0;
  }

  /** Feeds in one real frame time, before any simulation clamp. */
  sample(ms) {
    if (ms > MS_IGNORED || document.hidden) {
      this.resetWindow();
      return;
    }
    this.frames++;
    this.elapsed += ms;
    this.sinceChange += ms;
    if (this.elapsed < WINDOW_MS) return;
    this.fps = (this.frames * 1000) / this.elapsed;
    this.resetWindow();
    if (this.choice === 'auto') this.adapt();
  }

  adapt() {
    const index = ORDER.indexOf(this.tier);
    if (this.fps < FPS_DOWN) {
      this.goodWindows = 0;
      if (index === ORDER.length - 1) return;
      // Falling right after a raise means that raise was too much: wait longer before the next try.
      if (this.raisedRecently && this.sinceChange < 15000) this.raiseAfter = Math.min(this.raiseAfter * 2, 300000);
      this.raisedRecently = false;
      this.change(ORDER[index + 1]);
      return;
    }
    this.goodWindows = this.fps >= FPS_UP ? this.goodWindows + 1 : 0;
    if (index > 0 && this.goodWindows >= WINDOWS_TO_RAISE && this.sinceChange >= this.raiseAfter) {
      this.raisedRecently = true;
      this.change(ORDER[index - 1]);
    }
  }

  change(tier) {
    this.tier = tier;
    this.goodWindows = 0;
    this.sinceChange = 0;
    write(AUTO_TIER_KEY, tier);
    this.apply();
    this.onAutoChange?.(tier);
  }

  apply() {
    const t = TIERS[this.tier];
    const { renderer, sun, scene, world, fauna, robot, bubbles } = this.targets;
    renderer.setPixelRatio(Math.min(devicePixelRatio, t.pixel));
    sun.castShadow = t.shadow > 0;
    if (t.shadow > 0 && sun.shadow.mapSize.x !== t.shadow) {
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      sun.shadow.mapSize.setScalar(t.shadow);
    }
    scene.fog.density = t.fog;
    world.setDetail(t.props, t.radius, t.snow);
    fauna.setDensity(t.fauna, t.schools);
    robot.setPistons(t.pistons);
    bubbles.scale = t.bubbles;
  }
}
