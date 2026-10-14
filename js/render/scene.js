// Three.js scene: planet surface, clouds, atmosphere deck, limb glow, star and starfield.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { surfaceVert, surfaceFrag, cloudFrag, deckFrag, atmoVert, atmoFrag } from './shaders.js';

const NB = 36;

const op0 = (lum) => Math.min(1, Math.max(0, (lum - 0.25) / 0.45));

function starRGB(Teff) {
  // blackbody colour of the star (normalised), Tanner Helland approximation
  const t = Teff / 100;
  let r, g, b;
  r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  b = t >= 66 ? 255 : (t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307);
  const c = [r, g, b].map(v => Math.min(255, Math.max(0, v)) / 255);
  const m = Math.max(...c);
  return c.map(v => v / m);
}

export class PlanetScene {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = this.scene = new THREE.Scene();
    const camera = this.camera = new THREE.PerspectiveCamera(36, 1, 0.01, 2000);
    camera.position.set(-1.2, 0.9, 4.2);
    const controls = this.controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 1.35;
    controls.maxDistance = 12;
    controls.enablePan = false;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.7;

    this.sunDir = new THREE.Vector3(1, 0.15, 0.35).normalize();
    this.starColor = new THREE.Color(1, 0.95, 0.88);

    // band data textures (float RGBA, NB x 1)
    this.bandA = new THREE.DataTexture(new Float32Array(NB * 4), NB, 1, THREE.RGBAFormat, THREE.FloatType);
    this.bandB = new THREE.DataTexture(new Float32Array(NB * 4), NB, 1, THREE.RGBAFormat, THREE.FloatType);
    for (const t of [this.bandA, this.bandB]) {
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
      t.wrapS = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    }
    this.heightTex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RedFormat, THREE.FloatType);

    // group with obliquity tilt; planet spins inside it
    this.tilt = new THREE.Group();
    scene.add(this.tilt);
    this.spin = new THREE.Group();
    this.tilt.add(this.spin);

    const common = {
      uBandA: { value: this.bandA }, uBandB: { value: this.bandB },
      uLocked: { value: 0 }, uSubstellar: { value: new THREE.Vector3(1, 0, 0) },
      uSunDirW: { value: this.sunDir }, uStarColor: { value: new THREE.Vector3(1, 0.95, 0.9) },
      uTime: { value: 0 }, uObjToWorld: { value: new THREE.Matrix3() }, uExposure: { value: 1.0 },
    };
    this.common = common;

    const geo = new THREE.SphereGeometry(1, 256, 128);
    this.surfaceMat = new THREE.ShaderMaterial({
      vertexShader: surfaceVert, fragmentShader: surfaceFrag,
      uniforms: {
        ...common,
        uHeight: { value: this.heightTex }, uHeightSize: { value: new THREE.Vector2(1024, 512) },
        uSeaLevel: { value: 0 }, uHasOcean: { value: 1 }, uLife: { value: 1 }, uDesertTint: { value: 0 },
        uHot: { value: 0 }, uRust: { value: 0 },
      },
    });
    this.planet = new THREE.Mesh(geo, this.surfaceMat);
    this.spin.add(this.planet);

    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: surfaceVert, fragmentShader: cloudFrag, transparent: true, depthWrite: false,
      uniforms: { ...common, uStorm: { value: 0 } },
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.012, 160, 80), this.cloudMat);
    this.spin.add(this.clouds);

    this.deckMat = new THREE.ShaderMaterial({
      vertexShader: surfaceVert, fragmentShader: deckFrag, transparent: true, depthWrite: false,
      uniforms: {
        ...common, uDeckColor: { value: new THREE.Vector3(1, 0.9, 0.7) }, uOpacity: { value: 0 },
        uGlow: { value: 0 }, uGlowColor: { value: new THREE.Vector3(1, 0.3, 0.1) },
      },
    });
    this.deck = new THREE.Mesh(new THREE.SphereGeometry(1.02, 128, 64), this.deckMat);
    this.spin.add(this.deck);

    this.atmoMat = new THREE.ShaderMaterial({
      vertexShader: atmoVert, fragmentShader: atmoFrag, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      uniforms: {
        uSunDirW: common.uSunDirW, uStarColor: common.uStarColor, uExposure: common.uExposure,
        uRayleigh: { value: new THREE.Vector3(0.35, 0.6, 1.0) }, uStrength: { value: 1.0 },
      },
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1.06, 128, 64), this.atmoMat);
    scene.add(this.atmo);

    // star: glow sprite far away along sunDir
    const sprTex = this._glowTexture();
    this.starSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.starSprite.scale.set(60, 60, 1);
    scene.add(this.starSprite);
    this.starCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.starCore.scale.set(14, 14, 1);
    scene.add(this.starCore);

    // starfield background
    const bg = new THREE.TextureLoader().load('assets/starfield.jpg', (t) => { t.colorSpace = THREE.SRGBColorSpace; });
    bg.colorSpace = THREE.SRGBColorSpace;
    bg.mapping = THREE.EquirectangularReflectionMapping;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 64, 32), new THREE.MeshBasicMaterial({ map: bg, side: THREE.BackSide, color: new THREE.Color(0.42, 0.42, 0.46), depthWrite: false }));
    sky.rotation.set(0.5, 0, 0.3);
    scene.add(sky);
    this.sky = sky;

    // post-processing
    const composer = this.composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.5, 0.9);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());

    this.visualRotation = 0;
    this.spinRate = 0.05; // rad per real second (visual only)
    this.state = null;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.06, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.25)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.05)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  setPixelRatio(r) {
    this.renderer.setPixelRatio(r);
    this._resize();
  }

  _resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setHeightMap(hm) {
    const tex = new THREE.DataTexture(hm.data, hm.W, hm.H, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.heightTex.dispose();
    this.heightTex = tex;
    this.surfaceMat.uniforms.uHeight.value = tex;
    this.surfaceMat.uniforms.uHeightSize.value.set(hm.W, hm.H);
  }

  /** Update visual state from a simulation snapshot. */
  update(snap) {
    this.state = snap;
    const s = snap.summary, b = snap.bands, p = snap.params;
    const A = this.bandA.image.data, B = this.bandB.image.data;
    for (let i = 0; i < NB; i++) {
      A[i * 4] = b.T[i] / 400; A[i * 4 + 1] = b.sea[i]; A[i * 4 + 2] = b.snow[i]; A[i * 4 + 3] = b.ice[i];
      B[i * 4] = b.fc[i]; B[i * 4 + 1] = b.tc[i] / 40; B[i * 4 + 2] = b.pr[i] / 3; B[i * 4 + 3] = b.co2[i];
    }
    this.bandA.needsUpdate = true; this.bandB.needsUpdate = true;
    const u = this.surfaceMat.uniforms;
    u.uSeaLevel.value = s.seaLevelNorm ?? 0;
    u.uHasOcean.value = s.liquidEO > 1e-5 ? 1 : 0;
    u.uLife.value = s.lifeOn ? 1 : 0;
    const arid = s.liquidEO < 0.02 ? 1 - Math.min(1, s.liquidEO / 0.02) : 0;
    u.uDesertTint.value = arid * (s.Tmean < 330 ? 1 : 0.5);
    u.uHot.value = Math.min(1, Math.max(0, (s.Tmean - 380) / 300));
    const wEO = s.waterEO;
    u.uRust.value = 1 - Math.min(1, Math.max(0, (wEO - 0.002) / 0.048));
    this.common.uLocked.value = p.tidallyLocked ? 1 : 0;

    // star colour & direction
    const rgb = starRGB(s.Teff);
    this.common.uStarColor.value.set(rgb[0], rgb[1], rgb[2]);
    this.starSprite.material.color.setRGB(rgb[0], rgb[1], rgb[2]);
    this.starCore.material.color.setRGB(rgb[0], rgb[1], rgb[2]);
    const sz = 14 * Math.sqrt(Math.max(0.05, s.instellation));
    this.starCore.scale.set(sz, sz, 1);
    this.starSprite.scale.set(sz * 4.5, sz * 4.5, 1);

    // tilt (obliquity) - for locked planets the substellar point faces the star
    const obl = p.tidallyLocked ? 0 : (p.obliquity || 0) * Math.PI / 180;
    this.tilt.rotation.z = -obl;

    // atmosphere appearance
    const pS = s.pS / 1e5;
    const rgbA = s.rgbAtm || [0.04, 0.07, 0.15];
    const lum = Math.max(rgbA[0], rgbA[1], rgbA[2]);
    const norm = lum > 1e-4 ? rgbA.map(v => v / lum) : [0.4, 0.6, 1];
    const atm = this.atmoMat.uniforms;
    atm.uRayleigh.value.set(norm[0], norm[1], norm[2]);
    atm.uStrength.value = pS < 1e-4 ? 0 : Math.min(1.3, 0.25 + 0.5 * Math.log10(1 + pS * 8)) * (1 - 0.45 * op0(lum));
    const shell = 1.02 + Math.min(0.08, 0.025 * Math.log10(1 + pS * 10) + 0.01);
    this.atmo.scale.setScalar(shell / 1.06);
    // opaque decks: thick Rayleigh/steam/sulfuric/haze
    const dk = this.deckMat.uniforms;
    const op = Math.min(1, Math.max(0, (lum - 0.25) / 0.45));
    dk.uOpacity.value = op;
    const sat = s.tauS > 1 ? [1.0, 0.9, 0.68] : s.tauH > 0.5 ? [0.95, 0.7, 0.38] : norm;
    dk.uDeckColor.value.set(...sat.map((v, i) => 0.55 * v + 0.45 * (s.tauS > 1 || s.tauH > 0.5 ? v : 1)));
    // glow of a very hot lower atmosphere through the deck (night side)
    dk.uGlow.value = Math.min(1.5, Math.max(0, (s.Tmean - 1200) / 1200)) * 0.6;
    this.deck.visible = op > 0.01;
    this.clouds.visible = op < 0.995;
    this.spinRate = p.tidallyLocked ? 0 : 0.05 * Math.min(4, Math.max(0.15, Math.sqrt(24 / Math.max(p.rotationHours, 1))));
  }

  render(dtReal) {
    const t = performance.now() / 1000;
    this.common.uTime.value = t;
    this.visualRotation += this.spinRate * dtReal;
    if (this.state && this.state.params.tidallyLocked) {
      // keep substellar point (object +x) facing the star
      this.visualRotation = -Math.atan2(this.sunDir.z, this.sunDir.x);
    }
    this.spin.rotation.y = this.visualRotation;
    this.spin.updateMatrixWorld(true);
    const m3 = new THREE.Matrix3().setFromMatrix4(this.planet.matrixWorld);
    this.common.uObjToWorld.value.copy(m3);
    // substellar point in object space (for locked planets)
    const inv = new THREE.Matrix4().copy(this.planet.matrixWorld).invert();
    const sObj = this.sunDir.clone().transformDirection(inv);
    this.common.uSubstellar.value.copy(sObj);
    // star position
    const far = this.sunDir.clone().multiplyScalar(400);
    this.starSprite.position.copy(far); this.starCore.position.copy(far);
    this.controls.update();
    this.composer.render();
  }
}
