import express from 'express';
import { oauthRouter } from './routes/oauth.js';
import { connectionsRouter } from './routes/connections.js';
import { restoresRouter } from './routes/restores.js';
import { inventoryRouter } from './routes/inventory.js';
import { policiesRouter } from './routes/policies.js';
import { discoverRouter } from './routes/discover.js';
import { getDb } from './db/database.js';

const app = express();
const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

app.use(express.json());
app.use('/api/oauth', oauthRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/restores', restoresRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/policies', policiesRouter);
app.use('/api/discover', discoverRouter);

getDb();

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});

export { app };
