/**
 * Honest feature detection. Nothing here pretends a capability exists:
 * surface detection is only offered when the browser reports `immersive-ar`.
 */
export interface Capabilities {
  secure: boolean;
  webgl: boolean;
  camera: boolean;
  webxrAR: boolean;
  gyroscope: boolean;
  gyroNeedsPermission: boolean;
  mobile: boolean;
}

let cached: Promise<Capabilities> | null = null;

export function detectCapabilities(): Promise<Capabilities> {
  if (cached) return cached;
  cached = (async () => {
    const secure = window.isSecureContext;
    const webgl = (() => {
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      } catch {
        return false;
      }
    })();
    const camera = secure && !!navigator.mediaDevices?.getUserMedia;
    let webxrAR = false;
    try {
      const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
      if (xr && secure && new URLSearchParams(location.search).get('xr') !== 'off') webxrAR = await xr.isSessionSupported('immersive-ar');
    } catch {
      webxrAR = false;
    }
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
    return {
      secure,
      webgl,
      camera,
      webxrAR,
      gyroscope: !!DOE && mobile,
      gyroNeedsPermission: typeof DOE?.requestPermission === 'function',
      mobile,
    };
  })();
  return cached;
}
