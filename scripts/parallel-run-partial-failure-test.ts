/**
 * 并发运行部分失败契约测试（方案 A：先用测试暴露问题）
 *
 * 背景：runParallelGenerationTasks 用 Promise.allSettled 并行轮询 count 个任务，
 *   部分成功时仅返回成功 URL（string[]），errors 数组在函数内部被丢弃。
 *   调用方（FlowEditor.tsx 7 处）拿到短数组后直接 spawnOutputNode，
 *   不检查长度差异 → 用户请求 3 张只回 2 张时无失败提示，静默丢失。
 *
 * 本测试目的：
 *   - 断言 1-3：固化并发运行的正确行为（全成功保序 / 部分失败不阻塞 / 全失败抛错）
 *   - 断言 4：暴露"部分失败时调用方无法获取失败详情"的设计缺口（当前会 FAIL）
 *
 * 运行：npx tsx scripts/parallel-run-partial-failure-test.ts
 *
 * 注意：本测试暂不注册到 test-gate.mjs（断言 4 故意红，避免阻塞门禁）。
 *   待 runParallelGenerationTasks 改为返回 { urls, errors } 后，断言 4 转绿，
 *   再注册到 test-gate.mjs 作为防回退契约。
 */
import { runParallelGenerationTasks } from '../utils/multiGenerateTasks.ts';

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

async function main() {
  console.log('=== 并发运行部分失败契约测试 ===\n');

  // ---------- 断言 1：全成功 → 返回 count 个 URL，保序 ----------
  {
    console.log('[用例1] 3 任务全成功');
    const created: string[] = [];
    const { urls } = await runParallelGenerationTasks(
      3,
      (i) => Promise.resolve(`task-${i}`),
      (taskId, i) => Promise.resolve(`url-${i}`),
      (taskId) => created.push(taskId)
    );
    ok('返回 3 个 URL', urls.length === 3, `实际 ${urls.length}`);
    ok('URL 保序', urls[0] === 'url-0' && urls[1] === 'url-1' && urls[2] === 'url-2');
    ok('onTaskCreated 回调被调用 3 次', created.length === 3, `实际 ${created.length}`);
    console.log('');
  }

  // ---------- 断言 2：第 2 个轮询失败 → 返回 2 个 URL，不抛错 ----------
  {
    console.log('[用例2] 3 任务，第 2 个 pollTask 失败');
    const { urls } = await runParallelGenerationTasks(
      3,
      (i) => Promise.resolve(`task-${i}`),
      (taskId, i) => (i === 1 ? Promise.reject(new Error('轮询超时')) : Promise.resolve(`url-${i}`))
    );
    ok('返回 2 个 URL（失败任务被跳过）', urls.length === 2, `实际 ${urls.length}`);
    ok('保留下标 0 和 2 的结果', urls[0] === 'url-0' && urls[1] === 'url-2', `urls=${JSON.stringify(urls)}`);
    ok('部分失败不抛错', true, '到达此断言即未抛错');
    console.log('');
  }

  // ---------- 断言 3：全失败 → 抛聚合错误，含"批量生成失败" ----------
  {
    console.log('[用例3] 3 任务全失败（pollTask 全 reject）');
    let thrown: Error | null = null;
    try {
      await runParallelGenerationTasks(
        3,
        (i) => Promise.resolve(`task-${i}`),
        () => Promise.reject(new Error('上游 500'))
      );
    } catch (e) {
      thrown = e instanceof Error ? e : new Error(String(e));
    }
    ok('全失败时抛错', thrown !== null);
    ok('错误信息含"批量生成失败"', !!thrown?.message.includes('批量生成失败'), thrown?.message.slice(0, 60));
    ok('错误信息含失败详情', !!thrown?.message.includes('上游 500'), '应聚合各任务错误原因');
    console.log('');
  }

  // ---------- 断言 4：部分失败时调用方可获取失败详情（已修复，应通过） ----------
  {
    console.log('[用例4] 部分失败时调用方能否感知失败详情');
    const { urls, errors } = await runParallelGenerationTasks(
      3,
      (i) => Promise.resolve(`task-${i}`),
      (taskId, i) => (i === 1 ? Promise.reject(new Error('第2张生成失败')) : Promise.resolve(`url-${i}`))
    );
    ok('返回 { urls, errors } 结构', Array.isArray(urls) && Array.isArray(errors));
    ok('urls 含 2 个成功结果', urls.length === 2, `实际 ${urls.length}`);
    ok('errors 含 1 个失败详情', errors.length === 1, `实际 ${errors.length}`);
    ok('errors 含失败原因', errors.some((e) => e.includes('第2张生成失败')), errors.join(' | '));
    console.log('');
  }

  console.log(`=== 结果: ${pass} 通过, ${fail} 失败 ===`);
  console.log(fail > 0 ? '⚠️ 存在失败断言' : '✅ 全部通过');
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
