import { t } from './i18n.js';
import { clamp, wrapAngle } from './util.js';

const CLOSED = { lens: 0, mantle: 0, pump: 0, explode: 0 };
const SAFETY_MARGIN = 4.5;
const OFFSETS = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.85, -1.85, 2.4, -2.4];

/* Each routine is a list of [time, parts, label]. The robot stands still while it plays. */
const ROUTINES = [
  [[0, { lens: 1 }, 'CHECKING LENS'], [3.2, CLOSED, 'LOCKING LENS']],
  [[0, { mantle: 1 }, 'OPENING MANTLE'], [3.6, CLOSED, 'CLOSING MANTLE']],
  [
    [0, { mantle: 1 }, 'OPENING MANTLE'],
    [1.6, { mantle: 1, pump: 1 }, 'RAISING PUMP'],
    [5, CLOSED, 'LOWERING PUMP'],
  ],
  [[0, { explode: 1 }, 'EXPLODING ALL PARTS'], [4.4, CLOSED, 'REASSEMBLING']],
  [
    [0, { lens: 1 }, 'OPENING LENS'],
    [1.8, { lens: 1, mantle: 1 }, 'OPENING MANTLE'],
    [3.4, { lens: 1, mantle: 1, pump: 1 }, 'RAISING PUMP'],
    [5.6, { explode: 1 }, 'EXPLODING ALL PARTS'],
    [9.6, CLOSED, 'REASSEMBLING'],
  ],
];
const ROUTINE_TAIL = 1.8;

const between = (a, b) => a + Math.random() * (b - a);

/** Distance a robot can travel along a heading before entering a collider's safety margin. */
function clearance(x, z, heading, range, colliders) {
  const hx = Math.sin(heading), hz = Math.cos(heading);
  let best = range;
  for (const c of colliders) {
    const dx = c.x - x, dz = c.z - z;
    const along = dx * hx + dz * hz;
    if (along < 0) continue;
    const across = Math.abs(dx * hz - dz * hx);
    const r = c.r + SAFETY_MARGIN;
    if (across >= r) continue;
    best = Math.min(best, Math.max(0, along - Math.sqrt(r * r - across * across)));
  }
  return best;
}

/** Wanders the world on its own, driving through the same controls a player uses. */
export class Autopilot {
  constructor(world, robot) {
    this.world = world;
    this.robot = robot;
    this.enabled = false;
    this.label = null;
    this.log = '';
    this.deck = [];
    this.stats = { behaviors: {}, routines: 0, stuck: 0 };
  }

  enable(s) {
    this.enabled = true;
    Object.assign(this.robot.targets, CLOSED);
    this.stuckFor = 0;
    this.steerIn = 0;
    this.steerOff = 0;
    this.lastTarget = null;
    this.enter('roam', s);
    this.say('AI ON, EXPLORING ON ITS OWN');
  }

  disable() {
    this.enabled = false;
    this.label = null;
    Object.assign(this.robot.targets, CLOSED);
  }

  say(text) {
    this.log = t('AI / {text}', { text: t(text) });
  }

  setLabel(text) {
    this.label = text;
    this.say(text);
  }

  enter(name, s) {
    this.mode = name;
    this.time = 0;
    this.stats.behaviors[name] = (this.stats.behaviors[name] || 0) + 1;
    const colliders = this.world.collidersNear(s.pos.x, s.pos.z, 90);
    if (name === 'roam') {
      const dir = s.yaw + between(-1.3, 1.3), dist = between(35, 85);
      this.target = { x: s.pos.x + Math.sin(dir) * dist, z: s.pos.z + Math.cos(dir) * dist, stop: 6 };
      this.limit = between(9, 16);
      this.pace = between(0.65, 1);
      this.setLabel('EXPLORING');
    } else if (name === 'inspect') {
      const options = colliders.filter((c) => {
        const d = Math.hypot(c.x - s.pos.x, c.z - s.pos.z);
        return d > 18 && d < 80 && c !== this.lastTarget;
      });
      if (!options.length) return this.enter('roam', s);
      const c = options[Math.floor(Math.random() * options.length)];
      this.lastTarget = c;
      this.target = { x: c.x, z: c.z, stop: c.r + 9 };
      this.limit = 16;
      this.pace = 0.85;
      this.setLabel('APPROACHING OBJECT');
    } else if (name === 'jet') {
      if (clearance(s.pos.x, s.pos.z, s.yaw, 50, colliders) < 45) return this.enter('roam', s);
      this.limit = between(2, 3.6);
      this.setLabel('GLIDING WITH JET');
    } else if (name === 'scan') {
      this.limit = between(2.6, 4.6);
      this.scanSign = Math.random() < 0.5 ? -1 : 1;
      this.setLabel('SCANNING SURROUNDINGS');
    } else if (name === 'reverse') {
      this.limit = between(1.8, 3);
      this.scanSign = Math.random() < 0.5 ? -1 : 1;
      this.setLabel('REVERSING');
    } else if (name === 'routine') {
      if (!this.deck.length) this.deck = [...ROUTINES.keys()].sort(() => Math.random() - 0.5);
      this.routine = ROUTINES[this.deck.pop()];
      this.routineStep = -1;
      this.routineClock = null;
      this.stats.routines++;
      this.setLabel('STOPPING FOR SERVICE');
    }
    return undefined;
  }

  next(s) {
    const previous = this.mode;
    const colliders = this.world.collidersNear(s.pos.x, s.pos.z, 30);
    const rearClear = clearance(s.pos.x, s.pos.z, s.yaw + Math.PI, 18, colliders) >= 14;
    const options = [
      ['roam', 30], ['inspect', 22], ['jet', 14], ['scan', 10], ['routine', 26],
      ['reverse', rearClear ? 8 : 0],
    ].filter(([name]) => name !== previous);
    let roll = Math.random() * options.reduce((sum, o) => sum + o[1], 0);
    for (const [name, weight] of options) {
      roll -= weight;
      if (roll <= 0) return this.enter(name, s);
    }
    return this.enter('roam', s);
  }

  /** Picks the free heading closest to where it wants to go, with lookahead scaled to speed. */
  steer(desired, s, dt) {
    this.steerIn -= dt;
    if (this.steerIn <= 0) {
      this.steerIn = 0.12;
      const range = 22 + Math.abs(s.speed) * 1.6;
      const colliders = this.world.collidersNear(s.pos.x, s.pos.z, range + 12);
      let bestScore = -Infinity;
      let best = 0;
      for (const off of OFFSETS) {
        const clear = clearance(s.pos.x, s.pos.z, desired + off, range, colliders);
        const score = clear / range - Math.abs(off) * 0.16;
        if (score > bestScore) {
          bestScore = score;
          best = off;
        }
      }
      this.steerOff = best;
    }
    return wrapAngle(desired + this.steerOff - s.yaw);
  }

  driveTo(s, dt, jet = false) {
    const t = this.target;
    const desired = t ? Math.atan2(t.x - s.pos.x, t.z - s.pos.z) : s.yaw;
    const delta = this.steer(desired, s, dt);
    const align = clamp(1.25 - Math.abs(delta), 0.12, 1);
    return {
      throttle: jet ? 1 : this.pace * align,
      turn: clamp(delta * 2.4, -1, 1),
      jet,
    };
  }

  updateRoutine(dt, s) {
    // Parts only move once the robot has actually come to rest.
    if (this.routineClock === null) {
      if (Math.abs(s.speed) > 0.25) return false;
      this.routineClock = 0;
    }
    this.routineClock += dt;
    const steps = this.routine;
    let idx = this.routineStep;
    while (idx + 1 < steps.length && this.routineClock >= steps[idx + 1][0]) idx++;
    if (idx !== this.routineStep) {
      this.routineStep = idx;
      Object.assign(this.robot.targets, CLOSED, steps[idx][1]);
      this.setLabel(steps[idx][2]);
    }
    return this.routineClock >= steps[steps.length - 1][0] + ROUTINE_TAIL;
  }

  checkStuck(ctl, s, dt) {
    const pushing = Math.abs(ctl.throttle) > 0.3 && this.time > 1;
    this.stuckFor = pushing && Math.abs(s.speed) < 0.9 ? this.stuckFor + dt : 0;
    if (this.stuckFor < 1.1) return;
    this.stuckFor = 0;
    this.stats.stuck++;
    this.enter('reverse', s);
  }

  update(dt, s) {
    this.time += dt;
    let ctl = { throttle: 0, turn: 0, jet: false };
    if (this.mode === 'roam' || this.mode === 'inspect') {
      const d = Math.hypot(this.target.x - s.pos.x, this.target.z - s.pos.z);
      if (d < this.target.stop || this.time > this.limit) {
        const arrived = this.mode === 'inspect' && d < this.target.stop;
        if (arrived) this.enter(Math.random() < 0.7 ? 'routine' : 'scan', s);
        else this.next(s);
      } else {
        ctl = this.driveTo(s, dt);
      }
    } else if (this.mode === 'jet') {
      this.target = null;
      if (this.time > this.limit) this.next(s);
      else ctl = this.driveTo(s, dt, true);
    } else if (this.mode === 'scan') {
      if (this.time > this.limit) this.next(s);
      else ctl.turn = this.scanSign * Math.sin(this.time * 1.5) * 0.8;
    } else if (this.mode === 'reverse') {
      if (this.time > this.limit) this.enter('roam', s);
      else {
        ctl.throttle = -0.85;
        ctl.turn = this.scanSign * 0.55;
      }
    } else if (this.mode === 'routine') {
      if (this.updateRoutine(dt, s)) this.enter('roam', s);
    }
    this.checkStuck(ctl, s, dt);
    return ctl;
  }
}
