import { describe, expect, it } from 'vitest';
import {
  buildGenerationParamsFromRunSnapshot,
  isSameVideoAssetForDetails,
  scrubGeneratedVideoFromReferenceMovs,
  seedanceReferenceMovsForOutputDetails,
} from '../../../utils/nodeDetailsPreview';

describe('seedanceReferenceMovsForOutputDetails', () => {
  it('OUTPUT with image-only gp has no reference videos', () => {
    expect(seedanceReferenceMovsForOutputDetails(undefined, 'https://cos.example/out.mp4')).toEqual([]);
    expect(seedanceReferenceMovsForOutputDetails([], 'https://cos.example/out.mp4')).toEqual([]);
  });

  it('keeps gp reference videos that are not the generated output', () => {
    const gpMovs = [{ url: 'https://cos.example/ref-in.mp4' }];
    expect(
      seedanceReferenceMovsForOutputDetails(gpMovs, 'https://cos.example/out.mp4')
    ).toEqual(gpMovs);
  });

  it('scrubs generated output from reference mov list', () => {
    const out = 'https://cos.example/out.mp4?sig=1';
    const items = [
      { url: out },
      { url: 'https://cos.example/ref.mp4' },
    ];
    const scrubbed = scrubGeneratedVideoFromReferenceMovs(items, out, isSameVideoAssetForDetails);
    expect(scrubbed).toEqual([{ url: 'https://cos.example/ref.mp4' }]);
  });
});

describe('buildGenerationParamsFromRunSnapshot seedance reference', () => {
  it('runCapture mode overrides stale snapshot text mode', () => {
    const gp = buildGenerationParamsFromRunSnapshot(
      {
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'text',
        prompt: '@主图 @图片3',
      },
      'seedance2.0 (急速版)',
      {
        runCapture: {
          seedanceGenerationMode: 'reference',
          referenceImages: ['https://cos.example/a.jpg', 'https://cos.example/b.jpg'],
          referenceImageLabels: ['主图', '图片3'],
        },
      }
    );
    expect(gp.seedanceGenerationMode).toBe('reference');
    expect(gp.referenceImages).toEqual(['https://cos.example/a.jpg', 'https://cos.example/b.jpg']);
  });
});
