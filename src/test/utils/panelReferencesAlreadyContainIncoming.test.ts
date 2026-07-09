import { describe, expect, it } from 'vitest';
import { panelReferencesAlreadyContainIncoming } from '../../../utils/referenceImageSlotLabels';

describe('panelReferencesAlreadyContainIncoming', () => {
  it('detects duplicate after blob ingested as data URL', () => {
    const refs = ['data:image/jpeg;base64,AAAA'];
    const labels = ['图片1'];
    expect(
      panelReferencesAlreadyContainIncoming(refs, labels, 'blob:http://localhost/abc', {
        dedupeAgainstMain: false,
      })
    ).toBe(false);
    expect(
      panelReferencesAlreadyContainIncoming(refs, labels, 'data:image/jpeg;base64,AAAA', {
        dedupeAgainstMain: false,
      })
    ).toBe(true);
  });

  it('skips when same asset file URL already in slot', () => {
    const file = '/flowgen-api/projects/14/assets/abc/file';
    const thumb = '/flowgen-api/projects/14/assets/abc/thumb';
    expect(
      panelReferencesAlreadyContainIncoming([file], ['祭司老人'], thumb, {
        incomingLabel: '祭司老人',
      })
    ).toBe(true);
  });

  it('dedupes against main imagePreview when enabled', () => {
    const main = 'blob:http://localhost/main';
    expect(
      panelReferencesAlreadyContainIncoming([], undefined, main, {
        imagePreview: main,
        dedupeAgainstMain: true,
      })
    ).toBe(true);
  });
});
