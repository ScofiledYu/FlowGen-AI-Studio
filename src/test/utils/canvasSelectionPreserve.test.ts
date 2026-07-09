import { describe, expect, it } from 'vitest';
import type { Node as RFNode } from 'reactflow';
import { buildClearCanvasSelectionPatch } from '../../../utils/canvasSelectionPreserve';

describe('canvasSelectionPreserve', () => {
  const node = (id: string, selected: boolean): RFNode => ({
    id,
    type: 'processor',
    position: { x: 0, y: 0 },
    data: { label: id },
    selected,
  });

  it('clears multi-select after middle drag drop into inspector panel', () => {
    const nodes = [node('a', true), node('b', true), node('c', false)];
    const cleared = buildClearCanvasSelectionPatch(nodes);
    expect(cleared?.every((n) => !n.selected)).toBe(true);
    expect(cleared?.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('skips clear patch when nothing is selected', () => {
    const nodes = [node('a', false), node('b', false)];
    expect(buildClearCanvasSelectionPatch(nodes)).toBeNull();
  });
});
