import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clamp, damp, dampAngle } from './util.js';
import { heightAt, SKY, World } from './world.js';
import { Robot } from './robot.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Autopilot } from './ai.js';
import { initFullscreen } from './fullscreen.js';
import { Bubbles } from './bubbles.js';
import { Fauna } from './fauna.js';
import { Sound } from './audio.js';
import { LABEL, Quality } from './quality.js';
import { RemoteRobots } from './remote.js';
import { Online } from './online.js';
import { applyLang, retext, t as tr } from './i18n.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('scene') });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(SKY, 0.0115);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.62;

// A tone-mapped dome matches the tone-mapped fog; a plain clear colour would show a horizon seam.
const domeGeo = new THREE.SphereGeometry(600, 24, 16);
{
  const horizon = new THREE.Color(SKY), zenith = new THREE.Color(0xf8f4ec), c = new THREE.Color();
  const pos = domeGeo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    c.lerpColors(horizon, zenith, Math.max(0, pos.getY(i) / 600));
    col.set([c.r, c.g, c.b], i * 3);
  }
  domeGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
const dome = new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
scene.add(dome);

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 900);
scene.add(new THREE.HemisphereLight(0xfff6e8, 0xa89880, 0.8));
const sun = new THREE.DirectionalLight(0xfff0dc, 3.1);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -30;
sun.shadow.camera.right = sun.shadow.camera.top = 30;
sun.shadow.camera.far = 120;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.05;
sun.shadow.radius = 5;
scene.add(sun, sun.target);

const world = new World(scene);
const robot = new Robot(scene);

const bubbles = new Bubbles(scene);
robot.bubbles = bubbles;
const fauna = new Fauna(scene, world, bubbles);
const sound = new Sound();
const remote = new RemoteRobots(scene, document.getElementById('tags'));
const quality = new Quality({ renderer, sun, scene, world, fauna, robot, bubbles }, (tier) => {
  state.log = tr('SYSTEM / AUTO QUALITY: {level}', { level: LABEL[tier] });
});
const input = new Input();
const ai = new Autopilot(world, robot);
const RIDE = 4.9;
const SPEED = { forward: 6.5, reverse: 4.2, jetForward: 19, jetReverse: 10 };

const READY_LOG = 'OPERATOR / READY. PRESS W TO GO FORWARD, S TO REVERSE';
const state = {
  pos: new THREE.Vector3(0, heightAt(0, 0) + RIDE, 0),
  vel: new THREE.Vector3(),
  yaw: 0, yawRate: 0, pitch: 0, roll: 0,
  speed: 0, jet: 0, gear: 'N', odo: 0,
  log: tr(READY_LOG),
  demoActive: false, demoProgress: 0, aiLabel: null,
};

const DEMO = [
  [0, { lens: 1, mantle: 0, pump: 0, explode: 0 }, 'OPERATOR / LENS OPENED'],
  [2.4, { lens: 1, mantle: 1, pump: 0, explode: 0 }, 'OPERATOR / MANTLE OPENED'],
  [4.6, { lens: 1, mantle: 1, pump: 1, explode: 0 }, 'OPERATOR / PUMP RAISED'],
  [7, { lens: 0, mantle: 0, pump: 0, explode: 1 }, 'OPERATOR / ALL PARTS EXPLODED'],
  [11, { lens: 0, mantle: 0, pump: 0, explode: 0 }, 'OPERATOR / REASSEMBLING'],
];
const DEMO_LEN = 14;
let demoT = -1;
let demoStep = -1;

const online = new Online(state, robot, remote);
// Everyone starting on one exact spot would stack robots, so online players start scattered.
function scatterSpawn() {
  const angle = Math.random() * Math.PI * 2, radius = 7 + Math.random() * 11;
  state.pos.x = Math.sin(angle) * radius;
  state.pos.z = Math.cos(angle) * radius;
  world.collide(state.pos, 3.3);
  state.pos.y = heightAt(state.pos.x, state.pos.z) + RIDE;
  robot.teleported();
  cam.target.copy(state.pos);
}

const NO_INPUT = { throttle: 0, turn: 0, jet: false };
const MENU_PROBE_MS = 5000;
const isNativeApp = window.Capacitor?.isNativePlatform?.() === true;
const $ = (id) => document.getElementById(id);

/** The main menu: always the way in, and reachable during play to switch modes without restarting. */
const menu = {
  open: false,
  started: false,
  reachable: null,
  players: 0,
  checked: false,
  timer: 0,

  render() {
    const multi = $('start-multi'), single = $('start-single'), resume = $('menu-resume');
    const together = online.enabled;
    resume.hidden = !this.started;
    if (this.started) $('resume-note').textContent = together ? tr('Back to the multiplayer game') : tr('Back to the solo game');
    let note;
    if (!this.checked) note = tr('Checking server...');
    else if (navigator.onLine === false) note = tr('No internet');
    else if (!this.reachable) note = tr('Server unreachable, retrying...');
    else note = this.players > 0 ? tr('{n} players online', { n: this.players }) : tr('No other players yet');
    $('start-count').textContent = this.started && together ? tr('Playing now / {note}', { note }) : note;
    $('single-note').textContent = this.started && !together ? tr('Playing now') : tr('Explore the sea without other players');
    // An ongoing multiplayer game may be left at any time, but joining needs a reachable server.
    multi.disabled = !this.reachable && !(this.started && together);
    single.classList.toggle('primary', !this.started && (multi.disabled || !online.lastChoiceWasMulti));
    multi.classList.toggle('primary', !this.started && !multi.disabled && online.lastChoiceWasMulti);
    resume.classList.toggle('primary', this.started);
    const tele = $('tele-server');
    tele.classList.toggle('live', this.checked && this.reachable);
    tele.classList.toggle('down', this.checked && !this.reachable);
    tele.querySelector('b').textContent = !this.checked ? tr('CHECKING SERVER') : this.reachable ? tr('SERVER UP / {n} ONLINE', { n: this.players }) : navigator.onLine === false ? tr('NO INTERNET') : tr('SERVER UNREACHABLE');
    $('tele-quality').textContent = quality.choice === 'auto' ? tr('AUTO ({level})', { level: LABEL[quality.tier] }) : LABEL[quality.tier];
    $('tele-sound').textContent = sound.muted ? tr('OFF') : `${Math.round(sound.volume * 100)}%`;
  },

  showSettings(on) {
    $('start-menu').classList.toggle('settings-view', on);
    $('settings').classList.toggle('embedded', on);
    $('settings-back').hidden = !on;
    hud.setSettingsOpen(on);
    if (!on && this.open) {
      this.render();
      if (matchMedia('(pointer: fine)').matches) $('menu-settings').focus({ preventScroll: true });
    }
  },

  async check() {
    const players = await online.probe();
    this.checked = true;
    this.reachable = players !== null;
    this.players = players ?? 0;
    if (this.open) {
      this.render();
      this.timer = setTimeout(() => this.check(), MENU_PROBE_MS);
    }
  },

  show() {
    if (this.open) return;
    this.open = true;
    this.checked = this.reachable !== null;
    document.body.classList.add('in-menu');
    if (hud.settingsOpen) hud.setSettingsOpen(false);
    $('start-menu').hidden = false;
    this.render();
    clearTimeout(this.timer);
    this.check();
    if (matchMedia('(pointer: fine)').matches) {
      const first = this.started ? $('menu-resume') : $('start-menu').querySelector('button.primary');
      first?.focus({ preventScroll: true });
    }
  },

  hide() {
    this.open = false;
    clearTimeout(this.timer);
    this.showSettings(false);
    document.body.classList.remove('in-menu');
    $('start-menu').hidden = true;
    document.activeElement?.blur();
  },

  choose(together) {
    if (together && $('start-multi').disabled) return;
    // Scatter only on entry; someone switching mid-game stays where they are exploring.
    if (together && !this.started) scatterSpawn();
    this.started = true;
    if (online.enabled !== together) online.setEnabled(together);
    this.hide();
  },

  showExit(on) {
    $('exit-confirm').hidden = !on;
    if (on) {
      $('exit-note').textContent = online.enabled ? tr('You will leave the multiplayer game.') : '';
      if (matchMedia('(pointer: fine)').matches) $('exit-cancel').focus({ preventScroll: true });
    }
  },

  /** Esc and the Android back button: one step back at a time, ending at the exit question. */
  back() {
    if (!$('exit-confirm').hidden) {
      this.showExit(false);
      return true;
    }
    if (this.open && $('settings').classList.contains('embedded')) {
      this.showSettings(false);
      return true;
    }
    if (hud.settingsOpen) {
      hud.setSettingsOpen(false);
      return true;
    }
    if (!this.open) {
      this.show();
      return true;
    }
    if (isNativeApp) {
      this.showExit(true);
      return true;
    }
    // A browser tab cannot close itself, so Esc simply returns to the game there.
    if (this.started) this.hide();
    return true;
  },
};

/** Moves next to another player, for a world too large to meet in by chance. */
function jumpTo(id) {
  const p = remote.players.get(id);
  if (!p?.ready) return;
  const angle = Math.random() * Math.PI * 2;
  state.pos.x = p.x + Math.sin(angle) * 17;
  state.pos.z = p.z + Math.cos(angle) * 17;
  world.update(state.pos.x, state.pos.z, clock.elapsedTime, Infinity);
  world.collide(state.pos, 3.3);
  state.pos.y = heightAt(state.pos.x, state.pos.z) + RIDE;
  state.speed = 0;
  state.yaw = Math.atan2(p.x - state.pos.x, p.z - state.pos.z);
  robot.teleported();
  bubbles.burst(state.pos.x, state.pos.y, state.pos.z, 60, 3.5, 0.2);
  sound.whirr(true, 0.6);
  cam.target.copy(state.pos);
  cam.yaw = state.yaw + Math.PI;
  state.log = tr('OPERATOR / CATCHING UP TO {name}', { name: p.name });
}

applyLang();

const hud = new HUD({
  languageChanged() {
    state.log = retext(state.log);
    menu.render();
  },
  togglePart(part) {
    demoT = -1;
    state.demoActive = false;
    state.demoProgress = 0;
    const T = robot.targets;
    T[part] = T[part] > 0.5 ? 0 : 1;
    if (part === 'pump' && T.pump) T.mantle = 1;
    if (part === 'mantle' && !T.mantle) T.pump = 0;
    state.log = tr('OPERATOR / {part} {state}', {
      part: tr({ lens: 'LENS', mantle: 'MANTLE', pump: 'PUMP', explode: 'EXPLODE ALL' }[part]),
      state: tr(T[part] ? 'ACTIVE' : 'CLOSED'),
    });
  },
  demo() {
    if (ai.enabled) ai.disable();
    state.aiLabel = null;
    demoT = 0;
    demoStep = -1;
    state.demoActive = true;
  },
  cycleMantle() {
    const T = robot.targets;
    if (!T.mantle) this.togglePart('mantle');
    else if (!T.pump) this.togglePart('pump');
    else this.togglePart('mantle');
  },
  toggleAI() {
    demoT = -1;
    state.demoActive = false;
    state.demoProgress = 0;
    if (ai.enabled) {
      ai.disable();
      state.aiLabel = null;
      state.log = tr('OPERATOR / AI OFF');
    } else {
      ai.enable(state);
    }
  },
  toggleSound() {
    sound.setMuted(!sound.muted);
    return sound.muted;
  },
  isMuted: () => sound.muted,
  getVolume: () => sound.volume,
  setVolume: (v) => sound.setVolume(v),
  setContour: (on) => {
    world.uContour.value = on ? 1 : 0;
  },
  online,
  jumpTo,
  setQuality: (choice) => quality.set(choice),
  qualityStatus: () => ({ choice: quality.choice, tier: quality.tier, fps: quality.fps }),
});

/* Camera: free orbit by dragging, eases behind the robot only while driving. */
const cam = { yaw: 0.42, pitch: 0.2, dist: 37, target: state.pos.clone(), lastDrag: -10 };
const canvas = renderer.domElement;
const drag = new Map();
let pinch = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  drag.set(e.pointerId, { x: e.clientX, y: e.clientY });
  pinch = 0;
});
canvas.addEventListener('pointermove', (e) => {
  const p = drag.get(e.pointerId);
  if (!p) return;
  if (drag.size === 2) {
    p.x = e.clientX;
    p.y = e.clientY;
    const [a, b] = [...drag.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) cam.dist = clamp(cam.dist * (pinch / d), 12, 75);
    pinch = d;
    return;
  }
  cam.yaw -= (e.clientX - p.x) * 0.0055;
  cam.pitch = clamp(cam.pitch + (e.clientY - p.y) * 0.004, -0.05, 1.3);
  p.x = e.clientX;
  p.y = e.clientY;
  cam.lastDrag = clock.elapsedTime;
});
const endDrag = (e) => {
  drag.delete(e.pointerId);
  pinch = 0;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.dist = clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.07), 12, 75);
}, { passive: false });
document.getElementById('btn-ai-mini').addEventListener('click', () => hud.actions.toggleAI());
$('btn-menu').addEventListener('click', () => {
  $('btn-menu').blur();
  menu.show();
});
$('menu-resume').addEventListener('click', () => menu.hide());
$('start-single').addEventListener('click', () => menu.choose(false));
$('start-multi').addEventListener('click', () => menu.choose(true));
$('menu-settings').addEventListener('click', () => {
  $('menu-settings').blur();
  menu.showSettings(true);
});
$('settings-back').addEventListener('click', () => menu.showSettings(false));
if (isNativeApp) {
  $('menu-exit').hidden = false;
  document.body.classList.add('has-exit');
}
$('menu-exit').addEventListener('click', () => {
  $('menu-exit').blur();
  menu.showExit(true);
});
$('exit-cancel').addEventListener('click', () => menu.showExit(false));
$('exit-yes').addEventListener('click', () => {
  online.drop();
  window.OctobotNative?.exit();
});
addEventListener('online', () => menu.open && menu.check());
addEventListener('offline', () => menu.open && menu.check());
window.octobotBack = () => menu.back();
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyE') hud.actions.togglePart('explode');
  if (e.code === 'KeyI') hud.actions.toggleAI();
  if (e.code === 'KeyM') hud.toggleSound();
  if (e.code === 'Escape' && !e.defaultPrevented) menu.back();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  hud.fit(document.getElementById('graph'));
  hud.fit(document.getElementById('radar'));
});

initFullscreen();

const clock = { elapsedTime: 0, last: performance.now() };

function simulate(dt, t) {
  const manual = menu.open ? NO_INPUT : input.read();
  if (ai.enabled && (manual.throttle || manual.turn || manual.jet)) {
    ai.disable();
    state.aiLabel = null;
    state.log = tr('OPERATOR / MANUAL CONTROL TAKEN OVER');
  }
  const ctl = ai.enabled ? ai.update(dt, state) : manual;
  if (ai.enabled) {
    state.aiLabel = ai.label;
    state.log = ai.log;
  }
  const jetting = ctl.jet && ctl.throttle !== 0;

  // Speed
  const top = ctl.throttle >= 0
    ? (jetting ? SPEED.jetForward : SPEED.forward)
    : (jetting ? SPEED.jetReverse : SPEED.reverse);
  const prevSpeed = state.speed;
  const accel = jetting ? 1.6 : ctl.throttle === 0 ? 3.2 : 2.2;
  state.speed = damp(state.speed, ctl.throttle * top, accel, dt);
  if (ctl.throttle === 0 && Math.abs(state.speed) < 0.02) state.speed = 0;
  state.jet = damp(state.jet, jetting ? 1 : 0, jetting ? 4 : 2.5, dt);
  state.gear = state.speed > 0.15 ? 'F' : state.speed < -0.15 ? 'R' : 'N';

  // Heading: A/D always turns the same way on screen, also while reversing.
  state.yawRate = damp(state.yawRate, ctl.turn * (jetting ? 0.9 : 1.35), 5, dt);
  state.yaw += state.yawRate * dt;

  // Position
  const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw);
  const px = state.pos.x, pz = state.pos.z;
  state.pos.x += fx * state.speed * dt;
  state.pos.z += fz * state.speed * dt;
  if (world.collide(state.pos, 3.3)) {
    state.speed *= 0.86;
    state.hits = (state.hits || 0) + 1;
  }
  state.odo += Math.hypot(state.pos.x - px, state.pos.z - pz);
  state.vel.set((state.pos.x - px) / dt, 0, (state.pos.z - pz) / dt);

  // Ride height follows smoothed ground; pitch and roll follow the slope plus inertia.
  const g = heightAt(state.pos.x, state.pos.z);
  const ahead = heightAt(state.pos.x + fx * 4, state.pos.z + fz * 4);
  const behind = heightAt(state.pos.x - fx * 4, state.pos.z - fz * 4);
  const right = heightAt(state.pos.x + fz * 4, state.pos.z - fx * 4);
  const left = heightAt(state.pos.x - fz * 4, state.pos.z + fx * 4);
  const ground = (g * 2 + ahead + behind + left + right) / 6;
  const bob = Math.sin(t * 1.5) * 0.11 + Math.sin(state.odo * 1.15) * 0.1 * clamp(Math.abs(state.speed), 0, 1);
  const ride = ground + RIDE + bob + state.jet * 5 + robot.parts.explode * 2.6;
  state.pos.y = Math.max(damp(state.pos.y, ride, 4.2, dt), g + 3.2);

  const dv = (state.speed - prevSpeed) / Math.max(dt, 1e-3);
  const slopePitch = Math.atan2(behind - ahead, 8);
  const lean = clamp(dv * 0.03, -0.2, 0.2) + clamp(state.speed * 0.012, -0.08, 0.08);
  const jetPose = state.jet * (state.speed >= 0 ? 0.68 : -0.5);
  state.pitch = damp(state.pitch, slopePitch * 0.75 + lean + jetPose, 4, dt);
  const slopeRoll = Math.atan2(left - right, 8);
  state.roll = damp(state.roll, slopeRoll * 0.6 + clamp(-state.yawRate * Math.abs(state.speed) * 0.018, -0.25, 0.25), 4, dt);

  // Demo sequence
  if (demoT >= 0) {
    demoT += dt;
    state.demoProgress = clamp(demoT / DEMO_LEN, 0, 1);
    let idx = -1;
    DEMO.forEach((d, i) => { if (demoT >= d[0]) idx = i; });
    if (idx !== demoStep && idx >= 0) {
      demoStep = idx;
      Object.assign(robot.targets, DEMO[idx][1]);
      state.log = tr(DEMO[idx][2]);
    }
    if (demoT > DEMO_LEN) {
      demoT = -1;
      state.demoActive = false;
      state.demoProgress = 0;
      state.log = tr('OPERATOR / CYCLE DONE, ALL LOCKED');
    }
  } else if (ctl.throttle && !ai.enabled) {
    state.log = tr(jetting ? 'OPERATOR / SIPHON FIRED' : ctl.throttle > 0 ? 'OPERATOR / FORWARD' : 'OPERATOR / REVERSE');
  }

  return ctl;
}

const CAMERA_MIN_BOOM = 11;
const CAMERA_MARGIN = 2.5;
const OBSTACLE_TOP = 24;

function clearBoom(wanted) {
  const hx = Math.sin(cam.yaw) * Math.cos(cam.pitch), hz = Math.cos(cam.yaw) * Math.cos(cam.pitch);
  const flat = Math.hypot(hx, hz) || 1;
  const ux = hx / flat, uz = hz / flat;
  const ground = heightAt(cam.target.x, cam.target.z);
  let boom = wanted;
  for (const c of world.collidersNear(cam.target.x, cam.target.z, wanted + 12)) {
    const dx = c.x - cam.target.x, dz = c.z - cam.target.z;
    const along = dx * ux + dz * uz;
    if (along <= 0) continue;
    const across = Math.abs(dx * uz - dz * ux);
    const r = c.r + CAMERA_MARGIN;
    if (across >= r) continue;
    const hit = (along - Math.sqrt(r * r - across * across)) / flat;
    // A camera that is already above the object has a clear view over it.
    const heightAtHit = cam.target.y + Math.sin(cam.pitch) * hit - ground;
    if (hit > 0 && hit < boom && heightAtHit < OBSTACLE_TOP) boom = hit;
  }
  return Math.max(boom, CAMERA_MIN_BOOM);
}

function updateCamera(dt, t, ctl) {
  const driving = ctl.throttle !== 0;
  if (menu.open) cam.yaw += dt * 0.09;
  // While the AI is parked, the camera slowly circles so the servicing stays visible.
  if (ai.enabled && !driving && t - cam.lastDrag > 2) cam.yaw += dt * 0.14;
  if (driving && t - cam.lastDrag > 1) {
    cam.yaw = dampAngle(cam.yaw, state.yaw + Math.PI, state.jet > 0.3 ? 2.6 : 1.5, dt);
    cam.pitch = damp(cam.pitch, 0.28, 1.2, dt);
  }
  cam.target.x = damp(cam.target.x, state.pos.x, 6, dt);
  cam.target.y = damp(cam.target.y, state.pos.y - (camera.aspect < 1 ? 6 : 2.2), 4, dt);
  cam.target.z = damp(cam.target.z, state.pos.z, 6, dt);
  // Portrait screens need more distance to fit the arm span horizontally.
  // On the menu the robot comes closer and moves aside for the panel, like a showroom shot.
  cam.showcase = damp(cam.showcase ?? 1, menu.open ? 1 : 0, 3.5, dt);
  const wide = camera.aspect > 1.05;
  const shift = wide ? cam.showcase * 0.16 : 0;
  const lift = wide ? 0 : cam.showcase * 0.1;
  if (shift > 0.001 || lift > 0.001) camera.setViewOffset(innerWidth, innerHeight, -shift * innerWidth, lift * innerHeight, innerWidth, innerHeight);
  else if (camera.view?.enabled) camera.clearViewOffset();
  const wanted = (cam.dist * (1 - cam.showcase * 0.2) + state.jet * 7) * clamp(1.3 / camera.aspect, 1, 1.35);
  // Shorten the boom if a solid object sits between the robot and the camera. Pull in fast, ease out slowly.
  const clear = clearBoom(wanted);
  cam.boom = cam.boom === undefined ? clear : damp(cam.boom, clear, clear < cam.boom ? 12 : 1.6, dt);
  const d = cam.boom;
  const cx = cam.target.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * d;
  const cz = cam.target.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * d;
  let cy = cam.target.y + Math.sin(cam.pitch) * d;
  cy = Math.max(cy, heightAt(cx, cz) + 1.4);
  camera.position.set(cx, cy, cz);
  camera.lookAt(cam.target);
  dome.position.copy(camera.position);
  sun.target.position.copy(state.pos);
  sun.position.copy(state.pos).add(new THREE.Vector3(14, 42, 16));
}

const panVec = new THREE.Vector3();
/** Stereo position of a world point, seen from the camera. */
function panFor(x, z) {
  panVec.set(x, camera.position.y, z).project(camera);
  return Math.max(-1, Math.min(1, panVec.x * 0.8));
}

function step(dt, render = true) {
  const t = clock.elapsedTime;
  const ctl = simulate(dt, t);
  world.update(state.pos.x, state.pos.z, t);
  robot.update(dt, t, state);
  updateCamera(dt, t, ctl);
  fauna.update(dt, t, state);
  remote.update(dt, t, performance.now(), state.pos);
  online.update(dt * 1000);
  world.emitVents(bubbles, state.pos.x, state.pos.z, t, dt, (v, d) => {
    if (Math.random() < 0.35) sound.bubble(panFor(v.x, v.z), Math.max(0.15, 1 - d / 34));
  });
  bubbles.update(dt, t, renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360)));
  sound.update(state, robot);
  if (fauna.events.whale) {
    const c = fauna.events.whale;
    sound.whale(panFor(c.x, c.z), Math.max(0.25, 1 - Math.hypot(c.x - state.pos.x, c.z - state.pos.z) / 170));
  }
  if (fauna.events.swoosh) {
    const c = fauna.events.swoosh;
    sound.swoosh(panFor(c.x, c.z), Math.max(0.3, 1 - Math.hypot(c.x - state.pos.x, c.z - state.pos.z) / 60));
  }
  if (!render) return;
  hud.update(dt, state, robot, world, camera, fauna);
  remote.updateTags(camera);
  renderer.render(scene, camera);
}

// A background tab gets no animation frames, so a timer keeps loading from stalling there.
const nextFrame = () => new Promise((resolve) => {
  const timer = setTimeout(resolve, 100);
  requestAnimationFrame(() => {
    clearTimeout(timer);
    resolve();
  });
});

/** Builds the world in small pieces between frames, so progress is real and the page never freezes. */
async function boot() {
  const loader = window.octobotLoader;
  const chunks = (2 * 3 + 1) ** 2;
  while (world.chunks.size < chunks) {
    world.update(state.pos.x, state.pos.z, 0, 2);
    loader?.progress(0.05 + (0.65 * world.chunks.size) / chunks, tr('BUILDING THE SEABED'));
    await nextFrame();
  }
  world.collide(state.pos, 3.3);
  state.pos.y = heightAt(state.pos.x, state.pos.z) + RIDE;
  cam.target.copy(state.pos);

  loader?.progress(0.76, tr('RELEASING SEA LIFE'));
  await nextFrame();
  fauna.populate(state);
  step(1 / 60, false);

  // The first render compiles every shader, the worst single stall. Doing it behind the loader keeps it
  // out of the first seconds of play, and the loader's animation runs on the compositor meanwhile.
  // renderer.compileAsync() is avoided on purpose: it can stay pending forever and strand the player here.
  loader?.progress(0.86, tr('PREPARING GRAPHICS'));
  await nextFrame();
  step(1 / 60);
  loader?.progress(1, tr('READY'));
  await nextFrame();

  clock.last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    quality.sample(now - clock.last);
    const dt = Math.min((now - clock.last) / 1000, 1 / 20);
    clock.last = now;
    clock.elapsedTime += dt;
    step(dt);
  });
  menu.show();
  loader?.done();
}

boot();

window.__oct = { menu, state, robot, world, cam, step, ai, renderer, fauna, bubbles, sound, heightAt, quality, online, remote, jumpTo };
