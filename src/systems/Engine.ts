import * as THREE from 'three';
import type { QualitySettings } from './Quality';
import { shared } from './SharedUniforms';

/** Test hook: `?timescale=4` speeds up the world clock (useful on slow software GPUs). */
const TIME_SCALE = Math.max(0.1, Math.min(10, Number(new URLSearchParams(location.search).get('timescale')) || 1));

export type Updater = (dt: number, t: number, frame?: XRFrame) => void;

/**
 * Rendering core: owns the WebGLRenderer, the scene graph root, the default
 * camera and the frame loop (which is also the WebXR loop when presenting).
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  quality: QualitySettings;

  private updaters = new Set<Updater>();
  private lateUpdaters = new Set<Updater>();
  private clock = new THREE.Timer();
  private elapsed = 0;
  private running = false;
  private frameTimes: number[] = [];
  private lastPerfCheck = 0;
  private resizeObserver: ResizeObserver;

  onContextLost: () => void = () => {};
  onContextRestored: () => void = () => {};
  onSlowFrames: (avgMs: number) => void = () => {};

  constructor(container: HTMLElement, quality: QualitySettings) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      antialias: quality.antialias,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      stencil: false,
    });
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'gl-canvas';
    this.canvas.setAttribute('aria-label', 'Mundo 3D do Portal');
    container.appendChild(this.canvas);

    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.setClearColor(0x000000, 0);
    r.shadowMap.enabled = quality.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.xr.enabled = true;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.02, 200);
    this.scene.add(this.camera);

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.onContextRestored();
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    this.resize();
  }

  get isXR() {
    return this.renderer.xr.isPresenting;
  }

  /** Camera that is actually used to render this frame (XR camera while presenting). */
  get activeCamera(): THREE.PerspectiveCamera {
    if (this.renderer.xr.isPresenting) {
      const xrCam = this.renderer.xr.getCamera() as THREE.ArrayCamera;
      return (xrCam.cameras?.[0] as THREE.PerspectiveCamera) ?? (xrCam as unknown as THREE.PerspectiveCamera);
    }
    return this.camera;
  }

  setQuality(q: QualitySettings) {
    this.quality = q;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  resize() {
    if (this.renderer.xr.isPresenting) return;
    const parent = this.canvas.parentElement!;
    const w = Math.max(1, parent.clientWidth || window.innerWidth);
    const hgt = Math.max(1, parent.clientHeight || window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio));
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
    shared.uViewportHeight.value = hgt * this.renderer.getPixelRatio();
  }

  add(fn: Updater, late = false) {
    (late ? this.lateUpdaters : this.updaters).add(fn);
    return () => {
      this.updaters.delete(fn);
      this.lateUpdaters.delete(fn);
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.renderer.setAnimationLoop(this.tick);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private tick = (_time: number, frame?: XRFrame) => {
    this.clock.update();
    const dt = Math.min(this.clock.getDelta(), 1 / 20) * TIME_SCALE;
    this.elapsed += dt;
    shared.uTime.value = this.elapsed;

    if (this.renderer.xr.isPresenting) {
      const layer = this.renderer.xr.getSession()?.renderState.baseLayer;
      if (layer) shared.uViewportHeight.value = layer.framebufferHeight;
    }

    for (const u of this.updaters) u(dt, this.elapsed, frame);
    for (const u of this.lateUpdaters) u(dt, this.elapsed, frame);
    this.renderer.render(this.scene, this.camera);
    this.trackPerformance(dt);
  };

  private trackPerformance(dt: number) {
    if (this.renderer.xr.isPresenting || document.hidden) return;
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    if (this.elapsed - this.lastPerfCheck > 5 && this.frameTimes.length >= 120) {
      this.lastPerfCheck = this.elapsed;
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      if (avg > 26) this.onSlowFrames(avg);
    }
  }

  resetPerformanceWindow() {
    this.frameTimes.length = 0;
    this.lastPerfCheck = this.elapsed;
  }

  /** Pre-compiles every material so the reveal does not stutter. */
  async warmup() {
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      this.renderer.compile(this.scene, this.camera);
    }
  }
}
