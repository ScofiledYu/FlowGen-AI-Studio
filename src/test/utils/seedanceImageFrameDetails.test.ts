import { describe, expect, it } from 'vitest';
import {
  mergeSeedanceImageModeDetailsReferenceImages,
  resolveSeedanceImageModeFrameUrlsForDetails,
} from '../../../utils/nodeDetailsPreview';

describe('seedance image mode frame Details', () => {
  it('prefers gp frame slots over stale referenceImages', () => {
    const first = 'https://cos.example/ff-composite.png';
    const last = 'https://cos.example/lf-landscape.png';
    const stale = ['https://cos.example/stale-fox.png', 'https://cos.example/stale-goat.png'];
    const ordered = mergeSeedanceImageModeDetailsReferenceImages({
      nodeData: {
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'image',
        firstFrameImageUrl: first,
        lastFrameImageUrl: last,
        generationParams: {
          seedanceGenerationMode: 'image',
          referenceImages: stale,
          firstFrameImageUrl: first,
          lastFrameImageUrl: last,
        },
      },
      mergedPool: [...stale, first, last],
    });
    expect(ordered).toEqual([first, last]);
  });

  it('falls back to referenceImages when frame slots empty', () => {
    const refs = ['https://cos.example/a.png', 'https://cos.example/b.png'];
    const { ordered } = resolveSeedanceImageModeFrameUrlsForDetails({
      nodeData: {
        generationParams: { referenceImages: refs },
      },
    });
    expect(ordered).toEqual(refs);
  });

  it('reads seedanceTabConfigs.image when top-level cleared on OUTPUT', () => {
    const first = 'https://cos.example/tab-first.png';
    const last = 'https://cos.example/tab-last.png';
    const { ordered } = resolveSeedanceImageModeFrameUrlsForDetails({
      nodeData: {
        seedanceTabConfigs: {
          image: { firstFrameImageUrl: first, lastFrameImageUrl: last },
        },
        generationParams: {
          seedanceGenerationMode: 'image',
          referenceImages: ['https://cos.example/wrong.png'],
          firstFrameImageUrl: first,
          lastFrameImageUrl: last,
        },
      },
    });
    expect(ordered).toEqual([first, last]);
  });
});
