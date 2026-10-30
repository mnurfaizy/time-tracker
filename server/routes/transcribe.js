// Speech-to-text for dictation. The browser records a short clip and posts it here; we forward it to
// Groq's hosted Whisper (free tier, no credit card), primed with the user's own vocabulary, and return
// the text. Audio is never stored.
import { Router } from 'express';
import express from 'express';
import { q } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError, bad } from '../util.js';
import { listProjects } from './projects.js';
import { normalize, levenshtein } from '../../extension/matcher.js';

const r = Router();
r.use(requireAuth);

const GROQ_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/audio/transcriptions';
// Full large-v3: noticeably more accurate for Indonesian than the faster "turbo" variant.
const MODEL = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3';
// Text model that tidies the raw transcript (misheard words like "menecek" -> "mengecek").
const TEXT_MODEL = process.env.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b';
const CHAT_URL = process.env.GROQ_CHAT_URL || 'https://api.groq.com/openai/v1/chat/completions';
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
      `SELECT description FROM time_entries WHERE workspace_id = ? AND user_id = ? AND start_at > ? AND description <> ''
       GROUP BY description COLLATE NOCASE ORDER BY MAX(start_at) DESC LIMIT 15`,
      user.wsId, user.id, since,
    ),
    q.all(
      `SELECT p.id FROM time_entries e JOIN projects p ON p.id = e.project_id
       WHERE e.workspace_id = ? AND e.user_id = ? AND e.start_at > ? GROUP BY p.id ORDER BY MAX(e.start_at) DESC LIMIT 25`,
      user.wsId, user.id, since,
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
    if (p.clientName) add(p.clientName);
    p.tasks?.filter((t) => !t.done).forEach((t) => add(t.name));
  }
  return terms;
}

// Whisper treats the prompt as the text that came before, and copies its style. A mixed
// Indonesian/English work note keeps English terms and acronyms as they are instead of
// respelling them the Indonesian way.
const PROMPT_INTRO = {
  id: 'Catatan kerja harian, campuran Bahasa Indonesia dan English, dengan singkatan seperti SDP, PIC, QA, PPT. ',
  en: 'Daily work log with project names and acronyms such as SDP, PIC, QA, PPT. ',
};

function buildPrompt(terms, lang) {
  let prompt = PROMPT_INTRO[lang] + 'Project & aktivitas: ';
  let first = true;
  for (const t of terms) {
    if (prompt.length + t.length > 750) break;
    prompt += (first ? '' : ', ') + t;
    first = false;
  }
  return prompt + '.';
}

const ACRONYM = /^[A-Z][A-Z0-9]{1,5}$/;

/**
 * Speech recognition often gets single letters of an acronym wrong (SDP -> SGP). When a spoken acronym
 * differs by one letter from exactly one acronym the user actually uses, take the user's one.
 */
export function snapAcronyms(text, terms) {
  const known = new Set();
  for (const t of terms) for (const w of String(t).split(/[^A-Za-z0-9]+/)) if (ACRONYM.test(w)) known.add(w);
  if (!known.size) return text;
  return text.replace(/\b[A-Za-z][A-Za-z0-9]*\b/g, (word) => {
    if (!ACRONYM.test(word) || known.has(word)) return word;
    const close = [...known].filter((k) => k.length === word.length && [...k].filter((c, i) => c !== word[i]).length === 1);
    return close.length === 1 ? close[0] : word;
  });
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
  const terms = await vocabulary(req.user).catch(() => []);
  form.append('prompt', buildPrompt(terms, lang));

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
  if (HALLUCINATION.test(text) || text === buildPrompt([], lang).trim()) text = '';
  if (text) text = await tidyTranscript(text, terms, lang);
  text = snapAcronyms(text, terms);
  res.json({ text });
});

export default r;

const TIDY_INSTRUCTIONS = `You fix speech-to-text output of a short spoken work note for a time tracker.
The speaker mixes casual Indonesian with English work terms.
- Fix words that were misheard into the real, natural word the speaker most likely said
  (e.g. "menecek" -> "mengecek", "meriview" -> "me-review", "action best" -> "Daily Exam" when that is in the vocabulary).
- Use everyday Indonesian spelling; keep English terms in English. Do not formalize casual wording.
- Names of projects, clients, tasks and acronyms must be spelled exactly as in the vocabulary when the speaker clearly meant them.
- Never add, remove, reorder or translate content. Never answer or comment.
Reply with the corrected sentence only.`;

/** Second pass with a text model; falls back to the raw transcript on any problem. */
async function tidyTranscript(text, terms, lang) {
  try {
    const resp = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TEXT_MODEL,
        temperature: 0,
        reasoning_effort: 'low',
        max_completion_tokens: 600,
        messages: [
          { role: 'system', content: TIDY_INSTRUCTIONS },
          {
            role: 'user',
            content: [
              `Language: ${lang === 'en' ? 'English' : 'Indonesian (with English terms)'}`,
              `Vocabulary: ${relevantTerms(text, terms).join('; ') || '(none)'}`,
              '',
              `Transcript: ${text}`,
            ].join('\n'),
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      console.warn('Transcript tidy-up failed', resp.status, (await resp.text().catch(() => '')).slice(0, 200));
      return text;
    }
    const data = await resp.json();
    const out = String(data.choices?.[0]?.message?.content ?? '').trim().replace(/^["'“]|["'”]$/g, '').trim();
    // Guard against the model rewriting or answering instead of correcting.
    if (!out || out.includes('\n') || out.length > text.length * 1.5 + 20 || out.length < text.length * 0.5) return text;
    return out;
  } catch (err) {
    console.warn('Transcript tidy-up failed:', err.message);
    return text;
  }
}

/**
 * The vocabulary entries that look like something in the transcript (fuzzy, also across a word the
 * recognizer split in two: "arut min" ~ "Arutmin"). Keeps the tidy-up request small and focused.
 */
function relevantTerms(text, terms, limit = 40) {
  const words = normalize(text).split(' ').filter(Boolean);
  const probes = [...words, ...words.slice(1).map((w, i) => words[i] + w)];
  const similar = (a, b) => {
    if (a === b) return true;
    if (a.length < 3 || b.length < 3) return false;
    if (a.startsWith(b) || b.startsWith(a)) return Math.min(a.length, b.length) >= 4;
    return 1 - levenshtein(a, b) / Math.max(a.length, b.length) >= 0.6;
  };
  const scored = [];
  for (const term of terms) {
    const termWords = normalize(term).split(' ').filter((w) => w.length >= 2);
    const hits = termWords.filter((tw) => probes.some((p) => similar(p, tw))).length;
    if (hits) scored.push({ term, hits });
  }
  return scored.sort((a, b) => b.hits - a.hits).slice(0, limit).map((s) => s.term);
}
