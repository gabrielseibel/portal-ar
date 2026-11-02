export interface GestureHandlers {
  onTap?: (x: number, y: number) => void;
  onDrag?: (dx: number, dy: number, x: number, y: number) => void;
  onPinch?: (factor: number) => void;
  onTwist?: (radians: number) => void;
  onPan?: (dx: number, dy: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

interface P {
  id: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  t: number;
}

/**
 * Minimal multi-touch recognizer: tap, one-finger drag, two-finger pinch,
 * twist and pan. Pointer Events only (works for touch, pen and mouse).
 */
export class Gestures {
  private pts = new Map<number, P>();
  private moved = false;
  private multi = false;
  private lastDist = 0;
  private lastAngle = 0;
  private lastMid = { x: 0, y: 0 };
  handlers: GestureHandlers = {};

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('wheel', this.wheel, { passive: false });
  }

  private down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    this.pts.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    if (this.pts.size === 1) {
      this.moved = false;
      this.multi = false;
      this.handlers.onStart?.();
    }
    if (this.pts.size === 2) {
      this.multi = true;
      const [a, b] = [...this.pts.values()];
      this.lastDist = Math.hypot(b.x - a.x, b.y - a.y);
      this.lastAngle = Math.atan2(b.y - a.y, b.x - a.x);
      this.lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  };

  private move = (e: PointerEvent) => {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 9) this.moved = true;
    if (this.pts.size === 1 && !this.multi && this.moved) this.handlers.onDrag?.(dx, dy, p.x, p.y);
    else if (this.pts.size >= 2) {
      const [a, b] = [...this.pts.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.lastDist > 0) this.handlers.onPinch?.(dist / this.lastDist);
      let da = ang - this.lastAngle;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      this.handlers.onTwist?.(da);
      this.handlers.onPan?.(mid.x - this.lastMid.x, mid.y - this.lastMid.y);
      this.lastDist = dist;
      this.lastAngle = ang;
      this.lastMid = mid;
    }
  };

  private up = (e: PointerEvent) => {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    this.pts.delete(e.pointerId);
    const quick = performance.now() - p.t < 450;
    if (this.pts.size === 0) {
      if (!this.moved && !this.multi && quick) this.handlers.onTap?.(e.clientX, e.clientY);
      this.handlers.onEnd?.();
    } else if (this.pts.size === 1) {
      this.lastDist = 0;
    }
  };

  private cancel = (e: PointerEvent) => {
    this.pts.delete(e.pointerId);
    if (this.pts.size === 0) this.handlers.onEnd?.();
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.handlers.onPinch?.(Math.exp(-e.deltaY * 0.0015));
  };
}
