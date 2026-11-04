import { clamp } from './util.js';

const STORAGE_KEY = 'oc8-muted';
const VOLUME_KEY = 'oc8-volume';
const MASTER = 0.85;

const readMuted = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const readVolume = () => {
  try {
    const stored = localStorage.getItem(VOLUME_KEY);
    const v = Number(stored);
    return stored !== null && v >= 0 && v <= 1 ? v : 1;
  } catch {
    return 1;
  }
};

/**
 * Everything is synthesized, there are no audio files and no music.
 * World sounds pass through a lowpass and a dark reverb, which is what makes them read as underwater.
 * UI clicks skip that chain so they stay crisp.
 */
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = readMuted();
    this.volume = readVolume();
    this.last = {};
    this.prevTargets = {};
    this.prevSteps = 0;

    const unlock = () => this.unlock();
    for (const type of ['pointerdown', 'keydown', 'touchend', 'click']) {
      addEventListener(type, unlock, { capture: true, passive: true });
    }
    document.addEventListener('pointerdown', (e) => {
      const el = e.target.closest?.('button, #stick');
      if (!el) return;
      if (el.classList.contains('a') || el.dataset.drive === 'jet') this.click('heavy');
      else if (el.id === 'stick') this.click('grab');
      else this.click(el.classList.contains('on') ? 'off' : 'on');
    }, { capture: true });
    addEventListener('keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      if (['KeyE', 'KeyI', 'KeyF', 'KeyM'].includes(e.code)) this.click('on');
      else if (/^(Key[WASD]|Arrow|Shift|Space)/.test(e.code)) this.click('tick');
    });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
  }

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.build();
    }
    if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume();
  }

  noiseBuffer(seconds, brown) {
    const { ctx } = this;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buffer.getChannelData(0);
    let v = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        v = (v + w * 0.02) / 1.02;
        d[i] = v * 3.5;
      } else {
        d[i] = w;
      }
    }
    return buffer;
  }

  impulse(seconds) {
    const { ctx } = this;
    const buffer = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buffer.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / d.length;
        lp += (Math.random() * 2 - 1 - lp) * 0.12;
        d[i] = lp * Math.pow(1 - t, 2.6);
      }
    }
    return buffer;
  }

  build() {
    const { ctx } = this;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER * this.volume;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 6;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(limiter);
    limiter.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.ui = ctx.createGain();
    this.ui.gain.value = 0.5;
    this.ui.connect(this.master);

    this.water = ctx.createBiquadFilter();
    this.water.type = 'lowpass';
    this.water.frequency.value = 1500;
    this.water.Q.value = 0.4;
    this.water.connect(this.master);
    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.water.connect(reverb);
    reverb.connect(wet);
    wet.connect(this.master);

    this.white = this.noiseBuffer(2, false);
    const brown = this.noiseBuffer(5, true);
    const loop = (buffer, rate = 1) => {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.playbackRate.value = rate;
      s.start();
      return s;
    };
    const lfo = (freq, depth, param) => {
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g);
      g.connect(param);
      o.start();
    };

    // Deep pressure: slow-moving brown noise that sets the "submerged" feeling.
    const deepLp = ctx.createBiquadFilter();
    deepLp.type = 'lowpass';
    deepLp.frequency.value = 240;
    const deep = ctx.createGain();
    deep.gain.value = 0.55;
    loop(brown).connect(deepLp);
    deepLp.connect(deep);
    deep.connect(this.master);
    lfo(0.06, 70, deepLp.frequency);
    lfo(0.11, 0.14, deep.gain);

    // Water movement: a faint band of hiss that swells like a current.
    const currentBp = ctx.createBiquadFilter();
    currentBp.type = 'bandpass';
    currentBp.frequency.value = 620;
    currentBp.Q.value = 0.7;
    const current = ctx.createGain();
    current.gain.value = 0.028;
    loop(this.white, 0.7).connect(currentBp);
    currentBp.connect(current);
    current.connect(this.master);
    lfo(0.17, 0.016, current.gain);
    lfo(0.05, 220, currentBp.frequency);

    // Hull servo: its pitch and level follow how fast the arms are working.
    this.servoOsc = ctx.createOscillator();
    this.servoOsc.type = 'sawtooth';
    this.servoOsc.frequency.value = 50;
    const servoLp = ctx.createBiquadFilter();
    servoLp.type = 'lowpass';
    servoLp.frequency.value = 420;
    this.servoGain = ctx.createGain();
    this.servoGain.gain.value = 0;
    this.servoOsc.connect(servoLp);
    servoLp.connect(this.servoGain);
    this.servoGain.connect(this.water);
    this.servoOsc.start();

    // Jet: rushing water plus a low thruster tone.
    this.jetBp = ctx.createBiquadFilter();
    this.jetBp.type = 'bandpass';
    this.jetBp.frequency.value = 420;
    this.jetBp.Q.value = 0.6;
    this.jetGain = ctx.createGain();
    this.jetGain.gain.value = 0;
    loop(this.white).connect(this.jetBp);
    this.jetBp.connect(this.jetGain);
    this.jetGain.connect(this.water);
    const thruster = ctx.createOscillator();
    thruster.type = 'triangle';
    thruster.frequency.value = 58;
    this.thrusterGain = ctx.createGain();
    this.thrusterGain.gain.value = 0;
    thruster.connect(this.thrusterGain);
    this.thrusterGain.connect(this.water);
    thruster.start();
    this.thruster = thruster;
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    } catch {
      // Private mode can block storage; the choice then lasts for this visit only.
    }
    this.unlock();
    this.applyLevel();
  }

  setVolume(volume) {
    this.volume = volume;
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      // Private mode can block storage; the choice then lasts for this visit only.
    }
    this.unlock();
    this.applyLevel();
  }

  applyLevel() {
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER * this.volume, this.ctx.currentTime, 0.03);
  }

  /** Limits how often a sound can fire, so many sources never pile into a roar. */
  allow(name, gap) {
    const now = performance.now();
    if (now - (this.last[name] || 0) < gap) return false;
    this.last[name] = now;
    return Boolean(this.ctx) && this.ctx.state === 'running';
  }

  click(kind) {
    this.unlock();
    if (!this.ctx || !this.ui) return;
    const { ctx } = this;
    const t = ctx.currentTime + 0.001;
    const tones = {
      on: [1500, 2100, 0.05, 0.3],
      off: [1250, 780, 0.06, 0.28],
      tick: [1050, 860, 0.025, 0.14],
      grab: [620, 480, 0.04, 0.22],
      heavy: [320, 150, 0.1, 0.5],
    }[kind] || [1200, 1200, 0.03, 0.2];
    const o = ctx.createOscillator();
    o.type = kind === 'heavy' ? 'triangle' : 'square';
    o.frequency.setValueAtTime(tones[0], t);
    o.frequency.exponentialRampToValueAtTime(tones[1], t + tones[2]);
    const g = ctx.createGain();
    g.gain.setValueAtTime(tones[3], t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + tones[2]);
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 4200;
    o.connect(lp);
    lp.connect(g);
    g.connect(this.ui);
    o.start(t);
    o.stop(t + tones[2] + 0.01);
  }

  pan(value) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(value, -1, 1);
    p.connect(this.water);
    return p;
  }

  thud(pan = 0, level = 1) {
    if (!this.allow('thud', 55)) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.42 * level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    const out = this.pan(pan);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.22);
    // A small metal tick on the same step sells it as a machine, not a soft footfall.
    const tick = ctx.createOscillator();
    tick.type = 'square';
    tick.frequency.value = 780 + Math.random() * 260;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.035 * level, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    tick.connect(tg);
    tg.connect(out);
    tick.start(t);
    tick.stop(t + 0.06);
  }

  whirr(up = true, seconds = 0.9) {
    if (!this.allow('whirr', 120)) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(up ? 130 : 300, t);
    o.frequency.linearRampToValueAtTime(up ? 300 : 120, t + seconds);
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.08);
    g.gain.setValueAtTime(0.11, t + seconds - 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.water);
    o.start(t);
    o.stop(t + seconds + 0.02);
  }

  clank(level = 1) {
    if (!this.allow('clank', 90)) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    for (const f of [190, 327, 511]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f * (0.97 + Math.random() * 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.16 * level, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
      o.connect(g);
      g.connect(this.water);
      o.start(t);
      o.stop(t + 0.36);
    }
  }

  /** A real bubble is a short sine whose pitch rises as it reaches the surface tension limit. */
  bubble(pan = 0, level = 1) {
    if (!this.allow('bubble', 35)) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const f = 280 + Math.random() * 720;
    const dur = 0.04 + Math.random() * 0.07;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * (1.5 + Math.random() * 0.7), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1 * level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g);
    g.connect(this.pan(pan));
    o.start(t);
    o.stop(t + dur + 0.01);
  }

  /** Low mechanical moan of the robot whale, heard from far away. */
  whale(pan = 0, level = 1) {
    if (!this.allow('whale', 12000)) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const dur = 3.4;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(62, t);
    o.frequency.linearRampToValueAtTime(96, t + dur * 0.4);
    o.frequency.linearRampToValueAtTime(54, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 340;
    lp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26 * level, t + 0.8);
    g.gain.setValueAtTime(0.26 * level, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.pan(pan));
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Doppler-like sweep when something big passes close by. */
  swoosh(pan = 0, level = 1) {
    if (!this.allow('swoosh', 2500)) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.white;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(240, t);
    bp.frequency.exponentialRampToValueAtTime(760, t + 0.5);
    bp.frequency.exponentialRampToValueAtTime(180, t + 1.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * level, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    s.connect(bp);
    bp.connect(g);
    g.connect(this.pan(pan));
    s.start(t);
    s.stop(t + 1.45);
  }

  update(s, robot) {
    if (!this.ctx || this.ctx.state !== 'running') {
      this.prevSteps = robot.steps;
      Object.assign(this.prevTargets, robot.targets);
      return;
    }
    const now = this.ctx.currentTime;
    const speed = Math.abs(s.speed);
    const work = clamp(speed / 7 + Math.abs(s.yawRate) * 0.3, 0, 1);
    this.servoGain.gain.setTargetAtTime(work * 0.05, now, 0.12);
    this.servoOsc.frequency.setTargetAtTime(42 + work * 62, now, 0.15);
    this.jetGain.gain.setTargetAtTime(s.jet * 0.5, now, 0.1);
    this.jetBp.frequency.setTargetAtTime(320 + s.jet * 420, now, 0.2);
    this.thrusterGain.gain.setTargetAtTime(s.jet * 0.2, now, 0.15);
    this.thruster.frequency.setTargetAtTime(50 + s.jet * 26, now, 0.2);

    if (robot.steps !== this.prevSteps) {
      this.prevSteps = robot.steps;
      this.thud((Math.random() - 0.5) * 0.7, clamp(0.45 + speed * 0.08, 0.45, 1));
    }
    const T = robot.targets, P = this.prevTargets;
    for (const key of ['lens', 'mantle', 'pump']) {
      if (P[key] !== undefined && P[key] !== T[key]) this.whirr(T[key] > 0.5);
    }
    if (P.explode !== undefined && P.explode !== T.explode) {
      this.clank(1);
      this.whirr(T.explode > 0.5, 1.2);
    }
    Object.assign(P, T);
  }

  level() {
    if (!this.analyser) return 0;
    const d = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(d);
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    return Math.sqrt(sum / d.length);
  }
}
