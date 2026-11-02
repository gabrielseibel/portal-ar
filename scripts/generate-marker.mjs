// Generates the printable PORTAL marker (ArUco MIP 36h12, id 7) into public/.
// Usage: node scripts/generate-marker.mjs
import { writeFileSync } from 'node:fs';
import { AR } from '../src/ar/vendor/aruco.js';

const ID = 7;
const svg = new AR.Dictionary('ARUCO_MIP_36h12').generateSVG(ID).replace('<svg ', '<svg shape-rendering="crispEdges" ');
writeFileSync(new URL('../public/marker.svg', import.meta.url), svg + '\n');
console.log('public/marker.svg written');
