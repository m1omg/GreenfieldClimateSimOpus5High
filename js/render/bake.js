// Bakes procedural noise into cube maps on the GPU. Each texel stores the noise of its
// direction, so a shader can sample textureCube(map, dir) instead of evaluating dozens of
// simplex-noise octaves per pixel per frame (the main cost on tablets and phones).
import * as THREE from 'three';
import { bakeVert } from './shaders.js';

export class CubeBaker {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    // a box around the camera: the interpolated position is the exact view ray of each texel
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    const ext = renderer.extensions;
    this.halfFloat = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
  }

  /** A cube render target; `precise` uses half floats where they are renderable. */
  target(size, { format = THREE.RGBAFormat, precise = false } = {}) {
    const rt = new THREE.WebGLCubeRenderTarget(size, {
      format, type: precise && this.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    const cam = new THREE.CubeCamera(0.1, 10, rt);
    cam.coordinateSystem = this.renderer.coordinateSystem;
    cam.updateCoordinateSystem();
    cam.updateMatrixWorld(true);
    return { rt, texture: rt.texture, cams: cam.children, size };
  }

  material(fragmentShader, uniforms = {}) {
    return new THREE.ShaderMaterial({
      vertexShader: bakeVert, fragmentShader, uniforms,
      side: THREE.BackSide, depthTest: false, depthWrite: false,
    });
  }

  /** Render rows [y0, y0 + rows) of one face. */
  render(t, mat, face, y0 = 0, rows = t.size) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget(), prevClear = r.autoClear;
    this.mesh.material = mat;
    t.rt.scissor.set(0, y0, t.size, rows);
    t.rt.scissorTest = rows < t.size;
    r.autoClear = false;            // every texel is overwritten anyway
    r.setRenderTarget(t.rt, face);
    r.render(this.scene, t.cams[face]);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevClear;
  }

  bakeAll(t, mat) { for (let f = 0; f < 6; f++) this.render(t, mat, f); }
}

/**
 * Time-evolving cloud fields: keyframes every `period` seconds, cross-faded in the shader.
 * The next keyframe is baked in thin strips spread over many frames, so no frame pays
 * for more than a small slice of the noise. Each layer is {frag, size, format?, precise?}; layer i of the
 * current pair is keys[0][i] / keys[1][i].
 */
export class CloudKeyframes {
  constructor(baker, layers, { period = 8, strips = 32 } = {}) {
    this.baker = baker;
    this.period = period;
    this.strips = strips;
    this.layers = layers.map(l => ({ ...l, mat: baker.material(l.frag, { uT: { value: 0 } }) }));
    this.keys = [0, 1, 2].map(() => this.layers.map(l => baker.target(l.size, { format: l.format ?? THREE.RedFormat, precise: l.precise ?? true })));
    this.clock = 0;
    this.t0 = 0;                     // time of keys[0]; keys[1] is at t0 + period
    this.bakeKey(this.keys[0], 0);
    this.bakeKey(this.keys[1], period);
    this.startNext();
  }

  bakeKey(key, t) {
    this.layers.forEach((l, i) => { l.mat.uniforms.uT.value = t; this.baker.bakeAll(key[i], l.mat); });
  }

  startNext() { this.face = 0; this.strip = 0; this.nextReady = false; }

  /** Advance by dt seconds; returns the cross-fade weight between keys[0] and keys[1]. */
  step(dt) {
    // bake one strip of every layer of keys[2] (time t0 + 2 period)
    if (!this.nextReady) {
      this.layers.forEach((l, i) => {
        const y0 = Math.round(l.size * this.strip / this.strips), y1 = Math.round(l.size * (this.strip + 1) / this.strips);
        l.mat.uniforms.uT.value = this.t0 + 2 * this.period;
        this.baker.render(this.keys[2][i], l.mat, this.face, y0, y1 - y0);
      });
      if (++this.strip === this.strips) { this.strip = 0; if (++this.face === 6) this.nextReady = true; }
    }
    this.clock += dt;
    if (this.clock >= this.t0 + this.period) {
      if (this.nextReady) {
        this.keys.push(this.keys.shift());
        this.t0 += this.period;
        this.startNext();
      } else {
        this.clock = this.t0 + this.period;   // slow device: hold until the next key is ready
      }
    }
    return Math.min(1, (this.clock - this.t0) / this.period);
  }
}
