import * as THREE from 'three';
import { Engine } from '../systems/Engine';
import { QUALITY, type QualitySettings, type QualityLevel } from '../systems/Quality';
import { Haptics } from '../systems/Haptics';
import { Stage } from '../scenes/Stage';
import { Overlay, type InstructionSpec, type Action } from '../ui/Overlay';
import { InteractionSystem } from '../interactions/InteractionSystem';
import { Gestures } from '../interactions/Gestures';
import { Discoveries, DISCOVERIES, type DiscoveryId } from '../interactions/Discoveries';
import type { AudioEngine } from '../audio/AudioEngine';
import type { ARMode, ModeKind, PlacementStatus } from '../ar/ARMode';
import { CameraFeed, CameraError, preauthorizeCamera } from '../ar/CameraFeed';
import { MarkerMode } from '../ar/MarkerMode';
import { ManualMode } from '../ar/ManualMode';
import { ExploreMode } from '../ar/ExploreMode';
import { WebXRMode } from '../ar/WebXRMode';
import { detectCapabilities } from '../ar/capabilities';
import { markerSVG } from '../assets/marker';
import { h, nextFrame } from '../utils/dom';
import { clamp, damp } from '../utils/math';
import type { IconName } from '../ui/icons';
import { loadOptionalModels } from '../systems/AssetLoader';

type ExpState = 'idle' | 'placing' | 'opening' | 'world';

const SCALE_MIN = 0.4;
const SCALE_MAX = 3;
const scaleFromSlider = (v: number) => SCALE_MIN * Math.pow(SCALE_MAX / SCALE_MIN, v);
const sliderFromScale = (s: number) => Math.log(s / SCALE_MIN) / Math.log(SCALE_MAX / SCALE_MIN);

const DRAGON_LINE = 'Finalmente alguém encontrou meu mundo!';

/**
 * Orchestrates the whole experience: chooses the AR mode, runs placement,
 * the portal opening, interactions, audio and the UI.
 */
export class Experience {
  readonly engine: Engine;
  readonly stage: Stage;
  readonly overlay: Overlay;
  readonly discoveries = new Discoveries();
  private interactions = new InteractionSystem();
  private gestures: Gestures;
  private feed: CameraFeed;
  private mode: ARMode | null = null;
  private explore: ExploreMode | null = null;
  private state: ExpState = 'idle';
  private quality: QualitySettings;
  private cameraWorld = new THREE.Vector3();
  private yawTarget: number | null = null;
  private autoSpin = false;
  private dimK = 0;
  private dimTarget = 0;
  private speechUntil = 0;
  private elapsed = 0;
  private dragonHello = false;
  private uiRoot: HTMLElement;
  private wasPlacedOnce = false;
  private preferredCameraMode: 'marker' | 'manual' = 'marker';
  /** Name of the last tapped target (diagnostics / automated tests). */
  lastTap: string | null = null;
  private lastXRError = '';
  onExit: () => void = () => {};

  static async create(audio: AudioEngine, quality: QualitySettings) {
    const exp = new Experience(audio, quality);
    await nextFrame();
    // compile every shader up front (three skips invisible objects, so reveal them briefly)
    const st = exp.stage;
    const hidden = [st.anchor, st.world.group, st.sky.group, st.birds.group, st.dragon.root];
    const prev = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = true));
    await exp.engine.warmup();
    hidden.forEach((o, i) => (o.visible = prev[i]));
    void loadOptionalModels(st.world.group);
    return exp;
  }

  private constructor(
    private audio: AudioEngine,
    quality: QualitySettings,
  ) {
    this.quality = quality;
    const viewport = document.getElementById('viewport')!;
    this.uiRoot = document.getElementById('ui-root')!;
    const input = document.getElementById('input-layer')!;
    this.engine = new Engine(viewport, quality);
    this.engine.renderer.localClippingEnabled = true;
    this.feed = new CameraFeed(viewport);
    this.stage = new Stage(this.engine.scene, quality);
    this.engine.camera.position.set(0.6, 2.4, 5.2);
    this.engine.camera.lookAt(0, 1, 0);

    this.overlay = new Overlay(this.uiRoot, {
      onExit: () => this.exit(),
      onSound: () => {
        this.audio.unlock();
        this.audio.toggleMuted();
        Haptics.tap();
      },
      onScale: (v) => {
        this.stage.userScale = scaleFromSlider(v);
        this.stage.applyTransform();
      },
      onReposition: () => this.reposition(),
      onRotate: (dir) => {
        this.audio.ui();
        if (this.mode?.kind === 'explore') this.explore!.rotateBy(dir * 0.5);
        else this.yawTarget = (this.yawTarget ?? this.stage.userYaw) + dir * (Math.PI / 6);
      },
      onZoom: (dir) => {
        this.audio.ui();
        if (this.mode?.kind === 'explore') this.explore!.zoomBy(dir > 0 ? 1.2 : 1 / 1.2);
        else this.setUserScale(this.stage.userScale * (dir > 0 ? 1.2 : 1 / 1.2));
      },
      onAutoRotate: () => {
        this.audio.ui();
        if (this.mode?.kind === 'explore') {
          this.explore!.controls.autoRotate = !this.explore!.controls.autoRotate;
          this.overlay.setAutoRotate(this.explore!.controls.autoRotate, true);
        } else {
          this.autoSpin = !this.autoSpin;
          this.overlay.setAutoRotate(this.autoSpin, true);
        }
      },
      onRestart: () => this.restart(),
      onDiscoveries: () => {
        this.audio.ui();
        this.overlay.openPanel(DISCOVERIES, (id) => this.discoveries.has(id), () => this.discoveries.reset());
      },
    });
    this.overlay.setMuted(this.audio.muted);
    this.audio.onChange = (m) => this.overlay.setMuted(m);
    this.overlay.setDiscoveryCount(this.discoveries.count, this.discoveries.total);
    this.discoveries.onChange = () => this.overlay.setDiscoveryCount(this.discoveries.count, this.discoveries.total);
    this.discoveries.onFound = (d, n) => {
      this.audio.discovery();
      Haptics.success();
      this.overlay.toast('Nova descoberta', `${d.name} · ${n}/${this.discoveries.total}`, d.icon as IconName);
      if (n === this.discoveries.total) {
        setTimeout(() => this.overlay.card('Todos os segredos', 'Coleção completa', 'Você encontrou todas as descobertas do Portal. O mundo agora também conhece você.', 10000), 2500);
      }
    };

    // gestures
    this.gestures = new Gestures(input);
    this.gestures.handlers = {
      onTap: (x, y) => this.onTap(x, y),
      onDrag: (dx, dy, x, y) => {
        if (!this.mode) return;
        if (this.mode.placing) {
          this.mode.handleDrag?.(dx, dy, x, y);
          return;
        }
        if (this.mode.kind === 'explore') return;
        this.yawTarget = null;
        this.stage.userYaw += dx * 0.009;
        this.stage.applyTransform();
      },
      onPinch: (f) => {
        if (!this.mode || this.mode.kind === 'explore') return;
        this.setUserScale(this.stage.userScale * f);
      },
      onTwist: (da) => {
        if (!this.mode || this.mode.kind === 'explore' || this.mode.placing) return;
        this.yawTarget = null;
        this.stage.userYaw -= da;
        this.stage.applyTransform();
      },
    };

    // stage events
    this.stage.onFlash = () => {
      this.overlay.flash();
      Haptics.rumble();
      this.dimTarget = 0.55;
    };
    this.stage.onRevealed = () => {
      this.state = 'world';
      this.overlay.showDock(true);
      this.dimTarget = 0.12;
      this.startAmbience();
    };
    this.stage.onDragonLanded = () => {
      this.audio.land(this.worldPos(this.stage.dragon.root));
      if (!this.dragonHello) {
        this.dragonHello = true;
        setTimeout(() => this.overlay.hint('Toque no dragão para dizer olá', 6000), 600);
      }
    };
    this.stage.dragon.onFlame = () => this.audio.flame(this.worldPos(this.stage.dragon.root));
    this.stage.dragon.onWingBeat = () => this.audio.wingBeat(this.worldPos(this.stage.dragon.root));
    this.stage.world.spirit.onAppear = () => {
      if (!this.discoveries.has('espirito')) this.overlay.hint('Algo brilhante se move na campina…', 5000);
    };

    this.registerInteractions();

    // engine hooks
    this.engine.add((dt, t, frame) => this.update(dt, t, frame));
    this.engine.onContextLost = () => this.overlay.loading(true, 'Restaurando os gráficos…');
    this.engine.onContextRestored = () => this.overlay.loading(false);
    this.engine.onSlowFrames = () => this.degradeQuality();

    (window as unknown as { __portal: unknown }).__portal = this;
  }

  // ------------------------------------------------------------------ helpers
  private worldPos(o: THREE.Object3D) {
    return o.getWorldPosition(new THREE.Vector3());
  }

  private toStage(o: THREE.Object3D | THREE.Vector3) {
    const p = o instanceof THREE.Vector3 ? o.clone() : this.worldPos(o);
    return this.stage.root.worldToLocal(p);
  }

  private setUserScale(s: number) {
    this.stage.userScale = clamp(s, SCALE_MIN, SCALE_MAX);
    this.stage.applyTransform();
    this.overlay.setScaleValue(sliderFromScale(this.stage.userScale));
  }

  applyQuality(level: QualityLevel) {
    this.quality = QUALITY[level];
    this.engine.setQuality(this.quality);
    this.stage.setQuality(this.quality);
  }

  private degradeQuality() {
    const order: QualityLevel[] = ['alto', 'equilibrado', 'economico'];
    const i = order.indexOf(this.quality.level);
    if (i < 0 || i >= order.length - 1) return;
    this.applyQuality(order[i + 1]);
    this.engine.resetPerformanceWindow();
    this.overlay.hint(`Qualidade ajustada: ${this.quality.label}`, 3000);
  }

  get currentMode(): ModeKind | null {
    return this.mode?.kind ?? null;
  }

  get phase() {
    return this.stage.phase;
  }

  get experienceState() {
    return this.state;
  }

  // ------------------------------------------------------------------ entry points
  /**
   * WebXR entry that works around Android Chrome's overlay protection:
   * 1) ask for the camera in the normal page (a regular prompt, like any site);
   * 2) a second tap (fresh user activation) opens the AR session, which no
   *    longer needs to prompt. Falls back to the marker mode if AR fails.
   */
  async startXRFlow() {
    this.prepare('Pedindo acesso à câmera…');
    try {
      await preauthorizeCamera();
    } catch (e) {
      this.overlay.loading(false);
      this.cameraFailed(e as CameraError);
      return;
    }
    this.overlay.loading(false);
    this.overlay.setMode('AR · superfícies');
    this.overlay.showChrome(true);
    this.overlay.instruction({
      title: 'Câmera liberada',
      text: 'Toque abaixo para entrar na realidade aumentada. Depois, procure uma superfície plana para abrir seu portal.',
      visual: 'scan',
      actions: [
        {
          label: 'Entrar na realidade aumentada',
          primary: true,
          onClick: async () => {
            this.overlay.instruction(null);
            this.audio.unlock();
            if (!(await this.startXR())) this.xrFailed();
          },
        },
      ],
    });
  }

  /** AR could not start: explain and let the visitor choose, instead of silently switching modes. */
  private xrFailed() {
    this.overlay.loading(false);
    this.overlay.showChrome(true);
    const why = this.lastXRError ? ` (${this.lastXRError})` : '';
    this.overlay.sheet(
      'A realidade aumentada não iniciou',
      `O Chrome não conseguiu abrir o modo AR${why}. Verifique se o app “Google Play Services for AR” está instalado e atualizado na Play Store e tente de novo.`,
      [
        { label: 'Tentar de novo', primary: true, onClick: () => (this.overlay.closeSheet(), void this.startXRFlow()) },
        { label: 'Explorar em 3D', onClick: () => (this.overlay.closeSheet(), void this.startExplore()) },
        { label: 'Outras opções', onClick: () => (this.overlay.closeSheet(), this.chooseCameraMode(true)) },
      ],
    );
  }

  /**
   * Devices without WebXR surface detection: explain the honest options.
   * The printed marker is the only way to keep the world fixed in the room there.
   */
  chooseCameraMode(afterXRFailure = false) {
    this.prepare('');
    this.overlay.loading(false);
    this.overlay.showChrome(false);
    this.overlay.sheet(
      afterXRFailure ? 'Como abrir o portal' : 'Seu navegador não detecta superfícies',
      'Para o mundo ficar preso à mesa sem detecção de superfícies, o PORTAL precisa de uma referência: o marcador impresso (um quadrado preto e branco, como um QR code) que você coloca sobre a mesa. Sem ele, o mundo aparece sobre a câmera e acompanha apenas a rotação do celular, não os seus passos.',
      [
        { label: 'Usar sem marcador', primary: true, onClick: () => (this.overlay.closeSheet(), void this.startCamera('manual')) },
        { label: 'Tenho o marcador impresso', onClick: () => (this.overlay.closeSheet(), void this.startCamera('marker')) },
        { label: 'Explorar em 3D', onClick: () => (this.overlay.closeSheet(), void this.startExplore()) },
      ],
    );
  }

  /** Try WebXR immersive-ar with hit-test. Resolves false if unavailable/denied. */
  async startXR(): Promise<boolean> {
    this.prepare('Realidade aumentada');
    const mode = new WebXRMode(this.engine, this.stage, this.uiRoot);
    this.attach(mode);
    try {
      this.engine.start();
      await mode.start();
      this.uiRoot.classList.add('xr');
      this.overlay.loading(false);
      this.overlay.setMode('AR · superfícies');
      this.overlay.showChrome(true);
      this.beginPlacement();
      return true;
    } catch (e) {
      console.warn('[xr] fallback', e);
      this.lastXRError = (e as Error)?.name && (e as Error).name !== 'Error' ? (e as Error).name : String((e as Error)?.message ?? e).slice(0, 80);
      mode.stop();
      this.mode = null;
      this.engine.stop();
      return false;
    }
  }

  async startCamera(preferred: 'marker' | 'manual' = this.preferredCameraMode, xrFailed = false) {
    this.prepare('Abrindo a câmera…');
    this.engine.start();
    try {
      await this.feed.start();
    } catch (e) {
      this.overlay.loading(false);
      this.cameraFailed(e as CameraError);
      return;
    }
    document.body.classList.add('camera-on');
    await this.runCameraMode(preferred);
    if (xrFailed) this.overlay.hint('Detecção de superfícies indisponível aqui — usando o modo com marcador.', 5000);
  }

  private async runCameraMode(kind: 'marker' | 'manual') {
    this.mode?.stop();
    this.preferredCameraMode = kind;
    const mode = kind === 'marker' ? new MarkerMode(this.engine, this.stage, this.feed, this.quality.markerProcessWidth) : new ManualMode(this.engine, this.stage, this.feed);
    this.attach(mode);
    this.stage.anchor.visible = false;
    await mode.start();
    this.overlay.loading(false);
    this.overlay.setMode(kind === 'marker' ? 'AR · marcador' : 'AR · manual');
    this.overlay.showChrome(true);
    this.beginPlacement();
  }

  async startExplore() {
    this.prepare('Preparando o mundo…');
    if (!this.explore) this.explore = new ExploreMode(this.engine, this.stage, document.getElementById('input-layer')!);
    this.attach(this.explore);
    this.stage.setEnvironment('explore', this.engine.scene);
    this.stage.baseScale = 1;
    this.engine.start();
    await this.explore.start();
    this.overlay.loading(false);
    this.overlay.setMode('Exploração 3D');
    this.overlay.showChrome(true);
    this.overlay.setAutoRotate(true, true);
  }

  private prepare(loadingText: string) {
    this.overlay.reset();
    this.overlay.loading(true, loadingText);
    document.body.classList.add('in-experience');
    this.stage.reset();
    this.stage.anchor.visible = false; // nothing of the other world shows before placement
    this.stage.userScale = 1;
    this.stage.userYaw = 0;
    this.stage.userOffset.set(0, 0, 0);
    this.stage.applyTransform();
    this.overlay.setScaleValue(sliderFromScale(1));
    this.stage.setEnvironment('ar', this.engine.scene);
    this.state = 'idle';
    this.wasPlacedOnce = false;
    this.dragonHello = false;
    this.autoSpin = false;
    this.yawTarget = null;
    this.engine.resize();
  }

  private attach(mode: ARMode) {
    this.mode = mode;
    this.stage.baseScale = mode.baseScale;
    this.stage.applyTransform();
    mode.onStatus = (s) => this.onPlacementStatus(s);
    mode.onPlaced = () => this.onPlaced();
    mode.onEnded = () => this.exit();
    this.overlay.setAutoRotate(false, true);
  }

  private cameraFailed(e: CameraError) {
    const kind = e instanceof CameraError ? e.kind : 'unknown';
    const texts: Record<string, [string, string]> = {
      denied: ['Precisamos da sua câmera', 'O acesso à câmera foi negado. Para liberar: toque no ícone à esquerda do endereço → Permissões → Câmera → Permitir (ou ⋮ → Configurações → Configurações do site → Câmera). Depois, toque em Tentar novamente.'],
      notfound: ['Nenhuma câmera encontrada', 'Não encontramos uma câmera disponível neste dispositivo. Você ainda pode explorar o mundo em 3D.'],
      busy: ['A câmera está ocupada', 'Outro aplicativo está usando a câmera. Feche-o e tente novamente.'],
      insecure: ['Conexão não segura', 'A câmera só funciona em páginas HTTPS. Abra o PORTAL pelo endereço https:// do GitHub Pages.'],
      unknown: ['Não foi possível abrir a câmera', 'Algo impediu o acesso à câmera. Tente novamente ou explore o mundo em 3D.'],
    };
    const [title, text] = texts[kind] ?? texts.unknown;
    this.overlay.sheet(title, text, [
      { label: 'Explorar sem câmera', onClick: () => (this.overlay.closeSheet(), void this.startExplore()) },
      { label: 'Tentar novamente', primary: true, onClick: () => (this.overlay.closeSheet(), void this.startBest()) },
      { label: 'Voltar', onClick: () => (this.overlay.closeSheet(), this.exit()) },
    ]);
  }

  // ------------------------------------------------------------------ placement
  private beginPlacement() {
    this.state = 'placing';
    this.overlay.showDock(false);
    this.overlay.hint(null);
    this.overlay.hideCard();
    this.onPlacementStatus('starting');
  }

  private onPlacementStatus(s: PlacementStatus) {
    const mode = this.mode;
    if (!mode) return;
    if (!mode.placing && s !== 'marker-lost' && s !== 'placed') return;
    this.overlay.status(null);
    const main = 'Procure uma superfície plana para abrir seu portal.';
    let spec: InstructionSpec | null = null;
    if (mode.kind === 'webxr') {
      if (s === 'surface') spec = { title: 'Superfície encontrada', text: 'Toque na tela para abrir o portal sobre ela.', visual: 'tap', compact: true };
      else if (s === 'scanning' || s === 'starting') spec = { title: main, text: 'Mova o celular devagar, apontando para uma mesa ou para o chão.', visual: 'scan' };
    } else if (mode.kind === 'marker') {
      if (s === 'marker-found') spec = { title: 'Marcador encontrado', text: 'Segure firme… o portal está se formando.', visual: 'loading', compact: true };
      else if (s === 'marker-lost') {
        this.overlay.status('Marcador fora de vista — o mundo ficou onde estava');
        return;
      } else if (s === 'placed') return;
      else
        spec = {
          title: main,
          text: 'Coloque o marcador PORTAL impresso sobre ela e aponte a câmera para ele.',
          visual: 'marker',
          actions: [
            { label: 'Ver marcador', icon: 'marker', onClick: () => this.showMarkerSheet() },
            { label: 'Sem marcador', onClick: () => void this.runCameraMode('manual') },
          ],
        };
    } else if (mode.kind === 'manual') {
      const manual = mode as ManualMode;
      const actions: Action[] = [{ label: 'Abrir portal aqui', primary: true, onClick: () => void mode.confirmPlacement?.() }];
      const needsPermission = typeof (window.DeviceOrientationEvent as unknown as { requestPermission?: unknown } | undefined)?.requestPermission === 'function';
      if (!manual.gyroscopeActive && needsPermission)
        actions.push({
          label: 'Ativar giroscópio',
          icon: 'gyro',
          onClick: async () => {
            const ok = await manual.enableGyroscope();
            this.overlay.hint(ok ? 'Giroscópio ativo: o mundo acompanha os movimentos do celular.' : 'Não foi possível ativar o giroscópio.', 3500);
            this.onPlacementStatus('surface');
          },
        });
      actions.push({ label: 'Tenho o marcador impresso', onClick: () => void this.runCameraMode('marker') });
      if (s === 'aim-down') spec = { title: main, text: 'Incline o celular em direção à mesa.', visual: 'tilt', actions };
      else if (s === 'surface' || s === 'starting')
        spec = {
          title: main,
          text: manual.gyroscopeActive
            ? 'Aponte para onde o portal deve abrir e toque. Sem detecção de superfícies: o mundo acompanha a rotação do celular, mas não os seus passos.'
            : 'Arraste o anel até a sua mesa e toque para abrir. Sem detecção de superfícies: a superfície não é detectada automaticamente.',
          visual: 'tap',
          actions,
        };
    }
    if (spec) this.overlay.instruction(spec);
  }

  private onPlaced() {
    this.overlay.instruction(null);
    this.overlay.status(null);
    Haptics.soft();
    if (this.mode?.kind === 'explore' || !this.wasPlacedOnce) {
      this.wasPlacedOnce = true;
      this.openPortal();
    } else {
      // repositioning: re-appear instantly with a small burst
      this.stage.anchor.visible = true;
      this.stage.showOpened();
      this.overlay.flash();
      this.audio.crystalChime(undefined, 2);
      this.state = 'world';
      this.overlay.showDock(true);
    }
  }

  private openPortal() {
    this.state = 'opening';
    this.stage.anchor.visible = true;
    this.stage.beginOpening();
    this.dimTarget = 0.3;
    this.audio.unlock();
    this.audio.portalOpen();
    Haptics.soft();
  }

  private reposition() {
    if (!this.mode) return;
    this.audio.ui();
    if (this.mode.kind === 'explore') {
      this.mode.reposition();
      this.stage.userYaw = 0;
      this.setUserScale(1);
      return;
    }
    this.stage.anchor.visible = false;
    this.overlay.showDock(false);
    this.overlay.hint(null);
    this.overlay.hideCard();
    this.state = 'placing';
    this.mode.reposition();
  }

  private restart() {
    this.overlay.closePops();
    this.audio.ui();
    this.stage.userYaw = 0;
    this.yawTarget = null;
    this.setUserScale(1);
    this.overlay.showDock(false);
    this.dragonHello = false;
    if (this.mode?.kind === 'explore') this.mode.reposition();
    this.openPortal();
  }

  private showMarkerSheet() {
    this.overlay.sheet('Marcador PORTAL', 'Imprima este marcador (cerca de 10 cm) ou abra-o na tela de outro dispositivo, coloque-o sobre uma superfície plana e aponte a câmera.', [
      { label: 'Abrir para imprimir', primary: true, onClick: () => window.open('./marcador.html', '_blank', 'noopener') },
      { label: 'Fechar', onClick: () => this.overlay.closeSheet() },
    ]);
    const sheet = this.uiRoot.querySelector('.sheet');
    sheet?.insertBefore(h('div', { class: 'marker-preview', html: markerSVG() }), sheet.querySelector('.sheet-actions'));
  }

  private startAmbience() {
    const w = this.stage.world;
    const fall = this.worldPos(w.waterfallProxy);
    const edge = this.stage.root.localToWorld(new THREE.Vector3(-0.46, 0.4, 0.98));
    this.audio.startAmbience([fall, edge]);
  }

  // ------------------------------------------------------------------ interactions
  private onTap(x: number, y: number) {
    if (!this.mode || this.overlay.panelOpen) return;
    this.overlay.closePops();
    if (this.mode.placing) {
      this.mode.handleTap(x, y);
      return;
    }
    if (this.stage.phase === 'hidden') return;
    const r = this.uiRoot.getBoundingClientRect();
    this.lastTap = this.interactions.tapScreen(x - r.left, y - r.top, r.width, r.height, this.mode.pickCamera());
  }

  private discover(id: DiscoveryId) {
    this.discoveries.find(id);
  }

  private registerInteractions() {
    const st = this.stage;
    const w = st.world;
    const t = () => this.elapsed;
    const add = this.interactions.add.bind(this.interactions);

    add({
      name: 'dragon',
      object: st.dragon.hitProxy,
      priority: 2,
      onTap: () => {
        st.dragon.react();
        this.audio.dragonRoar(this.worldPos(st.dragon.root));
        Haptics.rumble();
        this.overlay.speech(DRAGON_LINE, 4500);
        this.speechUntil = this.elapsed + 4.5;
        this.overlay.hint(null);
      },
    });
    add({
      name: 'village',
      object: w.village.hitProxy,
      onTap: () => {
        w.village.celebrate();
        w.smoke.puff(true);
        setTimeout(() => w.smoke.puff(false), 6000);
        w.critters.excite();
        const c = this.toStage(w.village.hitProxy);
        for (let i = 0; i < 26; i++) st.bursts.emit({ x: c.x + (Math.random() - 0.5) * 0.4, y: c.y + Math.random() * 0.05, z: c.z + (Math.random() - 0.5) * 0.4 }, { x: 0, y: 0.15 + Math.random() * 0.15, z: 0 }, { life: 2.2, size: 0.03, color: '#ffd27a', colorEnd: '#ff9a4a', drag: 0.6 });
        this.audio.villageBells(this.worldPos(w.village.hitProxy));
        Haptics.tap();
        this.overlay.card('Vila de Lumenvale', 'A vila', 'Fundada por viajantes que cruzaram o primeiro portal. Sete casas, um poço que realiza pequenos desejos e um padeiro que jura já ter visto o dragão espirrar fogo no próprio pão.');
      },
    });
    add({
      name: 'castle',
      object: w.castle.hitProxy,
      onTap: () => {
        w.castle.celebrate();
        const top = this.toStage(w.group.localToWorld(w.castle.towerTop.clone()));
        st.bursts.burst(top, 40, 0.45, { life: 1.6, size: 0.035, color: '#fff1c4', colorEnd: '#ffb04a', gravity: 0.3 });
        this.audio.castleFanfare(this.worldPos(w.castle.hitProxy));
        Haptics.tap();
        this.overlay.card('Castelo de Aurora Alta', 'O castelo', 'Guardião do vale desde a Era das Brumas. Seus portões só se abrem para quem chega por um portal — e hoje eles se abriram para você.');
      },
    });
    add({
      name: 'crystals',
      object: w.crystals.hitProxy,
      onTap: () => {
        w.crystals.trigger(t());
        const c = this.toStage(w.crystals.hitProxy);
        st.bursts.burst(c, 46, 0.55, { life: 1.4, size: 0.03, color: '#d9c7ff', colorEnd: '#4ff0d2', gravity: -0.05 });
        this.audio.crystalChime(this.worldPos(w.crystals.hitProxy), Math.floor(Math.random() * 5));
        Haptics.soft();
      },
    });

    // ---- discoveries ----
    const secretCrystal = () => {
      w.water.setParted(true);
      setTimeout(() => w.water.setParted(false), 4500);
      w.crystals.revealSecret();
      const c = this.toStage(w.group.localToWorld(w.crystals.secretPosition.clone()));
      st.bursts.burst(c, 40, 0.35, { life: 1.6, size: 0.028, color: '#fff2b8', colorEnd: '#ffc94d' });
      this.audio.crystalChime(this.worldPos(w.crystals.secretProxy), 3);
      this.discover('cristal-cachoeira');
    };
    add({ name: 'secret-crystal', object: w.crystals.secretProxy, priority: 3, onTap: secretCrystal });
    add({ name: 'waterfall', object: w.waterfallProxy, priority: 1, onTap: secretCrystal });
    add({
      name: 'baby-dragon',
      object: w.babyProxy,
      priority: 3,
      onTap: () => {
        w.findBaby();
        this.audio.dragonRoar(this.worldPos(w.babyProxy), 1.9);
        const c = this.toStage(w.babyProxy);
        st.bursts.burst(c, 24, 0.3, { life: 1.2, size: 0.022, color: '#ffe3f6', colorEnd: '#a67bff' });
        this.discover('dragaozinho');
      },
    });
    add({
      name: 'secret-door',
      object: w.castle.secretProxy,
      priority: 3,
      onTap: () => {
        w.castle.openSecret();
        const c = this.toStage(w.castle.secretProxy);
        st.bursts.burst(c, 36, 0.3, { life: 1.4, size: 0.025, color: '#bff8ff', colorEnd: '#4ff0d2' });
        this.audio.spiritChime(this.worldPos(w.castle.secretProxy));
        this.discover('passagem-castelo');
      },
    });
    add({
      name: 'chest',
      object: w.props.chestProxy,
      priority: 3,
      onTap: () => {
        w.props.openChest();
        const c = this.toStage(w.props.chestProxy);
        for (let i = 0; i < 40; i++) st.bursts.emit(c, { x: (Math.random() - 0.5) * 0.35, y: 0.45 + Math.random() * 0.35, z: (Math.random() - 0.5) * 0.35 }, { life: 1.3, size: 0.022, color: '#ffe08a', colorEnd: '#d9a23a', gravity: 1.1, drag: 0.4 });
        this.audio.chest(this.worldPos(w.props.chestProxy));
        this.discover('bau');
      },
    });
    add({
      name: 'spirit',
      object: w.spirit.hitProxy,
      priority: 4,
      enabled: () => w.spirit.isVisible,
      onTap: () => {
        w.spirit.touch();
        const c = this.toStage(w.spirit.hitProxy);
        st.bursts.burst(c, 40, 0.4, { life: 1.8, size: 0.025, color: '#c9feff', colorEnd: '#5ff2d6', gravity: -0.15 });
        this.audio.spiritChime(this.worldPos(w.spirit.hitProxy));
        this.discover('espirito');
      },
    });
    add({
      name: 'golden-bird',
      object: st.birds.goldenProxy,
      priority: 4,
      onTap: () => {
        st.birds.celebrateGolden();
        const c = this.toStage(st.birds.goldenProxy);
        st.bursts.burst(c, 34, 0.4, { life: 1.4, size: 0.03, color: '#fff0b0', colorEnd: '#ffb52e' });
        this.audio.birdSong(this.worldPos(st.birds.goldenProxy));
        this.discover('passaro-dourado');
      },
    });
    add({
      name: 'mushrooms',
      object: w.singingProxy,
      priority: 3,
      onTap: () => {
        w.singMushrooms(t());
        const c = this.toStage(w.singingProxy);
        st.bursts.burst(c, 20, 0.2, { life: 1.6, size: 0.02, color: '#ffd1f0', colorEnd: '#9ad8ff', gravity: -0.1 });
        this.audio.mushroomChoir(this.worldPos(w.singingProxy));
        this.discover('coro-cogumelos');
      },
    });
  }

  // ------------------------------------------------------------------ frame
  private update(dt: number, t: number, frame?: XRFrame) {
    this.elapsed = t;
    const mode = this.mode;
    if (!mode) return;
    mode.update(dt, t, frame);

    const cam = mode.pickCamera();
    cam.updateMatrixWorld();
    this.cameraWorld.setFromMatrixPosition(cam.matrixWorld);

    if (this.yawTarget !== null) {
      this.stage.userYaw = damp(this.stage.userYaw, this.yawTarget, 6, dt);
      if (Math.abs(this.stage.userYaw - this.yawTarget) < 0.001) this.yawTarget = null;
      this.stage.applyTransform();
    }
    if (this.autoSpin && mode.kind !== 'explore') {
      this.stage.userYaw += dt * 0.12;
      this.stage.applyTransform();
    }

    this.stage.update(dt, t, this.cameraWorld);

    // audio follows the viewer
    if (this.audio.ready) {
      this.audio.setListener(cam.matrixWorld.elements);
      this.audio.setListenerPosition(this.cameraWorld);
      this.audio.setSpatialScale(this.stage.worldScale);
    }

    // the real world dims while the portal glows
    if (this.feed.active) {
      this.dimK = damp(this.dimK, this.dimTarget, 2, dt);
      this.feed.setDim(this.dimK);
    }

    // speech bubble follows the dragon's head on screen
    if (this.elapsed < this.speechUntil) {
      const p = this.stage.dragon.mouth.getWorldPosition(new THREE.Vector3()).project(cam);
      const r = this.uiRoot.getBoundingClientRect();
      if (p.z < 1) this.overlay.placeSpeech((p.x * 0.5 + 0.5) * r.width, (-p.y * 0.5 + 0.5) * r.height - 30);
      else this.overlay.placeSpeech(null, null);
    }
  }

  // ------------------------------------------------------------------ exit
  exit() {
    const mode = this.mode;
    this.mode = null;
    mode?.stop();
    this.feed.stop();
    this.uiRoot.classList.remove('xr');
    document.body.classList.remove('camera-on', 'in-experience');
    this.audio.stopAmbience();
    this.stage.reset();
    this.overlay.reset();
    this.overlay.loading(false);
    this.engine.stop();
    this.state = 'idle';
    this.dimK = this.dimTarget = 0;
    this.feed.setDim(0);
    this.onExit();
  }

  /** Called by main when the user wants to retry the best camera path. */
  async startBest() {
    const caps = await detectCapabilities();
    if (caps.webxrAR) return this.startXRFlow();
    if (caps.camera) this.chooseCameraMode();
    else this.cameraFailed(new CameraError(caps.secure ? 'notfound' : 'insecure', ''));
  }
}
