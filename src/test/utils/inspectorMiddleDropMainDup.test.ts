import { describe, expect, it } from 'vitest';
import { isPanelRefDuplicateOfMainImageSlot } from '../../../utils/referenceImageSlotLabels';

describe('inspector middle-drop main duplicate guard', () => {
  it('rejects reference URL same as imagePreview', () => {
    expect(
      isPanelRefDuplicateOfMainImageSlot('https://cdn.example/goat.png', {
        imagePreview: 'https://cdn.example/goat.png',
      })
    ).toBe(true);
  });

  it('allows distinct reference URL when main exists', () => {
    expect(
      isPanelRefDuplicateOfMainImageSlot('https://cdn.example/mountain.png', {
        imagePreview: 'https://cdn.example/goat.png',
      })
    ).toBe(false);
  });
});
