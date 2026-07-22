import { describe, expect, it } from 'vitest';
import { NodeType } from '../../../types';
import {
  isGeneratedOutputPersistableUrl,
  pickGeneratedOutputUrlFromNodeData,
  preferPersistableResultUrl,
  resolveNodeDetailsSourceUrl,
  resolvePreferredNodeDownloadUrl,
} from '../../../utils/generatedOutputUrl';
import { pickImageResourceUrlFromTaskStatus, pickMediaResourceUrlFromTaskStatus } from '../../../utils/taskStatusImageUrl';
import { pickVideoResourceUrlFromTaskStatus } from '../../../utils/taskStatusVideoUrl';

const AITOP =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/out.png';

describe('generatedOutputUrl', () => {
  it('preferPersistableResultUrl prefers AiTop over blob', () => {
    expect(
      preferPersistableResultUrl(['blob:http://127.0.0.1/input.jpg', AITOP])
    ).toBe(AITOP);
  });

  it('preferPersistableResultUrl prefers imagesGenerations over openApi', () => {
    const openApi =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/preview.png';
    const finalUrl =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/d94dac8d.png';
    expect(preferPersistableResultUrl([openApi, finalUrl])).toBe(finalUrl);
  });

  it('pickImageResourceUrlFromTaskStatus prefers imagesGenerations over openApi resourceUrl', () => {
    const openApi =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/preview.png';
    const finalUrl =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/d94dac8d.png';
    const url = pickImageResourceUrlFromTaskStatus({
      status: 'SUCCESS',
      resourceUrl: openApi,
      imageUrls: [finalUrl],
    });
    expect(url).toBe(finalUrl);
  });

  it('resolvePreferredNodeDownloadUrl uses generationParams.outputUrl', () => {
    const outputUrl =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/out.png';
    expect(
      resolvePreferredNodeDownloadUrl(
        {
          imagePreview: 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/ref.png',
          generationParams: { outputUrl, taskId: '1' },
        },
        NodeType.OUTPUT
      )
    ).toBe(outputUrl);
  });

  it('resolveNodeDetailsSourceUrl uses gp.outputUrl when imagePreview is blob', () => {
    const url = resolveNodeDetailsSourceUrl(
      {
        selectedModel: 'image 2',
        imagePreview: 'blob:http://127.0.0.1/nangchen-9918045_1920.jpg',
        imageName: 'nangchen-9918045_1920.jpg',
        taskId: '1455190',
        generationParams: {
          model: 'image 2',
          taskId: '1455190',
          outputUrl: AITOP,
          referenceImages: [
            'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/a.png',
            'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/b.png',
          ],
        },
      },
      NodeType.OUTPUT
    );
    expect(url).toBe(AITOP);
    expect(url.startsWith('blob:')).toBe(false);
  });

  it('multi-output nodes should have distinct gp.outputUrl per node', () => {
    const img0 =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/out-0.png';
    const img1 =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/out-1.png';

    // 模拟一次运行 spawn 出的两个 OUTPUT 节点：各自 gp.outputUrl 指向对应结果
    const node0 = {
      selectedModel: 'Nano Banana 2.0',
      imagePreview: img0,
      taskId: '1662365, 1662366',
      generationParams: {
        model: 'Nano Banana 2.0',
        taskId: '1662365, 1662366',
        outputUrl: img0,
        outputUrls: [img0, img1],
        numberOfImages: '2张',
      },
    };
    const node1 = {
      selectedModel: 'Nano Banana 2.0',
      imagePreview: img1,
      taskId: '1662365, 1662366',
      generationParams: {
        model: 'Nano Banana 2.0',
        taskId: '1662365, 1662366',
        outputUrl: img1,
        outputUrls: [img0, img1],
        numberOfImages: '2张',
      },
    };

    expect(resolveNodeDetailsSourceUrl(node0, NodeType.OUTPUT)).toBe(img0);
    expect(resolveNodeDetailsSourceUrl(node1, NodeType.OUTPUT)).toBe(img1);
    expect(resolveNodeDetailsSourceUrl(node0, NodeType.OUTPUT)).not.toBe(
      resolveNodeDetailsSourceUrl(node1, NodeType.OUTPUT)
    );
  });

  it('pickGeneratedOutputUrlFromNodeData reads thumbnails', () => {
    const url = pickGeneratedOutputUrlFromNodeData(
      {
        imagePreview: 'blob:http://127.0.0.1/stale',
        generatedThumbnails: [{ id: 't1', url: AITOP, type: 'image' }],
        generationParams: { taskId: '1' },
      },
      NodeType.INPUT
    );
    expect(url).toBe(AITOP);
  });

  it('isGeneratedOutputPersistableUrl rejects blob', () => {
    expect(isGeneratedOutputPersistableUrl(AITOP)).toBe(true);
    expect(isGeneratedOutputPersistableUrl('blob:http://x')).toBe(false);
  });
});

describe('task status URL pickers', () => {
  it('pickImageResourceUrlFromTaskStatus prefers https over blob', () => {
    const url = pickImageResourceUrlFromTaskStatus({
      status: 'SUCCESS',
      resourceUrl: AITOP,
      imageUrl: 'blob:http://127.0.0.1/temp.png',
    });
    expect(url).toBe(AITOP);
  });

  it('pickMediaResourceUrlFromTaskStatus prefers videosGenerations over openApi poster', () => {
    const poster =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/poster.jpg';
    const video =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/out.mp4';
    const url = pickMediaResourceUrlFromTaskStatus({
      status: 'TRANSFER_SUCCESS',
      resourceUrl: poster,
      videoUrl: video,
    });
    expect(url).toBe(video);
  });

  it('pickVideoResourceUrlFromTaskStatus prefers AiTop COS', () => {
    const video =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/out.mp4';
    const url = pickVideoResourceUrlFromTaskStatus({
      status: 'TRANSFER_SUCCESS',
      resourceUrl: video,
      url: 'blob:http://127.0.0.1/preview.mp4',
    });
    expect(url).toBe(video);
  });
});
