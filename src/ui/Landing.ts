import type { Capabilities } from '../ar/capabilities';

/** Ambient particle field for the landing page (2D canvas, very cheap). */
export function startMotes(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0;
  let hgt = 0;
  let dpr = 1;
  type M = { x: number; y: number; r: number; vx: number; vy: number; a: number; tw: number; hue: number };
  let motes: M[] = [];
  const resize = () => {
    dpr = Math.min(2, devicePixelRatio || 1);
    w = canvas.clientWidth;
    hgt = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    const n = Math.round(Math.min(110, (w * hgt) / 9000));
    motes = Array.from({ length: n }, () => ({
      x: Math.random() * w,
      y: Math.random() * hgt,
      r: 0.6 + Math.random() * 1.8,
      vx: (Math.random() - 0.5) * 0.08,
      vy: -0.05 - Math.random() * 0.22,
      a: Math.random(),
      tw: 0.5 + Math.random() * 2,
      hue: Math.random() < 0.6 ? 168 : Math.random() < 0.5 ? 265 : 42,
    }));
  };
  resize();
  addEventListener('resize', resize);
  let raf = 0;
  let running = true;
  const draw = (t: number) => {
    if (!running) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    ctx.globalCompositeOperation = 'lighter';
    for (const m of motes) {
      if (!reduce) {
        m.x += m.vx + Math.sin(t * 0.0004 + m.a * 10) * 0.08;
        m.y += m.vy;
        if (m.y < -10) {
          m.y = hgt + 10;
          m.x = Math.random() * w;
        }
      }
      const alpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.001 * m.tw + m.a * 20));
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 5);
      g.addColorStop(0, `hsla(${m.hue}, 90%, 80%, ${alpha})`);
      g.addColorStop(1, `hsla(${m.hue}, 90%, 60%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return (on: boolean) => {
    running = on;
    cancelAnimationFrame(raf);
    if (on) raf = requestAnimationFrame(draw);
  };
}

export function describeCapabilities(c: Capabilities): { text: string; tone: 'good' | 'ok' | 'warn' } {
  if (!c.webgl) return { text: 'Seu navegador não suporta WebGL — o portal não pode abrir aqui.', tone: 'warn' };
  if (c.webxrAR) return { text: 'Realidade aumentada com detecção de superfícies disponível', tone: 'good' };
  if (c.camera) return { text: 'Sem detecção de superfícies neste navegador · o portal abre sobre a câmera', tone: 'ok' };
  if (!c.secure) return { text: 'A câmera exige HTTPS · explore o mundo em 3D', tone: 'warn' };
  return { text: 'Câmera indisponível · explore o mundo em 3D', tone: 'warn' };
}
