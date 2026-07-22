import { describe, expect, it } from 'vitest';
import { MODEL_NANO_BANANA_2 } from '../../../types';
import {
  PANEL_MAIN_IMAGE_SLOT_SCENARIOS,
  buildPanelMainImageRestorePatchForEditing,
  resolveCanvasNodePreviewUrl,
  resolvePanelMainSlotPreviewUrl,
  shouldShowPanelMainImageSlot,
} from '../../../utils/referencedMediaRun';
import { resolveMainImagePanelDisplayLabel } from '../../../utils/referenceImageSlotLabels';

describe('panel main slot × creative prompt (@主图 rule)', () => {
  it('covers every registered model scenario in PANEL_MAIN_IMAGE_SLOT_SCENARIOS', () => {
    expect(PANEL_MAIN_IMAGE_SLOT_SCENARIOS.length).toBeGreaterThanOrEqual(7);
    for (const scenario of PANEL_MAIN_IMAGE_SLOT_SCENARIOS) {
      const base = {
        label: 'test',
        selectedModel: scenario.model,
        imagePreview: 'https://cos.example/main.png',
        referenceImages: [
          'https://cos.example/ref1.png',
          'https://cos.example/ref2.png',
        ],
        referenceImageLabels: ['图片1', '图片2'],
        prompt: '@图片1参考@图片2风格',
        ...scenario.dataPatch,
      };
      expect(shouldShowPanelMainImageSlot(base)).toBe(true);
      expect(shouldShowPanelMainImageSlot({ ...base, panelMainSlotVisible: false })).toBe(
        false
      );

      const withMain = {
        ...base,
        prompt: '@主图 参考 @图片2风格',
        ...(scenario.mainPromptPatch || {}),
      };
      expect(shouldShowPanelMainImageSlot(withMain)).toBe(true);
    }
  });

  it('hhhh.json: edit state keeps main slot; after run without @主图 still shows via panelMainImageUrl', () => {
    const edit = {
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: 'https://cos.example/cat.png',
      prompt: '@图片1参考@图片2风格',
      referenceImages: ['https://cos.example/ref1.png', 'https://cos.example/ref2.png'],
    };
    expect(shouldShowPanelMainImageSlot(edit)).toBe(true);

    const afterRun = {
      ...edit,
      imagePreview: 'https://cos.example/ref1.png',
      panelMainImageUrl: 'https://cos.example/cat.png',
      panelMainSlotVisible: false as const,
    };
    expect(shouldShowPanelMainImageSlot(afterRun)).toBe(true);
    expect(buildPanelMainImageRestorePatchForEditing(afterRun)).toBeUndefined();
  });

  it('banana-丢图2: 未@主图有备份时 restore 不得把 imagePreview 盖回主图', () => {
    const afterRun = {
      selectedModel: MODEL_NANO_BANANA_2,
      prompt: '@图片3参考@图片4风格生成',
      imagePreview: 'https://cos.example/pic3.png',
      panelMainImageUrl: '/flowgen-api/projects/14/assets/main-baize/file',
      panelMainSlotVisible: false as const,
      referenceImages: [
        '/flowgen-api/projects/14/assets/daya/file',
        '/flowgen-api/projects/14/assets/juanjuan/file',
        'https://cos.example/pic3.png',
        'https://cos.example/pic4.png',
      ],
      referenceImageLabels: ['大牙-有牙', '卷卷', '图片3', '图片4'],
    };
    expect(buildPanelMainImageRestorePatchForEditing(afterRun)).toBeUndefined();
    expect(resolvePanelMainSlotPreviewUrl(afterRun)).toBe(
      '/flowgen-api/projects/14/assets/main-baize/file'
    );
    expect(resolveCanvasNodePreviewUrl(afterRun)).toBe('https://cos.example/pic3.png');
  });

  it('有 @主图 时 restore 仍可盖回主图备份', () => {
    const afterRun = {
      selectedModel: MODEL_NANO_BANANA_2,
      prompt: '@主图参考@图片1风格',
      imagePreview: 'https://cos.example/ref1.png',
      panelMainImageUrl: 'https://cos.example/main.png',
      panelMainSlotVisible: false as const,
      referenceImages: ['https://cos.example/ref1.png'],
      referenceImageLabels: ['图片1'],
    };
    const patch = buildPanelMainImageRestorePatchForEditing(afterRun);
    expect(patch?.imagePreview).toBe('https://cos.example/main.png');
  });

  it('plain text prompt without @ still shows main slot', () => {
    expect(
      shouldShowPanelMainImageSlot({
        selectedModel: MODEL_NANO_BANANA_2,
        imagePreview: 'https://cos.example/main.png',
        prompt: '水墨风',
      })
    ).toBe(true);
  });

  it('after run without @主图: canvas thumb = gp first ref; main caption stays 主图', () => {
    const afterRun = {
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: 'https://cos.example/ref1.png',
      panelMainImageUrl: 'https://cos.example/cat-main.png',
      prompt: '@图片1参考@图片2风格',
      referenceImages: ['https://cos.example/ref1.png', 'https://cos.example/ref2.png'],
      generationParams: {
        referenceImages: ['https://cos.example/ref1.png', 'https://cos.example/ref2.png'],
        prompt: '@图片1参考@图片2风格',
      },
    };
    expect(resolveCanvasNodePreviewUrl(afterRun)).toBe('https://cos.example/ref1.png');
    expect(resolveMainImagePanelDisplayLabel(resolvePanelMainSlotPreviewUrl(afterRun)!)).toBe('主图');
  });

  it('20260710 seedance: 纯@资产 未@主图时画布不得显示主图备份（熊二）', () => {
    const main = '/flowgen-api/projects/14/assets/26a2ceb6-8175-4599-b33a-3bf119f35668/file';
    const ref0 =
      'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/15b1fafe-6291-4dcc-b9d6-78d9a71659bf.png';
    const afterRun = {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference' as const,
      imageName: '熊二',
      imagePreview: main,
      panelMainImageUrl: main,
      panelMainSlotVisible: false as const,
      prompt:
        '镜头向下拍摄原始丛林小路@资产:原始丛林小路，远处三个孩童（卷卷@资产:卷卷，石头@资产:石头，大牙@资产:大牙）',
      referenceImages: [
        ref0,
        'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/2d8674a6-4154-45ef-b0dd-03d65b9242b0.png',
      ],
      referenceImageLabels: ['原始丛林小路', '卷卷'],
      generationParams: {
        seedanceGenerationMode: 'reference' as const,
        referenceImages: [
          ref0,
          'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/2d8674a6-4154-45ef-b0dd-03d65b9242b0.png',
        ],
        referenceImageLabels: ['原始丛林小路', '卷卷'],
        prompt:
          '镜头向下拍摄原始丛林小路@资产:原始丛林小路，远处三个孩童（卷卷@资产:卷卷，石头@资产:石头，大牙@资产:大牙）',
      },
    };
    expect(resolveCanvasNodePreviewUrl(afterRun)).toBe(ref0);
  });

  it('after run: editing prompt keeps main slot even with legacy panelMainSlotVisible=false', () => {
    const afterRun = {
      selectedModel: MODEL_NANO_BANANA_2,
      imagePreview: 'https://cos.example/ref1.png',
      panelMainImageUrl: 'https://cos.example/cat-main.png',
      panelMainSlotVisible: false as const,
      prompt: '@图片1参考@图片2风格',
      referenceImages: ['https://cos.example/ref1.png', 'https://cos.example/ref2.png'],
    };
    expect(shouldShowPanelMainImageSlot(afterRun)).toBe(true);
    expect(
      shouldShowPanelMainImageSlot({
        ...afterRun,
        prompt: '@图片1参考@图片2风格，加强对比',
      })
    ).toBe(true);
  });

  it('444444: seedance 参考生紧凑 API 含主图标签时不重复展示 imagePreview 主图格', () => {
    const afterRun = {
      selectedModel: 'seedance2.0 (急速版)',
      seedanceGenerationMode: 'reference' as const,
      imagePreview:
        'https://aitop100app.cos/imagesGenerations/bc5dea33-a977-4736-935b-afae5bf42cf0.png',
      prompt: '@主图参考@图片3的姿势运动起来',
      referenceImages: [
        'https://aitop100app.cos/openApi/c3ca04a7-7ebf-4954-a7aa-b6ad15183feb.png',
        'https://aitop100app.cos/openApi/1f701fe3-dc78-493c-8ca1-38f91c2c8bde.png',
      ],
      referenceImageLabels: ['主图', '图片3'],
      panelMainSlotVisible: undefined,
    };
    expect(shouldShowPanelMainImageSlot(afterRun)).toBe(false);
  });
});
