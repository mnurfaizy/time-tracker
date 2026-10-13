// Voice dictation for the timer bar: "review modul untuk project BSI AI Literacy" starts the timer on that project.
// Speech-to-text runs through the shared speech.js (Groq Whisper via our server when configured, otherwise the
// browser's built-in engine); the project is matched locally by the same matcher the browser extension uses.
// When the match is not confident the user is asked to confirm.
import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { interpret, titleCase } from '../../../extension/matcher.js';
import { pickEngine, listenOnce, speechErrorMessage } from '../../../extension/speech.js';

const LANGS = { 'id-ID': 'Bahasa Indonesia', 'en-US': 'English' };

function storedLang() {
  try {
    const l = localStorage.getItem('tt.voiceLang');
    return LANGS[l] ? l : 'id-ID';
  } catch {
    return 'id-ID';
  }
}

async function transcribe(blob, lang) {
  const res = await fetch(`/api/transcribe?lang=${lang.startsWith('en') ? 'en' : 'id'}`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'fetch', 'Content-Type': blob.type || 'audio/webm' },
    credentials: 'same-origin',
    body: blob,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Transcription failed (${res.status})`);
  return data.text || '';
}

/**
 * Speech recognition state machine.
 * view: null | { kind: 'listening', text, engine } | { kind: 'transcribing' } | { kind: 'ask', result, transcript }
 *       | { kind: 'message', text, tone }
 */
export function useDictation({ projects, recent, cloudAvailable, onResult }) {
  const [view, setView] = useState(null);
  const [lang, setLangState] = useState(storedLang);
  const session = useRef(null);
  const engineRef = useRef(null);
  const langRef = useRef(lang);
  langRef.current = lang;
  const hideTimer = useRef(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const ctx = useRef({ projects, recent });
  ctx.current = { projects, recent };

  const show = (v, autoHide = 0) => {
    clearTimeout(hideTimer.current);
    setView(v);
    if (autoHide) hideTimer.current = setTimeout(() => setView(null), autoHide);
  };
  const message = (text, tone = 'info', autoHide = 0) => show({ kind: 'message', text, tone }, autoHide);
  const close = () => show(null);

  useEffect(() => () => {
    clearTimeout(hideTimer.current);
    session.current?.cancel();
  }, []);

  const listen = async () => {
    const engine = pickEngine({ cloudAvailable });
    if (!engine) {
      message('Dictation is not supported in this browser.', 'error');
      return;
    }
    engineRef.current = engine;
    const s = listenOnce({
      engine,
      lang: langRef.current,
      transcribe: (blob) => transcribe(blob, langRef.current),
      onText: (text) => show({ kind: 'listening', text, engine }),
      onPhase: (phase) => phase === 'transcribing' && show({ kind: 'transcribing' }),
    });
    session.current = s;
    show({ kind: 'listening', text: '', engine });
    const r = await s.result;
    if (session.current !== s) return; // replaced, e.g. after switching language
    session.current = null;
    if (r.error === 'aborted') return;
    if (r.error) return message(speechErrorMessage(r, { engine, cloudAvailable }), r.error === 'not-allowed' ? 'warn' : 'error');
    const text = r.text.trim();
    if (!text) return message('No speech was detected. Click the mic and try again.', 'warn', 4000);
    onResultRef.current(interpret(text, ctx.current), text);
  };

  const setLang = (l) => {
    setLangState(l);
    langRef.current = l;
    try {
      localStorage.setItem('tt.voiceLang', l);
    } catch {
      // ignore
    }
    // Built-in engine: restart in the new language. Whisper: the language applies when transcribing.
    if (!session.current) listen();
    else if (engineRef.current === 'native') {
      session.current.cancel();
      listen();
    }
  };

  const toggle = () => {
    if (session.current && view?.kind === 'listening') session.current.stop();
    else if (!session.current) listen();
  };

  const cancel = () => {
    const s = session.current;
    session.current = null;
    s?.cancel();
    close();
  };

  return {
    view, lang, setLang, toggle, cancel, close, message, show,
    listening: view?.kind === 'listening',
    finish: () => session.current?.stop(),
  };
}

export function MicButton({ dictation }) {
  return (
    <button
      type="button"
      className={`icon-btn mic-btn ${dictation.listening ? 'listening' : ''}`}
      onClick={dictation.toggle}
      title="Dictate: say what you are doing and for which project"
      aria-label={dictation.listening ? 'Stop dictation' : 'Dictate'}
    >
      <Mic size={18} />
    </button>
  );
}

function Dot({ color }) {
  return <span className="dot" style={{ background: color }} />;
}

/**
 * @param dictation   from useDictation
 * @param canCreate   whether the user may register projects
 * @param onPick(project|null, task|null, description)
 * @param onCreate(name, description)
 * @param onChoose()  opens the regular project picker
 */
export function DictationPanel({ dictation, projects, canCreate, onPick, onCreate, onChoose }) {
  const { view } = dictation;
  const [desc, setDesc] = useState('');
  useEffect(() => {
    if (view?.kind === 'ask') setDesc(view.result.description);
  }, [view]);
  if (!view) return null;

  if (view.kind === 'listening') {
    return (
      <div className="voice-panel" aria-live="polite">
        <div className="voice-head">
          <span className="voice-pulse" />
          <span className="voice-title">Listening…</span>
          <div className="voice-langs">
            {Object.entries(LANGS).map(([code, label]) => (
              <button key={code} type="button" title={label} className={`voice-lang ${dictation.lang === code ? 'on' : ''}`} onClick={() => dictation.setLang(code)}>
                {code.slice(0, 2).toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className={`voice-transcript ${view.text ? '' : 'placeholder'}`}>
          {view.text || (view.engine === 'cloud'
            ? 'Say what you are working on and for which project, e.g. “Review modul untuk project BSI AI Literacy”. It stops by itself when you pause.'
            : 'Say what you are working on and for which project, e.g. “Review modul untuk project BSI AI Literacy”.')}
        </div>
        <div className="voice-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={dictation.finish}>Done</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={dictation.cancel}>Cancel</button>
        </div>
      </div>
    );
  }

  if (view.kind === 'transcribing') {
    return (
      <div className="voice-panel" aria-live="polite">
        <div className="voice-head">
          <span className="voice-spinner" />
          <span className="voice-title">Transcribing…</span>
        </div>
      </div>
    );
  }

  if (view.kind === 'message') {
    return (
      <div className="voice-panel" aria-live="polite">
        <div className={`voice-msg tone-${view.tone}`}>{view.text}</div>
        {view.tone !== 'success' && (
          <div className="voice-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={dictation.close}>Close</button>
          </div>
        )}
      </div>
    );
  }

  // Ask the user which project this is.
  const { result, transcript } = view;
  const good = result.candidates.filter((c) => c.score >= 0.3).slice(0, 3);
  const phrase = result.projectPhrase ? titleCase(result.projectPhrase) : null;
  const exists = phrase && projects.some((p) => p.name.toLowerCase() === phrase.toLowerCase());
  const unknownProject = phrase && !exists && !good.some((c) => c.score >= 0.75);
  const description = desc.trim() || result.description;

  return (
    <div className="voice-panel" aria-live="polite">
      <div className="voice-heard">We heard: <q>{transcript}</q></div>
      <div className="voice-question">
        {unknownProject ? (
          <>
            Project <b>“{phrase}”</b> is not registered yet.{' '}
            {good.length ? 'Did you mean one of these, or register it as a new project?' : canCreate ? 'Register it as a new project?' : ''}
          </>
        ) : (
          <>Which project is <b>“{result.description || 'this'}”</b> for?</>
        )}
      </div>
      <label className="voice-desc">
        <span>Description</span>
        <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </label>
      {good.length > 0 && (
        <div className="voice-options">
          {good.map((c) => (
            <button key={c.project.id} type="button" className="voice-option" onClick={() => onPick(c.project, c.task, description)}>
              <Dot color={c.project.color} />
              <span className="voice-option-name">{c.task ? `${c.project.name}: ${c.task.name}` : c.project.name}</span>
              {c.project.clientName && <span className="voice-option-client">{c.project.clientName}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="voice-actions">
        {phrase && !exists && canCreate && (
          <button type="button" className={`btn btn-sm ${unknownProject ? 'btn-primary' : 'btn-outline'}`} onClick={() => onCreate(phrase, description)}>
            + Register “{phrase}”
          </button>
        )}
        <button type="button" className="btn btn-outline btn-sm" onClick={() => onPick(null, null, description)}>Start without project</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { dictation.close(); onChoose(); }}>Choose…</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={dictation.close}>Cancel</button>
      </div>
      {phrase && !exists && !canCreate && (
        <div className="voice-note">Only admins can register new projects. Ask an admin to add “{phrase}”, or pick another project.</div>
      )}
    </div>
  );
}
