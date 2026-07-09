import { describe, expect, it } from 'vitest';
import { alignPanelReferenceSlotsFromLocalRefs } from '../../../utils/hydratePanelReferenceLocalRefs';
import {
  canvasOmniRefElementId,
  panelReferencesAlreadyContainCanvasSource,
  panelReferencesAlreadyContainIncoming,
  buildPanelRefElementIdsAfterWrite,
} from '../../../utils/referenceImageSlotLabels';
import { buildOmniMultiApiImageList } from '../../../utils/referencedMediaRun';

describe('Omni panel inspector drop dedup', () => {
  it('blocks repeat canvas middle-drag by canvas:nodeId', () => {
    const eids = [canvasOmniRefElementId('node_1')];
    expect(panelReferencesAlreadyContainCanvasSource(eids, 'node_1')).toBe(true);
    expect(
      panelReferencesAlreadyContainIncoming(['blob:a'], ['图片1'], 'blob:b', {
        canvasSourceNodeId: 'node_1',
        elementIds: eids,
      })
    ).toBe(true);
  });

  it('allows local file data to replace hydrated blob at same slot', () => {
    const localRefs = ['', 'flowgen-local:ref'];
    const refs = ['blob:old', 'blob:hydrated'];
    const aligned = alignPanelReferenceSlotsFromLocalRefs(refs, localRefs);
    expect(
      panelReferencesAlreadyContainIncoming(aligned.images, undefined, 'data:image/jpeg;base64,X', {
        targetSlotIndex: 1,
        localRefs,
      })
    ).toBe(false);
  });

  it('strips canvas element_id from API imageList rows', () => {
    const list = buildOmniMultiApiImageList({
      firstFrameUrl: 'https://cos/f.png',
      extraEntries: [
        { token: '@图片1', url: 'https://cos/r.png', refImageSlotIndex: 0, label: '图片1', imageIndex: 0 },
      ],
      uploadedByToken: new Map([['@图片1', 'https://cos/r.png']]),
      refElementIds: [canvasOmniRefElementId('n1')],
    });
    expect(list.every((r) => !String(r.element_id || '').startsWith('canvas:'))).toBe(true);
  });

  it('sequential batch keeps elementIds without react re-render', () => {
    const eids: (string | undefined)[] = [];
    const refs: string[] = [];
    const apply = (nodeId: string, url: string) => {
      if (panelReferencesAlreadyContainCanvasSource(eids, nodeId)) return false;
      refs.push(url);
      eids.push(canvasOmniRefElementId(nodeId));
      return true;
    };
    expect(apply('node_8', 'blob:a')).toBe(true);
    expect(apply('node_0', 'blob:b')).toBe(true);
    expect(eids[0]).toBe(canvasOmniRefElementId('node_8'));
    expect(apply('node_8', 'blob:a2')).toBe(false);
    expect(refs.length).toBe(2);
  });

  it('standard referenceElementIds: sequential canvas batch dedupes', () => {
    let refs: string[] = [];
    let eids: (string | undefined)[] = [];
    const apply = (nodeId: string, url: string) => {
      if (panelReferencesAlreadyContainCanvasSource(eids, nodeId)) return false;
      const nextRefs = [...refs, url];
      eids = buildPanelRefElementIdsAfterWrite(refs, eids, nextRefs, nextRefs.length - 1, nodeId);
      refs = nextRefs;
      return true;
    };
    expect(apply('node_a', 'blob:a1')).toBe(true);
    expect(apply('node_b', 'blob:b1')).toBe(true);
    expect(eids[0]).toBe(canvasOmniRefElementId('node_a'));
    expect(apply('node_a', 'blob:a2')).toBe(false);
    expect(refs.length).toBe(2);
  });
});
