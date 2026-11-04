import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, dampAngle, lerp, rng, wrapAngle } from './util.js';
import { heightAt } from './world.js';

const WHITE = 0xf2efe8, BLACK = 0x17171c, RUBBER = 0x27272d, ORANGE = 0xff5a1f, STEEL = 0x8f9299;
const GUN = 0x565d67, SLATE = 0x4a5763, BELLY = 0xdedad1, RUST = 0xb42c14;

const DESPAWN = 185;
const SPAWN_MIN = 125;
const SPAWN_MAX = 160;
const ROBOT_REACH = 9; // Center of the robot to the far side of its arms.

const BODY_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.12 });

function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Countershading: darker on top and pale underneath, as on real sharks and whales. */
function twoTone(geo, top, belly, cut = -0.15) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const a = new THREE.Color(top), b = new THREE.Color(belly);
  const nor = g.attributes.normal;
  const col = new Float32Array(nor.count * 3);
  for (let i = 0; i < nor.count; i++) {
    const c = nor.getY(i) < cut ? b : a;
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** A hull section along -Z, optionally with a rounded nose reaching forward along +Z. */
function hull(len, r0, r1, { sx = 1, sy = 1, nose = 0, noseR = 0.04, bulge = 0.05, seg = 24 } = {}) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const u = 1 - i / 8;
    const r = lerp(r0, r1, u) + Math.sin(u * Math.PI) * bulge * r0;
    pts.push(new THREE.Vector2(Math.max(r, 0.001), -u * len));
  }
  if (nose > 0) {
    for (let i = 1; i <= 7; i++) {
      const u = i / 7;
      const r = lerp(r0, r0 * noseR, u * u);
      pts.push(new THREE.Vector2(Math.max(r, 0.001), u * nose));
    }
  }
  return new THREE.LatheGeometry(pts, seg).rotateX(Math.PI / 2).scale(sx, sy, 1);
}

const band = (r, z, width, sx, sy) => new THREE.CylinderGeometry(r, r, width, 24, 1, true)
  .rotateX(Math.PI / 2).scale(sx, sy, 1).translate(0, 0, z);

function rivetRing(r, z, count, sx, sy, size) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const s = new THREE.SphereGeometry(size, 5, 4);
    s.translate(Math.cos(a) * r * sx, Math.sin(a) * r * sy, z);
    out.push(tint(s, BLACK));
  }
  return out;
}

/** A thin plate. b runs backward along -Z, h runs up along +Y. */
function plate(points, thickness = 0.06) {
  const shape = new THREE.Shape(points.map(([b, h]) => new THREE.Vector2(b, h)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

/** A fin with an inset dark spar, so it reads as a machined part. */
function fin(points, thickness, color, spar = BLACK) {
  const center = points.reduce((s, [b, h]) => [s[0] + b / points.length, s[1] + h / points.length], [0, 0]);
  const inner = points.map(([b, h]) => [center[0] + (b - center[0]) * 0.68, center[1] + (h - center[1]) * 0.68]);
  return [tint(plate(points, thickness), color), tint(plate(inner, thickness * 1.5), spar)];
}

function eye(x, y, z, r, iris = ORANGE) {
  const parts = [];
  const ball = new THREE.SphereGeometry(r, 16, 12).translate(x, y, z);
  parts.push(tint(ball, BLACK));
  const dir = x >= 0 ? 1 : -1;
  const ring = new THREE.TorusGeometry(r * 1.05, r * 0.16, 8, 22).rotateY(Math.PI / 2).translate(x + dir * r * 0.32, y, z);
  parts.push(tint(ring, iris));
  const dot = new THREE.SphereGeometry(r * 0.32, 8, 6).translate(x + dir * r * 0.82, y, z);
  parts.push(tint(dot, iris));
  return parts;
}

const eyes = (x, y, z, r, iris) => [...eye(x, y, z, r, iris), ...eye(-x, y, z, r, iris)];

/** The exposed link between two body segments: a rubber boot around a steel pin. */
function jointParts(r, z, gap, sx, sy) {
  const boot = new THREE.LatheGeometry([
    [r * 0.72, -gap], [r * 0.84, -gap * 0.75], [r * 0.7, -gap * 0.5], [r * 0.84, -gap * 0.25], [r * 0.72, 0],
  ].map(([a, b]) => new THREE.Vector2(a, b)), 20).rotateX(Math.PI / 2).scale(sx, sy, 1).translate(0, 0, z);
  const pin = new THREE.CylinderGeometry(r * 0.13, r * 0.13, r * 2 * sy * 1.04, 10).translate(0, 0, z - gap / 2);
  return [tint(boot, RUBBER), tint(pin, STEEL)];
}

/* Assembles the fish family: every segment hangs from the previous one, so a wave travels along it. */
function buildFish(cfg) {
  const root = new THREE.Group();
  const { segs, gap, sx = 1, sy = 1, main, belly = main, accent = ORANGE } = cfg;
  let parent = root;
  let offset = 0;
  segs.forEach(([len, r0, r1], i) => {
    const pivot = new THREE.Group();
    pivot.userData.swim = i;
    pivot.position.z = offset;
    parent.add(pivot);
    const body = hull(len, r0, r1, { sx, sy, nose: i === 0 ? cfg.nose : 0, noseR: cfg.noseR, seg: cfg.detail || 24 });
    const parts = [twoTone(body, main, belly)];
    parts.push(tint(band(lerp(r0, r1, 0.2) * 1.015, -len * 0.2, len * 0.07, sx, sy), BLACK));
    if (i % 2 === 0) parts.push(tint(band(lerp(r0, r1, 0.65) * 1.015, -len * 0.65, len * 0.1, sx, sy), accent));
    const rivetCount = cfg.rivets || 14;
    parts.push(...rivetRing(lerp(r0, r1, 0.08) * 1.01, -len * 0.08, rivetCount, sx, sy, r0 * 0.022 + 0.008));
    parts.push(...rivetRing(lerp(r0, r1, 0.9) * 1.01, -len * 0.9, rivetCount, sx, sy, r0 * 0.022 + 0.008));
    if (i < segs.length - 1) parts.push(...jointParts(r1, -len, gap, sx, sy));
    cfg.decorate?.(i, parts, { len, r0, r1, sx, sy });
    const mesh = new THREE.Mesh(mergeGeometries(parts), BODY_MAT);
    mesh.castShadow = Boolean(cfg.shadow);
    pivot.add(mesh);
    for (const f of cfg.flaps?.(i) || []) {
      const flap = new THREE.Group();
      flap.position.set(...f.at);
      flap.userData.flap = f.side;
      flap.userData.base = f.tilt || 0;
      const m = new THREE.Mesh(mergeGeometries(f.parts), BODY_MAT);
      m.castShadow = Boolean(cfg.shadow);
      flap.add(m);
      pivot.add(flap);
    }
    parent = pivot;
    offset = -len - gap;
  });
  return root;
}

const horizontalFin = (geo, side) => geo.rotateZ(side > 0 ? -Math.PI / 2 : Math.PI / 2);

function sidePair(points, thickness, color, at, spar) {
  return [1, -1].map((side) => ({
    side,
    at: [at[0] * side, at[1], at[2]],
    tilt: 0.2,
    parts: fin(points, thickness, color, spar).map((g) => horizontalFin(g, side)),
  }));
}

function bigFish() {
  return buildFish({
    segs: [[1.5, 0.62, 0.66], [1.3, 0.66, 0.44], [1.05, 0.44, 0.24], [0.75, 0.24, 0.09]],
    gap: 0.13, sx: 0.68, sy: 1, nose: 0.85, noseR: 0.1, main: WHITE, belly: BELLY, accent: ORANGE, shadow: true, rivets: 12,
    decorate(i, parts, { len }) {
      if (i === 0) parts.push(...eyes(0.36, 0.2, 0.35, 0.13));
      if (i === 1) parts.push(...fin([[0, 0], [0.95, 0], [1.1, 0.9], [0.45, 0.72]], 0.05, WHITE).map((g) => g.translate(0, 0.6, -0.1)));
      if (i === 3) parts.push(...fin([[0, -0.1], [0, 0.1], [0.95, 1.05], [0.5, 0.05], [0.95, -1.05]], 0.05, ORANGE).map((g) => g.translate(0, 0, -len + 0.04)));
    },
    flaps: (i) => (i === 0 ? sidePair([[0, 0], [0.5, 0], [0.75, 0.75]], 0.04, ORANGE, [0.42, -0.25, -0.3]) : []),
  });
}

function giantFish() {
  return buildFish({
    segs: [[3.8, 2.65, 2.9], [3.5, 2.9, 2.1], [2.9, 2.1, 1.05], [2.1, 1.05, 0.42]],
    gap: 0.42, sx: 0.58, sy: 1, nose: 2.1, noseR: 0.45, main: GUN, belly: WHITE, accent: ORANGE, shadow: true, rivets: 22, detail: 28,
    decorate(i, parts, { len }) {
      if (i === 0) {
        parts.push(...eyes(1.25, 0.7, 0.9, 0.5));
        const lip = new THREE.TorusGeometry(0.72, 0.1, 8, 26).scale(1, 0.55, 1).translate(0, -0.35, 2.02);
        parts.push(tint(lip, ORANGE));
      }
      if (i === 1) parts.push(...fin([[-0.4, 0], [3, 0], [3.5, 2.3], [1.2, 2]], 0.16, GUN, ORANGE).map((g) => g.translate(0, 2.7, -0.1)));
      if (i === 2) parts.push(...fin([[0, 0], [2.2, 0], [2.4, 1.5], [0.9, 1.2]], 0.12, GUN, ORANGE).map((g) => g.rotateZ(Math.PI).translate(0, -1.6, -0.4)));
      if (i === 3) parts.push(...fin([[0, -0.35], [0, 0.35], [2.6, 2.7], [2.0, 0], [2.6, -2.7]], 0.14, GUN, ORANGE).map((g) => g.translate(0, 0, -len + 0.15)));
    },
    flaps: (i) => (i === 0 ? sidePair([[0, 0], [1.3, 0], [2.1, 1.7], [0.8, 1.5]], 0.1, ORANGE, [1.5, -0.7, -1.4]) : []),
  });
}

function shark() {
  return buildFish({
    segs: [[3.2, 1.15, 1.55], [3.1, 1.55, 1.2], [2.8, 1.2, 0.72], [2.4, 0.72, 0.34], [1.5, 0.34, 0.14]],
    gap: 0.24, sx: 0.82, sy: 0.92, nose: 2.5, noseR: 0.08, main: GUN, belly: WHITE, accent: RUST, shadow: true, rivets: 18, detail: 26,
    decorate(i, parts, { len }) {
      if (i === 0) {
        parts.push(...eyes(0.72, 0.28, 0.9, 0.17, 0xff2a10));
        // Gill slits and a jaw line of steel teeth
        for (let g = 0; g < 5; g++) {
          for (const side of [1, -1]) {
            const slit = new THREE.BoxGeometry(0.04, 0.72, 0.09).translate(side * 1.03, -0.05, -1 - g * 0.3);
            parts.push(tint(slit, BLACK));
          }
        }
        const jaw = new THREE.TorusGeometry(0.72, 0.045, 6, 26, Math.PI).rotateX(Math.PI / 2).rotateX(0.55).translate(0, -0.5, 0.65);
        parts.push(tint(jaw, BLACK));
        for (let t = 0; t < 13; t++) {
          const a = (t / 12) * Math.PI;
          const tooth = new THREE.ConeGeometry(0.05, 0.14, 4).rotateX(Math.PI).translate(Math.cos(a) * 0.72, -0.56 - Math.sin(a) * 0.32, 0.65 + Math.sin(a) * 0.62);
          parts.push(tint(tooth, WHITE));
        }
      }
      if (i === 1) parts.push(...fin([[-0.5, 0], [1.4, 0], [1.9, 2.4], [0.8, 2.1]], 0.1, GUN).map((g) => g.translate(0, 1.33, -0.6)));
      if (i === 3) parts.push(...fin([[0, 0], [0.8, 0], [1.15, 0.65]], 0.06, GUN).map((g) => g.translate(0, 0.62, -0.5)));
      if (i === 4) parts.push(...fin([[0, -0.1], [0, 0.2], [1.8, 3.2], [0.95, 0.15], [1.25, -1.5]], 0.09, GUN).map((g) => g.translate(0, 0, -len + 0.1)));
    },
    flaps: (i) => (i === 0 ? sidePair([[0, 0], [1.2, 0], [1.9, 2.3], [0.5, 1.3]], 0.08, GUN, [0.92, -0.72, -1.5]) : []),
  });
}

function whale() {
  return buildFish({
    segs: [[8, 4.4, 5.3], [8, 5.3, 4.5], [7, 4.5, 3], [6, 3, 1.5], [4.5, 1.5, 0.6]],
    gap: 0.75, sx: 1, sy: 0.84, nose: 5.4, noseR: 0.55, main: SLATE, belly: WHITE, accent: ORANGE, shadow: true, rivets: 34, detail: 36,
    decorate(i, parts, { len }) {
      if (i === 0) {
        parts.push(...eyes(4.1, -0.5, 1.2, 0.5));
        const blow = new THREE.CylinderGeometry(0.55, 0.75, 0.5, 18).translate(0, 4.15, -0.2);
        parts.push(tint(blow, BLACK));
        for (let g = 0; g < 9; g++) {
          const groove = new THREE.BoxGeometry(0.14, 0.08, 7.5).translate((g - 4) * 0.82, -4.32 + Math.abs(g - 4) * 0.2, -0.1);
          parts.push(tint(groove, BLACK));
        }
      }
      if (i === 2) parts.push(...fin([[0, 0], [2.2, 0], [2.9, 1.2], [1, 0.9]], 0.16, SLATE, ORANGE).map((g) => g.translate(0, 3.15, -2.4)));
      if (i === 4) {
        for (const side of [1, -1]) {
          parts.push(...fin([[0, 0], [1.3, 0], [3.2, 6.2], [1.2, 5.2]], 0.2, SLATE, ORANGE).map((g) => horizontalFin(g, side).translate(0, 0, -len + 0.3)));
        }
      }
    },
    flaps: (i) => (i === 0 ? sidePair([[0, 0], [2.1, 0], [3.9, 7.2], [1.0, 5.5]], 0.18, SLATE, [4.1, -2.3, -2.5], ORANGE) : []),
  });
}

function seahorse() {
  const root = new THREE.Group();
  const spec = [
    [0.34, 0.3], [0.42, 0.34], [0.46, 0.4], [0.42, 0.36], [0.36, 0.28], [0.3, 0.22], [0.28, 0.17], [0.25, 0.13], [0.22, 0.1], [0.2, 0.07],
  ];
  let parent = root;
  spec.forEach(([len, r], i) => {
    const pivot = new THREE.Group();
    pivot.userData.curl = i;
    pivot.position.y = i === 0 ? 0 : -spec[i - 1][0];
    parent.add(pivot);
    const parts = [];
    const seg = new THREE.CylinderGeometry(r, r * 0.86, len * 0.78, 12).translate(0, -len * 0.42, 0);
    parts.push(tint(seg, i % 2 ? WHITE : ORANGE));
    const ring = new THREE.TorusGeometry(r * 0.72, r * 0.16, 6, 14).rotateX(Math.PI / 2).translate(0, -len * 0.92, 0);
    parts.push(tint(ring, BLACK));
    if (i < 7) {
      const spine = new THREE.ConeGeometry(r * 0.2, r * 0.75, 5).rotateX(-Math.PI / 2).translate(0, -len * 0.4, -r * 1.1);
      parts.push(tint(spine, ORANGE));
    }
    if (i === 2) parts.push(tint(plate([[0, -0.16], [0.22, -0.13], [0.26, 0.13], [0, 0.16]], 0.025).rotateY(Math.PI / 2).translate(0, -0.2, -r * 0.9), ORANGE));
    const mesh = new THREE.Mesh(mergeGeometries(parts), BODY_MAT);
    pivot.add(mesh);
    parent = pivot;
  });
  const head = new THREE.Group();
  head.position.set(0, 0.04, 0.1);
  head.userData.headFlap = true;
  const parts = [
    tint(new THREE.SphereGeometry(0.34, 14, 10).scale(0.9, 1, 1.05), WHITE),
    tint(new THREE.CylinderGeometry(0.1, 0.13, 0.62, 10).rotateX(Math.PI / 2).translate(0, -0.08, 0.48), WHITE),
    tint(new THREE.TorusGeometry(0.1, 0.03, 6, 12).translate(0, -0.08, 0.79), ORANGE),
    tint(new THREE.CylinderGeometry(0.19, 0.25, 0.24, 8).translate(0, 0.36, -0.04), ORANGE),
    tint(new THREE.TorusGeometry(0.2, 0.04, 6, 14).rotateX(Math.PI / 2).translate(0, 0.5, -0.04), BLACK),
    ...eyes(0.27, 0.04, 0.08, 0.1),
  ];
  head.add(new THREE.Mesh(mergeGeometries(parts), BODY_MAT));
  root.add(head);
  return root;
}

function manta() {
  const root = new THREE.Group();
  const coreParts = [
    twoTone(new THREE.SphereGeometry(1.5, 28, 16).scale(1, 0.34, 1.9), BLACK, WHITE),
    tint(new THREE.TorusGeometry(1.32, 0.05, 8, 40).rotateX(Math.PI / 2).scale(1, 1, 1.5).translate(0, 0.33, 0), ORANGE),
    ...eyes(1.06, 0.1, 1.6, 0.2),
    tint(new THREE.CylinderGeometry(0.1, 0.03, 4.8, 8).rotateX(Math.PI / 2).translate(0, 0.05, -5), BLACK),
    tint(new THREE.CylinderGeometry(0.14, 0.14, 0.2, 10).rotateX(Math.PI / 2).translate(0, 0.05, -2.75), STEEL),
  ];
  for (const side of [1, -1]) {
    const lobe = new THREE.CapsuleGeometry(0.12, 0.8, 4, 8).rotateX(Math.PI / 2 - 0.2).translate(side * 0.85, 0, 3.05);
    coreParts.push(tint(lobe, ORANGE));
  }
  const core = new THREE.Mesh(mergeGeometries(coreParts), BODY_MAT);
  core.castShadow = true;
  root.add(core);
  for (const side of [1, -1]) {
    let parent = root;
    const sections = [
      [[0, 1.65], [2.25, 1.7], [2.2, 0.15], [2.1, -1.15], [0, -1.8]],
      [[0, 1.7], [2.05, 0.75], [1.65, -0.5], [0, -1.15]],
      [[0, 0.75], [1.5, -0.45], [0, -0.5]],
    ];
    let x = side * 1.22;
    sections.forEach((pts, i) => {
      const pivot = new THREE.Group();
      pivot.position.x = x;
      pivot.userData.wing = { side, i };
      parent.add(pivot);
      const shape = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a * side, b)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.1 - i * 0.02, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, 0.05, 0);
      const parts = [twoTone(geo, i === 1 ? GUN : BLACK, WHITE)];
      const hinge = new THREE.CylinderGeometry(0.075, 0.075, 2.4 - i * 0.65, 10).rotateX(Math.PI / 2).translate(0, 0, -0.05);
      parts.push(tint(hinge, STEEL));
      if (i < 2) {
        const stripe = new THREE.BoxGeometry(0.1, 0.13, 1.5 - i * 0.4).translate(side * 1.1, 0.03, 0);
        parts.push(tint(stripe, ORANGE));
      }
      const m = new THREE.Mesh(mergeGeometries(parts), BODY_MAT);
      m.castShadow = true;
      pivot.add(m);
      parent = pivot;
      x = side * (i === 0 ? 2.2 : 2);
    });
  }
  return root;
}

function turtle() {
  const root = new THREE.Group();
  const parts = [
    tint(new THREE.SphereGeometry(1.5, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1.22).translate(0, 0.02, 0), WHITE),
    tint(new THREE.CylinderGeometry(1.5, 1.32, 0.26, 28).scale(1, 1, 1.22).translate(0, -0.1, 0), BLACK),
  ];
  // Hexagonal shell plates
  const r = rng(11);
  for (let i = 0; i < 7; i++) {
    const a = (i / 6) * Math.PI * 2;
    const d = i === 6 ? 0 : 0.84;
    const x = Math.cos(a) * d, z = Math.sin(a) * d * 1.2;
    const y = Math.sqrt(Math.max(0.01, 1 - (x * x) / 2.25 - (z * z) / 3.35)) * 0.93 + 0.02;
    const hex = new THREE.CylinderGeometry(0.34, 0.38, 0.05, 6);
    hex.rotateZ(-x * 0.42).rotateX(z * 0.34).translate(x, y, z);
    parts.push(tint(hex, i === 6 || r() > 0.5 ? ORANGE : GUN));
  }
  const shell = new THREE.Mesh(mergeGeometries(parts), BODY_MAT);
  shell.castShadow = true;
  root.add(shell);
  const head = new THREE.Group();
  head.position.set(0, 0, 1.75);
  head.userData.headFlap = true;
  head.add(new THREE.Mesh(mergeGeometries([
    tint(new THREE.CylinderGeometry(0.28, 0.34, 0.45, 12).rotateX(Math.PI / 2).translate(0, 0, -0.2), RUBBER),
    tint(new THREE.SphereGeometry(0.4, 16, 12).scale(0.92, 0.8, 1.2).translate(0, 0.02, 0.26), WHITE),
    ...eyes(0.31, 0.14, 0.38, 0.1),
  ]), BODY_MAT));
  root.add(head);
  const flipper = (side, z, pts) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 1.22, -0.08, z);
    pivot.userData.flipper = { side, front: z > 0 };
    const geos = fin(pts, 0.08, GUN, ORANGE).map((g) => horizontalFin(g, side));
    pivot.add(new THREE.Mesh(mergeGeometries([...geos, tint(new THREE.SphereGeometry(0.2, 10, 8), STEEL)]), BODY_MAT));
    root.add(pivot);
  };
  for (const side of [1, -1]) {
    flipper(side, 0.82, [[-0.28, 0], [0.32, 0], [1.05, 1.95], [0.25, 1.75]]);
    flipper(side, -1.0, [[-0.2, 0], [0.28, 0], [0.55, 0.85], [-0.12, 0.8]]);
  }
  return root;
}

const JELLY_BELL = new THREE.MeshPhysicalMaterial({ color: 0xf8f4ee, roughness: 0.2, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false });
const JELLY_TIME = { value: 0 };
const JELLY_ARMS = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, transparent: true, opacity: 0.92 });
JELLY_ARMS.onBeforeCompile = (s) => {
  s.uniforms.uTime = JELLY_TIME;
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uTime;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      float jk = -position.y;
      transformed.x += sin(uTime * 1.6 + jk * 1.2 + position.z * 2.0) * jk * 0.09;
      transformed.z += cos(uTime * 1.3 + jk * 1.1 + position.x * 2.0) * jk * 0.09;`);
};

function jelly() {
  const root = new THREE.Group();
  const pts = [[0.001, 1.22], [0.46, 1.17], [0.86, 1.0], [1.14, 0.7], [1.28, 0.32], [1.3, 0], [1.2, -0.18]];
  const bellGeo = new THREE.LatheGeometry(pts.reverse().map(([a, b]) => new THREE.Vector2(a, b)), 28);
  const bell = new THREE.Group();
  bell.userData.bell = true;
  bell.add(new THREE.Mesh(bellGeo, JELLY_BELL));
  const frame = [
    tint(new THREE.TorusGeometry(1.26, 0.05, 8, 40).rotateX(Math.PI / 2).translate(0, -0.1, 0), ORANGE),
    tint(new THREE.TorusGeometry(0.45, 0.03, 6, 26).rotateX(Math.PI / 2).translate(0, 1.15, 0), BLACK),
    tint(new THREE.SphereGeometry(0.34, 16, 12).translate(0, 0.42, 0), BLACK),
    tint(new THREE.TorusGeometry(0.34, 0.035, 8, 26).rotateX(Math.PI / 2).translate(0, 0.42, 0), ORANGE),
    tint(new THREE.CylinderGeometry(0.08, 0.14, 0.5, 8).translate(0, 0.02, 0), STEEL),
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    // Each rib follows the inside of the bell, from the rim up to the crown.
    const rib = new THREE.TorusGeometry(1.24, 0.018, 5, 18, Math.PI / 2).scale(1, 0.96, 1).rotateY(-a).translate(0, -0.02, 0);
    frame.push(tint(rib, BLACK));
  }
  bell.add(new THREE.Mesh(mergeGeometries(frame), BODY_MAT));
  root.add(bell);
  const arms = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rad = i % 2 ? 0.45 : 1.02;
    const length = i % 2 ? 2.4 : 3.7;
    for (let k = 0; k < 7; k++) {
      const sLen = length / 7;
      const s = new THREE.CylinderGeometry(0.035 - k * 0.003, 0.04 - k * 0.003, sLen * 0.8, 5).translate(Math.cos(a) * rad, -0.15 - sLen * (k + 0.5), Math.sin(a) * rad);
      arms.push(tint(s, k % 2 ? WHITE : ORANGE));
    }
  }
  const tentacles = new THREE.Mesh(mergeGeometries(arms), JELLY_ARMS);
  tentacles.frustumCulled = false;
  root.add(tentacles);
  return root;
}

/** Collects the animated joints once; clones share geometry, so this is per instance. */
function rigOf(group) {
  const rig = { swim: [], flaps: [], curl: [], wings: [], flippers: [], head: null, bell: null };
  group.traverse((o) => {
    const u = o.userData;
    if (u.swim !== undefined) rig.swim.push(o);
    if (u.flap !== undefined) rig.flaps.push(o);
    if (u.curl !== undefined) rig.curl.push(o);
    if (u.wing) rig.wings.push(o);
    if (u.flipper) rig.flippers.push(o);
    if (u.headFlap) rig.head = o;
    if (u.bell) rig.bell = o;
  });
  rig.swim.sort((a, b) => a.userData.swim - b.userData.swim);
  rig.curl.sort((a, b) => a.userData.curl - b.userData.curl);
  return rig;
}

const SPECIES = {
  bigFish: { name: 'BIG FISH', build: bigFish, count: 5, cruise: 3.8, turn: 1.25, minY: 4, maxY: 15, wave: 0.28, tailRate: 2.1, personal: 9, size: 5 },
  giantFish: { name: 'GIANT FISH', build: giantFish, count: 2, cruise: 3.2, turn: 0.42, minY: 10, maxY: 26, wave: 0.14, tailRate: 0.62, personal: 16, size: 14, loud: true },
  shark: { name: 'BIG SHARK', build: shark, count: 2, cruise: 5.4, turn: 0.72, minY: 5, maxY: 18, wave: 0.2, tailRate: 0.9, personal: 11, size: 15, loud: true },
  whale: { name: 'WHALE', build: whale, count: 1, cruise: 4.2, turn: 0.13, minY: 26, maxY: 44, wave: 0.075, tailRate: 0.16, vertical: true, personal: 34, size: 40, far: true, loud: true },
  manta: { name: 'MANTA RAY', build: manta, count: 2, cruise: 3.4, turn: 0.5, minY: 4, maxY: 14, personal: 8, size: 10 },
  turtle: { name: 'TURTLE', build: turtle, count: 3, cruise: 1.5, turn: 0.55, minY: 2.5, maxY: 8, personal: 6, size: 4 },
  seahorse: { name: 'SEAHORSE', build: seahorse, count: 6, cruise: 0.55, turn: 0.9, minY: 3.2, maxY: 8, personal: 5, size: 3 },
  jelly: { name: 'JELLYFISH', build: jelly, count: 5, cruise: 0.35, turn: 0.3, minY: 7, maxY: 20, personal: 3, size: 4 },
};

const SCHOOL_BODY = { size: 2, minY: 4 };

const random = (a, b) => a + Math.random() * (b - a);

export class Fauna {
  constructor(scene, world, bubbles) {
    this.scene = scene;
    this.world = world;
    this.bubbles = bubbles;
    this.list = [];
    this.schools = [];
    this.freeze = false;
    this.radar = [];
    this.nearest = null;
    this.events = { whale: null, swoosh: null };

    for (const kind in SPECIES) {
      const sp = SPECIES[kind];
      const template = sp.build();
      for (let i = 0; i < sp.count; i++) {
        const group = i === 0 ? template : template.clone(true);
        group.rotation.order = 'YXZ';
        scene.add(group);
        this.list.push({
          kind, sp, group, rig: rigOf(group), x: 0, y: 0, z: 0,
          yaw: Math.random() * 6.28, pitch: 0, speed: sp.cruise, want: sp.cruise, phase: Math.random() * 6.28,
          tx: 0, tz: 0, ty: 10, timer: 0, mode: 'wander', avoidX: 0, avoidZ: 0, avoidIn: Math.random() * 0.3, orbit: Math.random() * 6.28, sign: Math.random() < 0.5 ? -1 : 1,
          blow: random(6, 18), turnAmt: 0,
        });
      }
    }
    this.buildSchools(scene);
  }

  buildSchools(scene) {
    const body = mergeGeometries([
      twoTone(hull(0.62, 0.2, 0.09, { sx: 0.55, nose: 0.28, noseR: 0.12, seg: 10 }), WHITE, BELLY),
      tint(band(0.17, -0.14, 0.08, 0.57, 1), BLACK),
      ...eyes(0.095, 0.05, 0.11, 0.04),
      ...fin([[0, 0], [0.34, 0], [0.42, 0.19]], 0.016, BLACK).map((g) => g.translate(0, 0.16, -0.08)),
    ]);
    const tail = mergeGeometries([
      tint(new THREE.SphereGeometry(0.035, 6, 5), STEEL),
      ...fin([[0, -0.03], [0, 0.03], [0.34, 0.25], [0.19, 0], [0.34, -0.25]], 0.016, ORANGE),
    ]);
    const FISH = 34, SCHOOLS = 4, total = FISH * SCHOOLS;
    const inst = (geo) => {
      const m = new THREE.InstancedMesh(geo, BODY_MAT, total);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.fishBody = inst(body);
    this.fishTail = inst(tail);
    const palette = [0xffffff, 0xffc2a6, 0xb9c6d1, 0xffffff];
    const c = new THREE.Color();
    for (let s = 0; s < SCHOOLS; s++) {
      const fish = [];
      for (let f = 0; f < FISH; f++) {
        const a = Math.random() * 6.28, r = Math.pow(Math.random(), 0.6) * 5.2;
        fish.push({
          ox: Math.cos(a) * r, oy: (Math.random() - 0.5) * 3.6, oz: Math.sin(a) * r - Math.random() * 3,
          phase: Math.random() * 6.28, rate: 8 + Math.random() * 7, scale: 0.75 + Math.random() * 0.7, x: 0, y: 0, z: 0, yaw: 0,
        });
        c.set(palette[s]);
        const id = s * FISH + f;
        this.fishBody.setColorAt(id, c);
        this.fishTail.setColorAt(id, c);
      }
      this.schools.push({
        fish, x: 0, y: 0, z: 0, yaw: Math.random() * 6.28, speed: 3.4, tx: 0, tz: 0, ty: 8, timer: 0, scatter: 0, placed: false,
        avoidX: 0, avoidZ: 0, avoidIn: Math.random() * 0.3, base: s * FISH, flee: 0, sp: { minY: 4, maxY: 16, cruise: 3.4, personal: 0 },
      });
    }
    this.fishBody.instanceColor.needsUpdate = true;
    this.fishTail.instanceColor.needsUpdate = true;
    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  /** Lower tiers park some animals. A parked one respawns normally if the tier comes back up. */
  setDensity(fraction, schools) {
    const seen = {};
    for (const c of this.list) {
      seen[c.kind] = (seen[c.kind] || 0) + 1;
      c.active = seen[c.kind] <= Math.ceil(c.sp.count * fraction);
      if (!c.active) c.group.visible = false;
    }
    this.schoolCount = schools;
    // Schools fill the instance buffer in order, so a shorter count drops whole schools.
    const fish = schools * this.schools[0].fish.length;
    this.fishBody.count = fish;
    this.fishTail.count = fish;
  }

  /** Puts everything around the start so the sea feels alive from the first second. */
  populate(s) {
    for (const c of this.list) {
      const near = c.sp.far ? random(85, 120) : random(32, 112);
      this.spawn(c, s, near, Math.random() * 6.28);
    }
    this.schools.forEach((sc, i) => {
      const a = (i / this.schools.length) * 6.28 + 0.5;
      sc.x = s.pos.x + Math.sin(a) * random(26, 60);
      sc.z = s.pos.z + Math.cos(a) * random(26, 60);
      sc.y = heightAt(sc.x, sc.z) + 8;
      sc.placed = false;
    });
  }

  spawn(c, s, dist, angle) {
    c.x = s.pos.x + Math.sin(angle) * dist;
    c.z = s.pos.z + Math.cos(angle) * dist;
    c.y = heightAt(c.x, c.z) + random(c.sp.minY, c.sp.maxY);
    c.yaw = Math.atan2(s.pos.x - c.x, s.pos.z - c.z) + random(-1, 1);
    c.timer = 0;
    c.mode = 'wander';
  }

  pickWander(c, s, reach) {
    const a = Math.random() * 6.28;
    const d = random(reach * 0.35, reach);
    // Wander around the player, so the world around them stays populated.
    c.tx = s.pos.x + Math.sin(a) * d;
    c.tz = s.pos.z + Math.cos(a) * d;
    c.ty = random(c.sp.minY, c.sp.maxY);
  }

  brain(c, s, dist, dt) {
    const sp = c.sp;
    c.timer -= dt;
    const close = Math.hypot(c.tx - c.x, c.tz - c.z) < sp.size * 0.8 + 3;
    const moving = Math.abs(s.speed) > 2 || s.jet > 0.3;
    switch (c.kind) {
      case 'shark':
        if (c.mode === 'wander') {
          c.want = sp.cruise;
          if (c.timer <= 0 || close) {
            if (dist < 90 && Math.random() < 0.55) {
              c.mode = 'circle';
              c.timer = random(10, 18);
              c.orbit = Math.atan2(c.x - s.pos.x, c.z - s.pos.z);
            } else {
              this.pickWander(c, s, 95);
              c.timer = random(8, 16);
            }
          }
        } else if (c.mode === 'circle') {
          c.orbit += c.sign * dt * 0.21;
          c.tx = s.pos.x + Math.sin(c.orbit) * 27;
          c.tz = s.pos.z + Math.cos(c.orbit) * 27;
          c.ty = sp.minY + 3;
          c.want = sp.cruise * 1.05;
          if (c.timer <= 0) {
            c.mode = 'dash';
            c.timer = 5;
            const side = c.sign * 16;
            const hx = Math.cos(c.yaw), hz = -Math.sin(c.yaw);
            c.tx = s.pos.x + hx * side - Math.sin(c.yaw) * -40;
            c.tz = s.pos.z + hz * side - Math.cos(c.yaw) * -40;
          }
        } else {
          c.want = sp.cruise * 2.5;
          if (c.timer <= 0) {
            c.mode = 'wander';
            c.timer = 0;
          }
        }
        break;
      case 'whale':
        c.orbit += c.sign * dt * 0.022;
        c.tx = s.pos.x + Math.sin(c.orbit) * 92;
        c.tz = s.pos.z + Math.cos(c.orbit) * 92;
        c.ty = (sp.minY + sp.maxY) * 0.55;
        c.want = sp.cruise;
        c.blow -= dt;
        if (c.blow <= 0) {
          c.blow = random(9, 20);
          const y = c.y + 4.3, sn = Math.sin(c.yaw), cs = Math.cos(c.yaw);
          this.bubbles.burst(c.x + sn * 1, y, c.z + cs * 1, 42, 1.3, 0.3);
          if (dist < 165) this.events.whale = c;
        }
        break;
      case 'bigFish':
        if (dist < 15 && moving) {
          c.mode = 'flee';
          c.timer = random(1.4, 2.6);
          c.tx = c.x + (c.x - s.pos.x) * 4;
          c.tz = c.z + (c.z - s.pos.z) * 4;
        }
        if (c.mode === 'flee') {
          c.want = sp.cruise * 2.6;
          if (c.timer <= 0) c.mode = 'wander';
        } else {
          c.want = sp.cruise;
          if (c.timer <= 0 || close) {
            this.pickWander(c, s, 70);
            c.timer = random(6, 13);
          }
        }
        break;
      case 'turtle':
        if (c.mode === 'rest') {
          c.want = 0.2;
          if (c.timer <= 0) {
            c.mode = 'wander';
            c.timer = 0;
          }
        } else {
          c.want = sp.cruise;
          if (c.timer <= 0 || close) {
            if (Math.random() < 0.3) {
              c.mode = 'rest';
              c.timer = random(4, 9);
            } else {
              this.pickWander(c, s, 62);
              c.timer = random(10, 20);
            }
          }
        }
        break;
      case 'seahorse':
        c.want = sp.cruise;
        if (c.timer <= 0 || close) {
          c.tx = c.x + random(-11, 11);
          c.tz = c.z + random(-11, 11);
          c.ty = random(sp.minY, sp.maxY);
          c.timer = random(5, 13);
          if (Math.hypot(c.x - s.pos.x, c.z - s.pos.z) > 85) this.pickWander(c, s, 60);
        }
        break;
      case 'jelly':
        c.want = sp.cruise;
        if (c.timer <= 0) {
          this.pickWander(c, s, 72);
          c.timer = random(12, 26);
        }
        break;
      default:
        c.want = sp.cruise;
        if (c.timer <= 0 || close) {
          this.pickWander(c, s, c.kind === 'giantFish' ? 105 : 85);
          c.timer = random(10, 20);
        }
    }
  }

  avoid(c, dt, s) {
    c.avoidIn -= dt;
    if (c.avoidIn > 0) return;
    c.avoidIn = 0.28;
    let ax = 0, az = 0;
    const heightOver = c.y - heightAt(c.x, c.z);
    if (heightOver < 24) {
      for (const o of this.world.collidersNear(c.x, c.z, 28)) {
        const dx = c.x - o.x, dz = c.z - o.z;
        const d = Math.hypot(dx, dz) || 1;
        const range = o.r + 9 + c.sp.size * 0.35;
        if (d < range) {
          const f = (range - d) / range;
          ax += (dx / d) * f;
          az += (dz / d) * f;
        }
      }
    }
    const dx = c.x - s.pos.x, dz = c.z - s.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < c.sp.personal + 7) {
      const f = (c.sp.personal + 7 - d) / (c.sp.personal + 7);
      ax += (dx / d) * f * 1.8;
      az += (dz / d) * f * 1.8;
    }
    c.avoidX = ax;
    c.avoidZ = az;
  }

  steer(c, dt, s) {
    this.avoid(c, dt, s);
    let dx = c.tx - c.x, dz = c.tz - c.z;
    const d = Math.hypot(dx, dz) || 1;
    dx = dx / d + c.avoidX * 2.6;
    dz = dz / d + c.avoidZ * 2.6;
    const desired = Math.atan2(dx, dz);
    const before = c.yaw;
    const delta = wrapAngle(desired - c.yaw);
    c.yaw += clamp(delta, -1, 1) * c.sp.turn * dt * (1.6 + Math.min(c.speed, 4) * 0.12);
    c.turnAmt = damp(c.turnAmt, wrapAngle(c.yaw - before) / Math.max(dt, 1e-3), 3, dt);
    c.speed = damp(c.speed, c.want, 1.3, dt);
    c.x += Math.sin(c.yaw) * c.speed * dt;
    c.z += Math.cos(c.yaw) * c.speed * dt;
    // Look ahead over the terrain, so big bodies climb before they reach a hill.
    const lookAhead = c.sp.size * 0.6 + c.speed * 2;
    const ground = Math.max(heightAt(c.x, c.z), heightAt(c.x + Math.sin(c.yaw) * lookAhead, c.z + Math.cos(c.yaw) * lookAhead));
    const wantY = ground + clamp(c.ty, c.sp.minY, c.sp.maxY);
    const before2 = c.y;
    c.y = damp(c.y, wantY, 0.75, dt);
    c.y = Math.max(c.y, ground + c.sp.minY * 0.6);
    const climb = (c.y - before2) / Math.max(dt, 1e-3);
    c.pitch = dampAngle(c.pitch, clamp(Math.atan2(climb, Math.max(c.speed, 0.6)), -0.5, 0.5), 2, dt);
    this.keepClear(c, s);
  }

  /** Steering alone can lose to a fast dash, so this is the hard limit that stops any overlap. */
  keepClear(c, s) {
    const limit = ROBOT_REACH + c.sp.size * 0.5;
    const dx = c.x - s.pos.x, dy = c.y - s.pos.y, dz = c.z - s.pos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d >= limit) return;
    const k = d > 1e-3 ? limit / d : 1;
    c.x = s.pos.x + (d > 1e-3 ? dx * k : limit);
    c.z = s.pos.z + dz * k;
    // Over the robot rather than into the ground: the hull only ever gets pushed upward.
    c.y = Math.max(s.pos.y + dy * k, heightAt(c.x, c.z) + c.sp.minY * 0.6);
  }

  animate(c, dt, t) {
    const { rig, sp, group } = c;
    group.position.set(c.x, c.y, c.z);
    group.rotation.set(-c.pitch, c.yaw, clamp(-c.turnAmt * 0.45, -0.35, 0.35));
    c.phase += dt * (sp.tailRate ? sp.tailRate * (1 + c.speed * 0.42) * 2.2 : 1 + c.speed * 0.8);
    if (rig.swim.length) {
      const n = rig.swim.length;
      const bendTurn = clamp(-c.turnAmt * 0.32, -0.16, 0.16);
      rig.swim.forEach((p, i) => {
        const u = i / Math.max(n - 1, 1);
        const a = sp.wave * (0.15 + u * u * 1.7) * Math.sin(c.phase - i * 0.95);
        if (sp.vertical) {
          p.rotation.x = a;
          p.rotation.y = i ? bendTurn * 0.4 : 0;
        } else {
          p.rotation.y = i ? a + bendTurn : a * 0.3;
        }
      });
    }
    for (const f of rig.flaps) {
      const side = f.userData.flap;
      f.rotation.z = side * (f.userData.base + Math.sin(c.phase * 0.42 + side) * 0.14 + clamp(c.turnAmt * side, -0.3, 0.3));
    }
    for (const w of rig.wings) {
      const { side, i } = w.userData.wing;
      w.rotation.z = side * Math.sin(c.phase - i * 0.75) * (0.14 + i * 0.13);
    }
    for (const f of rig.flippers) {
      const { side, front } = f.userData.flipper;
      f.rotation.z = side * (front ? Math.sin(c.phase * 0.9) * 0.45 : Math.sin(c.phase * 0.9 + 1.5) * 0.2);
      f.rotation.y = side * (front ? 0.5 + Math.cos(c.phase * 0.9) * 0.5 : 0.2);
    }
    if (c.kind === 'seahorse') {
      // The tail stays coiled and breathes slowly; the dorsal segment flutters.
      rig.curl.forEach((p, i) => {
        const base = i < 3 ? -0.09 + i * 0.09 : 0.2 + (i - 3) * 0.17;
        p.rotation.x = -(base + Math.sin(t * 1.1 + c.phase * 0.1 + i * 0.5) * 0.045 * i);
      });
      group.rotation.x = -c.pitch * 0.4 + Math.sin(t * 1.3 + c.phase) * 0.05;
      group.position.y += Math.sin(t * 1.1 + c.orbit) * 0.15;
      if (rig.head) rig.head.rotation.x = Math.sin(t * 0.7 + c.orbit) * 0.1 + 0.08;
    }
    if (c.kind === 'turtle' && rig.head) rig.head.rotation.y = Math.sin(t * 0.5 + c.orbit) * 0.3;
    if (c.kind === 'jelly') {
      const pulse = Math.sin(t * 1.5 + c.orbit);
      rig.bell.scale.set(1 + pulse * 0.14, 1 - pulse * 0.17, 1 + pulse * 0.14);
      group.rotation.set(Math.sin(t * 0.3 + c.orbit) * 0.12, c.yaw * 0.2, Math.cos(t * 0.26 + c.orbit) * 0.12);
      c.y += Math.max(pulse, 0) * dt * 0.75 - dt * 0.2;
    }
  }

  updateSchool(sc, dt, t, s) {
    if (!sc.placed) sc.placed = true;
    const dist = Math.hypot(sc.x - s.pos.x, sc.z - s.pos.z);
    if (dist > DESPAWN) {
      const a = s.yaw + random(-1.3, 1.3), d = random(SPAWN_MIN, SPAWN_MAX);
      sc.x = s.pos.x + Math.sin(a) * d;
      sc.z = s.pos.z + Math.cos(a) * d;
      sc.y = heightAt(sc.x, sc.z) + 8;
      sc.timer = 0;
      for (const f of sc.fish) f.x = sc.x;
    }
    sc.timer -= dt;
    const predator = this.list.find((c) => c.kind === 'shark' && c.active !== false && Math.hypot(c.x - sc.x, c.z - sc.z) < 26);
    const moving = Math.abs(s.speed) > 1.6 || s.jet > 0.2;
    const threat = predator || (dist < 19 && moving ? { x: s.pos.x, z: s.pos.z } : null);
    if (threat) {
      sc.flee = 2;
      sc.tx = sc.x + (sc.x - threat.x) * 3;
      sc.tz = sc.z + (sc.z - threat.z) * 3;
      sc.timer = 1;
    } else if (sc.timer <= 0) {
      this.pickWander(sc, s, 62);
      sc.timer = random(6, 13);
    }
    sc.flee = Math.max(0, sc.flee - dt);
    const fleeing = sc.flee > 0;
    sc.scatter = damp(sc.scatter, fleeing ? 1 : 0, fleeing ? 7 : 0.9, dt);
    sc.speed = damp(sc.speed, fleeing ? 11 : sc.sp.cruise, fleeing ? 6 : 1.2, dt);
    this.avoid(sc, dt, s);
    const dx = sc.tx - sc.x + sc.avoidX * 30, dz = sc.tz - sc.z + sc.avoidZ * 30;
    const desired = Math.atan2(dx, dz);
    sc.yaw += clamp(wrapAngle(desired - sc.yaw), -1, 1) * (fleeing ? 3.4 : 1.25) * dt;
    sc.x += Math.sin(sc.yaw) * sc.speed * dt;
    sc.z += Math.cos(sc.yaw) * sc.speed * dt;
    const ground = heightAt(sc.x, sc.z);
    sc.y = damp(sc.y, ground + clamp(sc.ty, sc.sp.minY, sc.sp.maxY), 0.9, dt);
    sc.y = Math.max(sc.y, ground + 2.5);
    this.keepClear({ get x() { return sc.x; }, set x(v) { sc.x = v; }, get y() { return sc.y; }, set y(v) { sc.y = v; }, get z() { return sc.z; }, set z(v) { sc.z = v; }, sp: SCHOOL_BODY }, s);

    const { _m: m, _m2: m2, _q: q, _e: e, _p: p, _s: sv } = this;
    const sn = Math.sin(sc.yaw), cs = Math.cos(sc.yaw);
    const spread = 1 + sc.scatter * 1.9;
    sc.fish.forEach((f, i) => {
      const ox = f.ox * spread + Math.sin(t * 0.7 + f.phase) * 0.7;
      const oz = f.oz * spread + Math.cos(t * 0.6 + f.phase) * 0.7;
      const oy = f.oy * spread + Math.sin(t * 0.9 + f.phase) * 0.35;
      const wx = sc.x + ox * cs + oz * sn, wz = sc.z - ox * sn + oz * cs;
      const wy = Math.max(sc.y + oy, heightAt(wx, wz) + 0.8);
      if (f.x === 0 && f.y === 0) {
        f.x = wx; f.y = wy; f.z = wz; f.yaw = sc.yaw;
      }
      const ddx = wx - f.x, ddz = wz - f.z;
      f.x += ddx * Math.min(1, dt * 5);
      f.y += (wy - f.y) * Math.min(1, dt * 4);
      f.z += ddz * Math.min(1, dt * 5);
      if (ddx * ddx + ddz * ddz > 0.004) f.yaw = dampAngle(f.yaw, Math.atan2(ddx, ddz), 8, dt);
      const beat = t * f.rate * (1 + sc.scatter) + f.phase;
      e.set(0, f.yaw + Math.sin(beat) * 0.1, 0);
      q.setFromEuler(e);
      m.compose(p.set(f.x, f.y, f.z), q, sv.setScalar(f.scale));
      this.fishBody.setMatrixAt(sc.base + i, m);
      m2.makeRotationY(Math.sin(beat - 0.9) * 0.6);
      m2.setPosition(0, 0, -0.62);
      m.multiply(m2);
      this.fishTail.setMatrixAt(sc.base + i, m);
    });
  }

  update(dt, t, s) {
    JELLY_TIME.value = t;
    this.events.whale = null;
    this.events.swoosh = null;
    this.radar.length = 0;
    let nearest = null;
    let nearestD = Infinity;
    for (const c of this.list) {
      if (c.active === false) continue;
      let dist = Math.hypot(c.x - s.pos.x, c.z - s.pos.z);
      if (!this.freeze) {
        if (dist > DESPAWN + c.sp.size) {
          const a = s.yaw + random(-1.5, 1.5);
          this.spawn(c, s, random(SPAWN_MIN, SPAWN_MAX) + c.sp.size * 0.4, a);
          dist = Math.hypot(c.x - s.pos.x, c.z - s.pos.z);
        }
        this.brain(c, s, dist, dt);
        this.steer(c, dt, s);
      }
      c.group.visible = dist < DESPAWN + c.sp.size;
      if (c.group.visible) this.animate(c, dt, t);
      if (!this.freeze && c.kind !== 'whale' && Math.random() < dt * (c.sp.size > 10 ? 0.5 : 0.1) && dist < 95) {
        this.bubbles.emit(c.x + Math.sin(c.yaw) * c.sp.size * 0.2, c.y + c.sp.size * 0.03, c.z + Math.cos(c.yaw) * c.sp.size * 0.2, 0.08 + c.sp.size * 0.006);
      }
      if (c.sp.loud && dist < 28 + c.sp.size && c.speed > 3) this.events.swoosh = c;
      const surface = Math.max(0, dist - c.sp.size * 0.5);
      if (surface < nearestD) {
        nearestD = surface;
        nearest = c;
      }
      if (dist < 75) this.radar.push(c);
    }
    for (let i = 0; i < this.schoolCount; i++) {
      const sc = this.schools[i];
      if (!this.freeze) this.updateSchool(sc, dt, t, s);
      const d = Math.hypot(sc.x - s.pos.x, sc.z - s.pos.z);
      if (d < nearestD) {
        nearestD = d;
        nearest = { sp: { name: 'FISH SCHOOL' } };
      }
    }
    this.fishBody.instanceMatrix.needsUpdate = true;
    this.fishTail.instanceMatrix.needsUpdate = true;
    this.nearest = nearest ? { name: nearest.sp.name, dist: nearestD } : null;
  }
}
