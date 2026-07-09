import { describe, expect, it } from 'vitest';
import {
  buildKlingOmniTabSwitchPatch,
  snapshotKlingOmniTabConfigsWithLivePanel,
} from '../../../utils/klingOmniTabPanelIsolation';
import {
  buildKlingOmniReferenceLocalRefForTab,
  buildMainLocalRefForModel,
  klingOmniTabScopedModelKey,
} from '../../../utils/localNodeMediaStore';
import type { NodeData } from '../../../types';

describe('klingOmni tab panel isolation', () => {
  it('tab scoped model keys are distinct for refs/frames', () => {
    expect(klingOmniTabScopedModelKey('multi')).not.toBe(klingOmniTabScopedModelKey('instruction'));
    expect(klingOmniTabScopedModelKey('video')).not.toBe(klingOmniTabScopedModelKey('frames'));
  });

  it('switching tabs does not clear shared main image', () => {
    const data = {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: 'https://cos/shared-main.png',
      imageLocalRef: buildMainLocalRefForModel('u_p', 'n1', '可灵3.0 Omni'),
      klingOmniMultiReferenceImages: ['https://cos/m0.png'],
      klingOmniInstructionReferenceImages: ['https://cos/i0.png'],
    } as NodeData;

    const toInstruction = buildKlingOmniTabSwitchPatch(data, 'multi', 'instruction');
    expect(toInstruction.imagePreview).toBeUndefined();
    expect(toInstruction.klingOmniTabConfigs?.instruction).toBeUndefined();
    expect('multi' in (toInstruction.klingOmniTabConfigs || {})).toBe(false);

    const toFrames = buildKlingOmniTabSwitchPatch(data, 'multi', 'frames');
    expect(toFrames.imagePreview).toBeUndefined();
  });

  it('reference local ref keys differ per tab at same slot index', () => {
    const multi = buildKlingOmniReferenceLocalRefForTab('s', 'n', 'multi', 0);
    const inst = buildKlingOmniReferenceLocalRefForTab('s', 'n', 'instruction', 0);
    expect(multi).not.toBe(inst);
  });

  it('snapshotKlingOmniTabConfigsWithLivePanel stores frames tab separately', () => {
    const tabs = snapshotKlingOmniTabConfigsWithLivePanel(
      {
        klingOmniTab: 'frames',
        imagePreview: 'https://cos/main.png',
        firstFrameImage: 'blob:ff',
        lastFrameImage: 'blob:lf',
      } as NodeData,
      'frames'
    );
    expect(tabs.frames?.firstFrameImage).toBe('blob:ff');
    expect(tabs.frames?.lastFrameImage).toBe('blob:lf');
    expect((tabs as { multi?: unknown }).multi).toBeUndefined();
  });

  it('instruction tab video fields restore from klingOmniTabConfigs', () => {
    const data = {
      selectedModel: '可灵3.0 Omni',
      klingOmniTab: 'multi',
      imagePreview: 'https://cos/main.png',
      klingOmniTabConfigs: {
        instruction: {
          klingOmniInstructionVideoPreviewUrl: 'blob:inst-vid',
        },
      },
    } as NodeData;
    const patch = buildKlingOmniTabSwitchPatch(data, 'multi', 'instruction');
    expect(patch.klingOmniInstructionVideoPreviewUrl).toBe('blob:inst-vid');
    expect(patch.imagePreview).toBeUndefined();
  });
});
