import * as THREE from 'three';
import { clamp } from './util.js';
import { LABEL } from './quality.js';
import { t, getLang, setLang, onLangChange } from './i18n.js';

const $ = (id) => document.getElementById(id);
const ORANGE = '#ff5a1f', INK = '#16161b', MUTE = '#a59d90';

const LABELS = [
  { key: 'lens', name: 'MAIN LENS', sub: 'IRIS / f1.4', dx: 90, dy: -56 },
  { key: 'mantle', name: 'MANTLE', sub: '2 INCH / HINGE', dx: -120, dy: -46 },
  { key: 'pump', name: 'PUMP', sub: 'COIL CORE', dx: 130, dy: -92 },
  { key: 'siphon', name: 'SIPHON', sub: 'JET NOZZLE', dx: -130, dy: 42 },
  { key: 'beak', name: 'BEAK', sub: 'LOWER JOINT', dx: 110, dy: 70 },
];

const pref = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};
const savePref = (key, on) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Private mode can block storage; the choice then lasts for this visit only.
  }
};

const pad = (n, w) => String(Math.round(n)).padStart(w, '0');

export class HUD {
  constructor(actions) {
    this.actions = actions;
    this.acc = 0;
    this.history = new Array(70).fill(0);
    this.battery = 100;
    this.lastLog = '';

    document.querySelectorAll('[data-part]').forEach((b) => {
      b.addEventListener('click', () => actions.togglePart(b.dataset.part));
    });
    $('btn-demo').addEventListener('click', () => actions.demo());
    $('btn-ai').addEventListener('click', () => actions.toggleAI());
    const padActions = {
      explode: () => actions.togglePart('explode'),
      lens: () => actions.togglePart('lens'),
      mantle: () => actions.cycleMantle(),
      ai: () => actions.toggleAI(),
    };
    document.querySelectorAll('[data-pad]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        navigator.vibrate?.(12);
        padActions[b.dataset.pad]();
      });
    });
    $('btn-labels').addEventListener('click', () => this.setLabels(!this.labelsOn));
    $('set-labels').addEventListener('click', () => {
      this.setLabels(!this.labelsOn);
      $('set-labels').blur();
    });
    $('btn-contour').addEventListener('click', () => this.setContour(!this.contourOn));
    $('set-contour').addEventListener('click', () => {
      this.setContour(!this.contourOn);
      $('set-contour').blur();
    });
    const volume = $('set-volume');
    volume.value = Math.round(actions.getVolume() * 100);
    $('volume-value').textContent = `${volume.value}%`;
    volume.addEventListener('input', () => {
      $('volume-value').textContent = `${volume.value}%`;
      actions.setVolume(volume.value / 100);
    });
    $('btn-explode-mini').addEventListener('click', () => actions.togglePart('explode'));
    $('btn-sound').addEventListener('click', () => this.toggleSound());
    $('set-sound').addEventListener('click', () => this.toggleSound());
    this.refreshSound();
    this.bindSettings();
    this.bindLanguage();

    this.setLabels(pref('oc8-labels', true));
    this.setContour(pref('oc8-contour', true));
    // A focused button would also fire on Space, which is the jet key.
    document.querySelectorAll('.chips button, .side-btns button').forEach((b) => {
      b.addEventListener('click', () => b.blur());
    });
    const wrap = $('labels');
    this.labels = LABELS.map((l) => {
      const el = document.createElement('div');
      el.className = 'callout';
      el.innerHTML = `<i class="dot"></i><svg><line x1="0" y1="0" x2="${l.dx}" y2="${l.dy}"/></svg><div class="txt" style="left:${l.dx}px;top:${l.dy}px"><b></b><span></span></div>`;
      if (l.dx < 0) el.querySelector('.txt').classList.add('rev');
      wrap.appendChild(el);
      return { ...l, el, p: new THREE.Vector3() };
    });
    this.refreshLabelText();

    this.armBars = [];
    const arms = $('arms');
    for (const n of ['R1', 'R2', 'R3', 'R4', 'L1', 'L2', 'L3', 'L4']) {
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML = `<span>${n}</span><div class="bar"><i></i></div><em>0%</em>`;
      arms.appendChild(row);
      this.armBars.push({ fill: row.querySelector('i'), val: row.querySelector('em') });
    }

    this.graph = $('graph').getContext('2d');
    this.radar = $('radar').getContext('2d');
    this.fit($('graph'));
    this.fit($('radar'));
    this.t0 = performance.now();
  }

  refreshLabelText() {
    for (const l of this.labels) {
      l.el.querySelector('b').textContent = t(l.name);
      l.el.querySelector('span').textContent = t(l.sub);
    }
  }

  setLabels(on) {
    this.labelsOn = on;
    savePref('oc8-labels', on);
    for (const id of ['btn-labels', 'set-labels']) this.setToggle($(id), on);
  }

  setContour(on) {
    this.contourOn = on;
    savePref('oc8-contour', on);
    this.actions.setContour(on);
    for (const id of ['btn-contour', 'set-contour']) this.setToggle($(id), on);
  }

  setToggle(el, on) {
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', String(on));
    if (el.id.startsWith('set-')) el.textContent = on ? t('ON') : t('OFF');
  }

  toggleSound() {
    this.actions.toggleSound();
    this.refreshSound();
    $('btn-sound').blur();
    $('set-sound').blur();
  }

  bindOnline() {
    this.playerRows = new Map();
    $('net-chip').addEventListener('click', () => {
      $('net-chip').blur();
      if (this.actions.online.status === 'online') this.setSettingsOpen(!this.settingsOpen, true);
    });
    this.refreshOnline();
  }

  refreshOnline() {
    const { online } = this.actions;
    $('set-mode').textContent = online.enabled ? t('PLAY TOGETHER') : t('PLAY SOLO');
    const live = online.status === 'online';
    const text = {
      off: t('PLAYING SOLO'),
      connecting: t('CONNECTING...'),
      offline: t('DISCONNECTED, RETRYING'),
      online: live && online.me ? t('{name} / ROOM {room} / {total} ONLINE', { name: online.me.name, room: online.room, total: online.total }) : '',
    }[online.status];
    $('online-status').textContent = text;
    const chip = $('net-chip');
    chip.textContent = live ? t('{total} ONLINE', { total: online.total }) : online.status === 'off' ? t('PLAY SOLO') : t('CONNECTING');
    chip.classList.toggle('live', live);

    const list = $('player-list');
    if (list.offsetParent === null) return;
    const others = online.others();
    const seen = new Set();
    for (const p of others) {
      seen.add(p.id);
      let row = this.playerRows.get(p.id);
      if (!row) {
        const el = document.createElement('li');
        el.innerHTML = '<span class="who"><i></i><b></b><small></small></span><button type="button"></button>';
        el.querySelector('i').style.background = p.tag.style.getPropertyValue('--accent');
        el.querySelector('b').textContent = p.name;
        el.querySelector('button').textContent = t('CATCH UP');
        el.querySelector('button').addEventListener('click', (e) => {
          this.actions.jumpTo(p.id);
          e.currentTarget.blur();
        });
        list.appendChild(el);
        row = { el, dist: el.querySelector('small') };
        this.playerRows.set(p.id, row);
      }
      row.dist.textContent = `${Math.round(p.distance)} M`;
      list.appendChild(row.el);
    }
    for (const [id, row] of this.playerRows) {
      if (!seen.has(id)) {
        row.el.remove();
        this.playerRows.delete(id);
      }
    }
    $('player-empty').hidden = others.length > 0 || !live;
  }

  bindSettings() {
    this.bindOnline();
    const panel = $('settings'), toggle = $('btn-settings');
    const setOpen = (open, playersOnly = false) => {
      this.settingsOpen = open;
      panel.classList.toggle('players-only', open && playersOnly);
      if (open) panel.style.top = `${document.querySelector('.top').getBoundingClientRect().bottom + 8}px`;
      panel.hidden = !open;
      toggle.classList.toggle('on', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (open) this.refreshQuality();
    };
    this.setSettingsOpen = setOpen;
    this.settingsOpen = false;
    toggle.addEventListener('click', () => {
      setOpen(panel.hidden);
      toggle.blur();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && !toggle.contains(e.target) && !$('net-chip').contains(e.target) && !panel.classList.contains('embedded')) setOpen(false);
    });
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !panel.hidden) {
        setOpen(false);
        e.preventDefault();
      }
    });
    document.querySelectorAll('[data-quality]').forEach((b) => {
      b.addEventListener('click', () => {
        this.actions.setQuality(b.dataset.quality);
        b.blur();
        this.refreshQuality();
      });
    });
  }

  bindLanguage() {
    const buttons = document.querySelectorAll('[data-lang]');
    const mark = () => buttons.forEach((b) => {
      const on = b.dataset.lang === getLang();
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    buttons.forEach((b) => b.addEventListener('click', () => {
      setLang(b.dataset.lang);
      b.blur();
    }));
    // Text the HUD writes once, or only on events, would otherwise stay in the old language.
    onLangChange(() => {
      mark();
      this.refreshLabelText();
      this.refreshSound();
      this.refreshOnline();
      this.refreshQuality();
      this.setToggle($('set-labels'), this.labelsOn);
      this.setToggle($('set-contour'), this.contourOn);
      this.actions.languageChanged();
    });
    mark();
  }

  refreshQuality() {
    const { choice, tier, fps } = this.actions.qualityStatus();
    document.querySelectorAll('[data-quality]').forEach((b) => {
      const on = b.dataset.quality === choice;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const level = choice === 'auto' ? t('AUTO: {level}', { level: LABEL[tier] }) : LABEL[tier];
    $('quality-status').textContent = fps ? t('{status} / {fps} FPS', { status: level, fps: Math.round(fps) }) : t('{status} / MEASURING FPS', { status: level });
  }

  refreshSound() {
    const muted = this.actions.isMuted();
    const set = $('set-sound');
    set.textContent = muted ? t('OFF') : t('ON');
    set.classList.toggle('on', !muted);
    set.setAttribute('aria-pressed', String(!muted));
    const b = $('btn-sound');
    b.classList.toggle('muted', muted);
    b.setAttribute('aria-label', muted ? t('Unmute sound') : t('Mute sound'));
    b.title = muted ? t('Unmute sound (M)') : t('Mute sound (M)');
  }

  fit(c) {
    const r = c.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2);
    c.width = Math.max(1, r.width * dpr);
    c.height = Math.max(1, r.height * dpr);
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    c._w = r.width;
    c._h = r.height;
  }

  update(dt, s, robot, world, camera, fauna) {
    this.battery = Math.max(0, this.battery - dt * (0.012 + Math.abs(s.speed) * 0.003 + s.jet * 0.2));
    this.updateLabels(s, robot, camera);
    this.acc += dt;
    if (this.acc < 1 / 12) return;
    this.acc = 0;

    const speed = Math.abs(s.speed);
    const stateName = s.jet > 0.5 ? 'JET' : s.gear === 'R' ? 'REVERSE' : s.gear === 'F' ? 'FORWARD' : Math.abs(s.yawRate) > 0.2 ? 'TURN' : 'STANDBY';
    const stateHint = {
      JET: 'SIPHON / FULL THRUST',
      REVERSE: 'REVERSE GAIT',
      FORWARD: '8-ARM GAIT',
      TURN: 'TURN IN PLACE',
      STANDBY: 'AWAITING COMMAND',
    }[stateName];
    $('state-big').textContent = t(stateName);
    $('state-big').className = stateName === 'REVERSE' ? 'rev' : '';
    $('state-hint').textContent = s.aiLabel ? t('AI / {text}', { text: t(s.aiLabel) }) : t(stateHint);
    $('t-status').textContent = t(stateName);

    $('v-speed').textContent = speed.toFixed(1);
    const thrust = Math.round(Math.abs(s.speed) * 2.4 + s.jet * 170);
    $('v-thrust').textContent = thrust;
    $('v-steps').textContent = robot.steps;
    $('v-gear').textContent = s.gear === 'R' ? 'R' : s.gear === 'F' ? 'D' : 'N';
    $('gear-speed').textContent = `${s.speed < -0.05 ? '-' : ''}${speed.toFixed(1)}`;
    const pct = clamp(s.speed / 20, -1, 1);
    const bar = $('gear-fill');
    bar.style.left = pct >= 0 ? '50%' : `${50 + pct * 50}%`;
    bar.style.width = `${Math.abs(pct) * 50}%`;
    bar.classList.toggle('rev', pct < 0);

    $('v-batt').textContent = Math.round(this.battery);
    const cells = $('cells').children;
    const lit = Math.ceil((this.battery / 100) * cells.length);
    [...cells].forEach((c, i) => {
      c.className = i >= lit ? '' : i < 2 ? 'warn' : 'ok';
    });
    $('v-amp').textContent = (6 + speed * 1.2 + s.jet * 42).toFixed(1);
    $('v-temp').textContent = Math.round(22 + speed * 0.4 + s.jet * 11);

    robot.arms.forEach((a, i) => {
      const v = Math.round(clamp(a.curl / 0.8, 0, 1) * 100);
      const row = this.armBars[i];
      row.fill.style.width = `${v}%`;
      row.fill.classList.toggle('lift', a.stepping);
      row.val.textContent = `${v}%`;
    });

    const depth = 18 - s.pos.y * 0.5;
    $('v-depth').textContent = depth.toFixed(2);
    $('v-heading').textContent = pad(((-s.yaw * 180) / Math.PI + 3600) % 360, 3);
    $('v-pitch').textContent = ((s.pitch * 180) / Math.PI).toFixed(1);
    $('v-roll').textContent = ((s.roll * 180) / Math.PI).toFixed(1);
    $('t-pos').textContent = `${s.pos.x.toFixed(0)} / ${s.pos.z.toFixed(0)}`;
    const elapsed = (performance.now() - this.t0) / 1000;
    $('t-time').textContent = `${pad(elapsed / 3600, 2)}:${pad((elapsed / 60) % 60, 2)}:${pad(elapsed % 60, 2)}`;
    $('t-odo').textContent = `${s.odo.toFixed(1)} M`;

    this.history.push(s.speed);
    this.history.shift();
    this.drawGraph();
    this.drawRadar(s, world, fauna);
    const near = fauna.nearest;
    $('sub-sonar-name').textContent = near ? t(near.name) : t('NO CONTACT');
    $('sub-sonar').textContent = near ? `${Math.round(near.dist)} M` : '-';
    $('sub-sonar').classList.toggle('alert', Boolean(near) && near.dist < 30);

    const P = robot.targets;
    this.setTag('sub-optics', P.lens > 0.5 ? t('OPEN') : t('LOCKED'), P.lens > 0.5);
    this.setTag('sub-mantle', P.mantle > 0.5 ? t('OPEN') : t('LOCKED'), P.mantle > 0.5);
    this.setTag('sub-pump', P.pump > 0.5 ? t('RAISED') : t('SPINNING'), P.pump > 0.5);
    this.setTag('sub-arms', P.explode > 0.5 ? t('EXPLODED') : t('{n}/8 WALKING', { n: robot.arms.filter((a) => a.stepping).length }), P.explode > 0.5);
    this.setTag('sub-siphon', s.jet > 0.5 ? t('FIRING') : t('STANDBY'), s.jet > 0.5);
    document.querySelectorAll('[data-part]').forEach((b) => b.classList.toggle('on', P[b.dataset.part] > 0.5));
    $('btn-explode-mini').classList.toggle('on', P.explode > 0.5);
    $('btn-demo').classList.toggle('on', s.demoActive);
    const aiOn = s.aiLabel !== null;
    document.body.classList.toggle('ai-on', aiOn);
    $('btn-ai').classList.toggle('on', aiOn);
    $('btn-ai-mini').classList.toggle('on', aiOn);
    $('pad-ai').classList.toggle('on', aiOn);
    $('pad-b').classList.toggle('on', P.explode > 0.5);
    $('pad-x').classList.toggle('on', P.lens > 0.5);
    $('pad-y').classList.toggle('on', P.mantle > 0.5);
    $('pad-y-label').textContent = !P.mantle ? t('MANTLE') : !P.pump ? t('PUMP') : t('CLOSE');
    $('log-line').textContent = s.log;
    this.refreshOnline();
    if (!$('settings').hidden) this.refreshQuality();
    $('demo-progress').style.width = `${s.demoProgress * 100}%`;
  }

  setTag(id, text, alert) {
    const el = $(id);
    el.textContent = text;
    el.classList.toggle('alert', alert);
  }

  updateLabels(s, robot, camera) {
    const show = this.labelsOn && Math.abs(s.speed) < 1.5 && s.jet < 0.2;
    $('labels').classList.toggle('show', show);
    if (!show) return;
    const w = innerWidth / 2, h = innerHeight / 2;
    for (const l of this.labels) {
      robot.anchors[l.key].getWorldPosition(l.p);
      l.p.project(camera);
      const off = l.p.z > 1;
      l.el.style.opacity = off ? 0 : 1;
      l.el.style.transform = `translate(${l.p.x * w + w}px,${-l.p.y * h + h}px)`;
    }
  }

  drawGraph() {
    const c = this.graph, cv = c.canvas;
    const W = cv._w, H = cv._h;
    c.clearRect(0, 0, W, H);
    c.strokeStyle = 'rgba(22,22,27,.13)';
    c.beginPath();
    c.moveTo(0, H / 2);
    c.lineTo(W, H / 2);
    c.stroke();
    c.lineWidth = 1.5;
    c.strokeStyle = ORANGE;
    c.beginPath();
    this.history.forEach((v, i) => {
      const x = (i / (this.history.length - 1)) * W;
      const y = H / 2 - clamp(v / 20, -1, 1) * (H / 2 - 2);
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    });
    c.stroke();
    c.lineWidth = 1;
  }

  /* Heading-up radar, plots the real colliders from the loaded chunks. */
  drawRadar(s, world, fauna) {
    const c = this.radar, cv = c.canvas;
    const W = cv._w, H = cv._h, cx = W / 2, cy = H / 2, R = Math.min(cx, cy) - 2;
    if (R <= 0) return; // The panel is hidden on small screens.
    c.clearRect(0, 0, W, H);
    c.strokeStyle = 'rgba(22,22,27,.22)';
    for (const f of [1, 0.66, 0.33]) {
      c.beginPath();
      c.arc(cx, cy, R * f, 0, Math.PI * 2);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(cx - R, cy); c.lineTo(cx + R, cy);
    c.moveTo(cx, cy - R); c.lineTo(cx, cy + R);
    c.stroke();
    const range = 75;
    const sn = Math.sin(s.yaw), cs = Math.cos(s.yaw);
    for (const o of world.collidersNear(s.pos.x, s.pos.z, range)) {
      const dx = o.x - s.pos.x, dz = o.z - s.pos.z;
      const fwd = dx * sn + dz * cs, right = -(dx * cs - dz * sn);
      const d = Math.hypot(fwd, right);
      if (d > range) continue;
      c.fillStyle = INK;
      c.beginPath();
      c.arc(cx + (right / range) * R, cy - (fwd / range) * R, clamp(o.r * 0.55, 1.5, 5), 0, Math.PI * 2);
      c.fill();
    }
    // Marine robots are hollow rings, so they stay distinct from solid terrain objects.
    c.lineWidth = 1.2;
    for (const o of fauna.radar) {
      const dx = o.x - s.pos.x, dz = o.z - s.pos.z;
      const fwd = dx * sn + dz * cs, right = -(dx * cs - dz * sn);
      if (Math.hypot(fwd, right) > range) continue;
      c.strokeStyle = o.kind === 'shark' || o.kind === 'whale' ? ORANGE : '#2f7f8f';
      c.beginPath();
      c.arc(cx + (right / range) * R, cy - (fwd / range) * R, clamp(1.6 + o.sp.size * 0.14, 1.6, 5), 0, Math.PI * 2);
      c.stroke();
    }
    c.lineWidth = 1;
    // Players always show: anyone beyond the range sits on the rim, pointing the way to them.
    for (const p of this.actions.online.others()) {
      const dx = p.x - s.pos.x, dz = p.z - s.pos.z;
      const fwd = dx * sn + dz * cs, right = -(dx * cs - dz * sn);
      const d = Math.hypot(fwd, right) || 1;
      const k = d > range ? (R - 3) / d : R / range;
      c.fillStyle = p.tag.style.getPropertyValue('--accent');
      const px = cx + right * k, py = cy - fwd * k;
      c.fillRect(px - 2.5, py - 2.5, 5, 5);
    }
    c.fillStyle = ORANGE;
    c.beginPath();
    c.moveTo(cx, cy - 7);
    c.lineTo(cx + 5, cy + 5);
    c.lineTo(cx, cy + 2);
    c.lineTo(cx - 5, cy + 5);
    c.closePath();
    c.fill();
    c.fillStyle = MUTE;
    c.font = '9px ui-monospace, Menlo, monospace';
    c.fillText('75M', cx + 3, 10);
  }
}
