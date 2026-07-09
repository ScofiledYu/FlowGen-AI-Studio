import { describe, expect, it } from 'vitest';
import {
  enqueueInspectorReferenceDrop,
  resetInspectorReferenceDropQueueForTests,
} from '../../../utils/inspectorReferenceDropQueue';
import { tryAppendReferenceImageWithLabel, alignReferenceImageLabels } from '../../../utils/referenceImageSlotLabels';

describe('enqueueInspectorReferenceDrop', () => {
  it('serializes concurrent append tasks', async () => {
    resetInspectorReferenceDropQueueForTests();
    let data = { referenceImages: [] as string[], referenceImageLabels: [] as string[] };

    const addOne = async (img: string) => {
      const cur = data.referenceImages;
      const labels = alignReferenceImageLabels(cur, data.referenceImageLabels);
      const next = tryAppendReferenceImageWithLabel(cur, labels, img, `图片${cur.length + 1}`);
      if (!next.added) return;
      await new Promise((r) => setTimeout(r, 8));
      data = {
        referenceImages: next.referenceImages,
        referenceImageLabels: next.referenceImageLabels,
      };
    };

    await Promise.all([
      enqueueInspectorReferenceDrop(() => addOne('https://cos/a.png')),
      enqueueInspectorReferenceDrop(() => addOne('https://cos/b.png')),
      enqueueInspectorReferenceDrop(() => addOne('https://cos/c.png')),
    ]);

    expect(data.referenceImages).toEqual([
      'https://cos/a.png',
      'https://cos/b.png',
      'https://cos/c.png',
    ]);
  });
});
