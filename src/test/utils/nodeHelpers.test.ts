import { describe, it, expect } from 'vitest';
import { Node as RFNode } from 'reactflow';
import { NodeType } from '../../../types';

// Helper function to create test nodes
export function createTestNode(
  id: string,
  type: NodeType,
  position = { x: 0, y: 0 },
  data = {}
): RFNode {
  return {
    id,
    type,
    position,
    data: {
      label: `Test ${type}`,
      ...data
    }
  };
}

describe('Node Helpers', () => {
  describe('createTestNode', () => {
    it('should create a valid input node', () => {
      const node = createTestNode('node1', NodeType.INPUT);
      
      expect(node.id).toBe('node1');
      expect(node.type).toBe(NodeType.INPUT);
      expect(node.data.label).toBe('Test inputNode');
      expect(node.position).toEqual({ x: 0, y: 0 });
    });

    it('should create a processor node with custom data', () => {
      const node = createTestNode(
        'node2',
        NodeType.PROCESSOR,
        { x: 100, y: 200 },
        { prompt: 'Test prompt', status: 'running' }
      );
      
      expect(node.type).toBe(NodeType.PROCESSOR);
      expect(node.position).toEqual({ x: 100, y: 200 });
      expect(node.data.prompt).toBe('Test prompt');
      expect(node.data.status).toBe('running');
    });

    it('should create output and mov nodes', () => {
      const outputNode = createTestNode('node3', NodeType.OUTPUT);
      const movNode = createTestNode('node4', NodeType.MOV);
      
      expect(outputNode.type).toBe(NodeType.OUTPUT);
      expect(movNode.type).toBe(NodeType.MOV);
    });
  });
});









