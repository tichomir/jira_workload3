import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { oauthRouter } from './routes/oauth.js';
import { connectionsRouter } from './routes/connections.js';
import { restoresRouter } from './routes/restores.js';
import { restoreJobsRouter } from './routes/restore-jobs.js';
import { inventoryRouter } from './routes/inventory.js';
import { policiesRouter } from './routes/policies.js';
import { discoverRouter } from './routes/discover.js';
import { jobsRouter } from './routes/jobs.js';
import { backupPointsRouter } from './routes/backup-points.js';
import { getDb } from './db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

const _clientId = config.atlassianClientId;
console.log(
  `[config] ATLASSIAN_CLIENT_ID: ${_clientId ? _clientId.slice(0, 4) + '**** (present)' : 'NOT SET'}`
);

if (!config.atlassianClientSecret) {
  console.error(
    'FATAL: ATLASSIAN_CLIENT_SECRET is not set. Set it in your .env file before starting the server.'
  );
  process.exit(1);
}

const app = express();
const PORT = config.port;

app.set('trust proxy', true);
app.use(express.json());
app.use('/api/oauth', oauthRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/restores', restoresRouter);
app.use('/api/restore-jobs', restoreJobsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/policies', policiesRouter);
app.use('/api/discover', discoverRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/backup-points', backupPointsRouter);

getDb();

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Serve the Vite-built SPA for all non-API routes (React Router client-side routing)
app.use(express.static(distDir));
app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});

export { app };
