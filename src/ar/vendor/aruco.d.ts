export interface ArucoCorner { x: number; y: number }
export interface ArucoMarker { id: number; corners: ArucoCorner[]; hammingDistance: number }
export const AR: {
  Detector: new (config?: { dictionaryName?: string; maxHammingDistance?: number }) => {
    detect(image: { width: number; height: number; data: Uint8ClampedArray }): ArucoMarker[];
  };
  Dictionary: new (name: string) => { generateSVG(id: number): string };
};
export const POS: {
  Posit: new (modelSize: number, focalLength: number) => {
    pose(points: ArucoCorner[]): {
      bestError: number;
      bestRotation: number[][];
      bestTranslation: number[];
      alternativeError: number;
      alternativeRotation: number[][];
      alternativeTranslation: number[];
    };
  };
};
