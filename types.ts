export enum NodeType {
  INPUT = 'inputNode',
  PROCESSOR = 'processorNode',
  OUTPUT = 'outputNode',
  MOV = 'movNode',
  /** 输入链折叠夹：收纳某输入/处理节点下游，可点击展开 */
  CHAIN_FOLDER = 'chainFolderNode',
  /** Nuke 风格背景框：框住若干节点，可拖角缩放；拖动框体时带动框内节点 */
  BACKDROP = 'backdropNode',
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerationParams {
  /** 生成完成时间（ISO 字符串） */
  generatedAt?: string;
  taskId?: string;
  prompt?: string;
  negativePrompt?: string;
  aspectRatio?: string;
  resolution?: string;
  numberOfImages?: string;
  referenceImages?: string[];
  /** 与 referenceImages 同序：Node Details 底栏展示名（如 @主图 → 主图） */
  referenceImageLabels?: string[];
  /** 参考视频（仅用于展示与历史追溯；不自动播放） */
  referenceMovs?: { url: string; posterDataUrl?: string }[];
  /** 参考音频（Seedance 2.0 参考生视频等） */
  referenceAudios?: { url: string }[];
  model?: string;
  quality?: string;
  duration?: string;
  creativityLevel?: number;
  /** 即梦：分辨率 720p/1080p */
  jimengResolution?: string;
  /** 即梦：视频比例 */
  jimengVideoRatio?: string;
  /** 即梦：文生视频 / 图生视频（Node Details 与快照） */
  jimengGenerationMode?: 'text' | 'image';
  /** 即梦：图生视频多图输入快照（用于 output/generated outputs 的 Node Details 展示） */
  jimengImages?: string[];
  /** vidu 2.0：时长 4s/8s */
  viduDuration?: string;
  /** vidu 2.0：清晰度 360p/720p/1080p */
  viduClarity?: string;
  /** vidu 2.0：运动幅度 自动/小/中/大 */
  viduMotionRange?: string;
  /** Seedance：分辨率（1.5 / 急速为 480p|720p；高质量版可为 1080p） */
  seedanceResolution?: string;
  /** seedance1.5-pro：视频比例 自动匹配 */
  seedanceAspectRatio?: string;
  /** Seedance：时长（秒字符串，1.5 / 2.0 均为 4s–15s） */
  seedanceDuration?: string;
  /** seedance1.5-pro：是否生成音频 */
  seedanceGenerateAudio?: boolean;
  /** seedance1.5-pro：是否固定镜头 */
  seedanceFixedCamera?: boolean;
  /** seedance2.0：生成入口 tab */
  seedanceGenerationMode?: 'text' | 'image' | 'reference';
  /** seedance2.0 参考生视频：比例策略（强制面板比例 / 自动匹配参考素材） */
  seedanceReferenceRatioMode?: SeedanceReferenceRatioMode;
  /** seedance2.0「参考生视频」tab：联网搜索开关 */
  seedanceReferenceWebSearch?: boolean;
  /** 可灵3.0 Omni：音画同步 */
  klingAudioSync?: boolean;
  /** 可灵：首尾帧（供 Node Details 与 output/thumbnail 一致展示） */
  firstFrameImage?: string;
  lastFrameImage?: string;
  firstFrameImageUrl?: string;
  lastFrameImageUrl?: string;
  /** 可灵3.0 Omni：本次快照对应的侧边栏 tab（Node Details 只展示该 tab 的参考图/视频） */
  klingOmniTab?: 'multi' | 'instruction' | 'video' | 'frames';
  /** 快照：指令变换槽视频 URL */
  klingOmniInstructionVideoUrl?: string;
  klingOmniInstructionVideoPreviewUrl?: string;
  /** 快照：视频参考 tab 槽位 */
  klingOmniVideoUrl?: string;
  klingOmniVideoPreviewUrl?: string;
  /** 快照中的视频截帧 data URL（仅展示；勿混入 Reference Images） */
  videoPosterDataUrl?: string;
  /** image2：风格 */
  image2Style?: 'vivid' | 'natural';
  /** image2：画面比例（与 image2ImageSize 联动） */
  image2AspectRatio?: string;
  /** image2：图像尺寸（像素，随 quality 档位变化） */
  image2ImageSize?: string;
  /** image2：清晰度档位 1K / 2K / 4K（满血版 API quality） */
  image2Quality?: '1K' | '2K' | '4K';
  /** image2：画质等级 low / medium / high（满血版 API qualityLevel） */
  image2QualityLevel?: 'low' | 'medium' | 'high';
  /** MidJourney 快照：风格族（realistic=真实感强 / cartoon=卡通动漫） */
  mjFamily?: 'realistic' | 'cartoon';
  /** MidJourney 快照：API model 参数（' --v 7' / ' --niji6' 等） */
  mjVersion?: string;
  /** MidJourney 快照：风格（API style 字段） */
  mjStyle?: string;
  /** MidJourney 快照：画面比例 ratio */
  mjRatio?: string;
  /** MidJourney 快照：quality 画质档 */
  mjQuality?: string;
  /** MidJourney 快照：mode 计费模式（FAST / RELAX） */
  mjMode?: 'FAST' | 'RELAX';
  /** MidJourney 快照：视角 angle */
  mjAngle?: string;
  /** MidJourney 快照：人物镜头 camera */
  mjCamera?: string;
  /** MidJourney 快照：灯光 light */
  mjLight?: string;
  /** MidJourney 快照：艺术程度 art */
  mjArt?: string;
  /** MidJourney 快照：风格一致性参考图 URL（sref） */
  mjSrefUrl?: string;
  /** MidJourney 快照：角色一致性参考图 URL（cref） */
  mjCrefUrl?: string;
  /** MidJourney 快照：参照万物参考图 URL（oref） */
  mjOrefUrl?: string;
  /** 生成结果 PNG 实际像素（探测 IHDR；可能与 image2ImageSize 请求值不同） */
  outputImageSize?: string;
  /** 本次生成结果主 URL（AiTop COS / 持久化链；Node Details Source URL 优先） */
  outputUrl?: string;
  /** 多图/多段生成时的全部结果 URL */
  outputUrls?: string[];
  /** 任务结果 resourceUrl 别名（部分模型网关字段） */
  resourceUrl?: string;
}

/** Seedance 视频时长标签（1.5 / 2.0 滑杆均为 4–15 秒） */
export type SeedanceDurationLabel = `${4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15}s`;

/** Seedance 2.0 文生/参考生视频可选比例 */
export type SeedanceTextRefAspectRatio = '1:1' | '16:9' | '4:3' | '21:9' | '9:16' | '3:4';

/** 图生 / 1.5 为「自动匹配」；2.0 文生/参考为具体比例 */
export type SeedanceAspectRatioSetting = '自动匹配' | SeedanceTextRefAspectRatio;
/** seedance2.0 参考生视频：比例策略 */
export type SeedanceReferenceRatioMode = 'force' | 'auto';

/** 侧栏 / selectedModel 使用的 Nano 图生模型名（对接 AiTop platform: NANO_BANANA_2_FLASH） */
export const MODEL_NANO_BANANA_2 = 'Nano Banana 2.0';

/** AiTop nanoBanana 接口 platform 字段 */
export const AITOP_PLATFORM_NANO_BANANA_2 = 'NANO_BANANA_2_FLASH';

const LEGACY_NANO_BANANA_MODEL_IDS = ['Nano Banana Pro(生图)', 'Nano Banana Pro'] as const;

/** 是否为 Nano Banana 2.0（含旧 persisted 名称） */
export function isNanoBanana2Model(model: string | undefined): boolean {
  if (!model) return false;
  if (model === MODEL_NANO_BANANA_2) return true;
  return (LEGACY_NANO_BANANA_MODEL_IDS as readonly string[]).includes(model);
}

/** image2 图生模型（侧栏名与 selectedModel 一致） */
export const MODEL_IMAGE_2 = 'image 2';

export function isImage2Model(model: string | undefined): boolean {
  return model === MODEL_IMAGE_2;
}

/** MidJourney 文生模型（面板下拉唯一选项） */
export const MODEL_MIDJOURNEY = 'MidJourney';
/** 旧 persisted 名称：MidJourney (真实感强)，用于向后兼容 */
export const MODEL_MIDJOURNEY_REALISTIC = 'MidJourney (真实感强)';
/** 旧 persisted 名称：Niji (卡通动漫)，用于向后兼容 */
export const MODEL_NIJI = 'Niji (卡通动漫)';

/** MidJourney 风格族类型 */
export type MjFamily = 'realistic' | 'cartoon';

/** MidJourney 风格族选项（面板内二级切换） */
export const MJ_FAMILY_OPTIONS: { id: MjFamily; label: string }[] = [
  { id: 'realistic', label: 'MidJourney (真实感强)' },
  { id: 'cartoon', label: 'Niji (卡通动漫)' },
];

export function isMidJourneyModel(model: string | undefined): boolean {
  return model === MODEL_MIDJOURNEY;
}

export function isNijiModel(model: string | undefined): boolean {
  return model === MODEL_NIJI;
}

/** 是否为旧 persisted 的 MJ 家族模型名（真实感强 / 卡通动漫） */
export function isLegacyMidJourneyFamilyModel(model: string | undefined): boolean {
  return model === MODEL_MIDJOURNEY_REALISTIC || model === MODEL_NIJI;
}

/** 是否为 MJ 家族文生模型（含新名 MidJourney 与旧 persisted 名），面板与运行链路共用判断 */
export function isMidJourneyFamilyModel(model: string | undefined): boolean {
  return isMidJourneyModel(model) || isLegacyMidJourneyFamilyModel(model);
}

/** MJ API version 参数（真实感强；含前导空格，服务端接受） */
export const MJ_VERSION_OPTIONS_REALISTIC = [' --v 7', ' --v 6.1', ' --v 6'] as const;
/** MJ API version 参数（卡通动漫；含前导空格，服务端接受） */
export const MJ_VERSION_OPTIONS_CARTOON = [' --niji6', ' --niji5'] as const;
/** MJ 画面比例（ratio 字段；文档示例中出现，已实测接受） */
export const MJ_RATIO_OPTIONS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const;
/** MJ 画质档（quality 字段；UI 显示中文，API 透传 value） */
export const MJ_QUALITY_OPTIONS: { name: string; value: string }[] = [
  { name: '一般', value: '0.25' },
  { name: '清晰', value: '0.5' },
  { name: '高清', value: '1' },
  { name: '超高清', value: '2' },
];
/** MJ 风格（style 字段） */
export const MJ_STYLE_OPTIONS: { name: string; value: string }[] = [
  { name: '赛博朋克', value: 'Cyberpunk' },
  { name: '星际', value: 'Warframe' },
  { name: '动漫', value: 'cartoon' },
  { name: '日本漫画', value: 'Japanese Manga' },
  { name: '水墨画风格', value: 'Ink painting style' },
  { name: '原创', value: 'Original' },
  { name: '风景画', value: 'Landscape Painting' },
  { name: '插画', value: 'illustration' },
  { name: '漫画', value: 'comics' },
  { name: '现代自然', value: 'Modern Nature' },
  { name: '创世纪', value: 'Genesis' },
  { name: '海报风格', value: 'Poster Style' },
  { name: '超现实主义', value: 'Surrealism' },
  { name: '素描', value: 'sketch' },
  { name: '写实', value: 'Realism' },
  { name: '水彩画', value: 'Watercolor' },
  { name: '立体主义', value: 'Cubism' },
  { name: '黑白', value: 'Black and White' },
  { name: '胶片摄影风格', value: 'fm photography' },
  { name: '电影化', value: 'Cinematic' },
  { name: '清晰的面部特征', value: 'dlear facial features' },
];
/** MJ 视角（angle 字段） */
export const MJ_ANGLE_OPTIONS: { name: string; value: string }[] = [
  { name: '宽视角', value: 'Wide view' },
  { name: '鸟瞰视角', value: 'Aerial view' },
  { name: '顶视角', value: 'Top view' },
  { name: '仰视角', value: 'Looking up' },
  { name: '正面视角', value: 'Front view' },
  { name: '头部特写', value: 'Headshot' },
  { name: '超广角视角', value: 'Ultrawideshot' },
  { name: '中景', value: 'Medium Shot(MS)' },
  { name: '远景', value: 'Long Shot(LS)' },
  { name: '景深', value: 'depth offield(dof)' },
];
/** MJ 人物镜头（camera 字段） */
export const MJ_CAMERA_OPTIONS: { name: string; value: string }[] = [
  { name: '脸部特写', value: 'Face Shot (VCU)' },
  { name: '大特写', value: 'Big Close-Up(BCU)' },
  { name: '腰部以上', value: 'Waist Shot(WS)' },
  { name: '膝盖以上', value: 'KneeShot(KS)' },
  { name: '全身照', value: 'Full Length Shot(FLS)' },
  { name: '极远景', value: 'Extra Long Shot(ELS)' },
];
/** MJ 灯光（light 字段） */
export const MJ_LIGHT_OPTIONS: { name: string; value: string }[] = [
  { name: '冷光', value: 'Cold Light' },
  { name: '暖光', value: 'Warm light' },
  { name: '硬光', value: 'Hard Light' },
  { name: '戏剧性光线', value: 'Dramatic Light' },
  { name: '反射光', value: 'Reflected Light' },
  { name: '薄雾', value: 'mist' },
  { name: '自然光', value: 'Natural Light' },
  { name: '阳光', value: 'Sunlight' },
  { name: '情绪化', value: 'Emotional' },
];
/** MJ 艺术程度（art 字段） */
export const MJ_ART_OPTIONS: { name: string; value: string }[] = [
  { name: '低强度风格', value: '50' },
  { name: '中等强度风格', value: '100' },
  { name: '高强度风格', value: '250' },
  { name: '非常高强度风格', value: '750' },
];
/** MJ 默认 version（真实感强最新版） */
export const MJ_DEFAULT_VERSION_REALISTIC = ' --v 7';
/** MJ 默认 version（卡通动漫最新版） */
export const MJ_DEFAULT_VERSION_CARTOON = ' --niji6';
/** @deprecated 旧常量别名，建议改用 MJ_DEFAULT_VERSION_REALISTIC */
export const MJ_DEFAULT_VERSION_MIDJOURNEY = MJ_DEFAULT_VERSION_REALISTIC;
/** @deprecated 旧常量别名，建议改用 MJ_DEFAULT_VERSION_CARTOON */
export const MJ_DEFAULT_VERSION_NIJI = MJ_DEFAULT_VERSION_CARTOON;

/** 属性面板 Model 下拉可选模型（新节点） */
export const INSPECTOR_SELECTABLE_MODELS = [
  MODEL_NANO_BANANA_2,
  MODEL_IMAGE_2,
  '可灵3.0 Omni',
  '即梦3.0 Pro',
  'seedance2.0 (高质量版)',
  'seedance2.0 (急速版)',
] as const;

/** 已从面板下线、旧工程仍可能 persisted 的模型 */
export const DEPRECATED_INSPECTOR_MODELS = [
  '可灵 2.5 Turbo',
  'vidu 2.0',
  'seedance1.5-pro',
] as const;

export function isDeprecatedInspectorModel(model: string | undefined): boolean {
  if (!model) return false;
  return (DEPRECATED_INSPECTOR_MODELS as readonly string[]).includes(model);
}

/**
 * Text Node（文生节点）可选模型：Nano Banana 2.0 / image 2 / MidJourney 文生图 + seedance2.0 文生视频。
 * MidJourney 面板内再通过 mjFamily 区分真实感强/卡通动漫。
 * 仅为 Image Node 已验收模型的子集，运行链路完全复用（无 @ 引用即文生）。
 */
export const TEXT_GEN_NODE_MODELS = [
  MODEL_NANO_BANANA_2,
  MODEL_IMAGE_2,
  MODEL_MIDJOURNEY,
  'seedance2.0 (高质量版)',
  'seedance2.0 (急速版)',
] as const;

/** 是否为 Text Node 文生面板可选模型 */
export function isTextGenNodeModel(model: string | undefined): boolean {
  if (!model) return false;
  return (TEXT_GEN_NODE_MODELS as readonly string[]).includes(model);
}

export interface NodeData {
  label: string;
  /** Text Node（文生节点）标记：纯文生图/文生视频，面板无拖图/参考区/@引用；PROCESSOR 类型复用全部运行链路 */
  textGenNode?: boolean;
  description?: string;
  icon?: string;
  status?: 'idle' | 'running' | 'completed' | 'error';
  // Specific fields
  prompt?: string;
  negativePrompt?: string; // Content to avoid
  modelName?: string;
  imagePreview?: string; // Main storyboard image
  /** 属性面板是否展示「主图」格：undefined=有 imagePreview 即展示；运行后未 @主图 时为 false */
  panelMainSlotVisible?: boolean;
  /** 运行后未 @主图 时备份的用户主图 URL，重新选中节点编辑时恢复属性面板主图格 */
  panelMainImageUrl?: string;
  
  // Progress & Error
  progress?: number;
  errorMessage?: string;
  /** 持久化：运行中刷新后按 taskId 恢复轮询与进度条（save 时 status 会落成 idle） */
  runRecoveryPending?: boolean;
  /** 持久化：刷新前最后一次进度（0–100） */
  runRecoveryProgress?: number;
  
  // Internal State Data (persisted in flow)
  referenceImages?: string[];
  /** 与 referenceImages 同槽下标：IndexedDB 引用（flowgen-local:…）；刷新后恢复面板参考图预览 */
  referenceImageLocalRefs?: string[];
  /** 与 referenceImages 同槽下标：资产库素材展示名（属性面板底栏）；无则显示「图片n」 */
  referenceImageLabels?: string[];
  /** 与 referenceImages 同槽：画布源 nodeId（canvas:…，仅面板去重，勿发 API） */
  referenceElementIds?: (string | undefined)[];
  /** 参考视频（仅用于 Node Details 展示；不自动播放） */
  referenceMovs?: { url: string; posterDataUrl?: string }[];
  /** 参考音频（Seedance 2.0 参考生视频 tab） */
  referenceAudios?: { url: string }[];
  /** 可灵3.0 Omni：多图参考（tab = multi）专用参考图 */
  klingOmniMultiReferenceImages?: string[];
  /** 与 klingOmniMultiReferenceImages 同槽 IndexedDB 引用 */
  klingOmniMultiReferenceLocalRefs?: string[];
  /** 可灵3.0 Omni：指令变换（tab = instruction）专用参考图 */
  klingOmniInstructionReferenceImages?: string[];
  klingOmniInstructionReferenceLocalRefs?: string[];
  /** 可灵3.0 Omni：视频参考（tab = video）专用参考图 */
  klingOmniVideoReferenceImages?: string[];
  klingOmniVideoReferenceLocalRefs?: string[];
  /** 可灵3.0 Omni：与参考图同索引的主体 elementId（主体库；发 Omni 请求时合并进平级 elementList） */
  klingOmniMultiReferenceElementIds?: (string | undefined)[];
  klingOmniInstructionReferenceElementIds?: (string | undefined)[];
  klingOmniVideoReferenceElementIds?: (string | undefined)[];
  /** 可灵3.0 Omni：多图参考（tab = multi）专用提示词 */
  klingOmniMultiPrompt?: string;
  klingOmniMultiNegativePrompt?: string;
  /** 可灵3.0 Omni：指令变换（tab = instruction）专用提示词 */
  klingOmniInstructionPrompt?: string;
  klingOmniInstructionNegativePrompt?: string;
  /** 可灵3.0 Omni：视频参考（tab = video）专用提示词 */
  klingOmniVideoPrompt?: string;
  klingOmniVideoNegativePrompt?: string;
  /** 可灵3.0 Omni：首尾帧（tab = frames）专用提示词 */
  klingOmniFramesPrompt?: string;
  klingOmniFramesNegativePrompt?: string;
  firstFrameImage?: string; // Keling: First Frame
  lastFrameImage?: string;  // Keling: Last Frame
  /** 首帧格底栏：资产库素材展示名；无则显示「首帧图」 */
  firstFrameImageLabel?: string;
  /** 尾帧格底栏：资产库素材展示名；无则显示「尾帧图」 */
  lastFrameImageLabel?: string;
  chatHistory?: ChatMessage[];
  selectedModel?: string;
  
  // Generation Settings
  aspectRatio?: string;
  resolution?: string;
  numberOfImages?: string; // Also used for Video Count (1条, 2条...)
  
  /** 分镜表批量生成下游节点时的边框高亮（绿=时长已写入，黄=模板节点，红=时长无效或不支持） */
  spawnHighlight?: 'green' | 'yellow' | 'red';
  /** 定时批量运行排队中（仅画布 UI 瞬态标记，勿持久化） */
  scheduledRunQueued?: boolean;
  /** 分镜表批量生成下游节点：主预览区改为镜头号占位图（仅 UI 显示，不影响真实输入媒体） */
  storyboardShotPreviewText?: string;

  // Keling Specific Settings
  quality?: string;      // '高质量' | '标准'
  duration?: string;     // '5s' | '10s'
  creativityLevel?: number; // 0-100 (Slider)
  klingAudioSync?: boolean; // 可灵3.0 Omni：音画同步

  /** 可灵3.0 Omni：当前使用的输入方式（决定是否走首尾帧图片 or 视频编辑） */
  klingOmniTab?: 'multi' | 'instruction' | 'video' | 'frames';
  /** 可灵3.0 Omni：各 tab 独立快照（参考图已分字段；此处仅首尾帧 + 指令/视频顶栏视频；主图四 tab 共用） */
  klingOmniTabConfigs?: {
    instruction?: {
      klingOmniInstructionVideoUrl?: string;
      klingOmniInstructionVideoPreviewUrl?: string;
      klingOmniInstructionVideoManuallyCleared?: boolean;
    };
    video?: {
      klingOmniVideoUrl?: string;
      klingOmniVideoPreviewUrl?: string;
      klingOmniVideoManuallyCleared?: boolean;
    };
    frames?: {
      firstFrameImage?: string;
      lastFrameImage?: string;
      firstFrameImageUrl?: string;
      lastFrameImageUrl?: string;
      firstFrameLocalRef?: string;
      lastFrameLocalRef?: string;
      firstFrameImageLabel?: string;
      lastFrameImageLabel?: string;
    };
  };
  /** 可灵3.0 Omni：已选视频的预览 URL（对象 URL；用于 UI 展示）——仅「视频参考」tab */
  klingOmniVideoPreviewUrl?: string;
  /** 可灵3.0 Omni：上传到 AiTop 后的视频 URL——仅「视频参考」tab */
  klingOmniVideoUrl?: string;
  /** 可灵3.0 Omni：用户在「视频参考」tab 手动移除了视频，禁止自动从上游补齐 */
  klingOmniVideoManuallyCleared?: boolean;
  /** 可灵3.0 Omni：指令变换 tab 本地预览（与视频参考槽位独立） */
  klingOmniInstructionVideoPreviewUrl?: string;
  /** 可灵3.0 Omni：指令变换 tab 上传后的视频 URL */
  klingOmniInstructionVideoUrl?: string;
  /** 可灵3.0 Omni：用户在「指令变换」tab 手动移除了视频，禁止自动从上游补齐 */
  klingOmniInstructionVideoManuallyCleared?: boolean;

  // 即梦3.0 Pro Specific Settings
  jimengGenerationMode?: 'text' | 'image';  // 文生视频 | 图生视频
  jimengProfessionalMode?: boolean;         // 专业模式
  jimengResolution?: string;                 // 分辨率，如 '1080p'
  jimengVideoRatio?: string;                 // 视频比例，如 '自动匹配'
  jimengImages?: string[];                   // 即梦图生视频：多张参考图

  // vidu 2.0 专用
  viduDuration?: '4s' | '8s';                // 时长
  viduClarity?: '360p' | '720p' | '1080p';  // 清晰度
  viduMotionRange?: '自动' | '小' | '中' | '大'; // 运动幅度

  // seedance1.5-pro 专用
  seedanceResolution?: '480p' | '720p' | '1080p'; // 1080p 仅 seedance2.0 高质量版
  seedanceAspectRatio?: SeedanceAspectRatioSetting;
  /** 时长（滑杆 4–15 秒，1.5 / 2.0 共用） */
  seedanceDuration?: SeedanceDurationLabel;
  seedanceGenerateAudio?: boolean;         // 生成音频
  seedanceFixedCamera?: boolean;            // 固定镜头
  seedanceGenerationMode?: 'text' | 'image' | 'reference';
  seedanceReferenceRatioMode?: SeedanceReferenceRatioMode;
  seedanceReferenceWebSearch?: boolean;
  /** seedance2.0：三 tab 独立配置快照 */
  seedanceTabConfigs?: {
    text?: { prompt?: string; negativePrompt?: string };
    image?: {
      prompt?: string;
      negativePrompt?: string;
      firstFrameImage?: string;
      lastFrameImage?: string;
      firstFrameImageUrl?: string;
      lastFrameImageUrl?: string;
      firstFrameLocalRef?: string;
      lastFrameLocalRef?: string;
    };
    reference?: {
      prompt?: string;
      negativePrompt?: string;
      referenceImages?: string[];
      referenceImageLabels?: string[];
      referenceElementIds?: (string | undefined)[];
      referenceMovs?: { url: string; posterDataUrl?: string }[];
      referenceAudios?: { url: string }[];
    };
  };

  /** image2：生动 / 自然 */
  image2Style?: 'vivid' | 'natural';
  /** image2：画面比例（与 image2ImageSize 联动） */
  image2AspectRatio?: string;
  /** image2：图像尺寸（像素） */
  image2ImageSize?: string;
  /** image2：清晰度档位 1K / 2K / 4K */
  image2Quality?: '1K' | '2K' | '4K';
  /** image2：画质等级 low / medium / high */
  image2QualityLevel?: 'low' | 'medium' | 'high';

  /** MidJourney：风格族（realistic=真实感强 / cartoon=卡通动漫） */
  mjFamily?: MjFamily;
  /** MidJourney：API model 参数（' --v 7' / ' --v 6.1' / ' --v 6' / ' --niji6' / ' --niji5'） */
  mjVersion?: string;
  /** MidJourney：风格（API style 字段，空=不传） */
  mjStyle?: string;
  /** MidJourney：画面比例 ratio（1:1 / 4:3 / 3:4 / 16:9 / 9:16） */
  mjRatio?: string;
  /** MidJourney：quality 画质档（'0.25' | '0.5' | '1' | '2'） */
  mjQuality?: string;
  /** MidJourney：mode 计费模式（FAST 快速=30 积分 / RELAX 低速=15 积分） */
  mjMode?: 'FAST' | 'RELAX';
  /** MidJourney：视角 angle（API angle 字段） */
  mjAngle?: string;
  /** MidJourney：人物镜头 camera（API camera 字段） */
  mjCamera?: string;
  /** MidJourney：灯光 light（API light 字段） */
  mjLight?: string;
  /** MidJourney：艺术程度 art（API art 字段） */
  mjArt?: string;
  /** MidJourney：风格一致性图 URL（sref，选填，面板上传即转 COS URL） */
  mjSrefUrl?: string;
  /** MidJourney：角色一致性图 URL（cref，卡通动漫风格族选填） */
  mjCrefUrl?: string;
  /** MidJourney：参照万物图 URL（oref，真实感强风格族选填） */
  mjOrefUrl?: string;
  /** MidJourney：参考图区是否展开（持久化） */
  mjRefImagesOpen?: boolean;
  /** MidJourney：高级参数区是否展开（持久化） */
  mjAdvancedOpen?: boolean;

  // Snapshot of parameters used to generate this node
  generationParams?: GenerationParams;
  /** 最近一次生成完成时间（ISO 字符串） */
  generatedAt?: string;
  taskId?: string;

  // Display fields
  imageName?: string;
  /** 本机 IndexedDB 媒体引用（flowgen-local:…）；仅当前浏览器可恢复预览，同步到库后他人不可见 */
  imageLocalRef?: string;
  /** 来自项目资产库的素材 id（分镜表模板校验 / 持久化绑定） */
  projectAssetId?: string;
  /** 首尾帧本机 IDB 引用（刷新后恢复 Inspector 预览；运行仍可用 originals 原图） */
  firstFrameLocalRef?: string;
  lastFrameLocalRef?: string;
  /** 节点自定义名称（用于画布显示） */
  customName?: string;

  /**
   * 链路折叠：下游 id 列表存在 INPUT/PROCESSOR 上时表示已打组（条 UI 画在节点内）；
   * chainFolderRootId 仅历史独立 CHAIN_FOLDER 节点使用。
   */
  chainFolderRootId?: string;
  chainFolderChildIds?: string[];
  chainFolderExpanded?: boolean;
  chainFolderLabel?: string;

  /** Backdrop：被框住的节点 id（仅组织用，非父子嵌套） */
  backdropChildIds?: string[];
  /** 标题条文案 */
  backdropLabel?: string;
  /** 创建后自动进入顶部命名编辑（一次性） */
  backdropRenamePending?: boolean;
  /** 填充色（如 rgba） */
  backdropFill?: string;
  /** 边框色 */
  backdropBorder?: string;

  /** 视频中间帧缩略图 data URL，生成后写入、持久化，避免播放或重复加载视频 */
  videoPosterDataUrl?: string;
  
  // Generated thumbnails (for INPUT nodes to show generated outputs)
  generatedThumbnails?: Array<{
    id: string;
    url: string;
    type: 'image' | 'video';
    nodeId?: string; // Reference to the output node
    /** 输出节点显示名快照（用于 Generated Outputs 历史项显示与追溯） */
    name?: string;
    generationParams?: GenerationParams;
    /** 视频缩略图 data URL，生成后写入、持久化 */
    posterDataUrl?: string;
  }>;
  
  // Video frame image URLs (uploaded URLs, not base64)
  firstFrameImageUrl?: string; // Uploaded URL for first frame
  lastFrameImageUrl?: string;  // Uploaded URL for last frame
  
  // Model-specific configurations (保存每个模型的独立配置)
  modelConfigs?: {
    'Nano Banana 2.0'?: {
      prompt?: string;
      negativePrompt?: string;
      aspectRatio?: string;
      numberOfImages?: string;
      referenceImages?: string[];
      referenceImageLabels?: string[];
      referenceElementIds?: (string | undefined)[];
      referenceImageLocalRefs?: string[];
      imagePreview?: string;
      imageName?: string;
      imageLocalRef?: string;
      panelMainImageUrl?: string;
      panelMainSlotVisible?: boolean;
    };
    image2?: {
      prompt?: string;
      negativePrompt?: string;
      referenceImages?: string[];
      referenceImageLabels?: string[];
      referenceElementIds?: (string | undefined)[];
      referenceImageLocalRefs?: string[];
      imagePreview?: string;
      imageName?: string;
      imageLocalRef?: string;
      panelMainSlotVisible?: boolean;
      panelMainImageUrl?: string;
      numberOfImages?: string;
      image2Style?: 'vivid' | 'natural';
      image2AspectRatio?: string;
      image2ImageSize?: string;
      image2Quality?: '1K' | '2K' | '4K';
      image2QualityLevel?: 'low' | 'medium' | 'high';
    };
    MidJourney?: {
      prompt?: string;
      negativePrompt?: string;
      numberOfImages?: string;
      mjFamily?: MjFamily;
      mjVersion?: string;
      mjStyle?: string;
      mjRatio?: string;
      mjQuality?: string;
      mjMode?: 'FAST' | 'RELAX';
      mjAngle?: string;
      mjCamera?: string;
      mjLight?: string;
      mjArt?: string;
      mjSrefUrl?: string;
      mjCrefUrl?: string;
      mjOrefUrl?: string;
    };
    '可灵 2.5 Turbo'?: {
      prompt?: string;
      negativePrompt?: string;
      firstFrameImage?: string;
      lastFrameImage?: string;
      firstFrameImageUrl?: string;
      lastFrameImageUrl?: string;
      firstFrameLocalRef?: string;
      lastFrameLocalRef?: string;
      firstFrameImageLabel?: string;
      lastFrameImageLabel?: string;
      quality?: string;
      duration?: string;
      creativityLevel?: number;
      numberOfImages?: string;
      aspectRatio?: string;
    };
    '可灵3.0 Omni'?: {
      prompt?: string;
      negativePrompt?: string;
      firstFrameImage?: string;
      lastFrameImage?: string;
      firstFrameImageUrl?: string;
      lastFrameImageUrl?: string;
      firstFrameLocalRef?: string;
      lastFrameLocalRef?: string;
      firstFrameImageLabel?: string;
      lastFrameImageLabel?: string;
      quality?: string;
      duration?: string;
      numberOfImages?: string;
      aspectRatio?: string;
      klingAudioSync?: boolean;
      referenceImages?: string[];
      klingOmniMultiReferenceImages?: string[];
      klingOmniInstructionReferenceImages?: string[];
      klingOmniVideoReferenceImages?: string[];
      klingOmniMultiReferenceElementIds?: (string | undefined)[];
      klingOmniInstructionReferenceElementIds?: (string | undefined)[];
      klingOmniVideoReferenceElementIds?: (string | undefined)[];
      klingOmniMultiPrompt?: string;
      klingOmniMultiNegativePrompt?: string;
      klingOmniInstructionPrompt?: string;
      klingOmniInstructionNegativePrompt?: string;
      klingOmniVideoPrompt?: string;
      klingOmniVideoNegativePrompt?: string;
      klingOmniFramesPrompt?: string;
      klingOmniFramesNegativePrompt?: string;
      klingOmniTab?: 'multi' | 'instruction' | 'video' | 'frames';
      klingOmniTabConfigs?: NodeData['klingOmniTabConfigs'];
      klingOmniVideoPreviewUrl?: string;
      klingOmniVideoUrl?: string;
      klingOmniInstructionVideoPreviewUrl?: string;
      klingOmniInstructionVideoUrl?: string;
      referenceImageLocalRefs?: string[];
      klingOmniMultiReferenceLocalRefs?: string[];
      klingOmniInstructionReferenceLocalRefs?: string[];
      klingOmniVideoReferenceLocalRefs?: string[];
    };
    '即梦3.0 Pro'?: {
      prompt?: string;
      negativePrompt?: string;
      jimengGenerationMode?: 'text' | 'image';
      jimengProfessionalMode?: boolean;
      jimengResolution?: string;
      jimengVideoRatio?: string;
      duration?: string;
      numberOfImages?: string;
      firstFrameImage?: string;
      firstFrameImageUrl?: string;
      firstFrameLocalRef?: string;
      firstFrameImageLabel?: string;
      jimengImages?: string[];
    };
    'vidu 2.0'?: {
      prompt?: string;
      negativePrompt?: string;
      firstFrameImage?: string;
      lastFrameImage?: string;
      firstFrameImageUrl?: string;
      lastFrameImageUrl?: string;
      firstFrameLocalRef?: string;
      lastFrameLocalRef?: string;
      firstFrameImageLabel?: string;
      lastFrameImageLabel?: string;
      viduDuration?: '4s' | '8s';
      viduClarity?: '360p' | '720p' | '1080p';
      viduMotionRange?: '自动' | '小' | '中' | '大';
      aspectRatio?: string;
      numberOfImages?: string;
    };
    'seedance1.5-pro'?: {
      prompt?: string;
      negativePrompt?: string;
      firstFrameImage?: string;
      lastFrameImage?: string;
      firstFrameImageUrl?: string;
      lastFrameImageUrl?: string;
      firstFrameLocalRef?: string;
      lastFrameLocalRef?: string;
      firstFrameImageLabel?: string;
      lastFrameImageLabel?: string;
      numberOfImages?: string;
      seedanceResolution?: '480p' | '720p';
      seedanceAspectRatio?: SeedanceAspectRatioSetting;
      seedanceDuration?: SeedanceDurationLabel;
      seedanceGenerateAudio?: boolean;
      seedanceFixedCamera?: boolean;
      seedanceGenerationMode?: 'text' | 'image' | 'reference';
      seedanceReferenceRatioMode?: SeedanceReferenceRatioMode;
      seedanceReferenceWebSearch?: boolean;
      seedanceTabConfigs?: NodeData['seedanceTabConfigs'];
      referenceImages?: string[];
      referenceImageLabels?: string[];
      referenceElementIds?: (string | undefined)[];
      referenceMovs?: { url: string; posterDataUrl?: string }[];
      referenceAudios?: { url: string }[];
    };
    'seedance2.0 (高质量版)'?: {
      prompt?: string;
      negativePrompt?: string;
      firstFrameImage?: string;
      lastFrameImage?: string;
      firstFrameImageUrl?: string;
      lastFrameImageUrl?: string;
      firstFrameLocalRef?: string;
      lastFrameLocalRef?: string;
      firstFrameImageLabel?: string;
      lastFrameImageLabel?: string;
      numberOfImages?: string;
      seedanceResolution?: '480p' | '720p' | '1080p';
      seedanceAspectRatio?: SeedanceAspectRatioSetting;
      seedanceDuration?: SeedanceDurationLabel;
      seedanceGenerateAudio?: boolean;
      seedanceFixedCamera?: boolean;
      seedanceGenerationMode?: 'text' | 'image' | 'reference';
      seedanceReferenceRatioMode?: SeedanceReferenceRatioMode;
      seedanceReferenceWebSearch?: boolean;
      seedanceTabConfigs?: NodeData['seedanceTabConfigs'];
      referenceImages?: string[];
      referenceImageLabels?: string[];
      referenceElementIds?: (string | undefined)[];
      referenceImageLocalRefs?: string[];
      referenceMovs?: { url: string; posterDataUrl?: string }[];
      referenceAudios?: { url: string }[];
    };
    'seedance2.0 (急速版)'?: {
      prompt?: string;
      negativePrompt?: string;
      firstFrameImage?: string;
      lastFrameImage?: string;
      firstFrameImageUrl?: string;
      lastFrameImageUrl?: string;
      firstFrameLocalRef?: string;
      lastFrameLocalRef?: string;
      firstFrameImageLabel?: string;
      lastFrameImageLabel?: string;
      numberOfImages?: string;
      seedanceResolution?: '480p' | '720p';
      seedanceAspectRatio?: SeedanceAspectRatioSetting;
      seedanceDuration?: SeedanceDurationLabel;
      seedanceGenerateAudio?: boolean;
      seedanceFixedCamera?: boolean;
      seedanceGenerationMode?: 'text' | 'image' | 'reference';
      seedanceReferenceRatioMode?: SeedanceReferenceRatioMode;
      seedanceReferenceWebSearch?: boolean;
      seedanceTabConfigs?: NodeData['seedanceTabConfigs'];
      referenceImages?: string[];
      referenceImageLabels?: string[];
      referenceElementIds?: (string | undefined)[];
      referenceImageLocalRefs?: string[];
      referenceMovs?: { url: string; posterDataUrl?: string }[];
      referenceAudios?: { url: string }[];
    };
  };
}

// Drag and drop data type
export interface DragItem {
  type: NodeType;
  label: string;
}