import express from 'express';
import { oauthRouter } from './routes/oauth.js';
import { connectionsRouter } from './routes/connections.js';
import { getDb } from './db/database.js';

const app = express();
const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

app.use(express.json());
app.use('/api/oauth', oauthRouter);
app.use('/api/connections', connectionsRouter);

getDb();

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});

export { app };
