import { describe, expect, it } from 'vitest';
import { resolvePictureTokenSlotIndex } from '../../../utils/promptMediaRefs';

describe('resolvePictureTokenSlotIndex', () => {
  const city = 'https://cos/city.png';
  const cat = 'https://cos/cat.png';
  const church = 'https://cos/church.png';

  it('skips main-preview duplicate when label 图片1 is on wrong slot', () => {
    const idx = resolvePictureTokenSlotIndex(
      1,
      [city, cat, '', church],
      ['图片1', '光头强', '', '图片3'],
      city
    );
    expect(idx).toBe(1);
  });

  it('finds 图片3 on sparse slot', () => {
    const idx = resolvePictureTokenSlotIndex(
      3,
      [city, cat, '', church],
      ['图片1', '光头强', '', '图片3'],
      city
    );
    expect(idx).toBe(3);
  });

  it('binds @图片2 to label slot even when URL equals imagePreview (2026070802-可灵3.json)', () => {
    const img2 = 'https://cos/img2.png';
    const img3 = 'https://cos/img3.png';
    const img4 = 'https://cos/img4.png';
    const blob = 'blob:http://localhost/pic1';
    const idx = resolvePictureTokenSlotIndex(
      2,
      [blob, img2, img3, img4, '/flowgen-api/projects/14/assets/x/file'],
      ['图片1', '图片2', '图片3', '图片4', '大牙-有牙'],
      img2
    );
    expect(idx).toBe(1);
  });

  it('duplicate 图片1 labels: @图片1/@图片2 use distinct physical slots (image2.json)', () => {
    const main = 'https://cos/main-a.png';
    const ref2 = 'https://cos/ref-b.png';
    expect(
      resolvePictureTokenSlotIndex(1, [main, ref2], ['图片1', '图片1'], main)
    ).toBe(0);
    expect(
      resolvePictureTokenSlotIndex(2, [main, ref2], ['图片1', '图片1'], main)
    ).toBe(1);
  });

  it('Nano @主图+@图片1: main-dup slot0 labeled 图片1 binds @图片1 (not slot1 图片2)', () => {
    const dup = 'https://cos/dup-main.png';
    const ref1 = 'https://cos/ref1.png';
    expect(
      resolvePictureTokenSlotIndex(1, [dup, ref1], ['图片1', '图片2'], dup)
    ).toBe(0);
  });
});
