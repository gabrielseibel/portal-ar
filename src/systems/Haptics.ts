/** Haptic feedback when the device supports it (Android Chrome). iOS Safari ignores silently. */
export const Haptics = {
  tap() {
    vibrate(8);
  },
  soft() {
    vibrate(14);
  },
  success() {
    vibrate([18, 40, 26]);
  },
  rumble() {
    vibrate([30, 30, 50, 30, 80]);
  },
};

function vibrate(p: number | number[]) {
  try {
    if ('vibrate' in navigator) navigator.vibrate(p);
  } catch {
    /* noop */
  }
}
