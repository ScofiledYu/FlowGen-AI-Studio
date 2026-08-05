import { describe, expect, it } from 'vitest';
import { NodeType } from '../../../types';
import {
  getRunResultMainPreviewUrl,
  preserveRunResultMainPreview,
} from '../../../utils/modelSwitchPanelIsolation';

describe('getRunResultMainPreviewUrl', () => {
  it('returns outputUrl when present', () => {
    expect(getRunResultMainPreviewUrl({ outputUrl: 'https://cos.example/out.png' } as any)).toBe(
      'https://cos.example/out.png'
    );
  });

  it('returns outputUrls[0] when outputUrl absent', () => {
    expect(
      getRunResultMainPreviewUrl({ outputUrls: ['https://cos.example/1.png', 'https://cos.example/2.png'] } as any)
    ).toBe('https://cos.example/1.png');
  });

  it('returns undefined when both absent', () => {
    expect(getRunResultMainPreviewUrl({} as any)).toBeUndefined();
    expect(getRunResultMainPreviewUrl(undefined)).toBeUndefined();
  });

  it('returns undefined for empty outputUrls', () => {
    expect(getRunResultMainPreviewUrl({ outputUrls: [] } as any)).toBeUndefined();
  });
});

describe('preserveRunResultMainPreview', () => {
  it('returns null for processorNode', () => {
    expect(
      preserveRunResultMainPreview(NodeType.PROCESSOR, {
        outputUrl: 'https://cos.example/out.png',
      } as any)
    ).toBeNull();
  });

  it('returns null for outputNode without generationParams', () => {
    expect(preserveRunResultMainPreview(NodeType.OUTPUT, undefined)).toBeNull();
  });

  it('returns null for outputNode with empty outputUrls', () => {
    expect(preserveRunResultMainPreview(NodeType.OUTPUT, { outputUrls: [] } as any)).toBeNull();
  });

  it('protects outputNode main preview when run result exists', () => {
    const patch = preserveRunResultMainPreview(NodeType.OUTPUT, {
      outputUrl: 'https://cos.example/generated.png',
    } as any);
    expect(patch).not.toBeNull();
    expect(patch!.imagePreview).toBe('https://cos.example/generated.png');
    expect(patch!.panelMainImageUrl).toBeUndefined();
    expect(patch!.panelMainSlotVisible).toBeUndefined();
    expect(patch!.imageLocalRef).toBeUndefined();
  });

  it('protects movNode main preview from outputUrls[0]', () => {
    const patch = preserveRunResultMainPreview(NodeType.MOV, {
      outputUrls: ['https://cos.example/v1.mp4', 'https://cos.example/v2.mp4'],
    } as any);
    expect(patch).not.toBeNull();
    expect(patch!.imagePreview).toBe('https://cos.example/v1.mp4');
  });

  it('20260731: outputNode switching model keeps run result, not stale modelConfigs snapshot', () => {
    // Simulates: outputNode ran with image2, modelConfigs['Nano Banana 2.0'] has upstream asset snapshot.
    // Switching to Nano Banana 2.0 should keep the run result image.
    const gp = {
      model: 'image 2',
      outputUrl: 'https://cos.example/image2-result.png',
    };
    const patch = preserveRunResultMainPreview(NodeType.OUTPUT, gp as any);
    expect(patch).not.toBeNull();
    expect(patch!.imagePreview).toBe('https://cos.example/image2-result.png');
    expect(patch!.panelMainImageUrl).toBeUndefined();
    expect(patch!.panelMainSlotVisible).toBeUndefined();
    expect(patch!.imageLocalRef).toBeUndefined();
  });
});
