// Turns a spoken sentence into { description, project, task } with a confidence score.
// Runs entirely in the extension: fuzzy token matching against project, client and task
// names plus the user's own recent activities. No external AI service is used.

// Filler and connector words (Indonesian + English) that never identify a project.
const STOP = new Set([
  'saya', 'aku', 'gue', 'gw', 'kami', 'kita', 'lagi', 'sedang', 'lg', 'mau', 'akan', 'ingin', 'pengen', 'mulai', 'start',
  'ngerjain', 'mengerjakan', 'kerjain', 'kerja', 'bekerja', 'garap', 'nggarap', 'menggarap', 'handle', 'handling',
  'untuk', 'buat', 'utk', 'di', 'ke', 'dari', 'dan', 'yang', 'yg', 'dengan', 'sama', 'pada', 'dalam', 'atau', 'itu', 'ini', 'nya',
  'project', 'proyek', 'projek', 'projectnya', 'proyeknya', 'klien', 'client', 'task', 'tugas', 'timer', 'tolong', 'dong', 'ya', 'nih', 'sih',
  'the', 'a', 'an', 'for', 'on', 'of', 'to', 'in', 'and', 'with', 'working', 'work', 'doing', 'im', 'i', 'am', 'my', 'please',
]);

// Words that introduce the project name in a sentence ("... untuk project X", "... for client Y").
// "project" wins over "client", so "meeting klien untuk project X" keeps "meeting klien" as the activity.
const PROJECT_MARKERS = [
  /\b(?:untuk\s+|buat\s+|di\s+|for\s+|on\s+)?(?:project|proyek|projek)\b\s*/i,
  /\b(?:untuk\s+|buat\s+|for\s+)?(?:klien|client)\b\s*/i,
];
const LEADING_FILLER = /^(?:(?:saya|aku|gue|gw|kami|i'?m|i am|lagi|sedang|lg|mau|akan|mulai|start|ngerjain|mengerjakan|kerjain|working on|doing)\s+)+/i;
const TRAILING_CONNECTOR = /\s+(?:untuk|buat|utk|di|ke|for|on|dengan|sama|dari|yang)$/i;

export const normalize = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const tokens = (s) => normalize(s).split(' ').filter((t) => t && !STOP.has(t));

// Legal-form and filler words in company names: people say "Arutmin", not "PT Arutmin Indonesia".
const CLIENT_GENERIC = new Set(['pt', 'tbk', 'persero', 'perseroan', 'cv', 'ltd', 'inc', 'corp', 'co', 'company', 'group', 'grup', 'indonesia', 'id', 'holding', 'holdings', 'tb']);
const clientTokens = (s) => {
  const all = tokens(s);
  const core = all.filter((t) => !CLIENT_GENERIC.has(t));
  return core.length ? core : all;
};

export function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Similarity of two tokens in [0, 1]. Numbers must match exactly; words tolerate small speech-to-text errors. */
export function tokenSim(a, b) {
  if (a === b) return 1;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return 0;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.85;
  const ratio = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return ratio >= 0.72 ? ratio : 0;
}

/** How much of `target` is covered by `query` (recall) and how much of `query` is explained (precision). */
function overlap(queryTokens, targetTokens) {
  if (!targetTokens.length || !queryTokens.length) return { recall: 0, precision: 0, used: new Set() };
  const used = new Set();
  let recallSum = 0;
  let weightSum = 0;
  for (const t of targetTokens) {
    // Single digits (versions like "3.0", "1") matter less than words or batch numbers.
    const w = /^\d$/.test(t) ? 0.5 : 1;
    weightSum += w;
    let best = 0;
    let bestIdx = -1;
    queryTokens.forEach((q, i) => {
      const s = tokenSim(q, t);
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    });
    recallSum += best * w;
    if (bestIdx >= 0 && best > 0) used.add(bestIdx);
  }
  return { recall: recallSum / weightSum, precision: used.size / queryTokens.length, used };
}

const f1 = (p, r) => (p + r ? (2 * p * r) / (p + r) : 0);

/** Splits "review modul untuk project BSI AI literacy" into the activity and the spoken project phrase. */
export function splitTranscript(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  const m = PROJECT_MARKERS.map((re) => re.exec(clean)).find(Boolean);
  if (!m) return { activity: clean, projectPhrase: null };
  const activity = clean.slice(0, m.index).trim();
  const projectPhrase = clean.slice(m.index + m[0].length).trim();
  return { activity, projectPhrase: projectPhrase || null };
}

function tidyDescription(text) {
  let s = String(text ?? '').replace(/\s+/g, ' ').trim().replace(LEADING_FILLER, '');
  for (let i = 0; i < 3; i++) s = s.replace(TRAILING_CONNECTOR, '');
  s = s.replace(/[.,;:!?]+$/, '').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/** Removes the words that named the project from a free-form sentence, keeping the activity. */
function stripProjectWords(text, projectTokens) {
  const words = String(text).split(/\s+/);
  const kept = words.filter((w) => {
    const n = normalize(w);
    if (!n) return false;
    return !projectTokens.some((t) => tokenSim(n, t) >= 0.72);
  });
  return kept.join(' ');
}

/**
 * Interprets a spoken sentence.
 * @param {string} transcript
 * @param {{ projects: object[], recent?: object[] }} ctx  projects from /api/projects, recent entries from /api/entries
 * @returns {{ description, projectPhrase, candidates: {project, task, score, reason}[], confident: boolean }}
 */
export function interpret(transcript, { projects, recent = [] }) {
  const { activity, projectPhrase } = splitTranscript(transcript);
  const live = projects.filter((p) => !p.archived);
  const queryText = projectPhrase ?? transcript;
  const q = tokens(queryText);
  const scores = new Map(); // projectId -> candidate
  const perClient = new Map(); // live projects per client: a client with one project identifies it
  for (const p of live) if (p.clientName) perClient.set(p.clientName, (perClient.get(p.clientName) || 0) + 1);

  const offer = (project, task, score, reason) => {
    const prev = scores.get(project.id);
    if (!prev || score > prev.score) scores.set(project.id, { project, task, score, reason });
  };

  for (const p of live) {
    const nameTokens = tokens(p.name);
    const cTokens = clientTokens(p.clientName);
    if (!nameTokens.length) continue;
    const byName = overlap(q, nameTokens);
    const withClient = cTokens.length ? overlap(q, [...nameTokens, ...cTokens]) : byName;
    // The client was named ("... Arutmin ..."): a strong pointer, decisive when it has a single project.
    const clientSaid = cTokens.length > 0 && overlap(q, cTokens).recall >= 0.85;
    const onlyProject = clientSaid && perClient.get(p.clientName) === 1;
    let score;
    if (projectPhrase) {
      // The user named the project explicitly: both sides should match.
      score = Math.max(f1(byName.precision, byName.recall), f1(withClient.precision, withClient.recall));
    } else {
      // Free sentence: the project's name should be (mostly) contained in what was said.
      score = byName.recall * (0.85 + 0.15 * Math.min(1, nameTokens.length / 3));
    }
    if (clientSaid) {
      // Close part of the gap to 1, so differences between the client's projects (batch numbers) survive.
      if (byName.recall >= 0.3) score += 0.4 * (1 - score);
      else score = Math.max(score, onlyProject ? 0.8 : 0.5);
    }
    // Pick a task when its name was said as well.
    let task = null;
    const taskQuery = tokens(activity || transcript);
    for (const t of p.tasks || []) {
      if (t.done) continue;
      const tt = tokens(t.name);
      const o = overlap(taskQuery, tt);
      if (tt.length && o.recall >= 0.75 && (!task || o.recall > task.recall)) task = { ...t, recall: o.recall };
    }
    // Naming one of the project's tasks is strong evidence for the project too.
    if (task && score > 0.3) score = Math.min(1, score + 0.25 * task.recall);
    if (score > 0.25) offer(p, task, score, 'name');
  }

  // The user's own history: a similar past activity strongly suggests the same project.
  const descTokens = tokens(activity || transcript);
  for (const e of recent) {
    if (!e.projectId || !e.description) continue;
    const p = live.find((x) => x.id === e.projectId);
    if (!p) continue;
    const o = overlap(descTokens, tokens(e.description));
    const sim = f1(o.precision, o.recall);
    if (sim >= 0.6) {
      const task = e.taskId ? (p.tasks || []).find((t) => t.id === e.taskId) ?? null : null;
      offer(p, task, Math.min(0.95, sim * 0.9 + (scores.get(p.id)?.score ?? 0) * 0.3), 'history');
    }
  }

  const candidates = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, 4);
  const [best, second] = candidates;
  const margin = best ? best.score - (second?.score ?? 0) : 0;
  const confident = !!best && best.score >= 0.75 && (margin >= 0.15 || (best.score >= 0.95 && margin >= 0.05));

  let description;
  if (projectPhrase != null) description = tidyDescription(activity);
  else if (best) description = tidyDescription(stripProjectWords(transcript, [...tokens(best.project.name), ...clientTokens(best.project.clientName)]));
  else description = tidyDescription(transcript);
  if (!description) description = tidyDescription(activity || transcript);

  return {
    description,
    projectPhrase: projectPhrase ? projectPhrase.replace(/[.,;:!?]+$/, '').trim() : null,
    candidates,
    confident,
  };
}

/** "bsi ai literacy" -> "Bsi Ai Literacy" (used when registering a spoken project name). */
export const titleCase = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').replace(/\b\p{L}/gu, (c) => c.toUpperCase());
