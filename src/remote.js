import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, dampAngle, lerp } from './util.js';
import { heightAt } from './world.js';

const MAX_PLAYERS = 19;
const ARMS = 8;
const LINKS = 10;
const ARM_LEN = 14.5;
const HOME_R = 6.6;
const STEP_DIST = 2.6;
const BODY_R = 2.1;
const SCALE = 1.22;
const INTERP_MS = 150;
const DRAW_RANGE = 170;
const TAG_RANGE = 130;

const WHITE = 0xf5f2eb, BLACK = 0x16161b, ORANGE = 0xff5a1f, RED = 0xb42c14;
// Each player's accent, so robots can be told apart at a glance.
const ACCENTS = [0x2f9e8f, 0x3d7bd9, 0x8a5bd6, 0xd94f8b, 0xe0a81c, 0x4caf50, 0x00a7c4, 0xc0562f];

const tint = (geo, hex) => {
  const c = new THREE.Color(hex);
  const g = geo.index ? geo.toNonIndexed() : geo;
  const a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
};

function bodyGeometry() {
  const seam = Math.acos(1 / BODY_R);
  const parts = [
    tint(new THREE.SphereGeometry(BODY_R, 24, 12, 0, Math.PI * 2, seam, Math.acos(-1.32 / BODY_R) - seam), WHITE),
    tint(new THREE.LatheGeometry([[1.72, -1.2], [1.86, -1.36], [1.28, -2.04], [0, -2.24]].map(([r, y]) => new THREE.Vector2(r, y)), 18), BLACK),
    tint(new THREE.ConeGeometry(0.34, 0.6, 10).rotateX(Math.PI).translate(0, -2.6, 0), BLACK),
    tint(new THREE.TorusGeometry(0.34, 0.07, 6, 16).translate(0, -0.7, -BODY_R - 0.4), ORANGE),
  ];
  const eye = (azimuth, radius) => {
    const dir = new THREE.Vector3(Math.sin(azimuth), 0, Math.cos(azimuth));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const m = new THREE.Matrix4().compose(dir.clone().multiplyScalar(BODY_R - 0.05), q, new THREE.Vector3(1, 1, 1));
    parts.push(
      tint(new THREE.CylinderGeometry(radius * 1.15, radius * 1.2, 0.3, 18).rotateX(Math.PI / 2).applyMatrix4(m), BLACK),
      tint(new THREE.TorusGeometry(radius, radius * 0.11, 6, 22).translate(0, 0, 0.17).applyMatrix4(m), ORANGE),
      tint(new THREE.SphereGeometry(radius * 0.7, 12, 8).scale(1, 1, 0.45).translate(0, 0, 0.3).applyMatrix4(m), 0x08080c),
    );
  };
  eye(0, 0.82);
  eye(1.02, 0.5);
  eye(-1.02, 0.5);
  for (let i = 0; i < ARMS; i++) {
    const a = ((i + 0.5) / ARMS) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.sin(a), -0.22, Math.cos(a)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(Math.sin(a) * 1.5, -1.12, Math.cos(a) * 1.5), q, new THREE.Vector3(1, 1, 1));
    parts.push(tint(new THREE.CylinderGeometry(0.72, 0.8, 0.82, 12).rotateX(Math.PI / 2).translate(0, 0, 0.25).applyMatrix4(m), WHITE));
  }
  return mergeGeometries(parts);
}

function capGeometry() {
  const seam = Math.acos(1 / BODY_R);
  const pivotX = BODY_R * Math.sin(seam);
  return mergeGeometries([
    tint(new THREE.SphereGeometry(BODY_R, 24, 10, 0, Math.PI * 2, 0, seam), WHITE),
    tint(new THREE.TorusGeometry(pivotX, 0.05, 6, 28).rotateX(Math.PI / 2).translate(0, 1, 0), BLACK),
    tint(new THREE.CylinderGeometry(0.48, 0.55, 0.14, 14).translate(0, BODY_R, 0), BLACK),
  ]).translate(-pivotX, -1, 0);
}

function linkGeometry() {
  const lathe = new THREE.LatheGeometry([[0.5, -0.32], [0.63, -0.24], [0.63, 0.24], [0.5, 0.32]].map(([r, z]) => new THREE.Vector2(r, z)), 9).rotateX(Math.PI / 2);
  const bead = (x) => new THREE.OctahedronGeometry(0.17).translate(x, -0.6, 0);
  return mergeGeometries([
    tint(lathe, WHITE),
    tint(new THREE.CylinderGeometry(0.33, 0.33, 0.96, 6, 1, true).rotateX(Math.PI / 2), BLACK),
    tint(new THREE.CylinderGeometry(0.637, 0.637, 0.07, 9, 1, true).rotateX(Math.PI / 2), BLACK),
    tint(bead(-0.21), RED),
    tint(bead(0.21), RED),
  ]);
}

const RADII = Array.from({ length: LINKS }, (_, k) => lerp(1, 0.28, Math.pow(k / (LINKS - 1), 0.85)));
const RADII_SUM = RADII.reduce((s, r) => s + r, 0);
const LINK_U = (() => {
  let acc = 0;
  return RADII.map((r) => {
    const u = (acc + r / 2) / RADII_SUM;
    acc += r;
    return u;
  });
})();
const LINK_LEN = ARM_LEN / RADII_SUM;

const v3 = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const BODY_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.05, side: THREE.DoubleSide });

/** A cut-down robot for other players: same silhouette and gait, a fraction of the triangles. */
export class RemoteRobots {
  constructor(scene, tagLayer) {
    this.scene = scene;
    this.tagLayer = tagLayer;
    this.players = new Map();
    this.bodyGeo = bodyGeometry();
    this.capGeo = capGeometry();
    this.accentGeo = new THREE.TorusGeometry(BODY_R * Math.sin(Math.acos(1 / BODY_R)) + 0.02, 0.09, 6, 28).rotateX(Math.PI / 2);
    this.accentMats = ACCENTS.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
    this.links = new THREE.InstancedMesh(linkGeometry(), BODY_MAT, MAX_PLAYERS * ARMS * LINKS);
    this.links.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.links.frustumCulled = false;
    // Bodies keep their shadow; a second pass over every arm link costs more than it shows.
    this.links.castShadow = false;
    this.links.count = 0;
    scene.add(this.links);
    this._t = { p: v3(), rad: v3(), c1: v3(), c2: v3(), T: v3(), U: v3(), S: v3(), m: new THREE.Matrix4(), s: v3(), out: v3(), back: v3(), side: v3() };
    this._pts = Array.from({ length: 41 }, v3);
    this._seg = new Float32Array(41);
    this._sample = Array.from({ length: LINKS }, v3);
    this._project = v3();
  }

  add(id, name) {
    if (this.players.has(id) || this.players.size >= MAX_PLAYERS) return;
    const accent = this.accentMats[id % this.accentMats.length];
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    root.scale.setScalar(SCALE);
    const body = new THREE.Mesh(this.bodyGeo, BODY_MAT);
    body.castShadow = true;
    const hinge = new THREE.Group();
    hinge.position.set(BODY_R * Math.sin(Math.acos(1 / BODY_R)), 1, 0);
    const cap = new THREE.Mesh(this.capGeo, BODY_MAT);
    cap.castShadow = true;
    hinge.add(cap);
    const ring = new THREE.Mesh(this.accentGeo, accent);
    ring.position.y = 0.97;
    root.add(body, hinge, ring);
    root.visible = false;
    this.scene.add(root);
    const tag = document.createElement('div');
    tag.className = 'player-tag';
    tag.textContent = name;
    tag.style.setProperty('--accent', `#${accent.color.getHexString()}`);
    this.tagLayer.appendChild(tag);
    const arms = Array.from({ length: ARMS }, (_, i) => ({
      i, angle: ((i + 0.5) / ARMS) * Math.PI * 2, foot: v3(), from: v3(), to: v3(), t: 1, stepping: false, placed: false, lift: 1,
    }));
    this.players.set(id, {
      id, name, root, hinge, tag, arms, buffer: [], ready: false,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0, jet: 0, flags: 0, cap: 0, explode: 0, distance: Infinity,
    });
  }

  remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.scene.remove(p.root);
    p.tag.remove();
    this.players.delete(id);
  }

  clear() {
    for (const id of [...this.players.keys()]) this.remove(id);
    this.links.count = 0;
  }

  push(id, s, now) {
    const p = this.players.get(id);
    if (!p || !s) return;
    p.buffer.push({ at: now, s });
    if (p.buffer.length > 12) p.buffer.shift();
  }

  /** Plays slightly in the past so there are always two snapshots to blend between. */
  interpolate(p, now, dt) {
    const b = p.buffer;
    if (!b.length) return false;
    const when = now - INTERP_MS;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].at > when) i--;
    const next = b[i];
    const prev = b[Math.max(0, i - 1)];
    const span = next.at - prev.at;
    const f = span > 0 ? clamp((when - prev.at) / span, 0, 1) : 1;
    const a = prev.s, c = next.s;
    const tx = lerp(a[0], c[0], f), ty = lerp(a[1], c[1], f), tz = lerp(a[2], c[2], f);
    // A far jump is a teleport, not fast swimming: snap instead of sliding across the map.
    const jumped = !p.ready || Math.hypot(tx - p.x, tz - p.z) > 40;
    if (jumped) {
      p.x = tx;
      p.y = ty;
      p.z = tz;
      p.yaw = c[3];
      for (const arm of p.arms) arm.placed = false;
      p.ready = true;
    } else {
      p.x = damp(p.x, tx, 14, dt);
      p.y = damp(p.y, ty, 14, dt);
      p.z = damp(p.z, tz, 14, dt);
      p.yaw = dampAngle(p.yaw, c[3], 10, dt);
    }
    p.pitch = damp(p.pitch, c[4], 8, dt);
    p.roll = damp(p.roll, c[5], 8, dt);
    p.speed = damp(p.speed, c[6], 8, dt);
    p.jet = damp(p.jet, c[7], 6, dt);
    p.flags = c[8];
    return true;
  }

  homeOf(p, arm, out) {
    const a = arm.angle + p.yaw;
    const lead = clamp(p.speed * 0.3, -2.4, 2.4);
    out.set(p.x + Math.sin(a) * HOME_R + Math.sin(p.yaw) * lead, 0, p.z + Math.cos(a) * HOME_R + Math.cos(p.yaw) * lead);
    out.y = heightAt(out.x, out.z);
    return out;
  }

  stepFeet(p, dt, t) {
    const { out: home, back, side } = this._t;
    if (p.jet > 0.4) {
      const f = p.speed >= 0 ? -1 : 1;
      back.set(Math.sin(p.yaw) * f, 0, Math.cos(p.yaw) * f);
      side.set(back.z, 0, -back.x);
      for (const arm of p.arms) {
        home.set(p.x, p.y - 1, p.z).addScaledVector(back, 9.5)
          .addScaledVector(side, Math.sin(arm.angle) * 2.7 + Math.sin(t * 5 + arm.i * 1.4) * 0.9);
        home.y += Math.cos(arm.angle) * 1.5;
        arm.foot.lerp(home, 1 - Math.exp(-7 * dt));
        arm.foot.y = Math.max(arm.foot.y, heightAt(arm.foot.x, arm.foot.z) + 0.3);
        arm.stepping = false;
      }
      return;
    }
    let active = p.arms.filter((a) => a.stepping).length;
    for (const arm of p.arms) {
      this.homeOf(p, arm, home);
      if (!arm.placed) {
        arm.foot.copy(home);
        arm.placed = true;
      }
      if (arm.stepping) {
        arm.t = Math.min(1, arm.t + dt / 0.36);
        arm.to.lerp(home, 1 - Math.exp(-3 * dt));
        arm.foot.lerpVectors(arm.from, arm.to, arm.t * arm.t * (3 - 2 * arm.t));
        arm.foot.y += Math.sin(arm.t * Math.PI) * arm.lift;
        if (arm.t >= 1) arm.stepping = false;
        continue;
      }
      const d = Math.hypot(arm.foot.x - home.x, arm.foot.z - home.z);
      const prev = p.arms[(arm.i + ARMS - 1) % ARMS], next = p.arms[(arm.i + 1) % ARMS];
      if (d > STEP_DIST && active < 4 && !prev.stepping && !next.stepping) {
        arm.stepping = true;
        arm.t = 0;
        arm.from.copy(arm.foot);
        arm.to.copy(home);
        arm.lift = clamp(0.9 + d * 0.28, 0.9, 3);
        active++;
      }
    }
  }

  writeArm(p, arm, t, index) {
    const { p: rootP, rad, c1, c2, T, U, S, m, s: scale, out } = this._t;
    const pts = this._pts, seg = this._seg;
    const a = arm.angle + p.yaw;
    rootP.set(p.x + Math.sin(a) * 2.5, p.y - 1.55, p.z + Math.cos(a) * 2.5);
    rad.subVectors(arm.foot, rootP);
    rad.y = 0;
    const d = rad.length();
    if (d < 0.01) rad.set(Math.sin(a), 0, Math.cos(a));
    else rad.divideScalar(d);
    c1.copy(rootP).addScaledVector(rad, d * 0.34);
    c1.y += lerp(2, 0.3, p.jet);
    c2.copy(arm.foot).addScaledVector(rad, -d * 0.34);
    c2.y += lerp(0.75, 0.15, p.jet);
    let total = 0;
    for (let k = 0; k <= 24; k++) {
      const u = k / 24, v = 1 - u;
      const b0 = v * v * v, b1 = 3 * v * v * u, b2 = 3 * v * u * u, b3 = u * u * u;
      pts[k].set(
        b0 * rootP.x + b1 * c1.x + b2 * c2.x + b3 * arm.foot.x,
        b0 * rootP.y + b1 * c1.y + b2 * c2.y + b3 * arm.foot.y,
        b0 * rootP.z + b1 * c1.z + b2 * c2.z + b3 * arm.foot.z,
      );
      if (k) total += pts[k].distanceTo(pts[k - 1]);
      seg[k] = total;
    }
    const remain = Math.max(0.9, ARM_LEN - total);
    const a0 = Math.atan2(arm.foot.y - c2.y, Math.max((arm.foot.x - c2.x) * rad.x + (arm.foot.z - c2.z) * rad.z, 0.001));
    const curl = 5.3 + Math.sin(t * 0.8 + arm.i * 2.1) * 0.9;
    const ds = remain / 16;
    for (let k = 1; k <= 16; k++) {
      const f = k / 16;
      const ang = a0 + curl * f * f;
      pts[24 + k].copy(pts[24 + k - 1]);
      pts[24 + k].x += rad.x * Math.cos(ang) * ds;
      pts[24 + k].z += rad.z * Math.cos(ang) * ds;
      pts[24 + k].y += Math.sin(ang) * ds;
      total += ds;
      seg[24 + k] = total;
    }
    let cursor = 0;
    const samples = this._sample;
    for (let k = 0; k < LINKS; k++) {
      const want = LINK_U[k] * total;
      while (cursor < 40 && seg[cursor] < want) cursor++;
      const i0 = Math.max(0, cursor - 1);
      const span = seg[cursor] - seg[i0];
      samples[k].lerpVectors(pts[i0], pts[cursor], span > 1e-5 ? (want - seg[i0]) / span : 0);
      samples[k].y = Math.max(samples[k].y, heightAt(samples[k].x, samples[k].z) + 0.45 * RADII[k]);
    }
    S.crossVectors(UP, rad).normalize();
    for (let k = 0; k < LINKS; k++) {
      const P = samples[k];
      T.subVectors(samples[Math.min(LINKS - 1, k + 1)], samples[Math.max(0, k - 1)]).normalize();
      U.crossVectors(T, S).normalize();
      out.crossVectors(U, T).normalize();
      m.makeBasis(out, U, T);
      const r = RADII[k];
      m.scale(scale.set(r, r, r * LINK_LEN));
      let x = P.x, y = P.y, z = P.z;
      if (p.explode > 0.01) {
        const push = p.explode * (1.4 + k * 0.45);
        const dx = x - p.x, dz = z - p.z, len = Math.hypot(dx, dz) || 1;
        x += (dx / len) * push;
        z += (dz / len) * push;
        y += p.explode * Math.sin(k + arm.i) * 0.8;
      }
      m.setPosition(x, y, z);
      this.links.setMatrixAt(index++, m);
    }
    return index;
  }

  update(dt, t, now, viewer) {
    let index = 0;
    for (const p of this.players.values()) {
      const hasData = this.interpolate(p, now, dt);
      p.distance = hasData ? Math.hypot(p.x - viewer.x, p.z - viewer.z) : Infinity;
      const near = hasData && p.distance < DRAW_RANGE;
      p.root.visible = near;
      if (!near) continue;
      const lift = (p.flags & 8 ? 1 : 0);
      p.explode = damp(p.explode, lift, 3.6, dt);
      p.cap = damp(p.cap, p.flags & 2 || p.flags & 4 || lift ? 1 : 0, 3.6, dt);
      p.root.position.set(p.x, p.y, p.z);
      p.root.rotation.set(p.pitch, p.yaw, p.roll);
      p.hinge.rotation.z = -p.cap * 1.45;
      this.stepFeet(p, dt, t);
      for (const arm of p.arms) index = this.writeArm(p, arm, t, index);
    }
    this.links.count = index;
    this.links.instanceMatrix.needsUpdate = true;
  }

  updateTags(camera) {
    const w = innerWidth / 2, h = innerHeight / 2, v = this._project;
    for (const p of this.players.values()) {
      const show = p.root.visible && p.distance < TAG_RANGE;
      if (show) {
        v.set(p.x, p.y + 4.6, p.z).project(camera);
        const visible = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
        p.tag.style.display = visible ? '' : 'none';
        if (visible) p.tag.style.transform = `translate(${v.x * w + w}px,${-v.y * h + h}px) translate(-50%,-100%)`;
      } else {
        p.tag.style.display = 'none';
      }
    }
  }
}
