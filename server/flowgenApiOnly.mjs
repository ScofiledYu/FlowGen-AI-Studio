/**
 * Standalone FlowGen multi-user API for local dev (Vite on :3000 proxies /flowgen-api here).
 * Production: same router is mounted from server.js on the main app port.
 */
import '../scripts/load-env-local.mjs';
import express from 'express';
import { createFlowgenRouter } from './flowgen/routes.mjs';
import { initStore, loadStore, bootstrapAdminIfNeeded } from './flowgen/store.mjs';

const PORT = Number(process.env.PORT || 3001);
const app = express();
app.use(express.json({ limit: '50mb' }));

await initStore();
const store = loadStore();
bootstrapAdminIfNeeded(store);

app.use('/flowgen-api', createFlowgenRouter());

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[flowgen-api] http://localhost:${PORT}/flowgen-api`);
});
