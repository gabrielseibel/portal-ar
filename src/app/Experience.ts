import * as THREE from 'three';
import { Engine } from '../systems/Engine';
import { QUALITY, type QualitySettings, type QualityLevel } from '../systems/Quality';
import { Haptics } from '../systems/Haptics';
import { Stage, type WorldKind } from '../scenes/Stage';
import { Overlay, type InstructionSpec, type Action } from '../ui/Overlay';
import { InteractionSystem } from '../interactions/InteractionSystem';
import { Gestures } from '../interactions/Gestures';
import { Discoveries, type DiscoveryId } from '../interactions/Discoveries';
import { World } from '../world/World';
import { FarmWorld } from '../world/farm/FarmWorld';
import { FARM_DISCOVERIES } from '../world/farm/discoveries';
import { DudaWorld } from '../world/duda/DudaWorld';
import { DUDA_DISCOVERIES } from '../world/duda/discoveries';
import { FIELD_NAMES, type FieldKind } from '../world/duda/layout';
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
  stage: Stage;
  readonly overlay: Overlay;
  discoveries: Discoveries;
  worldKind: WorldKind;
  /** Object the speech bubble follows on screen. */
  private speechTarget: THREE.Object3D | null = null;
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

  static async create(audio: AudioEngine, quality: QualitySettings, kind: WorldKind = 'fantasia') {
    const exp = new Experience(audio, quality, kind);
    await nextFrame();
    await exp.worldReady();
    await exp.warmupStage();
    void loadOptionalModels(exp.stage.world.group);
    return exp;
  }

  /** Worlds built from external models load them asynchronously. */
  private async worldReady() {
    const w = this.stage.world;
    if (w instanceof DudaWorld) {
      await w.ready;
      if (w.loadError) this.overlay.hint('Não foi possível carregar os modelos da fazenda. Recarregue a página.', 8000);
    }
  }

  /** Compile every shader up front (three skips invisible objects, so reveal them briefly). */
  private async warmupStage() {
    const st = this.stage;
    const hidden = [st.anchor, st.world.group, st.sky.group, st.birds.group, st.dragon.root];
    const prev = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = true));
    await this.engine.warmup();
    hidden.forEach((o, i) => (o.visible = prev[i]));
  }

  /** Swaps the world inside the portal (only while no experience is running). */
  async setWorld(kind: WorldKind) {
    if (kind === this.worldKind) return;
    this.overlay.loading(true, 'Tecendo o mundo…');
    await nextFrame();
    this.stage.dispose(this.engine.scene);
    this.explore?.controls.dispose();
    this.explore = null;
    this.worldKind = kind;
    this.stage = new Stage(this.engine.scene, this.quality, kind);
    this.bindWorld();
    await this.worldReady();
    await this.warmupStage();
    this.overlay.loading(false);
  }

  private constructor(
    private audio: AudioEngine,
    quality: QualitySettings,
    kind: WorldKind,
  ) {
    this.quality = quality;
    const viewport = document.getElementById('viewport')!;
    this.uiRoot = document.getElementById('ui-root')!;
    const input = document.getElementById('input-layer')!;
    this.engine = new Engine(viewport, quality);
    this.engine.renderer.localClippingEnabled = true;
    this.feed = new CameraFeed(viewport);
    this.worldKind = kind;
    this.stage = new Stage(this.engine.scene, quality, kind);
    this.discoveries = new Discoveries();
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
        this.overlay.openPanel(this.discoveries.defs, (id) => this.discoveries.has(id), () => this.discoveries.reset());
      },
    });
    this.overlay.setMuted(this.audio.muted);
    this.audio.onChange = (m) => this.overlay.setMuted(m);

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

    this.bindWorld();

    // engine hooks
    this.engine.add((dt, t, frame) => this.update(dt, t, frame));
    this.engine.onContextLost = () => this.overlay.loading(true, 'Restaurando os gráficos…');
    this.engine.onContextRestored = () => this.overlay.loading(false);
    this.engine.onSlowFrames = () => this.degradeQuality();

    (window as unknown as { __portal: unknown }).__portal = this;
  }

  /** Wires the current Stage/world into the experience (events, discoveries, touch targets). */
  private bindWorld() {
    this.discoveries =
      this.worldKind === 'vila'
        ? new Discoveries(FARM_DISCOVERIES, 'discoveries.vila')
        : this.worldKind === 'duda'
          ? new Discoveries(DUDA_DISCOVERIES, 'discoveries.duda')
          : new Discoveries();
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
    this.interactions.clear();
    if (this.stage.world instanceof World) {
      this.stage.world.spirit.onAppear = () => {
        if (!this.discoveries.has('espirito')) this.overlay.hint('Algo brilhante se move na campina…', 5000);
      };
      this.registerInteractions();
    } else if (this.stage.world instanceof FarmWorld) this.registerFarmInteractions(this.stage.world);
    else this.registerDudaInteractions(this.stage.world);
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
    if (!(w instanceof World)) {
      this.audio.startAmbience(w.sounds.map((p) => w.group.localToWorld(p.clone())));
      return;
    }
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

  private say(text: string, target: THREE.Object3D, seconds = 4.5) {
    this.speechTarget = target;
    this.overlay.speech(text, seconds * 1000);
    this.speechUntil = this.elapsed + seconds;
  }

  private discover(id: DiscoveryId) {
    this.discoveries.find(id);
  }

  private registerInteractions() {
    const st = this.stage;
    const w = st.world as World;
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
        this.say(DRAGON_LINE, st.dragon.mouth, 4.5);
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


  // ------------------------------------------------------------------ Vale Alecrim interactions
  private registerFarmInteractions(w: FarmWorld) {
    const st = this.stage;
    const add = this.interactions.add.bind(this.interactions);
    const P = w.proxies;
    const burstAt = (o: THREE.Object3D | THREE.Vector3, n: number, color: string, colorEnd: string, speed = 0.3, gravity = 0) =>
      st.bursts.burst(this.toStage(o instanceof THREE.Vector3 ? w.group.localToWorld(o.clone()) : o), n, speed, { life: 1.3, size: 0.022, color, colorEnd, gravity });
    let coopTaps = 0;
    let casts = 0;
    let letterIndex = 0;
    let seasonHint = false;

    // villagers talk (and stop walking for a moment)
    for (const v of w.villagers) {
      let line = 0;
      add({
        name: `npc:${v.name}`,
        object: v.p.hitProxy,
        priority: 3,
        onTap: () => {
          v.pause = Math.max(v.pause, 3.5);
          this.audio.voice(this.worldPos(v.p.root), v.role === 'criança' ? 1.5 : v.name === 'Bento' || v.name === 'Seu Olavo' ? 0.8 : 1.1);
          this.say(`${v.name}: “${v.lines[line++ % v.lines.length]}”`, v.p.head, 4.5);
        },
      });
    }
    add({
      name: 'field',
      object: P.field,
      onTap: () => {
        const picked = w.harvest();
        if (w.season === 3) return this.overlay.hint('No inverno a horta descansa. Toque na Árvore Anciã para mudar a estação.', 4500);
        if (!picked.length) return this.overlay.hint('A horta ainda está crescendo… volte daqui a pouco.', 3500);
        for (const p of picked) burstAt(p, 6, '#fff3b0', '#7fc75a', 0.25, 0.4);
        this.audio.harvest(this.worldPos(P.field), picked.length);
        Haptics.soft();
        this.overlay.hint(`Você colheu ${picked.length} ${picked.length === 1 ? 'planta' : 'plantas'}!`, 3000);
      },
    });
    add({
      name: 'coop',
      object: P.coop,
      onTap: () => {
        w.excite('chickens');
        this.audio.cluck(this.worldPos(P.coop));
        coopTaps++;
        if (coopTaps >= 2 && !w.goldenVisible && (coopTaps >= 4 || Math.random() < 0.45) && w.showGolden()) {
          this.overlay.hint('Uma galinha dourada apareceu no galinheiro!', 4000);
        }
      },
    });
    add({
      name: 'golden',
      object: P.golden,
      priority: 4,
      onTap: () => {
        burstAt(P.golden, 30, '#fff0b0', '#ffb52e', 0.35);
        this.audio.cluck(this.worldPos(P.golden), 1.4);
        this.discover('vale-galinha');
        setTimeout(() => w.hideGolden(), 2500);
      },
    });
    add({ name: 'cows', object: P.cows, onTap: () => (w.excite('cows'), this.audio.moo(this.worldPos(P.cows))) });
    add({ name: 'cat', object: P.cat, priority: 3, onTap: () => (w.wakeCat(), this.audio.meow(this.worldPos(P.cat))) });

    // fishing
    const FISH = ['Lambari-prateado', 'Tilápia-do-vale', 'Carpa-sol', 'Bagre-ranzinza', 'Piaba-arco-íris'];
    w.onCatch = (at) => {
      this.audio.splash(w.group.localToWorld(at.clone()));
      burstAt(at, 14, '#e9fbff', '#7fc7e8', 0.2, 0.6);
      casts++;
      const legendary = !this.discoveries.has('vale-peixe') && (casts >= 6 || (casts >= 3 && Math.random() < 0.3));
      if (legendary) {
        this.overlay.card('Dourado Ancião', 'Pesca lendária', 'Escamas cor de sol, olhos calmos como o lago. Ele te olha um instante… e volta para o fundo.', 7000);
        this.discover('vale-peixe');
      } else {
        const night = w.isNight && Math.random() < 0.5;
        const name = night ? 'Peixe-lanterna' : FISH[Math.floor(Math.random() * FISH.length)];
        this.overlay.hint(`Fisgou: ${name}!${night ? ' (só aparece à noite)' : ''}`, 3500);
      }
    };
    add({
      name: 'pond',
      object: P.pond,
      onTap: () => {
        if (w.cast()) this.audio.splash(this.worldPos(P.pond), 0.4);
      },
    });

    // mail
    const LETTERS: Array<[string, string]> = [
      ['Da Celeste, a padeira', 'Bem-vinda ao vale! Passe na padaria: o primeiro pão de queijo é sempre por conta da casa.'],
      ['Da prefeita Dalva', 'Lembrete: na próxima lua cheia teremos festa na praça. Traga o que a sua horta tiver de melhor!'],
      ['Do Bento, o ferreiro', 'Sua enxada está pronta. Ficou tão afiada que corta até preguiça de segunda-feira.'],
    ];
    add({
      name: 'mailbox',
      object: P.mailbox,
      onTap: () => {
        if (!w.letterWaiting) return this.overlay.hint('Nenhuma carta nova. A bandeirinha vermelha avisa quando chegar.', 3500);
        w.takeLetter();
        this.audio.ui();
        if (letterIndex < LETTERS.length) {
          const [from, text] = LETTERS[letterIndex++];
          this.overlay.card('Uma carta chegou', from, text, 9000);
        } else {
          this.overlay.card('Carta sem remetente', 'Papel antigo, tinta desbotada', '“Onde a areia encontra a água e o X marca o lugar, o avô guardou o que o vale não deve esquecer.”', 11000);
          this.discover('vale-carta');
        }
      },
    });

    // secrets
    add({
      name: 'treasure',
      object: P.treasure,
      priority: 3,
      onTap: () => {
        if (!w.digTreasure()) return;
        this.audio.chest(this.worldPos(P.treasure));
        setTimeout(() => {
          for (let i = 0; i < 30; i++) st.bursts.emit(this.toStage(P.treasure), { x: (Math.random() - 0.5) * 0.3, y: 0.4 + Math.random() * 0.3, z: (Math.random() - 0.5) * 0.3 }, { life: 1.2, size: 0.02, color: '#ffe08a', colorEnd: '#d9a23a', gravity: 1.1, drag: 0.4 });
          this.discover('vale-tesouro');
        }, 900);
      },
    });
    add({
      name: 'mine',
      object: P.mine,
      priority: 3,
      onTap: () => {
        w.openMine();
        burstAt(P.mine, 30, '#bff8ff', '#4fd8ff', 0.25);
        this.audio.crystalChime(this.worldPos(P.mine), 2);
        this.discover('vale-mina');
      },
    });
    add({
      name: 'mushroom',
      object: P.mushroom,
      priority: 2,
      onTap: () => {
        w.bounceMushroom();
        burstAt(P.mushroom, 24, '#ffd1d1', '#ff5a4a', 0.25, -0.1);
        this.audio.mushroomChoir(this.worldPos(P.mushroom));
        this.discover('vale-cogumelo');
      },
    });
    add({
      name: 'spirit',
      object: P.spirit,
      priority: 4,
      enabled: () => w.spiritVisible,
      onTap: () => {
        burstAt(P.spirit, 36, '#dffcff', '#5ff2d6', 0.35, -0.15);
        this.audio.spiritChime(this.worldPos(P.spirit));
        this.discover('vale-espirito');
      },
    });

    // village life
    add({
      name: 'ancient',
      object: P.ancient,
      onTap: () => {
        const name = w.nextSeason();
        burstAt(P.ancient, 30, ['#ffc2dc', '#fff2a8', '#e8913a', '#ffffff'][w.season], '#7fc75a', 0.3);
        this.audio.crystalChime(this.worldPos(P.ancient), w.season * 2);
        this.overlay.toast('A estação mudou', `${name} chegou ao Vale Alecrim`, 'sparkle');
        if (!seasonHint) {
          seasonHint = true;
          setTimeout(() => this.overlay.hint('Toque de novo na Árvore Anciã para a próxima estação.', 4000), 1500);
        }
      },
    });
    add({
      name: 'tower',
      object: P.tower,
      onTap: () => {
        w.skipTime(0.25);
        this.audio.villageBells(this.worldPos(P.tower));
        this.overlay.hint(`O sino tocou — agora são ${w.clock}${w.isNight ? ' (noite)' : ''}.`, 3500);
      },
    });
    const info: Record<string, [string, string, string]> = {
      bakery: ['Padaria Fornalha', 'Da Celeste', 'Pão de queijo, bolo de fubá e sonhos de doce de leite. O cheiro chega até a fazenda nas manhãs de vento.'],
      tavern: ['Taverna Caneca de Cobre', 'O coração da vila', 'Música aos sábados, sopa de abóbora no inverno e histórias que crescem a cada caneca.'],
      store: ['Armazém do Vale', 'Sementes e miudezas', 'Sementes da estação, fitas, botões e aquele doce de goiaba que acaba sempre antes do fim de semana.'],
      forge: ['Forja do Bento', 'Ferro e fogo', 'Ferraduras, enxadas e um sino novo para a torre, se o Bento um dia terminar de polir.'],
      library: ['Biblioteca do Vale', 'Do Seu Olavo', 'Mapas antigos, diários de fazendeiros e um livro sobre uma mina esquecida atrás da cachoeira.'],
      notices: ['Quadro de avisos', 'Praça central', '“Procura-se: galinha fujona.” · “Festa da colheita na próxima lua cheia!” · “Alguém viu um X na areia?”'],
    };
    for (const [key, [title, sub, text]] of Object.entries(info)) {
      add({
        name: key,
        object: P[key],
        onTap: () => {
          this.overlay.card(title, sub, text, 9000);
          if (key === 'forge') {
            this.audio.anvil(this.worldPos(P.forge));
            burstAt(P.forge, 26, '#ffe2a1', '#ff6a2a', 0.35, 0.8);
          } else if (key === 'tavern') this.audio.villageBells(this.worldPos(P.tavern));
          else this.audio.ui();
        },
      });
    }
  }

  // ------------------------------------------------------------------ Fazenda da Duda interactions
  private registerDudaInteractions(w: DudaWorld) {
    const st = this.stage;
    const add = this.interactions.add.bind(this.interactions);
    const P = w.proxies;
    const burstAt = (o: THREE.Object3D | THREE.Vector3, n: number, color: string, colorEnd: string, speed = 0.3, gravity = 0) =>
      st.bursts.burst(this.toStage(o instanceof THREE.Vector3 ? w.group.localToWorld(o.clone()) : o), n, speed, { life: 1.3, size: 0.02, color, colorEnd, gravity });
    let chickenTaps = 0;
    let casts = 0;
    let line = 0;

    const DUDA_LINES = [
      'Oi! Eu sou a Duda. Bem-vindo à minha fazenda!',
      'Toque nas plantações para colher. Elas crescem de novo rapidinho.',
      'O Biscoito dorme o dia inteiro perto da estufa… se você deixar.',
      'As galinhas adoram atenção. Às vezes até demais!',
      'Dizem que no lago vive uma carpa de todas as cores.',
      'À noite a estufa fica diferente. Eu juro que vi uma luz lá dentro.',
      'Perdi meu trevo da sorte em algum lugar na campina da frente…',
      'Se cansar, toque na casa: a gente descansa até o sol mudar.',
    ];
    add({
      name: 'duda',
      object: w.duda.hitProxy,
      priority: 4,
      onTap: () => {
        w.greet(4.5);
        this.audio.voice(this.worldPos(w.duda.root), 1.35);
        this.say(`Duda: “${DUDA_LINES[line++ % DUDA_LINES.length]}”`, w.duda.head, 4.5);
      },
    });

    // crops
    for (const k of Object.keys(FIELD_NAMES) as FieldKind[]) {
      add({
        name: `field:${k}`,
        object: P[`field:${k}`],
        onTap: () => {
          const [one, many] = FIELD_NAMES[k];
          if (!w.harvest(k)) return this.overlay.hint(`A plantação de ${one} ainda está crescendo… volte daqui a pouco.`, 3200);
          const c = w.fieldCenter(k);
          for (let i = 0; i < 4; i++) burstAt(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0, (Math.random() - 0.5) * 0.15)), 8, '#fff3b0', '#7fc75a', 0.25, 0.4);
          this.audio.harvest(this.worldPos(P[`field:${k}`]), 6);
          Haptics.soft();
          this.overlay.hint(`Você colheu ${many}! (${w.harvested.size}/5 plantações)`, 3000);
          if (w.harvested.size === 5) this.discover('duda-colheita');
        },
      });
    }

    // the farmhouse: rest until the light changes
    add({
      name: 'house',
      object: P.house,
      onTap: () => {
        w.skipTime(0.5);
        w.puffSmoke();
        this.audio.villageBells(this.worldPos(P.house));
        this.overlay.card('Casa da Duda', 'Onde tudo começa', `Café passado, pão de queijo no forno e a varanda virada para a horta. A Duda descansou um pouco: agora são ${w.clock}${w.isNight ? ', noite' : ''}.`, 7000);
      },
    });
    add({
      name: 'barn',
      object: P.barn,
      onTap: () => {
        this.audio.moo(this.worldPos(P.barn));
        this.overlay.card('Celeiro Vermelho', 'Feno e ferramentas', 'Lá dentro moram a Mimosa e a Estrela, duas vacas que só saem quando a Duda canta.', 6000);
      },
    });
    add({
      name: 'shed',
      object: P.shed,
      onTap: () => {
        this.audio.ui();
        this.overlay.card('Galpão', 'Sementes e regadores', 'Prateleiras de sementes, três regadores furados e um caderno com as receitas da vó da Duda.', 6000);
      },
    });
    add({
      name: 'scarecrow',
      object: P.scarecrow,
      onTap: () => {
        this.audio.ui();
        this.overlay.hint('O espantalho Seu Palha cuida da horta. Os corvos fingem que têm medo.', 3500);
      },
    });

    // secrets
    add({
      name: 'dog',
      object: P.dog,
      priority: 4,
      onTap: () => {
        const first = w.wakeDog();
        this.audio.voice(this.worldPos(P.dog), 2.1);
        burstAt(P.dog, 14, '#fff1c4', '#ffb04a', 0.2, -0.1);
        if (first) {
          this.overlay.hint('Biscoito acordou e foi correndo atrás da Duda!', 3500);
          this.discover('duda-biscoito');
        }
      },
    });
    add({
      name: 'chickens',
      object: P.chickens,
      onTap: () => {
        w.exciteChickens();
        this.audio.cluck(this.worldPos(P.chickens));
        chickenTaps++;
        if (chickenTaps >= 3 && !this.discoveries.has('duda-ovo') && w.showEgg()) this.overlay.hint('Uma galinha botou algo brilhante na grama!', 4000);
      },
    });
    add({ name: 'coop', object: P.coop, onTap: () => (w.exciteChickens(), this.audio.cluck(this.worldPos(P.coop), 0.9)) });
    add({
      name: 'egg',
      object: P.egg,
      priority: 5,
      enabled: () => w.eggVisible,
      onTap: () => {
        burstAt(P.egg, 30, '#fff0b0', '#ffb52e', 0.35);
        this.audio.chest(this.worldPos(P.egg));
        w.takeEgg();
        this.discover('duda-ovo');
      },
    });
    add({
      name: 'hives',
      object: P.hives,
      onTap: () => {
        const honey = w.buzzHives();
        burstAt(P.hives, 16, '#ffe14d', '#ffb21a', 0.25, -0.05);
        this.audio.crystalChime(this.worldPos(P.hives), 1);
        if (honey) {
          this.overlay.hint('As abelhas deixaram um pote de mel dourado!', 3500);
          this.discover('duda-mel');
        } else if (w.hiveTaps < 3) this.overlay.hint('Bzzz… as abelhas estão ficando curiosas.', 2500);
      },
    });
    add({
      name: 'greenhouse',
      object: P.greenhouse,
      onTap: () => {
        if (w.isNight) {
          w.bloomMoonFlower();
          burstAt(P.greenhouse, 36, '#dffcff', '#7fd6ff', 0.3, -0.12);
          this.audio.spiritChime(this.worldPos(P.greenhouse));
          this.discover('duda-lua');
          return;
        }
        this.audio.ui();
        this.overlay.card('Estufa de Vidro', 'Mudas e flores raras', 'Morangos o ano inteiro, orquídeas da vó e um vaso misterioso com uma plaquinha: “só à noite”.', 6500);
      },
    });
    add({
      name: 'clover',
      object: P.clover,
      priority: 5,
      onTap: () => {
        w.findClover();
        burstAt(P.clover, 26, '#e9ffd0', '#5fd15a', 0.25, -0.1);
        this.audio.crystalChime(this.worldPos(P.clover), 4);
        this.discover('duda-trevo');
      },
    });

    // fishing
    const FISH = ['Lambari', 'Tilápia', 'Carpa-dourada', 'Bagre-bigodudo', 'Peixinho-vermelho'];
    let legendaryNext = false;
    w.onCatch = (where) => {
      this.audio.splash(w.group.localToWorld(where.clone()));
      burstAt(where, 14, '#e9fbff', '#7fc7e8', 0.2, 0.6);
      if (legendaryNext) {
        this.overlay.card('Carpa Arco-íris', 'Pesca lendária', 'Ela saltou, brilhou em todas as cores e voltou para o fundo do lago. A Duda ficou sem palavras.', 7000);
        this.discover('duda-peixe');
      } else this.overlay.hint(`Fisgou: ${FISH[Math.floor(Math.random() * FISH.length)]}!`, 3000);
    };
    add({
      name: 'pond',
      object: P.pond,
      onTap: () => {
        if (!w.cast()) return;
        casts++;
        legendaryNext = !this.discoveries.has('duda-peixe') && (casts >= 5 || (casts >= 3 && Math.random() < 0.3));
        w.setFishLook(legendaryNext);
        this.audio.splash(this.worldPos(P.pond), 0.4);
      },
    });

    // the trees are known once the farm model has loaded
    void w.ready.then(() => {
      if (this.stage.world !== w) return;
      w.trees.forEach((tr, i) => {
        const fruity = tr.kind === 'apple' || tr.kind === 'orange';
        const color = tr.kind === 'apple' ? '#e5383b' : tr.kind === 'orange' ? '#ff9b2f' : tr.kind === 'blossom' ? '#f7bdd6' : tr.kind === 'autumn' ? '#f2b233' : '#7fd26a';
        add({
          name: `tree:${i}`,
          object: tr.proxy,
          onTap: () => {
            w.shakeTree(tr);
            burstAt(tr.center, fruity ? 10 : 18, color, color, 0.22, fruity ? 1.4 : 0.25);
            this.audio.harvest(this.worldPos(tr.proxy), 2);
            Haptics.tap();
          },
        });
      });
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
      const p = (this.speechTarget ?? this.stage.dragon.mouth).getWorldPosition(new THREE.Vector3()).project(cam);
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
