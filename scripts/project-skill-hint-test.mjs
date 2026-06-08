/**
 * 项目 Skill outputFormatHint 可选注入
 * node scripts/project-skill-hint-test.mjs
 */
import {
  buildCanvasWelcomeChatContent,
  buildProjectSkillAitopTip,
  buildProjectSkillBlock,
  PROJECT_SKILL_COMPLIANCE_RULES,
  PROJECT_SKILL_OUTPUT_TABLE_HINT_EXAMPLE,
} from '../utils/projectSkill.ts';

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const base = { enabled: true, title: 't', content: '你是导演' };

ok('无 hint 不追加', !buildProjectSkillBlock(base).includes('Markdown 管道表格'));
ok(
  '有 hint 才追加',
  buildProjectSkillBlock({
    ...base,
    outputFormatHint: PROJECT_SKILL_OUTPUT_TABLE_HINT_EXAMPLE,
  }).includes('Markdown 管道表格')
);
ok(
  'hint 含单镜秒数列',
  PROJECT_SKILL_OUTPUT_TABLE_HINT_EXAMPLE.includes('| 单镜秒数 |')
);
ok(
  'hint 在正文之后',
  buildProjectSkillBlock({ ...base, outputFormatHint: '格式A' }).endsWith('格式A')
);
ok('含通用执行要求', buildProjectSkillBlock(base).includes(PROJECT_SKILL_COMPLIANCE_RULES.slice(0, 20)));
ok('含项目标题', buildProjectSkillBlock({ ...base, title: '龙与潇逍' }).includes('【项目】龙与潇逍'));
ok('AiTop tip 含 Skill', buildProjectSkillAitopTip(base).includes('项目 Skill'));
ok(
  '欢迎语引用 Skill 标题',
  buildCanvasWelcomeChatContent({ ...base, title: '机甲分镜' }).includes('机甲分镜')
);
ok('欢迎语不写死角色名', !buildCanvasWelcomeChatContent(base).includes('我是导演'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
