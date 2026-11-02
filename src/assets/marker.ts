import { AR } from '../ar/vendor/aruco.js';

/**
 * The printed PORTAL marker: ArUco MIP 36h12 dictionary, id 7.
 * 36-bit codes with Hamming distance 12 → practically no false positives.
 * The printable version lives in public/marker.svg (scripts/generate-marker.mjs).
 */
export const MARKER_DICTIONARY = 'ARUCO_MIP_36h12';
export const MARKER_ID = 7;

export function markerSVG() {
  return new AR.Dictionary(MARKER_DICTIONARY).generateSVG(MARKER_ID);
}
