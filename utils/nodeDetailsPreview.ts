import type { GenerationParams, NodeData } from '../types';
import {
  MODEL_IMAGE_2,
  MODEL_NANO_BANANA_2,
  NodeType,
  isImage2Model,
  isNanoBanana2Model,
} from '../types';
import {
  getSeedanceDefaultResolution,
  normalizeSeedanceAspectForTextRef,
} from './seedanceAspectRatio';
import { pickStillImageRecoveryApiReferenceImages } from './referencedMediaRun';
import { SEEDANCE_DURATION_DEFAULT_LABEL } from './seedanceDuration';
import {
  buildReferenceImageDetailItemsFromPanel,
  buildPromptMediaRefContextFromNode,
  buildPromptMediaRefLabels,
  isDuplicateOfMainImagePreview,
  isLikelyMainVideoUrl,
  isOmniTabVideoMainVideoReference,
  omniMultiImagePreviewCountsAsPromptImageRef,
  matchAllPromptMediaTokens,
  panelReferenceSlotLabel,
  promptMentionsMainImageForNodeData,
  promptMentionsAnyImageRefForNodeData,
  referenceVideoUrlsInLabelOrder,
  resolveOmniMultiReferenceSlotVideoUrl,
  type ReferenceImageDetailItem,
} from './promptMediaRefs';