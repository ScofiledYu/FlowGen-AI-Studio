import { describe, expect, it } from 'vitest';
import { alignReferenceImageLabels, tryAppendReferenceImageWithLabel } from '../../../utils/referenceImageSlotLabels';

/**
 * 回归：中键多图拖入面板须串行追加，否则并发读同一 cur.length 会覆盖同一槽。
 * 对应 NodeInspector applyInspectorReferenceFromUrlString 内 await addOne 链。
 */
describe('panel reference sequential append', () => {
  it('serial append fills distinct slots', async () => {
    let data = { referenceImages: [] as string[], referenceImageLabels: [] as string[] };

    const addOne = async (img: string) => {
      const cur = data.referenceImages;
      const labels = alignReferenceImageLabels(cur, data.referenceImageLabels);
      const next = tryAppendReferenceImageWithLabel(cur, labels, img, `图片${cur.length + 1}`);
      if (!next.added) return;
      await new Promise((r) => setTimeout(r, 5));
      data = {
        referenceImages: next.referenceImages,
        referenceImageLabels: next.referenceImageLabels,
      };
    };

    await Promise.all([
      addOne('https://cos/a.png'),
      addOne('https://cos/b.png'),
      addOne('https://cos/c.png'),
    ]);

    // 并发：三次都读到 length=0，最终只剩一张
    expect(data.referenceImages).toHaveLength(1);
  });

  it('awaited serial append keeps all images', async () => {
    let data = { referenceImages: [] as string[], referenceImageLabels: [] as string[] };

    const addOne = async (img: string) => {
      const cur = data.referenceImages;
      const labels = alignReferenceImageLabels(cur, data.referenceImageLabels);
      const next = tryAppendReferenceImageWithLabel(cur, labels, img, `图片${cur.length + 1}`);
      if (!next.added) return;
      await new Promise((r) => setTimeout(r, 5));
      data = {
        referenceImages: next.referenceImages,
        referenceImageLabels: next.referenceImageLabels,
      };
    };

    await addOne('https://cos/a.png');
    await addOne('https://cos/b.png');
    await addOne('https://cos/c.png');

    expect(data.referenceImages).toEqual([
      'https://cos/a.png',
      'https://cos/b.png',
      'https://cos/c.png',
    ]);
  });
});
