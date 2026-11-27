// 자체 제작 아이콘 (단순 선형 SVG, 상용 프로그램 아이콘을 복제하지 않음)
import type { JSX } from 'react';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const ICONS: Record<string, JSX.Element> = {
  new: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M6 3h8l4 4v14H6z M14 3v4h4" />
    </svg>
  ),
  open: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M3 7h6l2 2h10v10H3z" />
    </svg>
  ),
  save: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M4 4h13l3 3v13H4z M8 4v5h8V4 M8 20v-6h8v6" />
    </svg>
  ),
  undo: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M9 7L4 12l5 5 M4 12h11a5 5 0 0 1 0 10h-3" />
    </svg>
  ),
  redo: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M15 7l5 5-5 5 M20 12H9a5 5 0 0 0 0 10h3" />
    </svg>
  ),
  line: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M4 20L20 4" />
      <circle cx="4" cy="20" r="1.6" />
      <circle cx="20" cy="4" r="1.6" />
    </svg>
  ),
  circle: (
    <svg viewBox="0 0 24 24" {...P}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12h8" />
    </svg>
  ),
  arc: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M4 18a9 9 0 0 1 16 0" />
    </svg>
  ),
  pline: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M3 19l5-10 5 6h3a4 4 0 0 0 4-4V5" />
    </svg>
  ),
  rect: (
    <svg viewBox="0 0 24 24" {...P}>
      <rect x="4" y="6" width="16" height="12" />
    </svg>
  ),
  text: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M5 6h14 M12 6v13" />
    </svg>
  ),
  move: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M12 3v18 M3 12h18 M12 3l-3 3 M12 3l3 3 M12 21l-3-3 M12 21l3-3 M3 12l3-3 M3 12l3 3 M21 12l-3-3 M21 12l-3 3" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" {...P}>
      <rect x="4" y="4" width="11" height="11" />
      <rect x="9" y="9" width="11" height="11" />
    </svg>
  ),
  rotate: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M20 12a8 8 0 1 1-3-6.2 M17 2v4h-4" />
    </svg>
  ),
  trim: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M4 12h8 M15 12h5" strokeDasharray="0" />
      <path d="M12 4v16" />
      <path d="M15 9l4 6 M19 9l-4 6" strokeWidth="1.2" />
    </svg>
  ),
  offset: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M4 18c3-8 9-12 16-12 M4 22c3-6 9-10 16-10" />
    </svg>
  ),
  erase: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M4 15l8-8 7 7-5 5H8z M10 20h10" />
    </svg>
  ),
  dimlinear: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M4 6v12 M20 6v12 M4 10h16 M4 10l3-2 M4 10l3 2 M20 10l-3-2 M20 10l-3 2" />
    </svg>
  ),
  dimaligned: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M4 16L16 4 M8 20L20 8 M6 18l12-12" />
    </svg>
  ),
  dimdia: (
    <svg viewBox="0 0 24 24" {...P}>
      <circle cx="12" cy="12" r="8" />
      <path d="M6 18L18 6" />
    </svg>
  ),
  dimrad: (
    <svg viewBox="0 0 24 24" {...P}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12l6-6" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  ),
  dist: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M3 16l13-13 5 5-13 13z M7 12l2 2 M10 9l2 2 M13 6l2 2" />
    </svg>
  ),
  layer: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M12 3l9 5-9 5-9-5z M3 13l9 5 9-5" />
    </svg>
  ),
  hole: (
    <svg viewBox="0 0 24 24" {...P}>
      <circle cx="7" cy="7" r="3" />
      <circle cx="17" cy="7" r="3" />
      <circle cx="7" cy="17" r="3" />
      <circle cx="17" cy="17" r="3" />
    </svg>
  ),
  zoomext: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5" />
      <rect x="8" y="8" width="8" height="8" />
    </svg>
  ),
  mirror: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M12 3v18" strokeDasharray="2 2" />
      <path d="M9 7L4 17h5z M15 7l5 10h-5z" />
    </svg>
  ),
  scale: (
    <svg viewBox="0 0 24 24" {...P}>
      <rect x="3" y="11" width="10" height="10" />
      <path d="M9 3h12v12 M13 11l8-8" />
    </svg>
  ),
  extend: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M20 3v18 M3 12h9" />
      <path d="M12 12h7" strokeDasharray="2 2" />
      <path d="M16 9l3 3-3 3" />
    </svg>
  ),
  fillet: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M4 20V11a7 7 0 0 1 7-7h9" />
    </svg>
  ),
  chamfer: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M4 20V10l6-6h10" />
    </svg>
  ),
  join: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M3 17l6-8 6 8 6-8" />
      <circle cx="9" cy="9" r="1.6" />
      <circle cx="15" cy="17" r="1.6" />
    </svg>
  ),
  explode: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M4 9l5-5 M15 4l5 5 M20 15l-5 5 M9 20l-5-5" />
    </svg>
  ),
  break: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M3 12h6 M15 12h6 M10 8l4 8" />
    </svg>
  ),
  array: (
    <svg viewBox="0 0 24 24" {...P}>
      <circle cx="12" cy="12" r="8" strokeDasharray="2 3" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="20" cy="12" r="2" />
      <circle cx="12" cy="20" r="2" />
      <circle cx="4" cy="12" r="2" />
    </svg>
  ),
  overkill: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M3 8h12 M3 12h12" />
      <path d="M17 15l4 4 M21 15l-4 4" />
    </svg>
  ),
  camcheck: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M4 18V6h10l4 4v3" />
      <circle cx="17" cy="17" r="3.5" />
      <path d="M19.5 19.5L22 22" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" {...P}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M4.9 19.1L7 17 M17 7l2.1-2.1" />
    </svg>
  ),
  share: (
    <svg viewBox="0 0 24 24" {...P}>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.2 10.8l7.6-3.6 M8.2 13.2l7.6 3.6" />
    </svg>
  ),
  help: (
    <svg viewBox="0 0 24 24" {...P}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14 M12 17.5v.5" />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  eyeOff: (
    <svg viewBox="0 0 24 24" {...P}>
      <path d="M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9 M6.6 6.6C3.8 8.3 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 4.3-1" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" {...P}>
      <rect x="5" y="11" width="14" height="9" rx="1" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  unlock: (
    <svg viewBox="0 0 24 24" {...P}>
      <rect x="5" y="11" width="14" height="9" rx="1" />
      <path d="M8 11V8a4 4 0 0 1 7.5-2" />
    </svg>
  ),
};

export function Icon({ name }: { name: string }) {
  return ICONS[name] ?? null;
}
