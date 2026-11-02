export type CameraErrorKind = 'denied' | 'notfound' | 'insecure' | 'busy' | 'unknown';

export class CameraError extends Error {
  constructor(public kind: CameraErrorKind, message: string) {
    super(message);
  }
}

/** Assumed horizontal field of view of a phone's main camera along its long side. */
export const ASSUMED_LONG_SIDE_FOV = 64;

/** Rear camera video shown behind the transparent WebGL canvas. */
export class CameraFeed {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;

  constructor(container: HTMLElement) {
    this.video = document.createElement('video');
    this.video.className = 'camera-feed';
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('muted', '');
    this.video.muted = true;
    this.video.autoplay = true;
    container.prepend(this.video);
  }

  get active() {
    return !!this.stream;
  }

  get width() {
    return this.video.videoWidth;
  }

  get height() {
    return this.video.videoHeight;
  }

  async start() {
    if (!window.isSecureContext) throw new CameraError('insecure', 'A câmera exige HTTPS.');
    if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('notfound', 'Este navegador não oferece acesso à câmera.');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraError('denied', 'Permissão de câmera negada.');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CameraError('notfound', 'Nenhuma câmera encontrada.');
      if (name === 'NotReadableError' || name === 'AbortError') throw new CameraError('busy', 'A câmera está em uso por outro aplicativo.');
      throw new CameraError('unknown', String((e as Error)?.message ?? e));
    }
    this.video.srcObject = this.stream;
    this.video.classList.add('on');
    await this.video.play().catch(() => undefined);
    if (!this.video.videoWidth) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        this.video.addEventListener('loadedmetadata', done, { once: true });
        setTimeout(done, 2500);
      });
    }
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.video.classList.remove('on');
  }

  /**
   * Vertical FOV (degrees) for a camera rendering into a viewW×viewH viewport
   * on top of this video displayed with `object-fit: cover`.
   */
  verticalFov(viewW: number, viewH: number, longSideFov = ASSUMED_LONG_SIDE_FOV) {
    const vw = this.width || 1280;
    const vh = this.height || 720;
    const fVideo = Math.max(vw, vh) / 2 / Math.tan(((longSideFov / 2) * Math.PI) / 180);
    const s = Math.max(viewW / vw, viewH / vh);
    const fScreen = fVideo * s;
    return (2 * Math.atan(viewH / 2 / fScreen) * 180) / Math.PI;
  }

  /** Brightness/saturation shift while the portal opens (the real world "dims"). */
  setDim(k: number) {
    this.video.style.filter = k > 0.001 ? `brightness(${1 - k * 0.35}) saturate(${1 - k * 0.25}) contrast(${1 + k * 0.05})` : '';
  }
}
