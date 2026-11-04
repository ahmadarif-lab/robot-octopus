import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, lerp, rng } from './util.js';
import { heightAt } from './world.js';

const WHITE = 0xf5f2eb, BLACK = 0x16161b, ORANGE = 0xff5a1f, RED = 0xb42c14, STEEL = 0x77777e;
const R = 2.1;
const SEAM_Y = 1.0;
const ARMS = 8;
const LINKS = 26;
const ARM_LEN = 14.5;
const HOME_R = 6.6;
const STEP_DIST = 2.3;
const SAMPLES = 44;

const v3 = () => new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/* Painted once: panel seams, plates, stencils. The bump map carries the same seams. */
function mantleTextures() {
  const W = 2048, H = 1024;
  const map = document.createElement('canvas');
  const bump = document.createElement('canvas');
  map.width = bump.width = W;
  map.height = bump.height = H;
  const a = map.getContext('2d'), b = bump.getContext('2d');
  a.fillStyle = '#f5f2eb'; a.fillRect(0, 0, W, H);
  b.fillStyle = '#b0b0b0'; b.fillRect(0, 0, W, H);

  const plate = (u, v, w, h, color, raise = 200) => {
    a.fillStyle = color;
    a.fillRect(u * W, v * H, w * W, h * H);
    b.fillStyle = `rgb(${raise},${raise},${raise})`;
    b.fillRect(u * W, v * H, w * W, h * H);
  };
  const r = rng(5);
  // Black service plates
  plate(0.19, 0.17, 0.05, 0.12, '#16161b');
  plate(0.27, 0.2, 0.035, 0.08, '#16161b');
  plate(0.68, 0.22, 0.09, 0.09, '#16161b');
  plate(0.44, 0.27, 0.05, 0.07, '#16161b');
  plate(0.92, 0.22, 0.055, 0.1, '#16161b');
  plate(0.05, 0.28, 0.04, 0.07, '#16161b');
  // Orange flags
  plate(0.245, 0.115, 0.012, 0.25, '#ff5a1f');
  plate(0.19, 0.3, 0.12, 0.012, '#ff5a1f');
  plate(0.73, 0.14, 0.012, 0.22, '#ff5a1f');
  plate(0.5, 0.17, 0.03, 0.014, '#ff5a1f');
  plate(0.02, 0.17, 0.03, 0.014, '#ff5a1f');
  plate(0.56, 0.42, 0.05, 0.03, '#ff5a1f');
  // Small hatches
  for (let i = 0; i < 26; i++) {
    plate(r(), 0.1 + r() * 0.5, 0.008 + r() * 0.018, 0.012 + r() * 0.02, r() > 0.75 ? '#ff5a1f' : '#2a2a30', 180);
  }
  // Seams
  a.strokeStyle = 'rgba(25,25,30,.85)';
  b.strokeStyle = '#000';
  a.lineWidth = b.lineWidth = 3;
  const line = (x0, y0, x1, y1) => {
    for (const c of [a, b]) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
  };
  for (let i = 0; i < 16; i++) { const x = (i / 16) * W; line(x, 0.06 * H, x, 0.72 * H); }
  for (const v of [0.08, 0.16, 0.33, 0.47, 0.6, 0.7]) line(0, v * H, W, v * H);
  // Stencils
  a.fillStyle = '#16161b';
  a.font = '700 34px Helvetica, Arial, sans-serif';
  a.fillText('OC-8', 0.335 * W, 0.45 * H);
  a.fillText('OC-8', 0.62 * W, 0.56 * H);
  a.font = '500 15px Menlo, monospace';
  a.fillText('OCTOBOT MARINE ROBOTICS', 0.56 * W, 0.59 * H);
  a.fillText('HIGH PRESSURE / 12 BAR', 0.33 * W, 0.47 * H);
  a.fillStyle = '#ff5a1f';
  a.fillText('DO NOT STEP', 0.82 * W, 0.45 * H);

  const tMap = new THREE.CanvasTexture(map);
  tMap.colorSpace = THREE.SRGBColorSpace;
  tMap.anisotropy = 8;
  tMap.wrapS = THREE.RepeatWrapping;
  const tBump = new THREE.CanvasTexture(bump);
  tBump.wrapS = THREE.RepeatWrapping;
  return { tMap, tBump };
}

function shellPart(thetaStart, thetaLen) {
  const g = new THREE.SphereGeometry(R, 96, 40, 0, Math.PI * 2, thetaStart, thetaLen);
  // SphereGeometry stretches the texture over a partial sphere; restore full-sphere V.
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setY(i, 1 - Math.acos(clamp(p.getY(i) / R, -1, 1)) / Math.PI);
  return g;
}

function rivets(parent, thetaFrom, thetaTo, mat) {
  const list = [];
  const r = R + 0.005;
  const add = (phi, theta) => {
    if (theta < thetaFrom || theta > thetaTo) return;
    list.push(new THREE.Vector3(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta)));
  };
  for (const v of [0.16, 0.33, 0.47, 0.6]) {
    for (let i = 0; i < 96; i++) add((i / 96) * Math.PI * 2, v * Math.PI);
  }
  for (let m = 0; m < 16; m++) {
    for (let j = 0; j < 22; j++) add((m / 16) * Math.PI * 2 + 0.018, (0.08 + (j / 22) * 0.62) * Math.PI);
  }
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.024, 6, 4), mat, list.length);
  const m = new THREE.Matrix4();
  list.forEach((p, i) => mesh.setMatrixAt(i, m.setPosition(p)));
  mesh.castShadow = false;
  parent.add(mesh);
  return mesh;
}

function makeEye(radius, mats) {
  const g = new THREE.Group();
  const mesh = (geo, mat, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.z = z;
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const cyl = (r0, r1, h) => new THREE.CylinderGeometry(r0, r1, h, 48).rotateX(Math.PI / 2);
  mesh(cyl(radius * 1.12, radius * 1.22, 0.3), mats.black, 0);
  mesh(new THREE.TorusGeometry(radius * 1.02, radius * 0.1, 16, 64), mats.orange, 0.16);
  mesh(cyl(radius * 0.92, radius * 0.95, 0.24), mats.black, 0.2);
  // The barrel unscrews separately from its housing.
  const barrel = new THREE.Group();
  g.add(barrel);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.72, 40, 24).scale(1, 1, 0.45), mats.glass);
  lens.position.z = 0.32;
  barrel.add(lens);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.76, radius * 0.05, 12, 64), mats.steel);
  ring.position.z = 0.3;
  barrel.add(ring);
  const iris = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.3, radius * 0.045, 10, 48), mats.glow);
  iris.position.z = 0.62;
  barrel.add(iris);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.03, radius * 0.1, 0.05), mats.steel);
    b.position.set(Math.cos(a) * radius * 0.84, Math.sin(a) * radius * 0.84, 0.34);
    b.rotation.z = a - Math.PI / 2;
    barrel.add(b);
  }
  // Threaded shaft, hidden inside the hull until the lens unscrews.
  const threadPts = [];
  for (let i = 0; i <= 28; i++) {
    threadPts.push(new THREE.Vector2(radius * (i % 2 ? 0.56 : 0.5), -1.05 + (i / 28) * 1.35));
  }
  const shaft = new THREE.Mesh(new THREE.LatheGeometry(threadPts, 28), mats.steel);
  shaft.rotation.x = Math.PI / 2;
  barrel.add(shaft);
  g.userData.barrel = barrel;
  return g;
}

function linkGeometries() {
  const lathe = (pts) => new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), 28).rotateX(Math.PI / 2);
  const body = () => tint(lathe([[0.5, -0.3], [0.6, -0.285], [0.63, -0.24], [0.63, 0.24], [0.6, 0.285], [0.5, 0.3]]), WHITE);
  // End plates close the hollow shell, so the gap shows a machined face and not its inside.
  const endPlates = () => [
    tint(lathe([[0.001, -0.3], [0.5, -0.3]]), STEEL),
    tint(lathe([[0.5, 0.3], [0.001, 0.3]]), STEEL),
  ];
  // Lugs that the hydraulic rods visibly attach to.
  const lugs = () => {
    const out = [];
    for (const x of [-0.39, 0.39]) {
      for (const z of [-0.2, 0.2]) {
        out.push(tint(new THREE.BoxGeometry(0.1, 0.08, 0.14).translate(x, 0.54, z), BLACK));
      }
    }
    return out;
  };
  const rivetSet = (zs) => {
    const out = [];
    for (const z of zs) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        // Eight faces are plenty at this size, and there are thousands of these on screen.
        const s = new THREE.OctahedronGeometry(0.026);
        s.translate(Math.cos(a) * 0.635, Math.sin(a) * 0.635, z);
        out.push(tint(s, BLACK));
      }
    }
    return out;
  };
  const a = mergeGeometries([body(), ...endPlates(), ...lugs(), ...rivetSet([-0.2, 0.2])]);

  const plate = new THREE.CylinderGeometry(0.64, 0.64, 0.42, 14, 1, true, Math.PI - 0.75, 1.5).rotateX(Math.PI / 2);
  const band = new THREE.CylinderGeometry(0.637, 0.637, 0.05, 28, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.14);
  const b = mergeGeometries([body(), ...endPlates(), ...lugs(), tint(plate, BLACK), tint(band, ORANGE), ...rivetSet([-0.21])]);

  // Clevis joint: a steel ball, an axle along the bend axis, and fork plates from both links.
  const forks = [];
  for (const x of [-0.27, 0.27]) {
    forks.push(tint(new THREE.BoxGeometry(0.06, 0.32, 0.4).translate(x, 0, 0), BLACK));
    forks.push(tint(new THREE.CylinderGeometry(0.095, 0.095, 0.075, 12).rotateZ(Math.PI / 2).translate(x * 1.16, 0, 0), ORANGE));
  }
  const joint = mergeGeometries([
    tint(new THREE.SphereGeometry(0.2, 14, 10), STEEL),
    tint(new THREE.CylinderGeometry(0.055, 0.055, 0.72, 10).rotateZ(Math.PI / 2), STEEL),
    tint(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 18).rotateX(Math.PI / 2).translate(0, 0, -0.13), BLACK),
    tint(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 18).rotateX(Math.PI / 2).translate(0, 0, 0.13), BLACK),
    ...forks,
  ]);
  // Unit-length parts along +Z, stretched each frame between two links.
  const rod = tint(new THREE.CylinderGeometry(0.03, 0.03, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5), STEEL);
  const housing = mergeGeometries([
    tint(new THREE.CylinderGeometry(0.058, 0.058, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5), BLACK),
    tint(new THREE.CylinderGeometry(0.066, 0.066, 0.12, 8).rotateX(Math.PI / 2).translate(0, 0, 0.92), ORANGE),
  ]);

  const tire = new THREE.CylinderGeometry(0.17, 0.17, 0.13, 20).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.08, 0.08, 0.15, 12).rotateZ(Math.PI / 2);
  const notch = new THREE.BoxGeometry(0.15, 0.05, 0.05).translate(0, 0.125, 0);
  const wheel = mergeGeometries([tint(tire, RED), tint(hub, ORANGE), tint(notch, BLACK)]);
  return { a, b, wheel, joint, rod, housing };
}

/* Link radius tapers along the arm; spacing follows radius, so links nest evenly. */
const RADII = Array.from({ length: LINKS }, (_, k) => lerp(1, 0.25, Math.pow(k / (LINKS - 1), 0.85)));
const RADII_SUM = RADII.reduce((s, x) => s + x, 0);
const LINK_U = (() => {
  let acc = 0;
  return RADII.map((r) => {
    const u = (acc + r / 2) / RADII_SUM;
    acc += r;
    return u;
  });
})();
const LINK_SCALE = ARM_LEN / RADII_SUM / 0.86;

export class Robot {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.root.scale.setScalar(1.22);
    scene.add(this.root);
    this.parts = { lens: 0, mantle: 0, pump: 0, explode: 0 };
    this.targets = { lens: 0, mantle: 0, pump: 0, explode: 0 };
    this.anchors = {};
    this.buildBody();
    this.buildArms(scene);
    this.particles = new Particles(scene);
    this.jetAcc = 0;
    this.bubbles = null;
    this.idleBubble = 2;
    this.prevExplode = 0;
  }

  buildBody() {
    const { tMap, tBump } = mantleTextures();
    const mats = {
      shell: new THREE.MeshPhysicalMaterial({ map: tMap, bumpMap: tBump, bumpScale: 1.1, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
      inner: new THREE.MeshStandardMaterial({ color: 0x24242a, roughness: 0.7, side: THREE.BackSide }),
      white: new THREE.MeshPhysicalMaterial({ color: WHITE, roughness: 0.36, clearcoat: 0.45 }),
      black: new THREE.MeshStandardMaterial({ color: BLACK, roughness: 0.5, metalness: 0.2 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x1e1e23, roughness: 0.85 }),
      orange: new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.42 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x9c9ca3, roughness: 0.28, metalness: 0.85 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x08080c, roughness: 0.04, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2 }),
      glow: new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff4a10, emissiveIntensity: 2.2 }),
      rivet: new THREE.MeshStandardMaterial({ color: 0x24242a, roughness: 0.5, metalness: 0.5 }),
    };
    this.mats = mats;
    const seamTheta = Math.acos(SEAM_Y / R);
    const bottomTheta = Math.acos(-1.32 / R);
    const shadow = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

    // Hinged at the side, so the opened cap never hides the pump from the front or chase camera.
    const pivot = new THREE.Vector3(R * Math.sin(seamTheta), SEAM_Y, 0);
    this.capHinge = new THREE.Group();
    this.capHinge.position.copy(pivot);
    this.root.add(this.capHinge);
    const cap = new THREE.Group();
    cap.position.copy(pivot).negate();
    this.capHinge.add(cap);
    const capGeo = shellPart(0, seamTheta);
    cap.add(shadow(new THREE.Mesh(capGeo, mats.shell)), new THREE.Mesh(capGeo, mats.inner));
    rivets(cap, 0, seamTheta, mats.rivet);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R * Math.sin(seamTheta), 0.055, 10, 96).rotateX(Math.PI / 2), mats.black);
    rim.position.y = SEAM_Y;
    cap.add(rim);
    const topHatch = new THREE.Group();
    const hatchDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.55, 0.14, 32), mats.black);
    const hatchRing = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.03, 8, 40).rotateX(Math.PI / 2), mats.orange);
    hatchRing.position.y = 0.08;
    topHatch.add(hatchDisc, hatchRing);
    topHatch.position.y = R + 0.01;
    cap.add(topHatch);
    this.topHatch = topHatch;

    const lower = new THREE.Group();
    this.root.add(lower);
    const lowerGeo = shellPart(seamTheta, bottomTheta - seamTheta);
    lower.add(shadow(new THREE.Mesh(lowerGeo, mats.shell)), new THREE.Mesh(lowerGeo, mats.inner));
    rivets(lower, seamTheta, bottomTheta, mats.rivet);
    const deck = new THREE.Mesh(new THREE.CircleGeometry(R * Math.sin(seamTheta) - 0.02, 64).rotateX(-Math.PI / 2), mats.rubber);
    deck.position.y = SEAM_Y - 0.14;
    lower.add(deck);
    const deckRing = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.04, 8, 64).rotateX(Math.PI / 2), mats.orange);
    deckRing.position.y = SEAM_Y - 0.1;
    lower.add(deckRing);

    // Hinge knuckles on the seam, and hydraulic struts that really extend as the cap lifts.
    const hingeParts = [];
    for (const z of [-0.8, 0, 0.8]) {
      hingeParts.push(new THREE.CylinderGeometry(0.1, 0.1, 0.42, 14).rotateX(Math.PI / 2).translate(pivot.x, SEAM_Y, z));
    }
    const hinge = new THREE.Mesh(mergeGeometries(hingeParts), mats.steel);
    hinge.castShadow = true;
    lower.add(hinge);
    const hingePin = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.1, 10).rotateX(Math.PI / 2).translate(pivot.x, SEAM_Y, 0), mats.black);
    lower.add(hingePin);
    this.struts = [-0.95, 0.95].map((z) => {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 10).rotateX(Math.PI / 2).translate(0, 0, 0.5), mats.steel);
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 12).rotateX(Math.PI / 2).translate(0, 0, 0.5), mats.black);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.02, 6, 16), mats.orange);
      collar.position.z = 0.75;
      housing.add(collar);
      this.root.add(rod, housing);
      return {
        rod, housing,
        base: new THREE.Vector3(0.75, SEAM_Y - 0.12, z),
        tip: new THREE.Vector3(-0.2, SEAM_Y + 0.75, z),
      };
    });
    cap.updateMatrix();
    this.capGroup = cap;

    // Pump: a tangled coil revealed when the mantle opens.
    this.pump = new THREE.Group();
    this.pump.position.y = SEAM_Y + 0.35;
    const coil = new THREE.Mesh(new THREE.TorusKnotGeometry(0.72, 0.08, 320, 10, 7, 11).rotateX(Math.PI / 2).scale(1, 0.7, 1), mats.rubber);
    coil.castShadow = true;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 1.05, 32), mats.steel);
    const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 10, 40).rotateX(Math.PI / 2), mats.orange);
    coreRing.position.y = 0.2;
    const coreGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 20), mats.glow);
    coreGlow.position.y = 0.54;
    this.pump.add(coil, core, coreRing, coreGlow);
    this.coil = coil;
    this.root.add(this.pump);
    // Telescoping column that carries the pump up out of the hull.
    this.pumpBase = SEAM_Y - 0.14;
    this.riser = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1, 16).translate(0, 0.5, 0), mats.steel);
    this.riser.position.y = this.pumpBase;
    this.riserSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.55, 18).translate(0, 0.27, 0), mats.black);
    this.riserSleeve.position.y = this.pumpBase;
    this.root.add(this.riser, this.riserSleeve);

    // Optics
    const eyeAt = (azimuth, elev, radius) => {
      const dir = new THREE.Vector3(Math.sin(azimuth) * Math.cos(elev), Math.sin(elev), Math.cos(azimuth) * Math.cos(elev));
      const eye = makeEye(radius, mats);
      eye.position.copy(dir).multiplyScalar(R - 0.05);
      eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      eye.userData.base = eye.position.clone();
      eye.userData.dir = dir;
      this.root.add(eye);
      return eye;
    };
    this.mainEye = eyeAt(0, -0.06, 0.82);
    this.sideEyes = [eyeAt(1.02, 0.02, 0.5), eyeAt(-1.02, 0.02, 0.5)];

    // Belly skirt and beak
    this.belly = new THREE.Group();
    this.root.add(this.belly);
    const skirt = new THREE.LatheGeometry(
      [[1.72, -1.2], [1.86, -1.36], [1.7, -1.72], [1.28, -2.04], [0.7, -2.2], [0, -2.24]].map(([r, y]) => new THREE.Vector2(r, y)), 64,
    );
    this.belly.add(shadow(new THREE.Mesh(skirt, mats.rubber)));
    this.beak = new THREE.Group();
    const beakRing = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.06, 10, 40).rotateX(Math.PI / 2), mats.orange);
    const beakBase = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.38, 0.26, 32), mats.steel);
    beakBase.position.y = -0.13;
    const beakTip = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.56, 24).rotateX(Math.PI), mats.black);
    beakTip.position.y = -0.52;
    this.beak.add(beakRing, beakBase, beakTip);
    this.beak.position.y = -2.2;
    this.belly.add(this.beak);

    // Siphon at the back; the jet actually fires from here.
    this.siphon = new THREE.Group();
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.9, 28).rotateX(Math.PI / 2), mats.black);
    const nozzle = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.07, 12, 40), mats.orange);
    nozzle.position.z = -0.46;
    const nozzleIn = new THREE.Mesh(new THREE.CircleGeometry(0.33, 28).rotateY(Math.PI), mats.glow);
    nozzleIn.position.z = -0.44;
    this.nozzleIn = nozzleIn;
    this.siphon.add(pipe, nozzle, nozzleIn);
    this.siphon.position.set(0, -0.7, -R + 0.05);
    this.siphon.rotation.x = 0.15;
    this.root.add(this.siphon);
    this.nozzleTip = new THREE.Object3D();
    this.nozzleTip.position.z = -0.6;
    this.siphon.add(this.nozzleTip);

    // Arm sockets
    this.sockets = [];
    for (let i = 0; i < ARMS; i++) {
      const a = ((i + 0.5) / ARMS) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(a), -0.22, Math.cos(a)).normalize();
      const s = new THREE.Group();
      s.position.set(Math.sin(a) * 1.5, -1.12, Math.cos(a) * 1.5);
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      s.userData.base = s.position.clone();
      s.userData.dir = dir;
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.8, 0.82, 32).rotateX(Math.PI / 2), mats.white);
      sleeve.position.z = 0.25;
      sleeve.castShadow = true;
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.73, 0.075, 10, 40), mats.black);
      collar.position.z = 0.66;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.73, 0.75, 0.05, 32, 1, true).rotateX(Math.PI / 2), mats.orange);
      stripe.position.z = 0.42;
      s.add(sleeve, collar, stripe);
      const anchor = new THREE.Object3D();
      anchor.position.z = 0.7;
      s.add(anchor);
      s.userData.anchor = anchor;
      this.root.add(s);
      this.sockets.push(s);
    }

    this.anchors = {
      lens: this.mainEye,
      mantle: topHatch,
      pump: this.pump,
      siphon: this.nozzleTip,
      beak: this.beak,
    };
  }

  buildArms(scene) {
    const geos = linkGeometries();
    const linkMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.36, clearcoat: 0.4, clearcoatRoughness: 0.35 });
    const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
    const count = ARMS * LINKS;
    const inst = (g, m, n) => {
      const mesh = new THREE.InstancedMesh(g, m, n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    };
    this.linksA = inst(geos.a, linkMat, Math.ceil(count / 2));
    this.linksB = inst(geos.b, linkMat, Math.floor(count / 2));
    this.wheels = inst(geos.wheel, wheelMat, count * 2);
    this.wheelCount = count * 2;
    this.linkCount = count;
    this.joints = inst(geos.joint, wheelMat, ARMS * LINKS);
    this.joints.castShadow = false;
    const pistons = ARMS * (LINKS - 1) * 2;
    this.rods = inst(geos.rod, wheelMat, pistons);
    this.housings = inst(geos.housing, wheelMat, pistons);
    this.rods.castShadow = this.housings.castShadow = false;

    const r = rng(31);
    this.arms = Array.from({ length: ARMS }, (_, i) => ({
      i,
      angle: ((i + 0.5) / ARMS) * Math.PI * 2,
      foot: v3(), from: v3(), to: v3(),
      t: 1, duration: 0.4, stepping: false, placed: false,
      spin: 0, curl: 0,
      px: new Float32Array(SAMPLES * 2 * 3),
      seg: new Float32Array(SAMPLES * 2),
      samples: Array.from({ length: LINKS }, v3),
      shatter: Array.from({ length: LINKS }, () => new THREE.Vector3(r() - 0.5, r() - 0.2, r() - 0.5)),
      shatterRot: Array.from({ length: LINKS }, () => r() * Math.PI * 2),
      rootPos: v3(),
      frames: Array.from({ length: LINKS }, () => ({ p: v3(), T: v3(), U: v3(), X: v3(), r: 1 })),
    }));
    this.steps = 0;
    this._tmp = {
      root: v3(), rad: v3(), up: new THREE.Vector3(0, 1, 0), c1: v3(), c2: v3(), side: v3(), home: v3(),
      T: v3(), U: v3(), X: v3(), m: new THREE.Matrix4(), m2: new THREE.Matrix4(), rot: new THREE.Matrix4(),
      trans: new THREE.Matrix4(), scale: v3(), q: new THREE.Quaternion(), p: v3(), out: v3(), a: v3(), b: v3(), back: v3(),
    };
    this._axisS = v3();
  }

  homeFor(arm, s, out) {
    const a = arm.angle + s.yaw;
    const lead = clamp(s.speed * 0.3, -2.4, 2.4);
    out.set(s.pos.x + Math.sin(a) * HOME_R + Math.sin(s.yaw) * lead, 0, s.pos.z + Math.cos(a) * HOME_R + Math.cos(s.yaw) * lead);
    out.y = heightAt(out.x, out.z);
    return out;
  }

  updateFeet(dt, s) {
    const tmp = this._tmp;
    const stepping = this.arms.filter((a) => a.stepping).length;
    let active = stepping;
    const moving = Math.abs(s.speed) > 0.35 || Math.abs(s.yawRate) > 0.25;
    const threshold = moving ? STEP_DIST : 0.7;
    const maxActive = moving ? 4 : 1;

    const order = [...this.arms].sort((a, b) => {
      const da = this.homeFor(a, s, tmp.a).distanceToSquared(a.foot);
      const db = this.homeFor(b, s, tmp.b).distanceToSquared(b.foot);
      return db - da;
    });

    for (const arm of order) {
      const home = this.homeFor(arm, s, tmp.home);
      if (!arm.placed) {
        arm.foot.copy(home);
        arm.placed = true;
      }
      if (arm.stepping) {
        arm.t = Math.min(1, arm.t + dt / arm.duration);
        const e = arm.t * arm.t * (3 - 2 * arm.t);
        // Retarget mid-step so reversing direction does not land in the old spot.
        arm.to.lerp(home, 1 - Math.exp(-3 * dt));
        arm.to.y = heightAt(arm.to.x, arm.to.z);
        arm.foot.lerpVectors(arm.from, arm.to, e);
        arm.foot.y += Math.sin(arm.t * Math.PI) * arm.lift;
        if (arm.t >= 1) {
          arm.stepping = false;
          this.steps++;
          if (Math.abs(s.speed) > 0.5) {
            this.particles.puff(arm.foot, 5);
            if (this.bubbles && Math.random() < 0.4) this.bubbles.burst(arm.foot.x, arm.foot.y + 0.3, arm.foot.z, 3, 0.5, 0.09);
          }
        }
        continue;
      }
      if (s.jet > 0.4) continue;
      const dist = Math.hypot(arm.foot.x - home.x, arm.foot.z - home.z);
      const prev = this.arms[(arm.i + ARMS - 1) % ARMS], next = this.arms[(arm.i + 1) % ARMS];
      if (dist > threshold && active < maxActive && !prev.stepping && !next.stepping) {
        arm.stepping = true;
        arm.t = 0;
        arm.from.copy(arm.foot);
        arm.to.copy(home);
        arm.duration = clamp(0.5 - Math.abs(s.speed) * 0.025, 0.24, 0.5) * (dist > 6 ? 1.3 : 1);
        arm.lift = clamp(0.9 + dist * 0.28, 0.9, 3);
        active++;
      }
    }
  }

  updateJetFeet(dt, s, t) {
    if (s.jet <= 0.02) return;
    const tmp = this._tmp;
    const back = tmp.back.copy(s.vel);
    if (back.lengthSq() < 1) back.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    back.normalize().multiplyScalar(-1);
    const side = tmp.side.set(back.z, 0, -back.x);
    for (const arm of this.arms) {
      if (s.jet < 0.4) continue;
      const a = arm.angle;
      const fan = Math.sin(a) * 2.7, rise = Math.cos(a) * 1.5;
      const w = Math.sin(t * 5 + arm.i * 1.4) * 0.9;
      const target = tmp.home.copy(s.pos)
        .addScaledVector(back, 9.5)
        .addScaledVector(side, fan + w)
        .add(tmp.a.set(0, rise - 1 + Math.cos(t * 4.2 + arm.i) * 0.6, 0));
      arm.foot.lerp(target, 1 - Math.exp(-7 * dt));
      arm.stepping = false;
      const g = heightAt(arm.foot.x, arm.foot.z) + 0.3;
      if (arm.foot.y < g) arm.foot.y = g;
    }
  }

  /** Walks the arm as a Bezier from socket to foot; leftover length becomes the tip spiral. */
  updateArmPath(arm, s, t) {
    const tmp = this._tmp;
    const socket = this.sockets[arm.i].userData.anchor;
    const root = socket.getWorldPosition(tmp.root);
    arm.rootPos.copy(root);
    const rad = tmp.rad.subVectors(arm.foot, root);
    rad.y = 0;
    const d = rad.length();
    if (d < 0.01) rad.set(Math.sin(arm.angle + s.yaw), 0, Math.cos(arm.angle + s.yaw));
    else rad.divideScalar(d);
    const j = s.jet;
    const c1 = tmp.c1.copy(root).addScaledVector(rad, d * 0.34).add(tmp.a.set(0, lerp(2.0, 0.3, j), 0));
    const c2 = tmp.c2.copy(arm.foot).addScaledVector(rad, -d * 0.34).add(tmp.b.set(0, lerp(0.75, 0.15, j), 0));
    const px = arm.px, seg = arm.seg;
    let total = 0;
    let lx = root.x, ly = root.y, lz = root.z;
    for (let k = 0; k < SAMPLES; k++) {
      const u = k / (SAMPLES - 1), v = 1 - u;
      const b0 = v * v * v, b1 = 3 * v * v * u, b2 = 3 * v * u * u, b3 = u * u * u;
      const x = b0 * root.x + b1 * c1.x + b2 * c2.x + b3 * arm.foot.x;
      const y = b0 * root.y + b1 * c1.y + b2 * c2.y + b3 * arm.foot.y;
      const z = b0 * root.z + b1 * c1.z + b2 * c2.z + b3 * arm.foot.z;
      total += Math.hypot(x - lx, y - ly, z - lz);
      px[k * 3] = x; px[k * 3 + 1] = y; px[k * 3 + 2] = z;
      seg[k] = total;
      lx = x; ly = y; lz = z;
    }
    const remain = Math.max(0.9, ARM_LEN - total);
    arm.curl = clamp(1 - total / ARM_LEN, 0, 1);
    // The plane of the arc is fixed per frame, so the chain never twists.
    const dirx = arm.foot.x - c2.x, diry = arm.foot.y - c2.y, dirz = arm.foot.z - c2.z;
    const h = dirx * rad.x + dirz * rad.z;
    const a0 = Math.atan2(diry, Math.max(h, 0.001));
    const curlTurns = 5.3 + Math.sin(t * 0.8 + arm.i * 2.1) * 0.9 + (arm.stepping ? 0.6 : 0);
    const ds = remain / SAMPLES;
    for (let k = 0; k < SAMPLES; k++) {
      const f = (k + 1) / SAMPLES;
      const ang = a0 + curlTurns * f * f;
      const hor = Math.cos(ang) * ds, ver = Math.sin(ang) * ds;
      lx += rad.x * hor; ly += ver; lz += rad.z * hor;
      const n = SAMPLES + k;
      px[n * 3] = lx; px[n * 3 + 1] = ly; px[n * 3 + 2] = lz;
      total += ds;
      seg[n] = total;
    }
    // Resample into links
    let cursor = 0;
    for (let k = 0; k < LINKS; k++) {
      const want = LINK_U[k] * total;
      while (cursor < SAMPLES * 2 - 1 && seg[cursor] < want) cursor++;
      const i1 = cursor, i0 = Math.max(0, cursor - 1);
      const span = seg[i1] - seg[i0];
      const f = span > 1e-5 ? (want - seg[i0]) / span : 0;
      const p = arm.samples[k];
      p.set(
        lerp(px[i0 * 3], px[i1 * 3], f),
        lerp(px[i0 * 3 + 1], px[i1 * 3 + 1], f),
        lerp(px[i0 * 3 + 2], px[i1 * 3 + 2], f),
      );
      const g = heightAt(p.x, p.z) + 0.62 * RADII[k] * LINK_SCALE * 0.75;
      if (p.y < g) p.y = g;
    }
    this._axisS.crossVectors(tmp.up, rad).normalize();
    return this._axisS;
  }

  writeArm(arm, axis, startA, startB, startW, e, center) {
    const tmp = this._tmp;
    const { T, U, X, m, m2, rot, trans, out, scale } = tmp;
    const samples = arm.samples;
    let ia = startA, ib = startB, iw = startW;
    for (let k = 0; k < LINKS; k++) {
      const p = samples[k];
      const next = samples[Math.min(LINKS - 1, k + 1)], prev = samples[Math.max(0, k - 1)];
      T.subVectors(next, prev).normalize();
      U.crossVectors(T, axis).normalize();
      X.crossVectors(U, T).normalize();
      const r = RADII[k] * LINK_SCALE;
      m.makeBasis(X, U, T);
      m.scale(scale.set(r, r, r));
      let px = p.x, py = p.y, pz = p.z;
      if (e > 0.001) {
        const sh = arm.shatter[k];
        out.set(p.x - center.x, p.y - center.y + 1.2, p.z - center.z).normalize();
        const push = e * (1.2 + k * 0.17);
        px += out.x * push + sh.x * e * 1.4;
        py += out.y * push + sh.y * e * 1.4;
        pz += out.z * push + sh.z * e * 1.4;
        rot.makeRotationAxis(X, arm.shatterRot[k] * e * 0.6);
        m.premultiply(rot);
      }
      m.setPosition(px, py, pz);
      const frame = arm.frames[k];
      frame.p.set(px, py, pz);
      frame.T.copy(T);
      frame.U.copy(U);
      frame.X.copy(X);
      frame.r = r;
      if (k % 2 === 0) this.linksA.setMatrixAt(ia++, m);
      else this.linksB.setMatrixAt(ib++, m);
      for (const side of [-1, 1]) {
        rot.makeRotationX(arm.spin * side + k);
        trans.makeTranslation(side * 0.21, -0.6, 0);
        trans.multiply(rot);
        m2.multiplyMatrices(m, trans);
        this.wheels.setMatrixAt(iw++, m2);
      }
    }
    return [ia, ib, iw];
  }

  /** After a jump across the map, the feet re-plant under the robot instead of stretching to it. */
  teleported() {
    for (const arm of this.arms) {
      arm.placed = false;
      arm.stepping = false;
    }
  }

  setPistons(on) {
    this.pistonsOn = on;
    this.rods.visible = on;
    this.housings.visible = on;
  }

  /** Places each clevis joint and the two hydraulic rods across it. */
  writeJoints(arm, startJ, startP, e) {
    const tmp = this._tmp;
    const { m, a: dir, b: axis, c1: up, c2: pa, home: pb } = tmp;
    let ij = startJ, ip = startP;
    const f = arm.frames;
    const hide = e > 0.02;
    for (let k = 0; k < LINKS; k++) {
      const prev = k === 0 ? null : f[k - 1];
      const cur = f[k];
      const aPos = prev ? prev.p : arm.rootPos;
      dir.subVectors(cur.p, aPos);
      const dist = dir.length();
      if (dist > 1e-5) dir.divideScalar(dist);
      else dir.copy(cur.T);
      axis.copy(cur.X).addScaledVector(dir, -cur.X.dot(dir)).normalize();
      up.crossVectors(dir, axis).normalize();
      const r = prev ? (prev.r + cur.r) / 2 : cur.r * 1.08;
      m.makeBasis(axis, up, dir);
      m.scale(tmp.scale.setScalar(r));
      m.setPosition((aPos.x + cur.p.x) / 2, (aPos.y + cur.p.y) / 2, (aPos.z + cur.p.z) / 2);
      this.joints.setMatrixAt(ij++, m);
      if (!prev || !this.pistonsOn) continue;
      for (const side of [-1, 1]) {
        pa.copy(prev.p).addScaledVector(prev.U, 0.56 * prev.r).addScaledVector(prev.X, side * 0.39 * prev.r).addScaledVector(prev.T, 0.2 * prev.r);
        pb.copy(cur.p).addScaledVector(cur.U, 0.56 * cur.r).addScaledVector(cur.X, side * 0.39 * cur.r).addScaledVector(cur.T, -0.2 * cur.r);
        dir.subVectors(pb, pa);
        const len = dir.length();
        if (hide || len < 1e-4) {
          this.rods.setMatrixAt(ip, ZERO);
          this.housings.setMatrixAt(ip, ZERO);
          ip++;
          continue;
        }
        dir.divideScalar(len);
        axis.copy(prev.X).addScaledVector(dir, -prev.X.dot(dir)).normalize();
        up.crossVectors(dir, axis).normalize();
        m.makeBasis(axis, up, dir);
        m.scale(tmp.scale.set(prev.r, prev.r, len));
        m.setPosition(pa);
        this.rods.setMatrixAt(ip, m);
        m.makeBasis(axis, up, dir);
        // The cylinder keeps its length, the rod slides out of it as the joint opens.
        m.scale(tmp.scale.set(prev.r, prev.r, Math.min(len, 0.42 * prev.r)));
        m.setPosition(pa);
        this.housings.setMatrixAt(ip, m);
        ip++;
      }
    }
    return [ij, ip];
  }

  updateStruts(e) {
    const hide = e > 0.02;
    this.capHinge.updateMatrix();
    const tmp = this._tmp;
    for (const s of this.struts) {
      s.rod.visible = s.housing.visible = !hide;
      if (hide) continue;
      const tip = tmp.p.copy(s.tip).applyMatrix4(this.capGroup.matrix).applyMatrix4(this.capHinge.matrix);
      const dir = tmp.a.subVectors(tip, s.base);
      const len = dir.length();
      dir.divideScalar(len);
      for (const part of [s.rod, s.housing]) {
        part.position.copy(s.base);
        part.quaternion.setFromUnitVectors(tmp.b.set(0, 0, 1), dir);
      }
      s.rod.scale.set(1, 1, len);
      s.housing.scale.set(1, 1, Math.min(len, 0.72));
    }
  }

  update(dt, t, s) {
    const P = this.parts, Q = this.targets;
    for (const k in P) P[k] = damp(P[k], Q[k], 3.6, dt);
    this.root.position.copy(s.pos);
    this.root.rotation.set(s.pitch, s.yaw, s.roll);

    const e = P.explode;
    const open = Math.max(P.mantle, P.pump * 0.9, e * 0.55);
    this.capHinge.rotation.z = -open * 1.45;
    this.capHinge.position.y = SEAM_Y + e * 1.5;
    this.capHinge.position.x = R * Math.sin(Math.acos(SEAM_Y / R)) + e * 1.4;
    this.topHatch.position.y = R + 0.01 + e * 1.7;
    this.topHatch.rotation.y = e * 2.5 + t * 0.2 * e;

    this.pump.position.y = SEAM_Y + 0.35 + P.pump * 1.9 + e * 2.2;
    this.coil.rotation.y += dt * (0.6 + P.pump * 4 + Math.abs(s.speed) * 0.25 + s.jet * 14);
    this.pump.rotation.y = P.pump * t * 0.8;
    this.riser.scale.y = Math.max(0.01, this.pump.position.y - this.pumpBase);
    this.updateStruts(e);

    // The lens unscrews: it rotates while translating along its axis.
    const barrel = this.mainEye.userData.barrel;
    barrel.position.z = P.lens * 1.25 + e * 1.1;
    barrel.rotation.z = P.lens * Math.PI * 3;
    this.mainEye.position.copy(this.mainEye.userData.base).addScaledVector(this.mainEye.userData.dir, e * 1.5);
    this.sideEyes.forEach((eye) => {
      eye.position.copy(eye.userData.base).addScaledVector(eye.userData.dir, e * 1.5 + P.lens * 0.12);
      eye.userData.barrel.position.z = P.lens * 0.4 + e * 0.5;
    });
    this.belly.position.y = -e * 0.6;
    this.beak.position.y = -2.2 - e * 0.8 - P.pump * 0.2;
    this.siphon.position.z = -R + 0.05 - e * 1.8;
    this.sockets.forEach((so) => so.position.copy(so.userData.base).addScaledVector(so.userData.dir, e * 1.6));

    const pulse = 0.25 + s.jet * 4 + Math.abs(s.speed) * 0.06 + Math.sin(t * 3) * 0.08;
    this.mats.glow.emissiveIntensity = 1.6 + pulse;

    this.root.updateMatrixWorld(true);

    this.updateJetFeet(dt, s, t);
    this.updateFeet(dt, s);

    let ia = 0, ib = 0, iw = 0, ij = 0, ip = 0;
    const center = s.pos;
    const spin = (Math.abs(s.speed) * 1.6 + Math.abs(s.yawRate) * 2) * dt * (s.speed < 0 ? -1 : 1);
    for (const arm of this.arms) {
      arm.spin += spin + (arm.stepping ? dt * 6 : 0);
      const axis = this.updateArmPath(arm, s, t);
      [ia, ib, iw] = this.writeArm(arm, axis, ia, ib, iw, e, center);
      [ij, ip] = this.writeJoints(arm, ij, ip, e);
    }
    this.joints.instanceMatrix.needsUpdate = true;
    this.rods.instanceMatrix.needsUpdate = true;
    this.housings.instanceMatrix.needsUpdate = true;
    this.linksA.instanceMatrix.needsUpdate = true;
    this.linksB.instanceMatrix.needsUpdate = true;
    this.wheels.instanceMatrix.needsUpdate = true;

    // Bubbles: air escaping from the hull at rest, and more when it is opened up.
    if (this.bubbles) {
      const tip = this.nozzleTip.getWorldPosition(this._tmp.p);
      this.idleBubble -= dt;
      if (this.idleBubble <= 0) {
        this.idleBubble = 1.4 + Math.random() * 3.4;
        this.bubbles.burst(tip.x, tip.y, tip.z, 3 + Math.floor(Math.random() * 4), 0.25, 0.09);
      }
      if (open > 0.5 && Math.random() < dt * 6) {
        this.bubbles.emit(s.pos.x + (Math.random() - 0.5) * 1.8, s.pos.y + 1.6, s.pos.z + (Math.random() - 0.5) * 1.8, 0.07 + Math.random() * 0.08);
      }
      if (Q.explode > 0.5 && this.prevExplode <= 0.5) this.bubbles.burst(s.pos.x, s.pos.y, s.pos.z, 90, 4.5, 0.22);
      this.prevExplode = Q.explode;
    }

    // Jet exhaust
    if (s.jet > 0.2) {
      this.jetAcc += dt * 90 * s.jet;
      const tip = this.nozzleTip.getWorldPosition(this._tmp.p);
      const fx = -Math.sin(s.yaw) * (s.speed >= 0 ? 1 : -1), fz = -Math.cos(s.yaw) * (s.speed >= 0 ? 1 : -1);
      while (this.jetAcc > 1) {
        this.jetAcc -= 1;
        this.particles.emit(tip, fx * 8 + (Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.4, fz * 8 + (Math.random() - 0.5) * 2.4, 0.9, 0.6);
        // Only a share of the exhaust becomes bubbles, or the wake hides the robot from the chase camera.
        if (Math.random() < 0.18) this.bubbles?.emit(tip.x, tip.y, tip.z, 0.05 + Math.random() * 0.12, fx * 7 + (Math.random() - 0.5) * 2, fz * 7 + (Math.random() - 0.5) * 2);
      }
    }
    this.particles.update(dt);
  }
}

class Particles {
  constructor(scene) {
    const n = 500;
    this.n = n;
    this.i = 0;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.size = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {},
      vertexShader: `attribute float aLife; attribute float aSize; varying float vL;
        void main(){ vL=aLife; vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv;
        gl_PointSize=aSize*(2.-aLife)*(420./-mv.z); }`,
      fragmentShader: `varying float vL; void main(){ float d=length(gl_PointCoord-.5); if(d>.5)discard;
        float a=smoothstep(.5,.15,d)*vL*.55; gl_FragColor=vec4(.42,.37,.31,a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(p, vx, vy, vz, life, size) {
    const i = this.i;
    this.i = (i + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = 1;
    this.maxLife[i] = life;
    this.size[i] = size;
  }

  puff(p, count) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      this.emit(p, Math.cos(a) * 1.3, 0.5 + Math.random(), Math.sin(a) * 1.3, 0.7, 0.8);
    }
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] = Math.max(0, this.life[i] - dt / this.maxLife[i]);
      const j = i * 3;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.vel[j] *= 0.97; this.vel[j + 1] *= 0.97; this.vel[j + 2] *= 0.97;
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = g.aLife.needsUpdate = g.aSize.needsUpdate = true;
  }
}
