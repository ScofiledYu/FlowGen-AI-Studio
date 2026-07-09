import { describe, expect, it } from 'vitest';
import { sanitizePersistValueDeep } from '../../../utils/persistSanitize.mjs';
import {
  hydratePanelMainImageUrlFromLocalRef,
  hydratePanelReferenceUrlsFromLocalRefs,
  anyPanelRefsPendingLocalHydrate,
  mainPanelPendingLocalHydrate,
  needsMainBackupHydrateFromLocalRef,
  panelRefsPendingLocalHydrate,
  panelNeedsPostRunBlobHydrateRecheck,
  panelShouldRecheckBlobHydrateAfterRun,
  panelHasBlobBackedLocalRefSlots,
  alignPanelReferenceSlotsFromLocalRefs,
  stripRestoredNodeMediaForLocalRefHydrate,
  stripRestoredPanelRefsForLocalRefHydrate,
  stripRestoredUrlForLocalRefHydrate,
  removeReferenceImageLocalRefAtIndex,
  setReferenceImageLocalRefAtIndex,
} from '../../../utils/hydratePanelReferenceLocalRefs';
import { shouldShowPanelMainImageSlot } from '../../../utils/referencedMediaRun';

describe('hydratePanelReferenceLocalRefs', () => {
  it('sanitize strips data URLs from referenceImages but keeps referenceImageLocalRefs', () => {
    const bigData = `data:image/jpeg;base64,${'A'.repeat(9000)}`;
    const node = sanitizePersistValueDeep({
      data: {
        referenceImages: [bigData],
        referenceImageLocalRefs: ['flowgen-local:u:p:n1:ref:0'],
      },
    });
    expect(node.data.referenceImages).toEqual(['']);
    expect(node.data.referenceImageLocalRefs).toEqual(['flowgen-local:u:p:n1:ref:0']);
  });

  it('setReferenceImageLocalRefAtIndex pads sparse slots', () => {
    const refs = setReferenceImageLocalRefAtIndex(undefined, 2, 'flowgen-local:u:p:n:ref:2');
    expect(refs).toEqual(['', '', 'flowgen-local:u:p:n:ref:2']);
  });

  it('removeReferenceImageLocalRefAtIndex splices aligned index', () => {
    const { localRefs, removedRef } = removeReferenceImageLocalRefAtIndex(
      ['a', 'b', 'c'],
      1
    );
    expect(removedRef).toBe('b');
    expect(localRefs).toEqual(['a', 'c']);
  });

  it('shouldShowPanelMainImageSlot true when panelMainImageUrl backup expected after run', () => {
    expect(
      shouldShowPanelMainImageSlot({
        imagePreview: 'https://cos/ref.png',
        panelMainSlotVisible: false,
        panelMainImageUrl: 'data:image/jpeg;base64,abc',
      })
    ).toBe(true);
  });

  it('shouldShowPanelMainImageSlot true when imageLocalRef exists after run without backup', () => {
    expect(
      shouldShowPanelMainImageSlot({
        selectedModel: 'image 2',
        imagePreview: 'https://cos/ref.png',
        panelMainSlotVisible: false,
        imageLocalRef: 'flowgen-local:u:p:n:main:image2',
      })
    ).toBe(true);
    expect(
      shouldShowPanelMainImageSlot({
        selectedModel: '可灵3.0 Omni',
        imagePreview: 'https://cos/ref.png',
        panelMainSlotVisible: false,
        imageLocalRef: 'flowgen-local:u:p:n:main:omni',
      })
    ).toBe(false);
  });

  it('mainPanelPendingLocalHydrate when panelMainSlotVisible=false and imageLocalRef only', () => {
    expect(
      mainPanelPendingLocalHydrate({
        selectedModel: 'image 2',
        panelMainSlotVisible: false,
        imageLocalRef: 'flowgen-local:u:p:n:main:image2',
        imagePreview: 'https://cos/ref.png',
      })
    ).toBe(true);
    expect(
      mainPanelPendingLocalHydrate({
        selectedModel: '可灵3.0 Omni',
        panelMainSlotVisible: false,
        imageLocalRef: 'flowgen-local:u:p:n:main:omni',
      })
    ).toBe(false);
    expect(
      anyPanelRefsPendingLocalHydrate({
        selectedModel: 'image 2',
        panelMainSlotVisible: false,
        imageLocalRef: 'flowgen-local:u:p:n:main:image2',
        referenceImages: ['https://cos/ref.png', 'https://cos/ref2.png'],
        referenceImageLocalRefs: ['flowgen-local:u:p:n:ref:0', 'flowgen-local:u:p:n:ref:1'],
      })
    ).toBe(true);
  });

  it('needsMainBackupHydrateFromLocalRef when panelMainImageUrl is stale blob', () => {
    expect(
      needsMainBackupHydrateFromLocalRef({
        selectedModel: 'Nano Banana 2.0',
        panelMainImageUrl: 'blob:http://localhost:3001/revoked-main',
        imageLocalRef: 'flowgen-local:u:p:n:main',
      })
    ).toBe(true);
    expect(
      needsMainBackupHydrateFromLocalRef({
        selectedModel: 'Nano Banana 2.0',
        panelMainImageUrl: 'https://cos/main.png',
        imageLocalRef: 'flowgen-local:u:p:n:main',
      })
    ).toBe(false);
  });

  it('needsMainBackupHydrateFromLocalRef for seedance reference without compact 主图 label', () => {
    expect(
      needsMainBackupHydrateFromLocalRef({
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'reference',
        panelMainSlotVisible: false,
        imageLocalRef: 'flowgen-local:u:p:n:main',
        referenceImages: ['https://cos/ref1.png', 'https://cos/ref2.png'],
        referenceImageLabels: ['图片1', '图片2'],
      })
    ).toBe(true);
    expect(
      needsMainBackupHydrateFromLocalRef({
        selectedModel: 'seedance2.0 (急速版)',
        seedanceGenerationMode: 'reference',
        panelMainSlotVisible: false,
        imageLocalRef: 'flowgen-local:u:p:n:main',
        referenceImages: ['https://cos/a.png'],
        referenceImageLabels: ['主图', '图片3'],
      })
    ).toBe(false);
  });

  it('panelRefsPendingLocalHydrate when localRefs exist but slots empty', () => {
    expect(
      panelRefsPendingLocalHydrate({
        referenceImages: ['', ''],
        referenceImageLocalRefs: ['flowgen-local:u:p:n1:ref:0', 'flowgen-local:u:p:n1:ref:1'],
      })
    ).toBe(true);
    expect(
      panelRefsPendingLocalHydrate({
        referenceImages: ['https://cos/a.png'],
        referenceImageLocalRefs: ['flowgen-local:u:p:n1:ref:0'],
      })
    ).toBe(false);
    expect(
      panelRefsPendingLocalHydrate({
        referenceImages: ['blob:http://localhost/abc'],
        referenceImageLocalRefs: ['flowgen-local:u:p:n1:ref:0'],
      })
    ).toBe(false);
  });

  it('anyPanelRefsPendingLocalHydrate across omni fields', () => {
    expect(
      anyPanelRefsPendingLocalHydrate({
        klingOmniMultiReferenceImages: [''],
        klingOmniMultiReferenceLocalRefs: ['flowgen-local:u:p:n1:ref:0'],
      })
    ).toBe(true);
    expect(
      anyPanelRefsPendingLocalHydrate({
        klingOmniMultiReferenceImages: ['blob:http://localhost/omni-ref'],
        klingOmniMultiReferenceLocalRefs: ['flowgen-local:u:p:n1:ref:0'],
      })
    ).toBe(false);
  });

  it('panelNeedsPostRunBlobHydrateRecheck after run with blob refs', () => {
    expect(
      panelShouldRecheckBlobHydrateAfterRun({
        status: 'completed',
        panelMainSlotVisible: false,
      })
    ).toBe(true);
    expect(
      panelHasBlobBackedLocalRefSlots({
        selectedModel: 'Nano Banana 2.0',
        referenceImages: [
          'https://cos/a.png',
          'blob:http://localhost/dead',
        ],
        referenceImageLocalRefs: ['flowgen-local:u:p:n:ref:0', 'flowgen-local:u:p:n:ref:1'],
      })
    ).toBe(true);
    expect(
      panelNeedsPostRunBlobHydrateRecheck({
        status: 'completed',
        panelMainSlotVisible: false,
        panelMainImageUrl: 'blob:http://localhost/backup',
        imageLocalRef: 'flowgen-local:u:p:n:main',
        selectedModel: 'Nano Banana 2.0',
        referenceImages: ['https://cos/a.png', 'blob:http://localhost/dead'],
        referenceImageLocalRefs: ['flowgen-local:u:p:n:ref:0', 'flowgen-local:u:p:n:ref:1'],
      })
    ).toBe(true);
    expect(
      panelNeedsPostRunBlobHydrateRecheck({
        status: 'idle',
        referenceImages: ['https://cos/a.png'],
        referenceImageLocalRefs: ['flowgen-local:u:p:n:ref:0'],
      })
    ).toBe(false);
  });

  it('alignPanelReferenceSlotsFromLocalRefs pads empty slots for model switch restore', () => {
    const aligned = alignPanelReferenceSlotsFromLocalRefs(undefined, [
      'flowgen-local:u:p:n1:ref:0',
      'flowgen-local:u:p:n1:ref:1',
    ]);
    expect(aligned.images).toEqual(['', '']);
    expect(aligned.localRefs).toHaveLength(2);
    expect(
      anyPanelRefsPendingLocalHydrate({
        referenceImages: aligned.images,
        referenceImageLocalRefs: aligned.localRefs,
      })
    ).toBe(true);
  });

  it('stripRestoredUrlForLocalRefHydrate strips stale blob when localRef exists', () => {
    const lr = 'flowgen-local:u:p:n1:ref:0';
    expect(stripRestoredUrlForLocalRefHydrate('blob:http://localhost/stale', lr)).toBe('');
    expect(stripRestoredUrlForLocalRefHydrate('data:image/png;base64,abc', lr)).toBe('');
    expect(stripRestoredUrlForLocalRefHydrate('https://cos/a.png', lr)).toBe('https://cos/a.png');
    expect(stripRestoredUrlForLocalRefHydrate('blob:http://localhost/live', '')).toBe(
      'blob:http://localhost/live'
    );
  });

  it('stripRestoredNodeMediaForLocalRefHydrate keeps main blob on model switch', () => {
    const patch = stripRestoredNodeMediaForLocalRefHydrate({
      imagePreview: 'blob:http://localhost/main',
      imageLocalRef: 'flowgen-local:u:p:n:main:image2',
    });
    expect(patch.imagePreview).toBeUndefined();
  });

  it('stripRestoredNodeMediaForLocalRefHydrate strips main data URL', () => {
    const patch = stripRestoredNodeMediaForLocalRefHydrate({
      imagePreview: 'data:image/png;base64,abc',
      imageLocalRef: 'flowgen-local:u:p:n:main:image2',
    });
    expect(patch.imagePreview).toBeUndefined();
  });

  it('stripRestoredNodeMediaForLocalRefHydrate on model switch clears ref blobs', () => {
    const patch = stripRestoredNodeMediaForLocalRefHydrate({
      referenceImages: ['blob:http://localhost/r0', 'https://cos/a.png', ''],
      referenceImageLocalRefs: ['flowgen-local:u:p:n:ref:0', '', 'flowgen-local:u:p:n:ref:2'],
    });
    expect(patch.referenceImages).toEqual(['', 'https://cos/a.png', '']);
    expect(
      anyPanelRefsPendingLocalHydrate({
        referenceImages: patch.referenceImages,
        referenceImageLocalRefs: ['flowgen-local:u:p:n:ref:0', '', 'flowgen-local:u:p:n:ref:2'],
      })
    ).toBe(true);
  });

  it('stripRestoredNodeMediaForLocalRefHydrate does not touch frame slots', () => {
    const patch = stripRestoredNodeMediaForLocalRefHydrate({
      lastFrameImage: 'blob:http://localhost/lf',
      lastFrameLocalRef: 'flowgen-local:u:p:n:lastFrame:vidu_2_0',
      firstFrameImage: 'blob:http://localhost/ff',
      firstFrameLocalRef: 'flowgen-local:u:p:n:firstFrame:可灵_25_Turbo',
    });
    expect(patch.lastFrameImage).toBeUndefined();
    expect(patch.firstFrameImage).toBeUndefined();
    expect(patch.lastFrameLocalRef).toBeUndefined();
  });
});

describe('hydratePanelReferenceLocalRefs async (no IDB in vitest)', () => {
  it('returns undefined when no local refs', async () => {
    const patch = await hydratePanelReferenceUrlsFromLocalRefs({
      referenceImages: ['https://cos/a.png'],
    });
    expect(patch).toBeUndefined();
  });

  it('returns undefined for panel main when backup is persistable', async () => {
    const patch = await hydratePanelMainImageUrlFromLocalRef({
      panelMainSlotVisible: false,
      panelMainImageUrl: 'https://cos/main.png',
      imageLocalRef: 'flowgen-local:u:p:n:main',
    });
    expect(patch).toBeUndefined();
  });
});
