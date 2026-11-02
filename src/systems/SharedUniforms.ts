/** Uniforms shared by every custom shader (single source of truth, updated once per frame). */
export const shared = {
  uTime: { value: 0 },
  /** Height of the render target in physical pixels (for point sprite sizing). */
  uViewportHeight: { value: 800 },
  /** Global multiplier for "magic" emissive elements (dimmed while the portal opens). */
  uMagic: { value: 1 },
};

/** GLSL helper that converts a world-space size into gl_PointSize, honouring object scale. */
export const POINT_SIZE_GLSL = /* glsl */ `
uniform float uViewportHeight;
float worldPointSize(float worldSize, vec4 mvPos) {
  float s = length(modelViewMatrix[0].xyz);
  float px = worldSize * s * projectionMatrix[1][1] * 0.5 * uViewportHeight / max(-mvPos.z, 0.0001);
  return clamp(px, 0.0, 96.0);
}
`;
