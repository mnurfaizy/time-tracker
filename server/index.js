import './env.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { HttpError } from './util.js';
import { cleanupExpired } from './auth.js';
import { initDb, isRemote } from './db.js';
import authRoutes from './routes/auth.js';
import workspaceRoutes from './routes/workspace.js';
import userRoutes from './routes/users.js';
import clientRoutes from './routes/clients.js';
import projectRoutes from './routes/projects.js';
import tagRoutes from './routes/tags.js';
import entryRoutes from './routes/entries.js';
import reportRoutes from './routes/reports.js';
import googleRoutes from './routes/google.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isDev = process.argv.includes('--dev');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use('/api', express.json({ limit: '1mb' }));
app.use('/api', (req, res, next) => {
  req.body ??= {};
  next();
});

// CSRF guard: state-changing API calls must come from our own frontend (custom header).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('X-Requested-With') !== 'fetch') {
    throw new HttpError(403, 'Invalid request');
  }
  next();
});

// Lightweight endpoint for uptime pings (keeps free hosting awake without touching the database).
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/entries', entryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/google', googleRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

if (isDev) {
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: path.join(root, 'vite.config.js'), server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error('Frontend is not built yet. Run "npm run build" first (or "npm run dev" for development).');
    process.exit(1);
  }
  app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '1y', immutable: true }));
  app.use(express.static(dist, { index: false }));
  app.get('/{*splat}', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

await initDb();
const cleanup = () => cleanupExpired().catch((err) => console.warn('Session cleanup failed:', err.message));
cleanup();
setInterval(cleanup, 60 * 60 * 1000).unref();

app.listen(PORT, HOST, () => {
  console.log(`Time Tracker running at http://localhost:${PORT}${isDev ? ' (development)' : ''} — database: ${isRemote ? 'Turso (cloud)' : 'local file'}`);
});
