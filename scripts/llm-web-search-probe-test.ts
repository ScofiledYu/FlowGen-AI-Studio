/**
 * 联网检索词改写测试（LLM rewrite + fallback）
 * npx tsx scripts/llm-web-search-probe-test.ts
 */
import {
  buildWebSearchProbeQueryFallback,
  isPlausibleSearchQuery,
  resolveWebSearchProbeQuery,
} from '../utils/webSearchProbe.ts';

const BASE_URL = process.env.LLM_TEST_BASE_URL || 'http://localhost:3001/aitop-llm-see';
const API_KEY = process.env.LLM_TEST_API_KEY || 'aitop-key-4MGEBAFEArM3HRaJ0P77EkhEAtxseJma';
const USER_ID = process.env.LLM_TEST_USER_ID || '297409';

function mkId(tag: string) {
  return `${USER_ID}_probe_${tag}_${Date.now()}`.slice(0, 63);
}

function assert(name: string, ok: boolean, detail = '') {
  console.log(`  [${ok ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return ok ? 1 : 0;
}

function runFallbackUnitTests() {
  let pass = 0;
  pass += assert(
    '天气：用本轮',
    buildWebSearchProbeQueryFallback('现在深圳的天气怎么样').includes('深圳'),
    buildWebSearchProbeQueryFallback('现在深圳的天气怎么样')
  );
  pass += assert(
    '纠错：拼接上轮用户话',
    buildWebSearchProbeQueryFallback('时间检索不对你再查', [
      { role: 'user', content: '现在查下北京时间是' },
    ]).length > 8,
    buildWebSearchProbeQueryFallback('时间检索不对你再查', [
      { role: 'user', content: '现在查下北京时间是' },
    ])
  );
  pass += assert(
    '学校追问不应带天气词',
    !buildWebSearchProbeQueryFallback('那个学校的小学部', [
      { role: 'user', content: '现在深圳的天气怎么样' },
    ]).includes('天气'),
    buildWebSearchProbeQueryFallback('那个学校的小学部', [
      { role: 'user', content: '现在深圳的天气怎么样' },
    ])
  );
  pass += assert(
    '表格追问含学校实体',
    /深中梅香|深中龙华|普高/.test(
      buildWebSearchProbeQueryFallback('用表格再对比一下', [
        { role: 'user', content: '深中梅香和深中龙华升学率对比' },
        { role: 'assistant', content: '深中梅香实验学校 深中龙华附属学校 普高率 四大率…' },
      ])
    ),
    buildWebSearchProbeQueryFallback('用表格再对比一下', [
      { role: 'user', content: '深中梅香和深中龙华升学率对比' },
      { role: 'assistant', content: '深中梅香实验学校 深中龙华附属学校 普高率 四大率…' },
    ])
  );
  return { pass, fail: 4 - pass };
}

async function runApiRewriteTests() {
  let pass = 0;
  let fail = 0;

  const runCase = async (
    name: string,
    turns: { role: 'user' | 'assistant'; content: string }[],
    latest: string,
    check: (q: string) => boolean
  ) => {
    process.stdout.write(`  → ${name} … `);
    try {
      const q = await resolveWebSearchProbeQuery({
        url: BASE_URL,
        apiKey: API_KEY,
        model: 'gemini-3.1-pro-preview:streamGenerateContent',
        chatId: mkId('api'),
        turns,
        latestUserText: latest,
      });
      if (!isPlausibleSearchQuery(q)) throw new Error(`implausible: ${q}`);
      if (!check(q)) throw new Error(`check failed: ${q}`);
      console.log(`OK "${q.slice(0, 60)}"`);
      pass += 1;
    } catch (e) {
      console.log(`FAIL ${e instanceof Error ? e.message : e}`);
      fail += 1;
    }
  };

  await runCase('北京时间', [], '现在查下北京时间是', (q) => /北京|时间|几点/.test(q));
  await runCase('天气', [], '现在深圳的天气', (q) => /深圳|天气/.test(q));
  await runCase(
    '纠错追问',
    [{ role: 'user', content: '现在查下北京时间' }],
    '查错了再查一下',
    (q) => /北京|时间/.test(q) && !/查错|再查一下/.test(q)
  );
  await runCase(
    '换题不串',
    [
      { role: 'user', content: '现在深圳的天气' },
      { role: 'assistant', content: '深圳今日多云…' },
    ],
    '深中梅香实验学校小学部怎么样',
    (q) => /深中梅香|小学部/.test(q) && !/天气|深圳.*天气/.test(q)
  );

  return { pass, fail };
}

async function main() {
  console.log('=== 联网检索词测试 ===\n[1/2] Fallback 单元');
  const unit = runFallbackUnitTests();
  console.log(`\n[2/2] LLM 改写 API (${BASE_URL})`);
  let api = { pass: 0, fail: 0 };
  try {
    const ping = await fetch(BASE_URL.replace(/\/aitop-llm-see$/, '/'));
    if (!ping.ok) throw new Error('server down');
    api = await runApiRewriteTests();
  } catch (e) {
    console.log(`  [SKIP] ${e instanceof Error ? e.message : e}`);
    api = { pass: 0, fail: 4 };
  }
  const totalFail = unit.fail + api.fail;
  console.log(`\n=== SUMMARY PASS ${unit.pass + api.pass} FAIL ${totalFail} ===`);
  if (totalFail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
