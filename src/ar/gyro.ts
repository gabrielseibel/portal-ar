type DOEWithPermission = { requestPermission?: () => Promise<string> };

let permission: Promise<boolean> | null = null;

/**
 * Motion sensors permission. iOS only grants it from inside a tap, so the
 * landing button calls this synchronously before anything else is awaited;
 * later callers reuse the same answer. Android/desktop need no prompt.
 */
export function requestGyroPermission(): Promise<boolean> {
  if (permission) return permission;
  const DOE = (typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined) as unknown as DOEWithPermission | undefined;
  if (!DOE) permission = Promise.resolve(false);
  else if (typeof DOE.requestPermission !== 'function') permission = Promise.resolve(true);
  else
    permission = DOE.requestPermission()
      .then((r) => r === 'granted')
      .catch(() => {
        permission = null; // not inside a gesture: allow asking again from a button
        return false;
      });
  return permission;
}

/** The answer obtained earlier (null when nobody asked yet). */
export function gyroPermissionAsked() {
  return permission;
}
