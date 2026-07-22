import { describe, expect, it } from 'vitest';
import type { Edge, Node as RFNode } from 'reactflow';
import { NodeType } from '../../../types';
import {
  getModelConfigOutputPreviewUrl,
  hydrateGraphMediaFromPersisted,
  hydrateNodeImagePreviewFromPersisted,
  outputImagePreviewLooksLikePanelRefMismatch,
} from '../../../utils/hydratePersistedNodePreviews';

describe('hydratePersistedNodePreviews', () => {
  it('detects OUTPUT preview polluted by seedance reference slot', () => {
    const data = {
      imagePreview: 'https://cos.example.com/openApi/lion.png',
      referenceImages: ['', '', 'https://cos.example.com/openApi/lion.png'],
      modelConfigs: {
        image2: {
          imagePreview: 'https://cos.example.com/imagesGenerations/sunset.png',
        },
      },
    };
    expect(outputImagePreviewLooksLikePanelRefMismatch(data)).toBe(true);
    expect(getModelConfigOutputPreviewUrl(data)).toContain('sunset');
  });

  it('hydrate fixes 3344-style OUTPUT: lion ref → image2 generated preview', () => {
    const output: RFNode = {
      id: 'out-1',
      type: NodeType.OUTPUT,
      position: { x: 0, y: 0 },
      data: {
        imagePreview: 'https://cos.example.com/openApi/lion.png',
        referenceImages: ['', '', 'https://cos.example.com/openApi/lion.png'],
        modelConfigs: {
          image2: {
            imagePreview: 'https://cos.example.com/imagesGenerations/sunset.png',
          },
        },
      },
    };
    const hydrated = hydrateNodeImagePreviewFromPersisted(output);
    expect(hydrated.data.imagePreview).toBe(
      'https://cos.example.com/imagesGenerations/sunset.png'
    );
  });

  it('paste hydrate: empty OUTPUT preview uses modelConfigs not referenceImages', () => {
    const nodes: RFNode[] = [
      {
        id: 'out-1',
        type: NodeType.OUTPUT,
        position: { x: 0, y: 0 },
        data: {
          referenceImages: ['', '', 'https://cos.example.com/openApi/lion.png'],
          modelConfigs: {
            image2: {
              imagePreview: 'https://cos.example.com/imagesGenerations/sunset.png',
            },
          },
        },
      },
    ];
    const edges: Edge[] = [];
    const out = hydrateGraphMediaFromPersisted(nodes, edges);
    expect(out[0].data.imagePreview).toBe('https://cos.example.com/imagesGenerations/sunset.png');
  });

  it('restores OUTPUT from upstream generatedThumbnails when preview missing', () => {
    const nodes: RFNode[] = [
      {
        id: 'proc-1',
        type: NodeType.PROCESSOR,
        position: { x: 0, y: 0 },
        data: {
          generatedThumbnails: [
            {
              id: 'out-1',
              nodeId: 'out-1',
              url: 'https://cos.example.com/imagesGenerations/sunset.png',
              type: 'image',
              name: 'Generated.png',
            },
          ],
        },
      },
      {
        id: 'out-1',
        type: NodeType.OUTPUT,
        position: { x: 0, y: 0 },
        data: {},
      },
    ];
    const edges: Edge[] = [{ id: 'e1', source: 'proc-1', target: 'out-1' }];
    const out = hydrateGraphMediaFromPersisted(nodes, edges);
    expect(out[1].data.imagePreview).toBe('https://cos.example.com/imagesGenerations/sunset.png');
  });

  it('export JSON: @主图 + COS imagePreview + imageLocalRef must not clear on hydrate', () => {
    const main =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/8cdbc6d8-15fc-4cc9-bd87-a1f23c97b22b.png';
    const ref0 =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/c2f1bc63-b984-4103-aac1-389be1532eac.png';
    const proc: RFNode = {
      id: 'node_0_1783922001453',
      type: NodeType.PROCESSOR,
      position: { x: 0, y: 0 },
      data: {
        imagePreview: main,
        imageLocalRef: 'flowgen-local:dd73b906-2dd5-40be-a70d-762fba12e36e_14:node_0:main',
        panelMainSlotVisible: true,
        referenceImages: [ref0],
        prompt: '@主图参考@图片1的风格生产',
        generationParams: {
          referenceImages: [main, ref0],
        },
      },
    };
    const hydrated = hydrateNodeImagePreviewFromPersisted(proc);
    expect(hydrated.data.imagePreview).toBe(main);
  });

  it('processor with blob preview hydrates to first gp ref not outputUrl', () => {
    const outputUrl = 'https://cos.example.com/imagesGenerations/owl.png';
    const firstRef = 'https://cos.example.com/openApi/forest.png';
    const proc: RFNode = {
      id: 'proc-1',
      type: NodeType.PROCESSOR,
      position: { x: 0, y: 0 },
      data: {
        imagePreview: 'blob:http://localhost:3001/stale',
        referenceImages: [],
        selectedModel: 'image 2',
        modelConfigs: {
          'Nano Banana 2.0': {
            prompt: '@图片1参考@图片3风格',
            referenceImages: [firstRef, '', 'https://cos.example.com/openApi/style.png'],
          },
        },
        generationParams: {
          model: 'Nano Banana 2.0',
          prompt: '@图片1参考@图片3风格',
          referenceImages: [firstRef, 'https://cos.example.com/openApi/style.png'],
          referenceImageLabels: ['图片1', '', '图片3'],
          outputUrl,
        },
      },
    };
    const hydrated = hydrateNodeImagePreviewFromPersisted(proc);
    expect(hydrated.data.imagePreview).toBe(firstRef);
    expect(hydrated.data.imagePreview).not.toBe(outputUrl);
  });
});
