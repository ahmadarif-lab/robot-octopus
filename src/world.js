import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chunkSeed, fbm, rng, smoothstep } from './util.js';

export const SKY = 0xefe8dc;
const CHUNK = 60;
const SEGS = 60;
const RADIUS = 3;
const SPAWN_CLEAR = 17;

export function heightAt(x, z) {
  const large = (fbm(x * 0.011 + 11, z * 0.011 - 7, 4) - 0.5) * 38;
  const mid = (fbm(x * 0.05 + 3, z * 0.05 + 5, 3) - 0.5) * 5;
  // The spawn stays gentle so the first steps read clearly.
  const flat = smoothstep(16, 85, Math.hypot(x, z));
  return (large + mid) * flat + mid * 0.2;
}

function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 0.72 + fbm(v.x * 1.7 + 4, v.y * 1.7 + v.z * 1.7, 3) * 0.62;
    v.multiplyScalar(k);
    v.y *= 0.72;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function coralGeometry() {
  const parts = [];
  const r = rng(77);
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.35 + r() * 0.55;
    const h = 0.9 + r() * 1.5;
    const w = 0.13 + r() * 0.1;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const tube = new THREE.CylinderGeometry(w, w * 1.3, h, 10, 1, false);
    tube.translate(x, h / 2, z);
    const cap = new THREE.CylinderGeometry(w * 1.1, w * 1.1, 0.08, 10);
    cap.translate(x, h + 0.02, z);
    const inner = new THREE.CylinderGeometry(w * 0.6, w * 0.6, 0.02, 10);
    inner.translate(x, h + 0.07, z);
    parts.push(tint(tube, 0xe7e1d5), tint(cap, 0xff5a1f), tint(inner, 0x1a1a1f));
  }
  return mergeGeometries(parts);
}

function kelpGeometry() {
  const g = new THREE.PlaneGeometry(0.42, 6, 1, 10);
  g.translate(0, 3, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const f = 1 - y / 6;
    p.setX(i, p.getX(i) * (0.25 + f * f * 0.9 + Math.sin(y * 1.8) * 0.2));
    p.setZ(i, Math.sin(y * 0.8) * 0.3);
  }
  g.computeVertexNormals();
  return g;
}

function ventGeometry() {
  const parts = [];
  for (const [x, z, h, r] of [[0, 0, 1.3, 0.55], [0.8, 0.35, 0.8, 0.38], [-0.62, 0.55, 0.65, 0.32], [0.1, -0.8, 0.95, 0.4]]) {
    parts.push(tint(new THREE.CylinderGeometry(r * 0.55, r, h, 10, 1, true).translate(x, h / 2, z), 0x24242a));
    parts.push(tint(new THREE.TorusGeometry(r * 0.56, 0.05, 6, 16).rotateX(Math.PI / 2).translate(x, h, z), 0xff5a1f));
    parts.push(tint(new THREE.CircleGeometry(r * 0.52, 10).rotateX(-Math.PI / 2).translate(x, h - 0.08, z), 0x0c0c10));
  }
  return mergeGeometries(parts);
}

function pylonGeometry() {
  const parts = [];
  const add = (geo, hex, y = 0) => { geo.translate(0, y, 0); parts.push(tint(geo, hex)); };
  add(new THREE.CylinderGeometry(1.5, 2.3, 1.2, 16), 0x1a1a1f, 0.6);
  add(new THREE.CylinderGeometry(0.72, 1.15, 17, 16), 0xf3efe7, 9.5);
  [5, 9, 13].forEach((y) => add(new THREE.CylinderGeometry(1.08 - y * 0.018, 1.08 - y * 0.018, 0.42, 16), 0x1a1a1f, y));
  add(new THREE.CylinderGeometry(0.98, 0.98, 0.5, 16), 0xff5a1f, 11);
  add(new THREE.CylinderGeometry(1.5, 0.8, 0.6, 16), 0xf3efe7, 18.3);
  add(new THREE.SphereGeometry(0.5, 16, 12), 0xff5a1f, 19.1);
  const boom = new THREE.BoxGeometry(5.6, 0.22, 0.22);
  add(boom, 0x1a1a1f, 15.5);
  const tipA = new THREE.BoxGeometry(0.5, 0.5, 0.5); tipA.translate(2.9, 0, 0);
  const tipB = new THREE.BoxGeometry(0.5, 0.5, 0.5); tipB.translate(-2.9, 0, 0);
  add(tipA, 0xff5a1f, 15.5);
  add(tipB, 0xff5a1f, 15.5);
  return mergeGeometries(parts);
}

function gateGeometry() {
  const parts = [tint(new THREE.TorusGeometry(13, 0.95, 12, 72), 0xf3efe7)];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const seg = new THREE.BoxGeometry(i % 4 === 0 ? 1.1 : 0.34, 2.3, 2.3);
    seg.rotateZ(a);
    seg.translate(Math.cos(a) * 13, Math.sin(a) * 13, 0);
    parts.push(tint(seg, i % 4 === 0 ? 0xff5a1f : 0x1a1a1f));
  }
  return mergeGeometries(parts);
}

function domeGeometry() {
  const parts = [];
  const shell = new THREE.SphereGeometry(8, 48, 18, 0, Math.PI * 2, 0, Math.PI / 2);
  parts.push(tint(shell, 0xf3efe7));
  const band = new THREE.CylinderGeometry(8.1, 8.1, 0.8, 48, 1, true);
  band.translate(0, 1.6, 0);
  parts.push(tint(band, 0x1a1a1f));
  const stripe = new THREE.CylinderGeometry(7.72, 7.82, 0.26, 48, 1, true);
  stripe.translate(0, 2.7, 0);
  parts.push(tint(stripe, 0xff5a1f));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const win = new THREE.CylinderGeometry(0.62, 0.62, 0.3, 18);
    win.rotateX(Math.PI / 2);
    win.rotateY(a);
    win.translate(Math.sin(a) * 7.2, 3.9, Math.cos(a) * 7.2);
    parts.push(tint(win, 0x1a1a1f));
  }
  const hatch = new THREE.CylinderGeometry(1.5, 1.8, 0.5, 24);
  hatch.translate(0, 8.05, 0);
  parts.push(tint(hatch, 0x1a1a1f));
  return mergeGeometries(parts);
}

/* Fixed landmarks around spawn, so driving forward and back has an obvious reference. */
const LANDMARKS = [
  { type: 'gate', x: 0, z: 42, yaw: 0 },
  { type: 'pylon', x: -24, z: 26, yaw: 0.4 },
  { type: 'pylon', x: 27, z: 18, yaw: 1.2 },
  { type: 'dome', x: 22, z: -34, yaw: 0.3 },
  { type: 'pylon', x: -16, z: -28, yaw: 2.1 },
];

const THINNED = new Set(['rock', 'kelp', 'coral']);
const FIXED_VENTS = [[13, 11], [-14, 15], [-11, -13], [17, -9]];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.uTime = { value: 0 };
    this.uContour = { value: 1 };
    this.chunks = new Map();
    this.propDensity = 1;
    this.drawRadius = RADIUS;
    this.centerX = 0;
    this.centerZ = 0;
    this.queue = [];
    this.free = [];

    const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    terrainMat.onBeforeCompile = (s) => {
      s.uniforms.uTime = this.uTime;
      s.uniforms.uContour = this.uContour;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uTime;\nuniform float uContour;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          // Sand ripples and a drifting caustic keep the ground from reading flat.
          float rip = sin(vWPos.x * 1.7 + sin(vWPos.z * 0.33) * 3.0 + vWPos.z * 0.6);
          diffuseColor.rgb *= 0.965 + 0.035 * rip;
          vec2 cp = vWPos.xz * 0.16;
          float ca = sin(cp.x + uTime * 0.35 + 2.0 * sin(cp.y * 0.8 - uTime * 0.2)) * sin(cp.y * 1.2 - uTime * 0.27 + 1.6 * sin(cp.x * 0.7));
          diffuseColor.rgb += vec3(0.05, 0.045, 0.035) * smoothstep(0.45, 0.95, ca);
          float dist = length(vWPos - cameraPosition);
          float h = vWPos.y / 2.0;
          float cw = fwidth(h);
          float cline = 1.0 - smoothstep(0.0, 1.4, abs(fract(h - 0.5) - 0.5) / max(cw, 1e-4));
          vec2 gp = vWPos.xz / 15.0;
          vec2 gw = fwidth(gp);
          vec2 gl = abs(fract(gp - 0.5) - 0.5) / max(gw, vec2(1e-4));
          float grid = 1.0 - smoothstep(0.0, 1.2, min(gl.x, gl.y));
          float fade = (1.0 - smoothstep(30.0, 120.0, dist)) * uContour;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.25, 0.20), cline * 0.34 * fade);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.22, 0.05), grid * 0.42 * fade);`);
    };
    this.terrainMat = terrainMat;

    const slots = (RADIUS * 2 + 1) ** 2;
    this.slotsFree = Array.from({ length: slots }, (_, i) => i);

    const standard = (o) => new THREE.MeshStandardMaterial({ roughness: 0.62, ...o });
    const kelpMat = new THREE.MeshStandardMaterial({ color: 0x3f3a33, roughness: 0.8, side: THREE.DoubleSide });
    kelpMat.onBeforeCompile = (s) => {
      s.uniforms.uTime = this.uTime;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23;
          float bend = position.y * position.y * 0.012;
          transformed.x += sin(uTime * 0.9 + ph + position.y * 0.5) * bend * 1.8;
          transformed.z += cos(uTime * 0.7 + ph + position.y * 0.4) * bend * 1.3;`);
    };

    this.types = {
      rock: this.makeType(rockGeometry(), standard({ color: 0x9e917c, roughness: 0.95, flatShading: true }), 16, slots),
      boulder: this.makeType(rockGeometry(), standard({ color: 0x8d8170, roughness: 0.95, flatShading: true }), 3, slots),
      coral: this.makeType(coralGeometry(), standard({ vertexColors: true, roughness: 0.55 }), 8, slots),
      kelp: this.makeType(kelpGeometry(), kelpMat, 34, slots),
      pylon: this.makeType(pylonGeometry(), standard({ vertexColors: true, roughness: 0.42 }), 2, slots),
      gate: this.makeType(gateGeometry(), standard({ vertexColors: true, roughness: 0.42 }), 1, slots),
      dome: this.makeType(domeGeometry(), standard({ vertexColors: true, roughness: 0.42 }), 1, slots),
      vent: this.makeType(ventGeometry(), standard({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }), 3, slots),
    };
    // Small props carry too little shadow to justify drawing them all a second time.
    this.types.kelp.mesh.castShadow = false;
    this.types.rock.mesh.castShadow = false;
    this.types.coral.mesh.castShadow = false;
    this.types.vent.mesh.castShadow = false;

    this.snow = this.makeSnow();
  }

  makeType(geo, mat, perChunk, slots) {
    const mesh = new THREE.InstancedMesh(geo, mat, perChunk * slots);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = 0;
    this.scene.add(mesh);
    // Slots hold each chunk's matrices; only the used ones are packed for the GPU,
    // because a zero-scale instance still costs its full vertex count.
    return { mesh, perChunk, store: new Float32Array(perChunk * slots * 16), used: new Uint16Array(slots) };
  }

  makeSnow() {
    const n = 1400;
    this.snowBox = 70;
    const pos = new Float32Array(n * 3);
    const r = rng(9);
    for (let i = 0; i < n * 3; i++) pos[i] = r() * this.snowBox;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0x6e6355, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.snowBase = pos.slice();
    return pts;
  }

  buildTerrainGeometry() {
    const n = SEGS + 1;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    const idx = [];
    for (let y = 0; y < SEGS; y++) {
      for (let x = 0; x < SEGS; x++) {
        const a = y * n + x, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    g.setIndex(idx);
    return g;
  }

  fillChunk(ch) {
    const { cx, cz, mesh, slot } = ch;
    const n = SEGS + 1, step = CHUNK / SEGS;
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const p = mesh.geometry.attributes.position;
    const nor = mesh.geometry.attributes.normal;
    const col = mesh.geometry.attributes.color;
    const low = new THREE.Color(0xa4957e), high = new THREE.Color(0xc9bca5), c = new THREE.Color();
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = ox + ix * step, z = oz + iz * step;
        const h = heightAt(x, z);
        const i = iz * n + ix;
        p.setXYZ(i, ix * step, h, iz * step);
        const hx = heightAt(x + 0.6, z) - heightAt(x - 0.6, z);
        const hz = heightAt(x, z + 0.6) - heightAt(x, z - 0.6);
        const l = Math.hypot(hx, 1.2, hz);
        nor.setXYZ(i, -hx / l, 1.2 / l, -hz / l);
        c.lerpColors(low, high, smoothstep(-12, 10, h) * (0.8 + fbm(x * 0.15, z * 0.15, 2) * 0.4));
        col.setXYZ(i, c.r, c.g, c.b);
      }
    }
    p.needsUpdate = nor.needsUpdate = col.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
    mesh.position.set(ox, 0, oz);
    this.fillProps(ch, slot);
  }

  fillProps(ch, slot) {
    const { cx, cz } = ch;
    const r = rng(chunkSeed(cx, cz));
    const counters = {};
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
    const e = new THREE.Euler();
    ch.colliders = [];
    ch.vents = [];
    const put = (name, x, y, z, sx, sy, sz, rx, ry, rz) => {
      const type = this.types[name];
      const n = counters[name] || 0;
      if (n >= type.perChunk) return false;
      counters[name] = n + 1;
      e.set(rx, ry, rz);
      q.setFromEuler(e);
      m.compose(t.set(x, y, z), q, s.set(sx, sy, sz));
      m.toArray(type.store, (slot * type.perChunk + n) * 16);
      return true;
    };
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const point = () => {
      const x = ox + r() * CHUNK, z = oz + r() * CHUNK;
      return { x, z, h: heightAt(x, z), ok: Math.hypot(x, z) > SPAWN_CLEAR && !(Math.abs(x) < 15 && z > 0 && z < 60) };
    };
    const placePylon = (x, z, yaw) => {
      put('pylon', x, heightAt(x, z) - 0.4, z, 1, 1, 1, 0, yaw, 0);
      ch.colliders.push({ x, z, r: 2.6 });
    };
    const placeGate = (x, z, yaw) => {
      put('gate', x, heightAt(x, z) + 8, z, 1, 1, 1, 0, yaw, 0);
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      ch.colliders.push({ x: x + c * 10.5, z: z - sn * 10.5, r: 2.4 }, { x: x - c * 10.5, z: z + sn * 10.5, r: 2.4 });
    };
    const placeDome = (x, z, yaw) => {
      put('dome', x, heightAt(x, z) - 1, z, 1, 1, 1, 0, yaw, 0);
      ch.colliders.push({ x, z, r: 8.6 });
    };

    const placeVent = (x, z) => {
      const y = heightAt(x, z);
      put('vent', x, y - 0.1, z, 1, 1, 1, 0, x * 3.1, 0);
      ch.vents.push({ x, y: y + 1.2, z, rate: 3 + r() * 9, size: 0.1 + r() * 0.12, gust: r() * 6 });
    };
    for (const v of FIXED_VENTS) {
      if (Math.floor(v[0] / CHUNK) === cx && Math.floor(v[1] / CHUNK) === cz) placeVent(v[0], v[1]);
    }
    for (let i = 0; i < 2; i++) {
      if (r() > 0.55) continue;
      const a = point();
      if (a.ok) placeVent(a.x, a.z);
    }

    for (const l of LANDMARKS) {
      if (Math.floor(l.x / CHUNK) !== cx || Math.floor(l.z / CHUNK) !== cz) continue;
      if (l.type === 'pylon') placePylon(l.x, l.z, l.yaw);
      else if (l.type === 'gate') placeGate(l.x, l.z, l.yaw);
      else placeDome(l.x, l.z, l.yaw);
    }

    for (let i = 0; i < 14; i++) {
      const a = point();
      if (!a.ok) continue;
      const k = 0.25 + r() * r() * 1.3;
      put('rock', a.x, a.h + k * 0.15, a.z, k * (0.8 + r()), k, k * (0.8 + r()), r() * 3, r() * 6, r() * 3);
    }
    for (let i = 0; i < 2; i++) {
      if (r() > 0.75) continue;
      const a = point();
      if (!a.ok) continue;
      const k = 2.5 + r() * 3.5;
      put('boulder', a.x, a.h + k * 0.2, a.z, k * (0.9 + r() * 0.8), k * (0.9 + r() * 0.5), k * (0.9 + r() * 0.8), r(), r() * 6, r());
      ch.colliders.push({ x: a.x, z: a.z, r: k * 1.1 });
    }
    for (let i = 0; i < 7; i++) {
      const a = point();
      if (!a.ok) continue;
      const k = 0.8 + r() * 1.4;
      put('coral', a.x, a.h - 0.1, a.z, k, k, k, 0, r() * 6, 0);
    }
    // Kelp grows in clumps, not uniformly.
    for (let c = 0; c < 3; c++) {
      const a = point();
      if (!a.ok) continue;
      for (let i = 0; i < 10; i++) {
        const x = a.x + (r() - 0.5) * 8, z = a.z + (r() - 0.5) * 8;
        const k = 0.7 + r() * 1.2;
        put('kelp', x, heightAt(x, z) - 0.1, z, k, k, k, 0, r() * 6, 0);
      }
    }
    if (r() < 0.3) {
      const a = point();
      if (a.ok) placePylon(a.x, a.z, r() * 6);
    }
    if (r() < 0.12) {
      const a = point();
      if (a.ok) placeGate(a.x, a.z, r() * 6);
    }
    if (r() < 0.1) {
      const a = point();
      if (a.ok) placeDome(a.x, a.z, r() * 6);
    }

    for (const name in this.types) this.types[name].used[slot] = counters[name] || 0;
    this.packInstances();
  }

  /** Lower tiers thin out small props and stop drawing the farthest chunks. Colliders stay real. */
  setDetail(props, radius, snow) {
    this.propDensity = props;
    this.drawRadius = radius;
    this.snow.geometry.setDrawRange(0, Math.floor(this.snowBase.length / 3 * snow));
    this.applyDrawRadius();
  }

  inDrawRange(ch) {
    return Math.max(Math.abs(ch.cx - this.centerX), Math.abs(ch.cz - this.centerZ)) <= this.drawRadius;
  }

  applyDrawRadius() {
    for (const ch of this.chunks.values()) ch.mesh.visible = this.inDrawRange(ch);
    this.packInstances();
  }

  packInstances() {
    const drawn = new Set();
    for (const ch of this.chunks.values()) if (this.inDrawRange(ch)) drawn.add(ch.slot);
    for (const name in this.types) {
      const type = this.types[name];
      const out = type.mesh.instanceMatrix.array;
      const thin = THINNED.has(name) ? this.propDensity : 1;
      let n = 0;
      for (let slot = 0; slot < type.used.length; slot++) {
        if (!drawn.has(slot)) continue;
        const from = slot * type.perChunk * 16;
        const count = Math.ceil(type.used[slot] * thin);
        const size = count * 16;
        for (let i = 0; i < size; i++) out[n * 16 + i] = type.store[from + i];
        n += count;
      }
      type.mesh.count = n;
      type.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  update(px, pz, t, budget = 2) {
    this.uTime.value = t;
    const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
    const moved = ccx !== this.centerX || ccz !== this.centerZ;
    this.centerX = ccx;
    this.centerZ = ccz;
    const wanted = new Set();
    for (let z = -RADIUS; z <= RADIUS; z++) {
      for (let x = -RADIUS; x <= RADIUS; x++) wanted.add(`${ccx + x},${ccz + z}`);
    }
    let removed = false;
    for (const [key, ch] of this.chunks) {
      if (!wanted.has(key)) {
        this.chunks.delete(key);
        ch.mesh.visible = false;
        this.free.push(ch.mesh);
        this.slotsFree.push(ch.slot);
        for (const name in this.types) this.types[name].used[ch.slot] = 0;
        removed = true;
      }
    }
    if (moved && this.drawRadius < RADIUS) this.applyDrawRadius();
    else if (removed) this.packInstances();
    const missing = [];
    for (const key of wanted) if (!this.chunks.has(key)) missing.push(key);
    missing.sort((a, b) => {
      const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number);
      return Math.hypot(ax - ccx, az - ccz) - Math.hypot(bx - ccx, bz - ccz);
    });
    for (const key of missing.slice(0, budget)) {
      const [cx, cz] = key.split(',').map(Number);
      let mesh = this.free.pop();
      if (!mesh) {
        mesh = new THREE.Mesh(this.buildTerrainGeometry(), this.terrainMat);
        mesh.receiveShadow = true;
        this.scene.add(mesh);
      }
      const ch = { cx, cz, mesh, slot: this.slotsFree.pop(), colliders: [] };
      mesh.visible = this.inDrawRange(ch);
      this.chunks.set(key, ch);
      this.fillChunk(ch);
    }

    // Marine snow wraps around the camera's area, drifting downward.
    const a = this.snow.geometry.attributes.position.array, b = this.snowBase, S = this.snowBox;
    const fall = t * 0.35;
    for (let i = 0; i < a.length; i += 3) {
      const drift = Math.sin(t * 0.2 + i) * 0.4;
      a[i] = px - S / 2 + ((((b[i] + drift - px) % S) + S) % S);
      a[i + 2] = pz - S / 2 + ((((b[i + 2] - pz) % S) + S) % S);
      a[i + 1] = ((((b[i + 1] - fall) % S) + S) % S) - 12 + heightAt(px, pz);
    }
    this.snow.geometry.attributes.position.needsUpdate = true;
  }

  /** Pushes a circle out of solid props. Returns true if it hit something. */
  collide(pos, radius) {
    let hit = false;
    for (const ch of this.chunks.values()) {
      for (const c of ch.colliders) {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const min = radius + c.r;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          pos.x = c.x + (dx / d) * min;
          pos.z = c.z + (dz / d) * min;
          hit = true;
        }
      }
    }
    return hit;
  }

  /** Vents breathe in gusts, so the columns never look like a fixed loop. */
  emitVents(bubbles, px, pz, t, dt, onNear) {
    for (const ch of this.chunks.values()) {
      for (const v of ch.vents) {
        const d = Math.hypot(v.x - px, v.z - pz);
        if (d > 95) continue;
        const gust = 0.55 + Math.sin(t * 0.45 + v.gust) * 0.45;
        if (Math.random() < dt * v.rate * gust) {
          bubbles.emit(v.x + (Math.random() - 0.5) * 1.2, v.y, v.z + (Math.random() - 0.5) * 1.2, v.size * (0.4 + Math.random() * Math.random() * 2.2));
          if (d < 34) onNear?.(v, d);
        }
      }
    }
  }

  collidersNear(x, z, range) {
    const out = [];
    for (const ch of this.chunks.values()) {
      for (const c of ch.colliders) {
        if (Math.abs(c.x - x) < range && Math.abs(c.z - z) < range) out.push(c);
      }
    }
    return out;
  }
}
