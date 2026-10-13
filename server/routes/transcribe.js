// Speech-to-text for browsers without a working built-in recognizer (Brave, Firefox, Opera, ...).
// The browser records a short clip and posts it here; we forward it to Groq's hosted Whisper
// (free tier, no credit card) and return the text. Audio is never stored.
import { Router } from 'express';
import express from 'express';
import { q } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError, bad } from '../util.js';
import { listProjects } from './projects.js';

const r = Router();
r.use(requireAuth);

const GROQ_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';
export const transcribeConfigured = () => !!process.env.GROQ_API_KEY;

const EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };

// Whisper sometimes "hears" these stock phrases in silence or noise.
const HALLUCINATION = /^(?:terima kasih(?: (?:telah|sudah) menonton)?|thank you(?: for watching)?|thanks for watching|subtitles? by.*|sampai jumpa.*|you)[.!\s]*$/i;

// Simple per-user rate limit, well inside Groq's free tier.
const recent = new Map(); // userId -> timestamps
function rateLimit(userId) {
  const now = Date.now();
  const list = (recent.get(userId) || []).filter((t) => now - t < 60_000);
  if (list.length >= 12) throw new HttpError(429, 'Too many dictations in a minute. Please wait a moment.');
  list.push(now);
  recent.set(userId, list);
}

/**
 * Words the user is likely to say (their recent activities, project and task names), so Whisper spells
 * them right, e.g. "Daily Exam" instead of "action best". Whisper reads ~224 tokens of prompt.
 */
async function vocabulary(user) {
  const since = Date.now() - 90 * 86_400_000;
  const [descriptions, used, all] = await Promise.all([
    q.all(
      `SELECT description FROM time_entries WHERE user_id = ? AND start_at > ? AND description <> ''
       GROUP BY description COLLATE NOCASE ORDER BY MAX(start_at) DESC LIMIT 15`,
      user.id, since,
    ),
    q.all(
      `SELECT p.id FROM time_entries e JOIN projects p ON p.id = e.project_id
       WHERE e.user_id = ? AND e.start_at > ? GROUP BY p.id ORDER BY MAX(e.start_at) DESC LIMIT 25`,
      user.id, since,
    ),
    listProjects(user),
  ]);
  const byId = new Map(all.filter((p) => !p.archived).map((p) => [p.id, p]));
  const projects = [...used.map((u) => byId.get(u.id)).filter(Boolean), ...byId.values()];
  const terms = [];
  const add = (t) => {
    const s = String(t ?? '').trim();
    if (s && !terms.some((x) => x.toLowerCase() === s.toLowerCase())) terms.push(s);
  };
  descriptions.forEach((d) => add(d.description));
  for (const p of projects) {
    add(p.name);
    p.tasks?.filter((t) => !t.done).forEach((t) => add(t.name));
  }
  let prompt = '';
  for (const t of terms) {
    if (prompt.length + t.length > 700) break;
    prompt += (prompt ? ', ' : '') + t;
  }
  return prompt;
}

r.get('/status', (req, res) => res.json({ configured: transcribeConfigured() }));

r.post('/', express.raw({ type: () => true, limit: '6mb' }), async (req, res) => {
  if (!transcribeConfigured()) throw new HttpError(503, 'Backup speech recognition is not set up on this server (GROQ_API_KEY).');
  const audio = req.body;
  if (!Buffer.isBuffer(audio) || audio.length < 1500) throw bad('No audio was recorded');
  rateLimit(req.user.id);

  const type = String(req.get('Content-Type') || 'audio/webm').split(';')[0].trim().toLowerCase();
  const lang = req.query.lang === 'en' ? 'en' : 'id';
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), `speech.${EXT[type] || 'webm'}`);
  form.append('model', MODEL);
  form.append('language', lang);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const prompt = await vocabulary(req.user).catch(() => '');
  if (prompt) form.append('prompt', prompt);

  let resp;
  try {
    resp = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.warn('Groq transcription failed:', err.message);
    throw new HttpError(502, 'The speech service did not respond. Please try again.');
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.warn('Groq transcription error', resp.status, detail.slice(0, 300));
    if (resp.status === 429) throw new HttpError(429, 'The speech service is busy (free limit reached). Please try again in a minute.');
    throw new HttpError(502, 'The speech service could not process the audio. Please try again.');
  }
  const data = await resp.json();
  let text = String(data.text ?? '').trim();
  if (HALLUCINATION.test(text)) text = '';
  res.json({ text });
});

export default r;
