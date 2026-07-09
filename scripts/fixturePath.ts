/**
 * 回归脚本 fixture 路径：优先 scripts/fixtures/（CI），回退 d:/json/（本地调试）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

export function resolveFixtureFile(name: string, legacyAbsolute?: string): string {
  const inRepo = path.join(scriptsDir, 'fixtures', name);
  if (fs.existsSync(inRepo)) return inRepo;
  if (legacyAbsolute && fs.existsSync(legacyAbsolute)) return legacyAbsolute;
  throw new Error(
    `Fixture not found: ${name}${legacyAbsolute ? ` (legacy: ${legacyAbsolute})` : ''}`
  );
}
