const svg = (body: string, extra = '') =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const Icon = {
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  soundOn: svg('<path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 9.5a3.5 3.5 0 010 5M18.5 7a7 7 0 010 10"/>'),
  soundOff: svg('<path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 10l4 4M20 10l-4 4"/>'),
  scale: svg('<path d="M4 20l6-6M4 20v-5M4 20h5M20 4l-6 6M20 4v5M20 4h-5"/>'),
  reposition: svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  explore: svg('<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/>'),
  discoveries: svg('<path d="M12 3l2.3 5.6L20 9.3l-4.4 3.9 1.3 5.8L12 16l-4.9 3 1.3-5.8L4 9.3l5.7-.7L12 3z"/>'),
  rotateLeft: svg('<path d="M4 12a8 8 0 108-8"/><path d="M4 5v4h4" transform="translate(0 -1)"/><path d="M12 4H8"/>'),
  rotateRight: svg('<path d="M20 12a8 8 0 11-8-8"/><path d="M20 4v4h-4"/><path d="M12 4h4"/>'),
  zoomIn: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8v6M8 11h6"/>'),
  zoomOut: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8 11h6"/>'),
  orbit: svg('<ellipse cx="12" cy="12" rx="9" ry="4"/><circle cx="12" cy="12" r="2.2"/><path d="M19 9l2 1.5-2.3.9"/>'),
  reset: svg('<path d="M4 4v6h6"/><path d="M5 15a7.5 7.5 0 102-8L4 10"/>'),
  marker: svg('<rect x="4" y="4" width="16" height="16" rx="1.5"/><rect x="8" y="8" width="3" height="3"/><rect x="13" y="13" width="3" height="3"/><rect x="13" y="8" width="3" height="2"/>'),
  gyro: svg('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M3 9a10 10 0 000 6M21 9a10 10 0 010 6"/>'),
  hand: svg('<path d="M9 11V5.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-.5V6.5a1.5 1.5 0 013 0v7a7 7 0 01-7 7h-.6a6 6 0 01-4.6-2.2L4 14.8a1.5 1.5 0 012.3-1.9L9 15V8.5a1.5 1.5 0 013 0"/>'),
  check: svg('<path d="M5 12.5l4.2 4.2L19 7"/>'),
  sparkle: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>'),
  // discovery glyphs
  crystal: svg('<path d="M12 2l5 6-5 14-5-14 5-6z"/><path d="M7 8h10M12 2v20"/>'),
  dragon: svg('<path d="M4 15c2-6 7-8 12-6l3-3 1 4-2 2c1 4-2 7-6 7-3 0-5-1-6-3"/><circle cx="15" cy="10" r=".8" fill="currentColor"/><path d="M8 12l-3-4 4 1"/>'),
  door: svg('<path d="M6 21V10a6 6 0 0112 0v11"/><path d="M3 21h18M12 4v17"/><circle cx="14.5" cy="14" r=".7" fill="currentColor"/>'),
  chest: svg('<rect x="3" y="10" width="18" height="10" rx="1.5"/><path d="M3 10a9 5 0 0118 0M3 14h18"/><rect x="10.5" y="12.5" width="3" height="3"/>'),
  spirit: svg('<path d="M12 21c-4 0-7-3-7-7 0-3 2-5 3-8 1 2 2 3 4 3 0-2 1-4 3-6 1 3 3 5 3 9 0 5-3 9-6 9z"/><circle cx="10" cy="14" r=".7" fill="currentColor"/><circle cx="14" cy="14" r=".7" fill="currentColor"/>'),
  bird: svg('<path d="M2 13c4 0 6-2 8-5 1 3 3 4 6 4l6-3-3 5c-2 3-6 4-9 3l-3 3v-4c-2 0-4-1-5-3z"/>'),
  mushroom: svg('<path d="M3 12a9 7 0 0118 0z"/><path d="M9.5 12v6a2.5 2.5 0 005 0v-6"/><circle cx="8" cy="9" r="1"/><circle cx="14" cy="7.5" r="1.2"/>'),
} as const;

export type IconName = keyof typeof Icon;
