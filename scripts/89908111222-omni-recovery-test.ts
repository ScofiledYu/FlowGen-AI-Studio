/**
 * 89908111222.json 回归：可灵3.0 Omni 视频参考 tab 经 AiTop 恢复 spawn 时
 * generationParams 须含 referenceImages / referenceMovs / outputUrl，勿把成片写入参考视频槽。
 *
 * npx tsx scripts/89908111222-omni-recovery-test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Node as RFNode } from 'reactflow';
import { NodeType } from '../types.ts';
import type { NodeData } from '../types.ts';
import {
  buildRecoveryGraphUpdates,
  mergeRecoveryGenerationParamsFromRunNode,
} from '../utils/runRecovery.ts';
import { buildOmniInstructionVideoTabDetailsReferencePreview } from '../utils/nodeDetailsPreview.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', '89908111222.json');

const MAIN_IMG =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/1c5ae635-5cd1-4865-9ddd-22dd85411b5d.png';
const INPUT_VIDEO =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/aec30c9e-f93b-4eca-924d-1695ee6d4323.mp4';
const OUTPUT_VIDEO =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/cdc4db19-2735-403c-b521-e6dee1c29c4c.mp4';

console.log('\n=== 89908111222 §1. mergeRecoveryGenerationParamsFromRunNode（Omni video tab）===\n');

{
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    nodes: Array<{ id: string; type: string; data: NodeData }>;
  };
  const runNode = raw.nodes.find((n) => n.id === 'node_7_1782870116896');
  ok('fixture 含 processor 运行节点', Boolean(runNode));
  if (runNode) {
    const rfNode = {
      id: runNode.id,
      type: NodeType.PROCESSOR,
      position: { x: 0, y: 0 },
      data: runNode.data,
    } as RFNode;

    const gp = mergeRecoveryGenerationParamsFromRunNode(rfNode, {
      taskId: '1460856',
      model: '可灵3.0 Omni',
      generatedAt: new Date().toISOString(),
      outputUrl: OUTPUT_VIDEO,
    });

    ok('gp.klingOmniTab=video', gp.klingOmniTab === 'video', String(gp.klingOmniTab));
    ok('gp 含主图 referenceImages', gp.referenceImages?.[0] === MAIN_IMG, gp.referenceImages?.[0]);
    ok('gp 含 quality', gp.quality === '高质量', gp.quality);
    ok('gp 含 duration', gp.duration === '5s', gp.duration);
    ok('gp 含 aspectRatio', gp.aspectRatio === '16:9', gp.aspectRatio);
    ok('gp.outputUrl 为成片', gp.outputUrl === OUTPUT_VIDEO, gp.outputUrl);
    ok('gp.klingOmniVideoUrl 为输入参考视频', gp.klingOmniVideoUrl === INPUT_VIDEO, gp.klingOmniVideoUrl);
    ok(
      'gp.referenceMovs 为输入参考视频',
      gp.referenceMovs?.[0]?.url === INPUT_VIDEO,
      gp.referenceMovs?.[0]?.url
    );
    ok(
      'referenceMovs 不含成片 URL',
      !gp.referenceMovs?.some((m) => m.url === OUTPUT_VIDEO),
      JSON.stringify(gp.referenceMovs)
    );
  }
}

console.log('\n=== 89908111222 §2. buildRecoveryGraphUpdates spawn 后 run/MOV gp 完整 ===\n');

{
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: NodeData }>;
    edges: Array<{ id: string; source: string; target: string }>;
  };
  const runNode = raw.nodes.find((n) => n.id === 'node_7_1782870116896');
  if (runNode) {
    const preRecoveryNodes = [
      {
        ...runNode,
        type: NodeType.PROCESSOR,
        data: {
          ...runNode.data,
          status: 'running',
          progress: 80,
          generatedThumbnails: [],
          generationParams: {
            taskId: '1460856',
            model: '可灵3.0 Omni',
            prompt: runNode.data.klingOmniVideoPrompt,
            klingOmniTab: 'video',
          },
        },
      },
    ] as RFNode[];

    let seq = 0;
    const { nodes } = buildRecoveryGraphUpdates({
      nodes: preRecoveryNodes,
      edges: [],
      runNodeId: runNode.id,
      mediaUrls: [OUTPUT_VIDEO],
      taskIdJoined: '1460856',
      createNodeId: () => `node_recover_${++seq}`,
    });

    const updatedRun = nodes.find((n) => n.id === runNode.id);
    const mov = nodes.find((n) => n.type === NodeType.MOV);
    ok('恢复后 spawn MOV', Boolean(mov));
    const runGp = updatedRun?.data?.generationParams;
    const movGp = mov?.data?.generationParams;
    ok('run 节点 gp 含 referenceImages', (runGp?.referenceImages?.length ?? 0) >= 1);
    ok('run 节点 gp.referenceMovs 为输入视频', runGp?.referenceMovs?.[0]?.url === INPUT_VIDEO);
    ok('run 节点 gp.outputUrl 为成片', runGp?.outputUrl === OUTPUT_VIDEO);
    ok('MOV gp 含 referenceImages', (movGp?.referenceImages?.length ?? 0) >= 1);
    ok('MOV gp.referenceMovs 为输入视频', movGp?.referenceMovs?.[0]?.url === INPUT_VIDEO);
    ok('MOV gp 不含 output 作为 referenceMov', !movGp?.referenceMovs?.some((m) => m.url === OUTPUT_VIDEO));
  }
}

console.log('\n=== 89908111222 §3. Node Details 参考图/视频（gp 快照驱动）===\n');

{
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    nodes: Array<{ id: string; data: NodeData }>;
  };
  const runNode = raw.nodes.find((n) => n.id === 'node_7_1782870116896');
  if (runNode) {
    const rfNode = {
      id: runNode.id,
      type: NodeType.PROCESSOR,
      position: { x: 0, y: 0 },
      data: runNode.data,
    } as RFNode;
    const gp = mergeRecoveryGenerationParamsFromRunNode(rfNode, {
      taskId: '1460856',
      model: '可灵3.0 Omni',
      outputUrl: OUTPUT_VIDEO,
    });
    const movUrlSet = new Set([INPUT_VIDEO]);
    const refPreview = buildOmniInstructionVideoTabDetailsReferencePreview({
      panelSource: {
        ...runNode.data,
        selectedModel: '可灵3.0 Omni',
        klingOmniTab: 'video',
      },
      omniTab: 'video',
      urlPool: [MAIN_IMG, INPUT_VIDEO],
      snapshotRefs: gp.referenceImages || [],
      movUrlSet,
    });
    ok('Details 参考图 ≥1', refPreview.referenceImages.length >= 1, String(refPreview.referenceImages.length));
    ok('Details 含主图标签', refPreview.referenceImageDetailItems.some((i) => i.label === '主图'));
    ok('Details 参考图 URL 为主图', refPreview.referenceImages[0] === MAIN_IMG, refPreview.referenceImages[0]);
  }
}

console.log(`\n=== 89908111222 汇总: ${pass} 通过, ${fail} 失败 ===\n`);
process.exit(fail > 0 ? 1 : 0);
