import { describe, it, expect } from 'vitest';
import { fitWithin, qualitySteps } from '../lib/imageCompressor';

describe('image compressor sizing', () => {
  it('fits the longest edge, keeps the aspect ratio and never upscales', () => {
    expect(fitWithin(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 });
    expect(fitWithin(3000, 4000, 400)).toEqual({ width: 300, height: 400 });
    expect(fitWithin(300, 200, 1200)).toEqual({ width: 300, height: 200 });
  });

  it('steps quality down by 0.1 and stops at 0.3', () => {
    expect(qualitySteps(0.75)).toEqual([0.75, 0.65, 0.55, 0.45, 0.35, 0.3]);
    expect(qualitySteps(0.6)).toEqual([0.6, 0.5, 0.4, 0.3]);
    expect(qualitySteps(0.3)).toEqual([0.3]);
  });
});
