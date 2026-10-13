import { SERVER } from './config.js';
import { api, AuthError, getToken, setToken, formatDuration, updateBadge } from './api.js';

const $ = (id) => document.getElementById(id);
const PLAY_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
const STOP_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="16" height="16" x="4" y="4" rx="2"/></svg>';
const SMALL_PLAY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
const fmtHours = (ms) => {
  const m = Math.round(ms / 60000);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
const emptyDraft = () => ({ description: '', projectId: null, taskId: null, tagIds: [], billable: false });

const state = {
  projects: [],
  tags: [],
  running: null,
  draft: emptyDraft(),
  recent: [],
  todayDone: 0,
  tagsOpen: false,
};
let ticker = null;

const current = () => state.running ?? state.draft;

function show(view) {
  $('loading').classList.add('hidden');
  $('login-view').classList.toggle('hidden', view !== 'login');
  $('main-view').classList.toggle('hidden', view !== 'main');
  $('logout').classList.toggle('hidden', view !== 'main');
}

function showError(message) {
  $('error').textContent = message || '';
  $('error').classList.toggle('hidden', !message);
}

async function guard(fn) {
  try {
    showError('');
    return await fn();
  } catch (err) {
    if (err instanceof AuthError) {
      show('login');
      showError(err.message);
    } else {
      showError(err.message);
    }
    return undefined;
  }
}

// ---------------------------------------------------------------- Sign in

$('server-label').textContent = `Connecting to ${SERVER.replace(/^https?:\/\//, '')}`;

$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  guard(async () => {
    const { token } = await api('POST', '/auth/token', { email: $('email').value, password: $('password').value }, '');
    await setToken(token);
    $('password').value = '';
    await loadMain();
  });
});

$('code-form').addEventListener('submit', (e) => {
  e.preventDefault();
  guard(async () => {
    const code = $('code').value.trim();
    await api('GET', '/auth/me', undefined, code);
    await setToken(code);
    $('code').value = '';
    await loadMain();
  });
});

$('logout').addEventListener('click', () =>
  guard(async () => {
    await api('POST', '/auth/logout', {}).catch(() => {});
    await setToken(null);
    await updateBadge(null);
    show('login');
  }),
);

$('open-app').addEventListener('click', () => chrome.tabs.create({ url: `${SERVER}/tracker` }));

// ---------------------------------------------------------------- Tracker

function renderProjects() {
  const sel = $('project');
  sel.textContent = '';
  sel.append(new Option('No project', ''));
  const byClient = new Map();
  for (const p of state.projects) {
    if (p.archived) continue;
    const key = p.clientName || '';
    if (!byClient.has(key)) byClient.set(key, []);
    byClient.get(key).push(p);
  }
  const groups = [...byClient.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  for (const [client, projects] of groups) {
    const group = document.createElement('optgroup');
    group.label = client || 'No client';
    for (const p of projects) {
      group.append(new Option(p.name, `p:${p.id}`));
      for (const t of p.tasks.filter((x) => !x.done)) group.append(new Option(`   ${p.name}: ${t.name}`, `t:${p.id}:${t.id}`));
    }
    sel.append(group);
  }
}

function renderTags() {
  const panel = $('tags-panel');
  panel.textContent = '';
  const selected = new Set(current().tagIds);
  const visible = state.tags.filter((t) => !t.archived || selected.has(t.id));
  if (!visible.length) panel.append(Object.assign(document.createElement('div'), { className: 'muted small', textContent: 'No tags yet' }));
  for (const t of visible) {
    const label = document.createElement('label');
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: selected.has(t.id) });
    box.addEventListener('change', () => {
      const ids = new Set(current().tagIds);
      if (box.checked) ids.add(t.id);
      else ids.delete(t.id);
      setFields({ tagIds: [...ids] });
    });
    label.append(box, document.createTextNode(t.name));
    panel.append(label);
  }
  panel.classList.toggle('hidden', !state.tagsOpen);
}

function renderTimer() {
  const c = current();
  const desc = $('description');
  if (document.activeElement !== desc) desc.value = c.description || '';
  const sel = $('project');
  sel.value = c.taskId ? `t:${c.projectId}:${c.taskId}` : c.projectId ? `p:${c.projectId}` : '';
  if (sel.value === '' && c.projectId) sel.value = `p:${c.projectId}`;
  sel.classList.toggle('has-value', !!c.projectId);
  $('billable').classList.toggle('on', !!c.billable);
  $('tags-btn').classList.toggle('on', c.tagIds.length > 0);
  const names = c.tagIds.map((tagId) => state.tags.find((t) => t.id === tagId)?.name).filter(Boolean);
  $('tag-names').textContent = names.join(', ');
  const btn = $('toggle');
  btn.innerHTML = state.running ? STOP_ICON : PLAY_ICON;
  btn.className = `play-btn ${state.running ? 'stop' : ''}`;
  btn.setAttribute('aria-label', state.running ? 'Stop timer' : 'Start timer');
  btn.title = state.running ? 'Stop timer' : 'Start timer';
  renderTags();
  tick();
}

function tick() {
  const elapsed = state.running ? Date.now() - state.running.start : 0;
  $('clock').textContent = formatDuration(elapsed);
  $('today-total').textContent = fmtHours(state.todayDone + elapsed);
}

function renderRecent() {
  const list = $('recent');
  list.textContent = '';
  if (!state.recent.length) {
    list.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'No time entries yet' }));
    return;
  }
  for (const e of state.recent) {
    const p = e.projectId ? state.projects.find((x) => x.id === e.projectId) : null;
    const li = document.createElement('li');
    const info = Object.assign(document.createElement('div'), { className: 'info' });
    info.append(Object.assign(document.createElement('div'), { className: 'd', textContent: e.description || '(no description)' }));
    const proj = Object.assign(document.createElement('div'), { className: 'p' });
    if (p || e.projectName) {
      const color = p?.color ?? e.projectColor ?? '#999';

      const dot = Object.assign(document.createElement('span'), { className: 'dot' });
      dot.style.background = color;
      proj.append(dot, document.createTextNode(`${p?.name ?? e.projectName}${e.taskName ? `: ${e.taskName}` : ''}`));
    } else {
      proj.classList.add('muted');
      proj.textContent = 'No project';
    }
    info.append(proj);
    const dur = Object.assign(document.createElement('span'), { className: 'dur', textContent: formatDuration(e.end - e.start) });
    const play = Object.assign(document.createElement('button'), { className: 'play', title: 'Continue', innerHTML: SMALL_PLAY });
    play.addEventListener('click', () => start({ description: e.description, projectId: e.projectId, taskId: e.taskId, tagIds: e.tagIds, billable: e.billable }));
    li.append(info, dur, play);
    list.append(li);
  }
}

async function setFields(patch) {
  if (!state.running) {
    Object.assign(state.draft, patch);
    renderTimer();
    return;
  }
  Object.assign(state.running, patch);
  renderTimer();
  await guard(async () => {
    const { entry } = await api('PUT', `/entries/${state.running.id}`, patch);
    state.running = entry;
    renderTimer();
    await updateBadge(entry);
  });
}

async function start(fields) {
  await guard(async () => {
    const d = await api('POST', '/entries/start', fields);
    state.running = d.entry;
    state.draft = emptyDraft();
    state.tagsOpen = false;
    await updateBadge(d.entry);
    chrome.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
    await loadRecent();
    renderTimer();
  });
}

async function stop() {
  await guard(async () => {
    await api('POST', '/entries/stop', {});
    state.running = null;
    await updateBadge(null);
    chrome.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
    await loadRecent();
    renderTimer();
  });
}

$('toggle').addEventListener('click', () => {
  if (state.running) stop();
  else start({ ...state.draft, description: $('description').value });
});

$('description').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (state.running) e.target.blur();
  else start({ ...state.draft, description: e.target.value });
});
$('description').addEventListener('blur', (e) => {
  if (e.target.value !== (current().description || '')) setFields({ description: e.target.value });
});

$('project').addEventListener('change', (e) => {
  const [kind, pid, tid] = e.target.value.split(':');
  const projectId = kind ? Number(pid) : null;
  const project = state.projects.find((p) => p.id === projectId);
  const patch = { projectId, taskId: kind === 't' ? Number(tid) : null };
  if (project && projectId !== current().projectId) patch.billable = project.billable;
  setFields(patch);
});

$('billable').addEventListener('click', () => setFields({ billable: !current().billable }));
$('tags-btn').addEventListener('click', () => {
  state.tagsOpen = !state.tagsOpen;
  renderTags();
});

async function loadRecent() {
  const { entries } = await api('GET', '/entries?limit=60');
  const todayStart = new Date().setHours(0, 0, 0, 0);
  state.todayDone = entries.filter((e) => e.start >= todayStart).reduce((s, e) => s + (e.end - e.start), 0);
  const seen = new Set();
  state.recent = entries.filter((e) => {
    const key = `${e.description}|${e.projectId}|${e.taskId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
  renderRecent();
}

async function loadMain() {
  const [{ projects }, { tags }, { entry }] = await Promise.all([
    api('GET', '/projects'),
    api('GET', '/tags'),
    api('GET', '/entries/running'),
  ]);
  state.projects = projects;
  state.tags = tags;
  state.running = entry;
  renderProjects();
  await loadRecent();
  renderTimer();
  await updateBadge(entry);
  show('main');
  if (!ticker) ticker = setInterval(tick, 1000);
  if (!entry) $('description').focus();
}

(async () => {
  if (!(await getToken())) {
    show('login');
    return;
  }
  const ok = await guard(async () => {
    await loadMain();
    return true;
  });
  if (!ok && !(await getToken())) show('login');
  else if (!ok) show('main');
})();
