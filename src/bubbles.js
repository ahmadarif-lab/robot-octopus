import * as THREE from 'three';

const MAX = 1400;

/** Rising air bubbles. A single draw call, shaded as a thin shell with a highlight. */
export class Bubbles {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.age = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 2);
    this.phase = new Float32Array(MAX);
    this.alive = new Uint8Array(MAX);
    this.cursor = 0;
    this.active = 0;
    this.scale = 1;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.uniforms = { uScale: { value: 600 } };
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: this.uniforms,
      vertexShader: `attribute float aSize; uniform float uScale; varying float vFade;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        float d = -mv.z; gl_PointSize = aSize * uScale / max(d, 0.1);
        vFade = 1.0 - smoothstep(55.0, 110.0, d); }`,
      fragmentShader: `varying float vFade;
        void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;
        float rim = smoothstep(0.62, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
        float body = 0.10 * (1.0 - r * 0.4);
        float spec = smoothstep(0.34, 0.0, length(p - vec2(-0.34, -0.38)));
        float spec2 = smoothstep(0.14, 0.0, length(p - vec2(0.38, 0.42)));
        vec3 col = mix(vec3(0.34, 0.47, 0.52), vec3(1.0), clamp(spec + spec2 * 0.7, 0.0, 1.0));
        float a = clamp(rim * 0.8 + body + spec * 0.95 + spec2 * 0.55, 0.0, 1.0) * vFade;
        gl_FragColor = vec4(col, a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, radius = 0.12, driftX = 0, driftZ = 0) {
    if (this.scale < 1 && Math.random() > this.scale) return;
    const i = this.cursor;
    this.cursor = (i + 1) % MAX;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.size[i] = radius * 2;
    this.age[i] = 0;
    this.life[i] = 5 + Math.random() * 7;
    this.vel[i * 2] = driftX;
    this.vel[i * 2 + 1] = driftZ;
    this.phase[i] = Math.random() * 6.28;
    this.alive[i] = 1;
  }

  burst(x, y, z, count, spread = 1, radius = 0.14) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * 6.28, d = Math.random() * spread;
      this.emit(
        x + Math.cos(a) * d,
        y + (Math.random() - 0.5) * spread,
        z + Math.sin(a) * d,
        radius * (0.35 + Math.random() * Math.random() * 1.6),
        Math.cos(a) * d * 0.6,
        Math.sin(a) * d * 0.6,
      );
    }
  }

  update(dt, t, scale) {
    this.uniforms.uScale.value = scale;
    let active = 0;
    for (let i = 0; i < MAX; i++) {
      if (!this.alive[i]) continue;
      this.age[i] += dt;
      if (this.age[i] > this.life[i]) {
        this.alive[i] = 0;
        this.size[i] = 0;
        continue;
      }
      active++;
      const radius = this.size[i] / 2;
      // Larger bubbles rise faster and wobble wider, as they do in water.
      const rise = 1.1 + radius * 7;
      const j = i * 3;
      const ph = this.phase[i];
      const wob = Math.sin(t * 5 + ph) * (0.2 + radius * 2);
      this.pos[j] += (this.vel[i * 2] + wob) * dt;
      this.pos[j + 1] += rise * dt;
      this.pos[j + 2] += (this.vel[i * 2 + 1] + Math.cos(t * 4.3 + ph) * (0.2 + radius * 2)) * dt;
      this.vel[i * 2] *= 0.985;
      this.vel[i * 2 + 1] *= 0.985;
    }
    this.active = active;
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = true;
    g.aSize.needsUpdate = true;
  }
}
