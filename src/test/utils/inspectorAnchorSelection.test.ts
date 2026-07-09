import { describe, expect, it } from 'vitest';
import {
  resolveInspectorNodeIdOnSelectionChange,
  shouldIgnoreNodeClickForInspector,
} from '../../../utils/inspectorAnchorSelection';

describe('inspectorAnchorSelection', () => {
  const open = () => true;

  it('plain empty selection closes inspector', () => {
    const r = resolveInspectorNodeIdOnSelectionChange({
      selectedNodeIds: [],
      anchorId: 'node-a',
      prevId: 'node-a',
      suppressClear: false,
      preserveAnchor: false,
      shouldOpenInspector: open,
    });
    expect(r.nextId).toBeNull();
    expect(r.nextAnchor).toBeNull();
  });

  it('keeps anchor when shift box select clears selection briefly', () => {
    const r = resolveInspectorNodeIdOnSelectionChange({
      selectedNodeIds: [],
      anchorId: 'node-a',
      prevId: 'node-a',
      suppressClear: true,
      preserveAnchor: true,
      shouldOpenInspector: open,
    });
    expect(r.nextId).toBe('node-a');
    expect(r.nextAnchor).toBe('node-a');
  });

  it('plain box select single node switches inspector', () => {
    const r = resolveInspectorNodeIdOnSelectionChange({
      selectedNodeIds: ['node-b'],
      anchorId: 'node-a',
      prevId: 'node-a',
      suppressClear: false,
      preserveAnchor: false,
      shouldOpenInspector: open,
    });
    expect(r.nextId).toBe('node-b');
    expect(r.nextAnchor).toBe('node-b');
  });

  it('does not switch to sole box-selected node while suppress flag is on', () => {
    expect(
      shouldIgnoreNodeClickForInspector({
        anchorId: 'node-a',
        clickedNodeId: 'node-b',
        multiCount: 1,
        suppressClear: true,
        shiftKey: false,
      })
    ).toBe(true);
  });

  it('allows plain click to switch inspector target', () => {
    expect(
      shouldIgnoreNodeClickForInspector({
        anchorId: 'node-a',
        clickedNodeId: 'node-b',
        multiCount: 1,
        suppressClear: false,
        shiftKey: false,
      })
    ).toBe(false);
  });
});
