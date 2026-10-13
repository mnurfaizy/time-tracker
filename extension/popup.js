import { SERVER } from './config.js';
import { api, AuthError, getToken, setToken, formatDuration, updateBadge } from './api.js';
import { setupVoice } from './voice.js';

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
  recentAll: [],
  todayDone: 0,
  tagsOpen: false,
  canCreate: false,
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

// ---------------------------------------------------------------- Project picker

const picker = { open: false, items: [], active: 0 };
const norm = (s) => String(s ?? '').toLowerCase();
// Matches the start of any word, so 'bsi' finds 'BSI - ...' but not 'Website'.
const wordMatch = (text, term) => !term || norm(text).split(/[^a-z0-9]+/).some((w) => w.startsWith(term)) || norm(text).startsWith(term);

/** Builds the visible option list: recent projects first, then all projects grouped by client. */
function pickerItems(term) {
  const t = norm(term).trim();
  const live = state.projects.filter((p) => !p.archived);
  const items = [];
  const option = (p, task, extra = {}) => ({ type: 'option', projectId: p?.id ?? null, taskId: task?.id ?? null, project: p, task, ...extra });
  if (!t) {
    items.push(option(null, null));
    const seen = new Set();
    const recent = [];
    for (const e of state.recentAll) {
      const key = e.projectId + '|' + e.taskId;
      const p = live.find((x) => x.id === e.projectId);
      if (!p || seen.has(key)) continue;
      seen.add(key);
      recent.push(option(p, e.taskId ? p.tasks.find((x) => x.id === e.taskId) : null));
      if (recent.length === 5) break;
    }
    if (recent.length) items.push({ type: 'group', label: 'Recent' }, ...recent);
  }
  const byClient = new Map();
  for (const p of live) {
    const clientHit = wordMatch(p.clientName, t);
    const projectHit = wordMatch(p.name, t);
    const tasks = p.tasks.filter((x) => !x.done && (!t || clientHit || projectHit || wordMatch(x.name, t)));
    if (t && !clientHit && !projectHit && !tasks.length) continue;
    const key = p.clientName || '';
    if (!byClient.has(key)) byClient.set(key, []);
    byClient.get(key).push({ p, tasks: t ? tasks : [] });
  }
  const groups = [...byClient.entries()].sort(([x], [y]) => (x === '' ? -1 : y === '' ? 1 : x.localeCompare(y)));
  for (const [client, list] of groups) {
    items.push({ type: 'group', label: client || 'No client' });
    for (const { p, tasks } of list) {
      items.push(option(p, null, { taskCount: p.tasks.filter((x) => !x.done).length }));
      for (const task of tasks) items.push(option(p, task, { isTask: true }));
    }
  }
  return items;
}

function renderPicker() {
  const list = $('project-list');
  list.textContent = '';
  picker.items = pickerItems($('project-search').value);
  const options = picker.items.filter((i) => i.type === 'option');
  picker.active = Math.min(picker.active, Math.max(0, options.length - 1));
  if (!options.length) {
    list.append(Object.assign(document.createElement('div'), { className: 'picker-empty', textContent: 'No matching projects' }));
    return;
  }
  let index = 0;
  const c = current();
  for (const item of picker.items) {
    if (item.type === 'group') {
      list.append(Object.assign(document.createElement('div'), { className: 'picker-group', textContent: item.label }));
      continue;
    }
    const i = index++;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'picker-item' + (item.isTask ? ' task' : '') + (i === picker.active ? ' active' : '');
    row.setAttribute('role', 'option');
    const selected = item.projectId === (c.projectId ?? null) && (item.taskId ?? null) === (c.taskId ?? null);
    row.setAttribute('aria-selected', String(selected));
    if (!item.project) {
      row.append(Object.assign(document.createElement('span'), { className: 'picker-name muted', textContent: 'No project' }));
    } else {
      const dot = Object.assign(document.createElement('span'), { className: 'dot' });
      dot.style.background = item.project.color;
      const name = item.isTask ? item.task.name : item.task ? item.project.name + ': ' + item.task.name : item.project.name;
      row.append(dot, Object.assign(document.createElement('span'), { className: 'picker-name', textContent: name }));
      if (item.taskCount) row.append(Object.assign(document.createElement('span'), { className: 'picker-meta', textContent: item.taskCount + (item.taskCount > 1 ? ' tasks' : ' task') }));
    }
    if (selected) row.append(Object.assign(document.createElement('span'), { className: 'picker-check', textContent: '✓' }));
    row.addEventListener('mousedown', (ev) => ev.preventDefault());
    row.addEventListener('click', () => chooseProject(item));
    row.addEventListener('mousemove', () => {
      if (picker.active !== i) {
        picker.active = i;
        list.querySelectorAll('.picker-item').forEach((el, n) => el.classList.toggle('active', n === i));
      }
    });
    list.append(row);
  }
  list.querySelector('.picker-item.active')?.scrollIntoView({ block: 'nearest' });
}

function openPicker(open) {
  picker.open = open;
  $('project-panel').classList.toggle('hidden', !open);
  $('project').setAttribute('aria-expanded', String(open));
  if (open) {
    state.tagsOpen = false;
    renderTags();
    $('project-search').value = '';
    picker.active = 0;
    renderPicker();
    $('project-search').focus();
  }
}

function chooseProject(item) {
  openPicker(false);
  const projectId = item.projectId;
  const patch = { projectId, taskId: item.taskId };
  if (item.project && projectId !== current().projectId) patch.billable = item.project.billable;
  // Description typed + project chosen while idle: start right away.
  const typed = $('description').value.trim();
  if (!state.running && projectId && typed) start({ ...state.draft, description: typed, ...patch });
  else setFields(patch);
}

$('project').addEventListener('click', () => openPicker(!picker.open));
$('project-search').addEventListener('input', () => {
  picker.active = 0;
  renderPicker();
});
$('project-search').addEventListener('keydown', (e) => {
  const options = picker.items.filter((i) => i.type === 'option');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = Math.max(1, options.length);
    picker.active = (picker.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    renderPicker();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (options[picker.active]) chooseProject(options[picker.active]);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    openPicker(false);
    $('project').focus();
  }
});
document.addEventListener('mousedown', (e) => {
  if (picker.open && !$('project-panel').contains(e.target) && !$('project').contains(e.target)) openPicker(false);
});

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
  const p = c.projectId ? state.projects.find((x) => x.id === c.projectId) : null;
  const task = p && c.taskId ? p.tasks.find((x) => x.id === c.taskId) : null;
  const projectName = p?.name ?? (c.projectId ? state.running?.projectName : null);
  $('project-label').textContent = projectName ? (task ? projectName + ': ' + task.name : projectName) : 'Project';
  $('project-dot').classList.toggle('hidden', !projectName);
  $('project-dot').style.background = p?.color ?? state.running?.projectColor ?? '';
  $('project').classList.toggle('has-value', !!projectName);
  $('project').title = projectName ? projectName + (p?.clientName ? ' · ' + p.clientName : '') : 'Choose a project';
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
    const fields = { description: e.description, projectId: e.projectId, taskId: e.taskId, tagIds: e.tagIds, billable: e.billable };
    // The whole row is clickable: one click starts tracking this activity again.
    li.classList.add('clickable');
    li.title = state.running ? 'Switch to this activity' : 'Start this activity';
    li.addEventListener('click', () => start(fields));
    play.addEventListener('click', (ev) => {
      ev.stopPropagation();
      start(fields);
    });
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
  return guard(async () => {
    const d = await api('POST', '/entries/start', fields);
    state.running = d.entry;
    state.draft = emptyDraft();
    state.tagsOpen = false;
    await updateBadge(d.entry);
    chrome.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
    await loadRecent();
    renderTimer();
    return true;
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


$('billable').addEventListener('click', () => setFields({ billable: !current().billable }));
$('tags-btn').addEventListener('click', () => {
  if (picker.open) openPicker(false);
  state.tagsOpen = !state.tagsOpen;
  renderTags();
});

async function loadRecent() {
  const { entries } = await api('GET', '/entries?limit=60');
  state.recentAll = entries;
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
  const [{ projects }, { tags }, { entry }, me] = await Promise.all([
    api('GET', '/projects'),
    api('GET', '/tags'),
    api('GET', '/entries/running'),
    api('GET', '/auth/me'),
  ]);
  state.canCreate = me.user.role === 'admin' || !!me.settings?.membersCanCreate;
  state.projects = projects;
  state.tags = tags;
  state.running = entry;
  await loadRecent();
  renderTimer();
  await updateBadge(entry);
  show('main');
  if (!ticker) ticker = setInterval(tick, 1000);
  if (!entry) $('description').focus();
}

// ---------------------------------------------------------------- Dictation

const NEW_PROJECT_COLORS = ['#3E8E5E', '#4F68D8', '#C2861A', '#D24A3F', '#8E5EA8', '#2A9D8F', '#E07A5F', '#5C7AEA'];

setupVoice({
  context: () => ({ projects: state.projects, recent: state.recentAll, canCreate: state.canCreate, running: state.running }),
  start: async (fields) => {
    if (!(await start(fields))) throw new Error($('error').textContent || 'Could not start the timer');
  },
  createProject: async (name) => {
    const color = NEW_PROJECT_COLORS[state.projects.length % NEW_PROJECT_COLORS.length];
    const { project } = await api('POST', '/projects', { name, color, clientId: null });
    state.projects = [...state.projects, project];
    return project;
  },
  openPicker: () => openPicker(true),
});

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
