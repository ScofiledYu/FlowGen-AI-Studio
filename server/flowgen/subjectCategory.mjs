/**
 * 与前端 services/aitop.ts 中 KLING_SUBJECT_TAG_BY_CATEGORY 一致：
 * 入库统一为 PERSON / ANIMAL / … / OTHER（ASCII），避免 multipart / 代理对中文字段不稳定。
 */
const ZH_TO_EN = {
  人物: 'PERSON',
  动物: 'ANIMAL',
  道具: 'PROP',
  服饰: 'CLOTHES',
  场景: 'SCENE',
  特效: 'EFFECT',
  特性: 'EFFECT',
  其他: 'OTHER',
  其它: 'OTHER',
  未分类: 'OTHER',
};

const EN_SET = new Set(['PERSON', 'ANIMAL', 'PROP', 'CLOTHES', 'SCENE', 'EFFECT', 'OTHER']);

export function normalizeCategoryForStore(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'OTHER';
  const up = s.toUpperCase();
  if (EN_SET.has(up)) return up;
  if (ZH_TO_EN[s]) return ZH_TO_EN[s];
  return 'OTHER';
}
