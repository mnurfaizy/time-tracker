// Dictation: speak "review modul untuk project BSI AI Literacy" and the timer starts on the right project.
// Speech-to-text runs through speech.js (Groq Whisper via our server, or the browser's built-in engine);
// the project is matched locally by matcher.js. When the match is not confident, the user is asked to confirm.
import { interpret, titleCase } from './matcher.js';
import { pickEngine, listenOnce, speechErrorMessage } from './speech.js';

const LANGS = { 'id-ID': 'Bahasa Indonesia', 'en-US': 'English' };

/** Tiny DOM helper: el('button', { className, onclick }, 'text', child) */
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

function projectLabel(project, task) {
  const dot = el('span', { className: 'dot' });
  dot.style.background = project.color;
  return [dot, el('span', { className: 'voice-option-name' }, task ? `${project.name}: ${task.name}` : project.name),
    project.clientName ? el('span', { className: 'voice-option-client' }, project.clientName) : null];
}

/**
 * @param {object} deps
 * @param {() => {projects, recent, canCreate, running, cloudAvailable}} deps.context
 * @param {(blob, lang) => Promise<string>} deps.transcribe  sends audio to the server
 * @param {(fields) => Promise<void>} deps.start     starts a timer (stops the running one)
 * @param {(name) => Promise<object>} deps.createProject
 * @param {() => void} deps.openPicker
 */
export function setupVoice({ context, start, createProject, openPicker, transcribe }) {
  const panel = document.getElementById('voice-panel');
  const micBtn = document.getElementById('mic');
  const descInput = document.getElementById('description');
  const voice = { session: null, listening: false, lang: 'id-ID', hideTimer: null };

  chrome.storage.local.get('voiceLang').then(({ voiceLang }) => {
    if (voiceLang && LANGS[voiceLang]) voice.lang = voiceLang;
  });

  const close = () => {
    clearTimeout(voice.hideTimer);
    panel.classList.add('hidden');
    panel.textContent = '';
  };

  const render = (...children) => {
    clearTimeout(voice.hideTimer);
    panel.textContent = '';
    panel.append(...children.flat().filter(Boolean));
    panel.classList.remove('hidden');
  };

  const message = (text, tone = 'info', { autoHide = 0, action } = {}) => {
    render(
      el('div', { className: `voice-msg tone-${tone}` }, text),
      action ? el('button', { className: 'voice-btn primary', type: 'button', onclick: action.onClick }, action.label) : null,
    );
    if (autoHide) voice.hideTimer = setTimeout(close, autoHide);
  };

  const setListening = (on) => {
    voice.listening = on;
    micBtn.classList.toggle('listening', on);
    micBtn.setAttribute('aria-label', on ? 'Stop dictation' : 'Dictate');
  };

  const langToggle = () =>
    el('div', { className: 'voice-langs' },
      Object.entries(LANGS).map(([code, label]) =>
        el('button', {
          type: 'button',
          className: `voice-lang ${voice.lang === code ? 'on' : ''}`,
          textContent: code.slice(0, 2).toUpperCase(),
          title: label,
          onclick: () => {
            voice.lang = code;
            chrome.storage.local.set({ voiceLang: code });
            // Built-in engine: restart in the new language. Whisper: the language applies when transcribing.
            if (!voice.listening) listen();
            else if (voice.engine === 'native') {
              voice.session?.cancel();
              listen();
            } else showListening();
          },
        }),
      ),
    );

  const showListening = (interim = '') =>
    render(
      el('div', { className: 'voice-head' },
        el('span', { className: 'voice-pulse' }),
        el('span', { className: 'voice-title' }, 'Listening…'),
        langToggle(),
      ),
      el('div', { className: `voice-transcript ${interim ? '' : 'placeholder'}` },
        interim || (voice.engine === 'cloud'
          ? 'Say what you are working on and for which project. It stops by itself when you pause.'
          : 'Say what you are working on and for which project, e.g. “Review modul untuk project BSI AI Literacy”.')),
      el('div', { className: 'voice-actions' },
        el('button', { type: 'button', className: 'voice-btn', onclick: () => voice.session?.stop() }, 'Done'),
        el('button', { type: 'button', className: 'voice-btn ghost', onclick: () => { voice.session?.cancel(); close(); } }, 'Cancel'),
      ),
    );

  const showTranscribing = () =>
    render(
      el('div', { className: 'voice-head' },
        el('span', { className: 'voice-spinner' }),
        el('span', { className: 'voice-title' }, 'Transcribing…'),
      ),
    );

  async function begin(description, project, task) {
    descInput.value = description;
    const wasRunning = !!context().running;
    try {
      await start({
        description,
        projectId: project?.id ?? null,
        taskId: task?.id ?? null,
        tagIds: [],
        billable: project ? !!project.billable : false,
      });
    } catch (err) {
      message(err.message, 'error');
      return;
    }
    message(
      `${wasRunning ? 'Switched to' : 'Started'}: ${description || '(no description)'}${project ? ` · ${project.name}` : ''}`,
      'success',
      { autoHide: 3500 },
    );
  }

  function ask(result, transcript) {
    const { projects, canCreate } = context();
    const good = result.candidates.filter((c) => c.score >= 0.3).slice(0, 3);
    const phrase = result.projectPhrase ? titleCase(result.projectPhrase) : null;
    const exists = phrase && projects.some((p) => p.name.toLowerCase() === phrase.toLowerCase());
    const unknownProject = phrase && !exists && !good.some((c) => c.score >= 0.75);
    const desc = () => descInput.value.trim() || result.description;

    render(
      el('div', { className: 'voice-heard' }, 'We heard: ', el('q', {}, transcript)),
      el('div', { className: 'voice-question' },
        unknownProject
          ? [el('span', {}, 'Project '), el('b', {}, `“${phrase}”`), el('span', {}, ' is not registered yet. '),
              good.length ? 'Did you mean one of these, or register it as a new project?' : canCreate ? 'Register it as a new project?' : '']
          : `Which project is “${result.description || 'this'}” for?`),
      good.length
        ? el('div', { className: 'voice-options' },
            good.map((c) => el('button', { type: 'button', className: 'voice-option', onclick: () => begin(desc(), c.project, c.task) }, projectLabel(c.project, c.task))))
        : null,
      phrase && !exists
        ? canCreate
          ? el('button', {
              type: 'button',
              // Prominent only when nothing registered looks like what was said.
              className: `voice-btn block ${unknownProject ? 'primary' : ''}`,
              onclick: async () => {
                try {
                  const project = await createProject(phrase);
                  await begin(desc(), project, null);
                } catch (err) {
                  message(err.message, 'error');
                }
              },
            }, `+ Register “${phrase}”`)
          : el('div', { className: 'voice-note' }, `Only admins can register new projects. Ask an admin to add “${phrase}”, or pick another project.`)
        : null,
      el('div', { className: 'voice-actions' },
        el('button', { type: 'button', className: 'voice-btn', onclick: () => begin(desc(), null, null) }, 'Start without project'),
        el('button', { type: 'button', className: 'voice-btn ghost', onclick: () => { close(); openPicker(); } }, 'Choose…'),
        el('button', { type: 'button', className: 'voice-btn ghost', onclick: close }, 'Cancel'),
      ),
    );
  }

  async function handle(transcript) {
    const text = transcript.trim();
    if (!text) {
      message('No speech was detected. Tap the mic and try again.', 'warn', { autoHide: 4000 });
      return;
    }
    const { projects, recent } = context();
    const result = interpret(text, { projects, recent });
    const best = result.candidates[0];
    if (result.confident && best) await begin(result.description, best.project, best.task);
    else ask(result, text);
  }

  async function listen() {
    const { cloudAvailable } = context();
    const engine = pickEngine({ cloudAvailable });
    if (!engine) {
      message('Dictation is not supported in this browser.', 'error');
      return;
    }
    voice.engine = engine;
    const session = listenOnce({
      engine,
      lang: voice.lang,
      transcribe: (blob) => transcribe(blob, voice.lang),
      onText: (t) => showListening(t),
      onPhase: (phase) => {
        if (phase === 'transcribing') {
          setListening(false);
          showTranscribing();
        }
      },
    });
    voice.session = session;
    setListening(true);
    showListening();
    const r = await session.result;
    if (voice.session !== session) return; // replaced (language switch)
    voice.session = null;
    setListening(false);
    if (r.error === 'aborted') return;
    if (r.error) {
      const text = speechErrorMessage(r, { engine, cloudAvailable, extension: true });
      if (r.error === 'not-allowed') {
        message(text, 'warn', { action: { label: 'Allow microphone', onClick: () => chrome.tabs.create({ url: chrome.runtime.getURL('mic.html') }) } });
      } else {
        message(text, 'error');
      }
      return;
    }
    await handle(r.text);
  }

  micBtn.addEventListener('click', () => {
    if (voice.listening) voice.session?.stop();
    else listen();
  });
}
