import { h } from '../utils/dom';
import { Icon, type IconName } from './icons';
import type { DiscoveryDef } from '../interactions/Discoveries';
import { iconButton, labeled } from '../components/Button';

export interface Action {
  label: string;
  onClick: () => void;
  primary?: boolean;
  icon?: IconName;
}

export interface InstructionSpec {
  title: string;
  text?: string;
  visual?: 'scan' | 'marker' | 'tap' | 'tilt' | 'loading';
  actions?: Action[];
  compact?: boolean;
}

export interface OverlayHandlers {
  onExit: () => void;
  onSound: () => void;
  onScale: (v: number) => void;
  onReposition: () => void;
  onRotate: (dir: number) => void;
  onZoom: (dir: number) => void;
  onAutoRotate: () => void;
  onRestart: () => void;
  onDiscoveries: () => void;
}

const btn = iconButton;

/**
 * Minimal, elegant in-experience interface. Lives inside #ui-root, which is
 * also used as the WebXR DOM Overlay root so the same UI works in AR sessions.
 */
export class Overlay {
  readonly root: HTMLElement;
  private top: HTMLElement;
  private modeChip: HTMLElement;
  private soundBtn: HTMLButtonElement;
  private dock: HTMLElement;
  private badge: HTMLElement;
  private instructionEl: HTMLElement;
  private speechEl: HTMLElement;
  private cardEl: HTMLElement;
  private toastEl: HTMLElement;
  private hintEl: HTMLElement;
  private veilEl: HTMLElement;
  private flashEl: HTMLElement;
  private loadingEl: HTMLElement;
  private sheetEl: HTMLElement;
  private panelEl: HTMLElement;
  private scalePop: HTMLElement;
  private explorePop: HTMLElement;
  private scaleInput: HTMLInputElement;
  private autoBtn: HTMLButtonElement;
  private statusEl: HTMLElement;
  private timers = new Map<string, number>();

  constructor(root: HTMLElement, private handlers: OverlayHandlers) {
    this.root = root;

    // ---- top bar ----
    const exit = btn('close', 'Sair da experiência');
    exit.addEventListener('click', () => handlers.onExit());
    this.modeChip = h('div', { class: 'mode-chip' });
    this.soundBtn = btn('soundOn', 'Som');
    this.soundBtn.addEventListener('click', () => handlers.onSound());
    this.top = h('div', { class: 'topbar' }, exit, this.modeChip, this.soundBtn);

    // ---- dock ----
    const scaleBtn = btn('scale', 'Escala', 'dock-btn');
    const repoBtn = btn('reposition', 'Reposicionar', 'dock-btn');
    const exploreBtn = btn('explore', 'Explorar', 'dock-btn');
    const discBtn = btn('discoveries', 'Descobertas', 'dock-btn');
    this.badge = h('span', { class: 'badge' }, '0');
    discBtn.append(this.badge);
    for (const [b, label] of [
      [scaleBtn, 'Escala'],
      [repoBtn, 'Reposicionar'],
      [exploreBtn, 'Explorar'],
      [discBtn, 'Descobertas'],
    ] as const) b.append(h('span', { class: 'dock-label' }, label));
    this.dock = h('nav', { class: 'dock', 'aria-label': 'Controles' }, scaleBtn, repoBtn, exploreBtn, discBtn);

    // scale popover
    this.scaleInput = h('input', { type: 'range', min: '0', max: '100', value: '50', 'aria-label': 'Escala do mundo' }) as HTMLInputElement;
    this.scaleInput.addEventListener('input', () => handlers.onScale(Number(this.scaleInput.value) / 100));
    const minus = btn('zoomOut', 'Diminuir', 'mini-btn');
    const plus = btn('zoomIn', 'Aumentar', 'mini-btn');
    minus.addEventListener('click', () => this.nudgeScale(-0.1));
    plus.addEventListener('click', () => this.nudgeScale(0.1));
    this.scalePop = h('div', { class: 'popover pop-scale', role: 'dialog', 'aria-label': 'Escala' }, h('p', { class: 'pop-title' }, 'Escala do mundo'), h('div', { class: 'pop-row' }, minus, this.scaleInput, plus));

    // explore tray
    const rl = btn('rotateLeft', 'Girar para a esquerda', 'mini-btn');
    const rr = btn('rotateRight', 'Girar para a direita', 'mini-btn');
    const zo = btn('zoomOut', 'Afastar', 'mini-btn');
    const zi = btn('zoomIn', 'Aproximar', 'mini-btn');
    this.autoBtn = btn('orbit', 'Rotação automática', 'mini-btn');
    const rs = btn('reset', 'Reiniciar experiência', 'mini-btn');
    rl.addEventListener('click', () => handlers.onRotate(1));
    rr.addEventListener('click', () => handlers.onRotate(-1));
    zo.addEventListener('click', () => handlers.onZoom(-1));
    zi.addEventListener('click', () => handlers.onZoom(1));
    this.autoBtn.addEventListener('click', () => handlers.onAutoRotate());
    rs.addEventListener('click', () => handlers.onRestart());
    this.explorePop = h(
      'div',
      { class: 'popover pop-explore', role: 'dialog', 'aria-label': 'Exploração' },
      h('p', { class: 'pop-title' }, 'Explorar'),
      h('div', { class: 'pop-grid' }, labeled(rl, 'Girar'), labeled(rr, 'Girar'), labeled(zo, 'Afastar'), labeled(zi, 'Aproximar'), labeled(this.autoBtn, 'Órbita'), labeled(rs, 'Reiniciar')),
      h('p', { class: 'pop-note' }, 'Dica: arraste para girar · pince para mudar o tamanho'),
    );

    scaleBtn.addEventListener('click', () => this.togglePop(this.scalePop, scaleBtn));
    exploreBtn.addEventListener('click', () => this.togglePop(this.explorePop, exploreBtn));
    repoBtn.addEventListener('click', () => {
      this.closePops();
      handlers.onReposition();
    });
    discBtn.addEventListener('click', () => {
      this.closePops();
      handlers.onDiscoveries();
    });

    // ---- messages ----
    this.instructionEl = h('div', { class: 'instruction', role: 'status', 'aria-live': 'polite' });
    this.speechEl = h('div', { class: 'speech', role: 'status', 'aria-live': 'polite' });
    this.cardEl = h('div', { class: 'card', role: 'dialog' });
    this.toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    this.hintEl = h('div', { class: 'hint' });
    this.statusEl = h('div', { class: 'status-pill' });
    this.veilEl = h('div', { class: 'veil' });
    this.flashEl = h('div', { class: 'flash' });
    this.loadingEl = h('div', { class: 'loading' }, h('div', { class: 'spinner' }), h('p', { class: 'loading-text' }, 'Tecendo o mundo…'));
    this.sheetEl = h('div', { class: 'sheet-wrap' });
    this.panelEl = h('div', { class: 'panel-wrap' });

    root.append(this.flashEl, this.top, this.statusEl, this.instructionEl, this.speechEl, this.hintEl, this.cardEl, this.toastEl, this.scalePop, this.explorePop, this.dock, this.panelEl, this.sheetEl, this.loadingEl, this.veilEl);

    // UI taps must not reach the WebXR session as "select" or the gesture layer
    for (const el of [this.top, this.dock, this.scalePop, this.explorePop, this.instructionEl, this.cardEl, this.panelEl, this.sheetEl, this.toastEl]) {
      el.addEventListener('beforexrselect', (e) => e.preventDefault());
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closePops();
        this.closePanel();
        this.hideCard();
      }
    });
  }

  // ------------------------------------------------------------ chrome
  setMode(label: string) {
    this.modeChip.textContent = label;
  }

  showChrome(on: boolean) {
    this.top.classList.toggle('on', on);
  }

  showDock(on: boolean) {
    this.dock.classList.toggle('on', on);
    if (!on) this.closePops();
  }

  setMuted(m: boolean) {
    this.soundBtn.innerHTML = m ? Icon.soundOff : Icon.soundOn;
    this.soundBtn.setAttribute('aria-label', m ? 'Ativar som' : 'Silenciar');
    this.soundBtn.classList.toggle('muted', m);
  }

  setDiscoveryCount(n: number, total: number) {
    this.badge.textContent = `${n}`;
    this.badge.setAttribute('aria-label', `${n} de ${total} descobertas`);
    this.badge.classList.toggle('has', n > 0);
  }

  setScaleValue(v: number) {
    this.scaleInput.value = String(Math.round(v * 100));
  }

  setAutoRotate(on: boolean, available: boolean) {
    this.autoBtn.classList.toggle('active', on);
    (this.autoBtn.parentElement as HTMLElement).style.display = available ? '' : 'none';
  }

  private nudgeScale(d: number) {
    const v = Math.min(1, Math.max(0, Number(this.scaleInput.value) / 100 + d));
    this.setScaleValue(v);
    this.handlers.onScale(v);
  }

  private togglePop(pop: HTMLElement, anchor: HTMLElement) {
    const open = !pop.classList.contains('on');
    this.closePops();
    if (open) {
      pop.classList.add('on');
      anchor.classList.add('active');
    }
  }

  closePops() {
    for (const p of [this.scalePop, this.explorePop]) p.classList.remove('on');
    this.dock.querySelectorAll('.active').forEach((b) => b.classList.remove('active'));
  }

  // ------------------------------------------------------------ transitions
  veil(on: boolean) {
    this.veilEl.classList.toggle('on', on);
  }

  flash() {
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
  }

  loading(on: boolean, text?: string) {
    if (text) (this.loadingEl.querySelector('.loading-text') as HTMLElement).textContent = text;
    this.loadingEl.classList.toggle('on', on);
  }

  // ------------------------------------------------------------ messages
  instruction(spec: InstructionSpec | null) {
    const el = this.instructionEl;
    if (!spec) {
      el.classList.remove('on');
      return;
    }
    el.className = `instruction on${spec.compact ? ' compact' : ''}`;
    el.replaceChildren();
    if (spec.visual) el.append(visual(spec.visual));
    el.append(h('p', { class: 'ins-title' }, spec.title));
    if (spec.text) el.append(h('p', { class: 'ins-text' }, spec.text));
    if (spec.actions?.length) {
      const row = h('div', { class: 'ins-actions' });
      for (const a of spec.actions) {
        const b = h('button', { class: a.primary ? 'pill primary' : 'pill', type: 'button' });
        if (a.icon) b.innerHTML = Icon[a.icon];
        b.append(h('span', {}, a.label));
        b.addEventListener('click', a.onClick);
        row.append(b);
      }
      el.append(row);
    }
  }

  status(text: string | null) {
    this.statusEl.textContent = text ?? '';
    this.statusEl.classList.toggle('on', !!text);
  }

  /** Speech bubble; optionally anchored to a screen position (px). */
  speech(text: string, duration = 4200) {
    this.speechEl.replaceChildren(h('p', {}, text));
    this.speechEl.classList.add('on');
    this.later('speech', duration, () => this.speechEl.classList.remove('on'));
  }

  placeSpeech(x: number | null, y: number | null) {
    if (x === null || y === null) {
      this.speechEl.style.removeProperty('--sx');
      this.speechEl.style.removeProperty('--sy');
      this.speechEl.classList.remove('anchored');
      return;
    }
    const w = this.root.clientWidth;
    const hh = this.root.clientHeight;
    const cx = Math.min(w - 130, Math.max(130, x));
    const cy = Math.min(hh - 180, Math.max(90, y));
    this.speechEl.style.setProperty('--sx', `${cx}px`);
    this.speechEl.style.setProperty('--sy', `${cy}px`);
    this.speechEl.classList.add('anchored');
  }

  card(title: string, subtitle: string, text: string, duration = 9000) {
    const close = btn('close', 'Fechar', 'card-close');
    close.addEventListener('click', () => this.hideCard());
    this.cardEl.replaceChildren(close, h('p', { class: 'card-sub' }, subtitle), h('h2', { class: 'card-title' }, title), h('p', { class: 'card-text' }, text));
    this.cardEl.classList.add('on');
    this.later('card', duration, () => this.hideCard());
  }

  hideCard() {
    this.cardEl.classList.remove('on');
  }

  toast(title: string, sub: string, icon: IconName = 'sparkle') {
    this.toastEl.replaceChildren(h('span', { class: 'toast-icon', html: Icon[icon] }), h('div', {}, h('p', { class: 'toast-title' }, title), h('p', { class: 'toast-sub' }, sub)));
    this.toastEl.classList.remove('on');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('on');
    this.later('toast', 4200, () => this.toastEl.classList.remove('on'));
  }

  hint(text: string | null, duration = 5000) {
    if (!text) {
      this.hintEl.classList.remove('on');
      return;
    }
    this.hintEl.textContent = text;
    this.hintEl.classList.add('on');
    this.later('hint', duration, () => this.hintEl.classList.remove('on'));
  }

  // ------------------------------------------------------------ discoveries panel
  openPanel(defs: readonly DiscoveryDef[], has: (id: DiscoveryDef['id']) => boolean, onReset: () => void) {
    const found = defs.filter((d) => has(d.id)).length;
    const close = btn('close', 'Fechar', 'panel-close');
    close.addEventListener('click', () => this.closePanel());
    const list = h('ul', { class: 'disc-list' });
    for (const d of defs) {
      const ok = has(d.id);
      list.append(
        h(
          'li',
          { class: ok ? 'disc found' : 'disc' },
          h('span', { class: 'disc-icon', html: Icon[d.icon as IconName] ?? Icon.sparkle }),
          h('div', { class: 'disc-body' }, h('p', { class: 'disc-name' }, ok ? d.name : 'Ainda oculto'), h('p', { class: 'disc-text' }, ok ? d.text : d.hint)),
          ok ? h('span', { class: 'disc-check', html: Icon.check }) : null,
        ),
      );
    }
    const progress = h('div', { class: 'disc-progress' }, h('span', { style: `width:${(found / defs.length) * 100}%` }));
    const reset = h('button', { class: 'text-btn', type: 'button' }, 'Recomeçar coleção');
    reset.addEventListener('click', () => {
      onReset();
      this.openPanel(defs, has, onReset);
    });
    const panel = h(
      'div',
      { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'disc-title' },
      close,
      h('p', { class: 'panel-eyebrow' }, `${found} de ${defs.length} encontradas`),
      h('h2', { class: 'panel-title', id: 'disc-title' }, 'Descobertas do Portal'),
      progress,
      list,
      found > 0 ? reset : null,
    );
    const backdrop = h('div', { class: 'backdrop' });
    backdrop.addEventListener('click', () => this.closePanel());
    this.panelEl.replaceChildren(backdrop, panel);
    this.panelEl.classList.add('on');
    close.focus();
  }

  closePanel() {
    this.panelEl.classList.remove('on');
  }

  get panelOpen() {
    return this.panelEl.classList.contains('on');
  }

  // ------------------------------------------------------------ sheets
  sheet(title: string, text: string, actions: Action[]) {
    const body = h('div', { class: 'sheet', role: 'alertdialog', 'aria-labelledby': 'sheet-title' }, h('h2', { class: 'sheet-title', id: 'sheet-title' }, title), h('p', { class: 'sheet-text' }, text));
    const row = h('div', { class: 'sheet-actions' });
    for (const a of actions) {
      const b = h('button', { class: a.primary ? 'pill primary' : 'pill', type: 'button' }, a.label);
      b.addEventListener('click', a.onClick);
      row.append(b);
    }
    body.append(row);
    this.sheetEl.replaceChildren(h('div', { class: 'backdrop' }), body);
    this.sheetEl.classList.add('on');
  }

  closeSheet() {
    this.sheetEl.classList.remove('on');
  }

  reset() {
    this.instruction(null);
    this.showDock(false);
    this.showChrome(false);
    this.closePanel();
    this.closeSheet();
    this.hideCard();
    this.status(null);
    this.hint(null);
    this.speechEl.classList.remove('on');
    this.toastEl.classList.remove('on');
  }

  private later(key: string, ms: number, fn: () => void) {
    clearTimeout(this.timers.get(key));
    this.timers.set(key, window.setTimeout(fn, ms));
  }
}

function visual(kind: NonNullable<InstructionSpec['visual']>) {
  if (kind === 'loading') return h('div', { class: 'ins-visual loading-dots' }, h('i'), h('i'), h('i'));
  if (kind === 'marker') return h('div', { class: 'ins-visual v-marker', html: Icon.marker });
  if (kind === 'tap') return h('div', { class: 'ins-visual v-tap', html: Icon.hand });
  if (kind === 'tilt') return h('div', { class: 'ins-visual v-tilt', html: Icon.gyro });
  return h('div', { class: 'ins-visual v-scan' }, h('div', { class: 'phone' }), h('div', { class: 'plane' }));
}
