import { describe, it, expect } from 'vitest';
import { NodeType, NodeData, GenerationParams } from '../../types';

describe('Types', () => {
  describe('NodeType enum', () => {
    it('should have correct node types', () => {
      expect(NodeType.INPUT).toBe('inputNode');
      expect(NodeType.PROCESSOR).toBe('processorNode');
      expect(NodeType.OUTPUT).toBe('outputNode');
      expect(NodeType.MOV).toBe('movNode');
      expect(NodeType.CHAIN_FOLDER).toBe('chainFolderNode');
    });
  });

  describe('NodeData interface', () => {
    it('should create valid NodeData object', () => {
      const nodeData: NodeData = {
        label: 'Test Node',
        description: 'Test Description',
        status: 'idle',
        prompt: 'Test prompt',
        imagePreview: 'https://example.com/image.png',
        selectedModel: 'Nano Banana 2.0',
        aspectRatio: '1:1',
        resolution: '1K',
        numberOfImages: '1张',
        imageName: 'test.png'
      };

      expect(nodeData.label).toBe('Test Node');
      expect(nodeData.status).toBe('idle');
      expect(nodeData.selectedModel).toBe('Nano Banana 2.0');
    });

    it('should support optional fields', () => {
      const minimalNodeData: NodeData = {
        label: 'Minimal Node'
      };

      expect(minimalNodeData.label).toBe('Minimal Node');
      expect(minimalNodeData.status).toBeUndefined();
    });
  });

  describe('GenerationParams interface', () => {
    it('should create valid GenerationParams object', () => {
      const params: GenerationParams = {
        prompt: 'Test prompt',
        negativePrompt: 'Test negative',
        aspectRatio: '16:9',
        resolution: '4K',
        numberOfImages: '2张',
        referenceImages: ['img1.png', 'img2.png'],
        model: 'Nano Banana 2.0',
        quality: '高质量',
        duration: '10s',
        creativityLevel: 75
      };

      expect(params.prompt).toBe('Test prompt');
      expect(params.aspectRatio).toBe('16:9');
      expect(params.referenceImages?.length).toBe(2);
      expect(params.creativityLevel).toBe(75);
    });
  });
});









