import { Storage } from './Storage';

export type QualityLevel = 'economico' | 'equilibrado' | 'alto';
export type QualityPreference = QualityLevel | 'auto';

export interface QualitySettings {
  level: QualityLevel;
  label: string;
  maxPixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Multiplier applied to every particle system. */
  particles: number;
  trees: number;
  /** Distance (world units, before stage scale) beyond which small props are culled (LOD). */
  detailDistance: number;
  /** Max width of the frame used for marker detection. */
  markerProcessWidth: number;
  geometryDetail: number;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  economico: {
    level: 'economico',
    label: 'Econômico',
    maxPixelRatio: 1,
    antialias: false,
    shadows: false,
    shadowMapSize: 512,
    particles: 0.45,
    trees: 34,
    detailDistance: 7,
    markerProcessWidth: 360,
    geometryDetail: 0,
  },
  equilibrado: {
    level: 'equilibrado',
    label: 'Equilibrado',
    maxPixelRatio: 1.5,
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    particles: 0.75,
    trees: 58,
    detailDistance: 10,
    markerProcessWidth: 480,
    geometryDetail: 1,
  },
  alto: {
    level: 'alto',
    label: 'Alto',
    maxPixelRatio: 2,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    particles: 1,
    trees: 84,
    detailDistance: 16,
    markerProcessWidth: 640,
    geometryDetail: 2,
  },
};

interface GpuInfo {
  renderer: string;
  maxTexture: number;
}

function probeGpu(): GpuInfo | null {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { renderer, maxTexture };
  } catch {
    return null;
  }
}

export function hasWebGL(): boolean {
  return probeGpu() !== null;
}

/** Heuristic device classification. Conservative on mobile: smooth > shiny. */
export function detectQuality(): QualityLevel {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? 4;
  const cores = nav.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || ('ontouchstart' in window && window.innerWidth < 1100);
  const gpu = probeGpu();
  const r = (gpu?.renderer ?? '').toLowerCase();

  let score = 0;
  score += mem >= 8 ? 2 : mem >= 4 ? 1 : 0;
  score += cores >= 8 ? 2 : cores >= 6 ? 1 : 0;
  if (gpu && gpu.maxTexture >= 8192) score += 1;
  if (/apple gpu|apple m\d|adreno \(tm\) (7[3-9]\d|8\d\d)|adreno.*7[3-9]\d|mali-g7[1-9]|mali-g(6|7)1\d|immortalis|xclipse|nvidia|radeon|geforce|intel.*(iris|arc)/.test(r))
    score += 2;
  if (/adreno.*(3\d\d|4\d\d|50\d|51\d)|mali-(4|t)|powervr|sgx|swiftshader|llvmpipe|software/.test(r)) score -= 3;
  if (!mobile) score += 1;

  if (score >= 5) return 'alto';
  if (score >= 2) return 'equilibrado';
  return 'economico';
}

export function resolveQuality(pref: QualityPreference = loadQualityPreference()): QualitySettings {
  return QUALITY[pref === 'auto' ? detectQuality() : pref];
}

export function loadQualityPreference(): QualityPreference {
  const fromUrl = new URLSearchParams(location.search).get('quality');
  if (fromUrl && (fromUrl === 'auto' || fromUrl in QUALITY)) return fromUrl as QualityPreference;
  return Storage.get<QualityPreference>('quality', 'auto');
}

export function saveQualityPreference(p: QualityPreference) {
  Storage.set('quality', p);
}
