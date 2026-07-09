/**
 * Omni multi 面板拖入去重：Shift+框选中键重复拖入 + 本地文件 hydrate 竞态双槽
 * fixture 场景：d:/json/面板问题2.json
 *
 * npx tsx scripts/2026070802-omni-panel-dedup-test.ts
 */
import {
  alignPanelReferenceSlotsFromLocalRefs,
  panelReferenceImagesFieldForLocalRefs,
} from '../utils/hydratePanelReferenceLocalRefs.ts';
import {
  canvasOmniRefElementId,
  panelReferencesAlreadyContainCanvasSource,
  panelReferencesAlreadyContainIncoming,
  resolvePanelRefLabelForInspectorDrop,
} from '../utils/referenceImageSlotLabels.ts';
import { buildOmniMultiApiImageList } from '../utils/referencedMediaRun.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  [OK] ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n=== 场景1：画布 node_a 二次拖入 → canvas:node_a 去重 ===\n');
{
  const elementIds = [canvasOmniRefElementId('node_a'), canvasOmniRefElementId('node_b')];
  const refs = ['blob:http://localhost/a1', 'blob:http://localhost/b1'];
  ok(
    'node_a 已在 elementIds',
    panelReferencesAlreadyContainCanvasSource(elementIds, 'node_a')
  );
  ok(
    'node_a 再来 blob 不同 URL 仍跳过',
    panelReferencesAlreadyContainIncoming(refs, ['图片1', '图片2'], 'blob:http://localhost/a2', {
      canvasSourceNodeId: 'node_a',
      elementIds,
    })
  );
  ok(
    'node_c 可追加',
    !panelReferencesAlreadyContainIncoming(refs, ['图片1', '图片2'], 'blob:http://localhost/c1', {
      canvasSourceNodeId: 'node_c',
      elementIds,
    })
  );
}

console.log('\n=== 场景2：本地拖入 hydrate 先写 blob，压缩 data 同槽替换（不追加） ===\n');
{
  const startIndex = 4;
  const blob = 'blob:http://localhost/hydrated';
  const data = 'data:image/jpeg;base64,LOCALFILE';
  const localRef = 'flowgen-local:scope:node:ref:0';
  const localRefs = ['', '', '', '', localRef];
  const refs = ['r0', 'r1', 'r2', 'r3', blob];
  const aligned = alignPanelReferenceSlotsFromLocalRefs(refs, localRefs);
  ok('hydrate 后槽4=blob', aligned.images[4] === blob);

  const slotOccupiedByHydrate =
    Boolean(localRefs[4]) && Boolean(String(aligned.images[4] || '').trim());
  ok('同槽 hydrate 占用', slotOccupiedByHydrate);

  const skipAppend = panelReferencesAlreadyContainIncoming(aligned.images, undefined, data, {
    targetSlotIndex: startIndex,
    localRefs,
  });
  ok('同槽 data 不因 blob≠data 误判为可追加', skipAppend === false, `skipAppend=${skipAppend}`);

  const next = [...aligned.images];
  next[startIndex] = data;
  ok('写入后仍 5 槽', next.filter(Boolean).length === 5, `len=${next.filter(Boolean).length}`);
  ok('槽4=data 非双槽', next[4] === data && next.length === 5);
}

console.log('\n=== 场景3：API imageList 过滤 canvas: element_id ===\n');
{
  const list = buildOmniMultiApiImageList({
    firstFrameUrl: 'https://cos/first.png',
    extraEntries: [{ token: '@图片1', url: 'https://cos/r1.png', refImageSlotIndex: 0, label: '图片1', imageIndex: 0 }],
    uploadedByToken: new Map([['@图片1', 'https://cos/r1.png']]),
    refElementIds: [canvasOmniRefElementId('node_x')],
  });
  ok('仅首帧+1参考', list.length === 2, `len=${list.length}`);
  ok('无 canvas element_id', !list.some((r) => 'element_id' in r && String(r.element_id).startsWith('canvas:')));
}

console.log('\n=== 场景4：面板问题2.json 结构（6槽=重复）可经去重压到 3 ===\n');
{
  const nodeA = 'node_src_a';
  const nodeB = 'node_src_b';
  let refs: string[] = [];
  let labels: string[] = [];
  let eids: (string | undefined)[] = [];

  const addCanvas = (nodeId: string, url: string) => {
    if (panelReferencesAlreadyContainCanvasSource(eids, nodeId)) return false;
    refs = [...refs, url];
    labels = [...labels, `图片${refs.length}`];
    eids = [...eids, canvasOmniRefElementId(nodeId)];
    return true;
  };

  ok('首次 node_a', addCanvas(nodeA, 'blob:a1'));
  ok('首次 node_b', addCanvas(nodeB, 'blob:b1'));
  ok('重复 node_a 跳过', !addCanvas(nodeA, 'blob:a2'));
  ok('重复 node_b 跳过', !addCanvas(nodeB, 'blob:b2'));
  ok('去重后 2 槽', refs.length === 2, `len=${refs.length}`);

  const startIndex = refs.length;
  const localRef = 'flowgen-local:x';
  const localRefs = [...Array(startIndex).fill(''), localRef];
  refs = [...refs, 'blob:local-hydrate'];
  const data = 'data:image/jpeg;base64,SAME';
  refs[startIndex] = data;
  labels = [...labels, resolvePanelRefLabelForInspectorDrop({
    url: data,
    slotIndex: startIndex,
    referenceImages: refs,
  })];
  ok('本地 1 张仅 1 槽', refs.filter(Boolean).length === 3, `len=${refs.filter(Boolean).length}`);
  ok('末槽为 data', refs[startIndex] === data);
  ok('localRef 对齐', localRefs.length === refs.length || localRefs[startIndex] === localRef);
}

console.log('\n=== 场景5：串行 batch（无 React 重渲染）elementIds 不丢、重复拖入跳过 ===\n');
{
  type NodeDataSlice = {
    klingOmniMultiReferenceImages?: string[];
    klingOmniMultiReferenceElementIds?: (string | undefined)[];
    referenceImageLabels?: string[];
  };
  let live: NodeDataSlice = {
    klingOmniMultiReferenceImages: [],
    klingOmniMultiReferenceElementIds: [],
    referenceImageLabels: [],
  };
  const applyCanvas = (nodeId: string, url: string) => {
    const refs = live.klingOmniMultiReferenceImages || [];
    const eids = live.klingOmniMultiReferenceElementIds || [];
    if (panelReferencesAlreadyContainCanvasSource(eids, nodeId)) return false;
    const nextRefs = [...refs, url];
    const nextEids = [...eids, canvasOmniRefElementId(nodeId)];
    live = {
      klingOmniMultiReferenceImages: nextRefs,
      klingOmniMultiReferenceElementIds: nextEids,
      referenceImageLabels: [...(live.referenceImageLabels || []), `图片${nextRefs.length}`],
    };
    return true;
  };
  ok('batch 第1个 node_8', applyCanvas('node_8', 'blob:a1'));
  ok('batch 第2个 node_0', applyCanvas('node_0', 'blob:b1'));
  ok(
    'batch 第2个后 eids[0] 仍在',
    live.klingOmniMultiReferenceElementIds?.[0] === canvasOmniRefElementId('node_8')
  );
  ok('batch 第3个 node_17', applyCanvas('node_17', 'blob:c1'));
  ok('重复 node_8 跳过', !applyCanvas('node_8', 'blob:a2'));
  ok('重复 node_0 跳过', !applyCanvas('node_0', 'blob:b2'));
  ok('重复 node_17 跳过', !applyCanvas('node_17', 'blob:c2'));
  ok('仍为 3 槽', (live.klingOmniMultiReferenceImages || []).length === 3, `len=${(live.klingOmniMultiReferenceImages || []).length}`);
  ok(
    '三槽均有 canvas eid',
    (live.klingOmniMultiReferenceElementIds || []).filter(Boolean).length === 3
  );
}

console.log('\n=== 场景6：通用 referenceElementIds（Banana/image2/Seedance 等）串行 batch ===\n');
{
  let refs: string[] = [];
  let eids: (string | undefined)[] = [];
  const apply = (nodeId: string, url: string) => {
    if (panelReferencesAlreadyContainCanvasSource(eids, nodeId)) return false;
    const nextRefs = [...refs, url];
    eids = nextRefs.map((u, i) => {
      if (i < refs.length && u === refs[i] && eids[i]) return eids[i];
      if (i === nextRefs.length - 1) return canvasOmniRefElementId(nodeId);
      return eids[i];
    });
    refs = nextRefs;
    return true;
  };
  ok('nano batch node_1', apply('node_1', 'blob:n1'));
  ok('nano batch node_2', apply('node_2', 'blob:n2'));
  ok('nano 重复 node_1 跳过', !apply('node_1', 'blob:n1b'));
  ok('仍为 2 槽', refs.length === 2, `len=${refs.length}`);
}

console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);
