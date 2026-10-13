// Voice dictation for the timer bar: "review modul untuk project BSI AI Literacy" starts the timer on that project.
// Speech-to-text is the browser's built-in Web Speech API; the project is matched locally by the same
// matcher the browser extension uses. When the match is not confident the user is asked to confirm.
import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { interpret, titleCase } from '../../../extension/matcher.js';

const SpeechRecognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const LANGS = { 'id-ID': 'Bahasa Indonesia', 'en-US': 'English' };

function storedLang() {
  try {
    const l = localStorage.getItem('tt.voiceLang');
    return LANGS[l] ? l : 'id-ID';
  } catch {
    return 'id-ID';
  }
}

/**
 * Speech recognition state machine.
 * view: null | { kind: 'listening', text } | { kind: 'ask', result, transcript } | { kind: 'message', text, tone }
 */
export function useDictation({ projects, recent, onResult }) {
  const [view, setView] = useState(null);
  const [lang, setLangState] = useState(storedLang);
  const rec = useRef(null);
  const flags = useRef({});
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
    flags.current.cancelled = true;
    rec.current?.abort();
  }, []);

  const listen = (language = lang) => {
    if (!SpeechRecognition) {
      message('Dictation is not supported in this browser. Use Google Chrome or Microsoft Edge.', 'error');
      return;
    }
    flags.current = { final: '', error: null, cancelled: false, restart: null };
    const r = new SpeechRecognition();
    rec.current = r;
    r.lang = language;
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) flags.current.final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      show({ kind: 'listening', text: `${flags.current.final} ${interim}`.trim() });
    };
    r.onerror = (e) => {
      flags.current.error = e.error;
    };
    r.onend = () => {
      const { error, cancelled, restart, final } = flags.current;
      rec.current = null;
      if (restart) return listen(restart);
      if (cancelled || error === 'aborted') return;
      if (error === 'not-allowed' || error === 'service-not-allowed') {
        return message('Microphone access is blocked. Allow it from the icon at the left of the address bar, then try again.', 'warn');
      }
      if (error === 'network') return message('Dictation needs an internet connection. Please try again.', 'error');
      if (error === 'audio-capture') return message('No microphone was found on this device.', 'error');
      const text = final.trim();
      if (!text) return message('No speech was detected. Click the mic and try again.', 'warn', 4000);
      const result = interpret(text, ctx.current);
      onResultRef.current(result, text);
    };
    show({ kind: 'listening', text: '' });
    try {
      r.start();
    } catch {
      rec.current = null;
    }
  };

  const setLang = (l) => {
    setLangState(l);
    try {
      localStorage.setItem('tt.voiceLang', l);
    } catch {
      // ignore
    }
    if (rec.current) {
      flags.current.restart = l;
      rec.current.abort();
    } else {
      listen(l);
    }
  };

  const toggle = () => {
    if (rec.current) rec.current.stop();
    else listen();
  };

  const cancel = () => {
    flags.current.cancelled = true;
    rec.current?.abort();
    close();
  };

  return {
    view, lang, setLang, toggle, cancel, close, message, show,
    listening: view?.kind === 'listening',
    finish: () => rec.current?.stop(),
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
          {view.text || 'Say what you are working on and for which project, e.g. “Review modul untuk project BSI AI Literacy”.'}
        </div>
        <div className="voice-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={dictation.finish}>Done</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={dictation.cancel}>Cancel</button>
        </div>
      </div>
    );
  }

  if (view.kind === 'message') {
    return (
      <div className="voice-panel" aria-live="polite">
        <div className={`voice-msg ${view.tone}`}>{view.text}</div>
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
