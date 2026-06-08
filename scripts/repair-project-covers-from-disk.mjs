/**
 * 迁移后若 cover_image 为空，但 data/uploads/{projectId}/project-cover.* 仍在磁盘，
 * 将库内 cover_image 写回 /flowgen-api/projects/:id/cover/file
 *
 * Usage: cd D:\apps\flowgen-ai-studio && node scripts/repair-project-covers-from-disk.mjs
 */
import './load-env-local.mjs';
import { resolveProjectCoverFile } from '../server/flowgen/projectCover.mjs';
import * as projectsRepo from '../server/flowgen/repos/projectsRepo.mjs';
import { loadMetadataCache } from '../server/flowgen/relationalStore.mjs';

async function main() {
  if (!process.env.MYSQL_PASSWORD) {
    console.error('[repair-covers] 请配置 .env.local 中的 MYSQL_PASSWORD');
    process.exit(1);
  }
  const projects = await projectsRepo.listAllProjects();
  let fixed = 0;
  let skipped = 0;
  for (const p of projects) {
    const fp = resolveProjectCoverFile(p.id);
    if (!fp) {
      skipped += 1;
      continue;
    }
    const url = `/flowgen-api/projects/${p.id}/cover/file`;
    if (p.coverImage === url) {
      skipped += 1;
      continue;
    }
    await projectsRepo.updateProjectCoverImage(p.id, url);
    console.log('[repair-covers] ok', p.name, p.id);
    fixed += 1;
  }
  await loadMetadataCache();
  console.log('[repair-covers] done', { fixed, skipped, total: projects.length });
}

main().catch((e) => {
  console.error('[repair-covers] failed', e);
  process.exit(1);
});
