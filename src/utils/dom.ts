type Attrs = Record<string, string | number | boolean | undefined>;

/** Tiny hyperscript helper for building the UI without a framework. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T | null;

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function idle(timeout = 300): Promise<void> {
  return new Promise((resolve) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, 16);
  });
}
