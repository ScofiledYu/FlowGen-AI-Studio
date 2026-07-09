import { describe, expect, it } from 'vitest';
import {
  getFlowgenInspectorAnchorId,
  setFlowgenInspectorAnchorId,
} from '../../../utils/inspectorAnchorSession';

describe('inspectorAnchorSession', () => {
  it('stores and clears anchor id', () => {
    setFlowgenInspectorAnchorId('node_a');
    expect(getFlowgenInspectorAnchorId()).toBe('node_a');
    setFlowgenInspectorAnchorId(null);
    expect(getFlowgenInspectorAnchorId()).toBeNull();
  });
});
