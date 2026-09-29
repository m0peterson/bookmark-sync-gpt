import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import pg from 'pg';
import { hashPassword, signToken, verifyPassword, verifyToken } from './auth.js';
import { cleanName, cleanWindows, validEmail, validPassword } from './validation.js';

const { Pool } = pg;
const port = Number(process.env.PORT || 8787);
const secret = process.env.JWT_SECRET;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !secret || secret.length < 32) {
  console.error('DATABASE_URL and a JWT_SECRET of at least 32 characters are required.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
await pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL,
    token_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL, revision integer NOT NULL DEFAULT 1, windows jsonb NOT NULL DEFAULT '[]',
    updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS sessions_user_updated ON sessions(user_id, updated_at DESC);
`);

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type'] }));
app.use(express.json({ limit: '2mb' }));

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/v1/auth/register', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password } = req.body;
  if (!validEmail(email) || !validPassword(password)) return res.status(400).json({ error: 'Use a valid email and a password of at least 10 characters.' });
  const id = crypto.randomUUID();
  try {
    await pool.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [id, email, hashPassword(password)]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
    throw error;
  }
  res.status(201).json({ token: signToken({ sub: id, ver: 1 }, secret), user: { id, email } });
}));

app.post('/v1/auth/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const result = await pool.query('SELECT id, email, password_hash, token_version FROM users WHERE email = $1', [email]);
  const user = result.rows[0];
  if (!user || !verifyPassword(req.body.password, user.password_hash)) return res.status(401).json({ error: 'Incorrect email or password.' });
  res.json({ token: signToken({ sub: user.id, ver: user.token_version }, secret), user: { id: user.id, email: user.email } });
}));

app.use('/v1', asyncRoute(async (req, res, next) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  const payload = verifyToken(token, secret);
  if (!payload) return res.status(401).json({ error: 'Sign in again.' });
  const result = await pool.query('SELECT id FROM users WHERE id = $1 AND token_version = $2', [payload.sub, payload.ver]);
  if (!result.rowCount) return res.status(401).json({ error: 'Sign in again.' });
  req.userId = payload.sub;
  next();
}));

const selectSession = `SELECT id, name, revision, windows, updated_at AS "updatedAt", created_at AS "createdAt" FROM sessions`;
app.get('/v1/sessions', asyncRoute(async (req, res) => {
  const result = await pool.query(`${selectSession} WHERE user_id = $1 ORDER BY updated_at DESC`, [req.userId]);
  res.json({ sessions: result.rows });
}));

app.post('/v1/sessions', asyncRoute(async (req, res) => {
  let windows;
  try { windows = cleanWindows(req.body.windows || []); } catch (error) { return res.status(400).json({ error: error.message }); }
  const id = crypto.randomUUID();
  // The explicit RETURNING list keeps the public wire format stable.
  const inserted = await pool.query(
    'INSERT INTO sessions (id, user_id, name, windows) VALUES ($1, $2, $3, $4) RETURNING id, name, revision, windows, updated_at AS "updatedAt", created_at AS "createdAt"',
    [id, req.userId, cleanName(req.body.name, 'New session'), JSON.stringify(windows)]
  );
  res.status(201).json({ session: inserted.rows[0] });
}));

app.put('/v1/sessions/:id', asyncRoute(async (req, res) => {
  let windows;
  try { windows = cleanWindows(req.body.windows); } catch (error) { return res.status(400).json({ error: error.message }); }
  const revision = Number(req.body.revision);
  if (!Number.isInteger(revision)) return res.status(400).json({ error: 'revision is required' });
  const result = await pool.query(
    'UPDATE sessions SET name=$1, windows=$2, revision=revision+1, updated_at=now() WHERE id=$3 AND user_id=$4 AND revision=$5 RETURNING id, name, revision, windows, updated_at AS "updatedAt", created_at AS "createdAt"',
    [cleanName(req.body.name), JSON.stringify(windows), req.params.id, req.userId, revision]
  );
  if (!result.rowCount) {
    const current = await pool.query(`${selectSession} WHERE id=$1 AND user_id=$2`, [req.params.id, req.userId]);
    if (!current.rowCount) return res.status(404).json({ error: 'Session not found.' });
    return res.status(409).json({ error: 'This session changed on another device.', session: current.rows[0] });
  }
  res.json({ session: result.rows[0] });
}));

app.delete('/v1/sessions/:id', asyncRoute(async (req, res) => {
  const result = await pool.query('DELETE FROM sessions WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
  res.status(result.rowCount ? 204 : 404).end();
}));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(port, () => console.log(`Orbit Tabs API listening on ${port}`));
