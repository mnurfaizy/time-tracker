import { useState } from 'react';
import { Puzzle, Download, Copy } from 'lucide-react';
import { api } from '../api.js';
import { useData } from '../store.jsx';

/** Profile card: download the browser extension and get a sign-in code for it. */
export function ExtensionCard() {
  const { toast } = useData();
  const [code, setCode] = useState('');

  const getCode = async () => {
    try {
      const d = await api.post('/auth/extension-code');
      setCode(d.code);
      try {
        await navigator.clipboard.writeText(d.code);
        toast('Sign-in code copied. Paste it in the extension.', 'success');
      } catch {
        // Clipboard may be blocked; the code is shown below.
      }
    } catch (err) {
      toast(err.message);
    }
  };

  return (
    <div className="card pad-lg">
      <h3 className="section-title first"><Puzzle size={18} /> Browser extension</h3>
      <p className="setting-desc">
        Start and stop your timer from the browser toolbar, like the Clockify extension. Works in Chrome, Edge, Brave and Opera.
        While a timer runs, the icon turns blue and shows the elapsed time.
      </p>
      <a className="btn btn-outline" href="/api/extension/download"><Download size={16} /> Download extension (.zip)</a>
      <ol className="install-steps">
        <li>Extract the downloaded ZIP to a folder you will keep (for example <code>Documents\time-tracker-extension</code>).</li>
        <li>Open <code>chrome://extensions</code> (Edge: <code>edge://extensions</code>) and turn on <b>Developer mode</b>.</li>
        <li>Click <b>Load unpacked</b> and choose the extracted <code>time-tracker-extension</code> folder.</li>
        <li>Pin the extension (puzzle icon in the toolbar → pin <b>Time Tracker</b>) and sign in.</li>
      </ol>
      <p className="setting-desc small">Shortcuts: <b>Alt+Shift+U</b> opens the extension, <b>Alt+Shift+S</b> starts or stops the timer.</p>
      <div className="setting-row">
        <div>
          <div className="setting-title">Sign in with a code</div>
          <div className="setting-desc">For people who log in with Google and have no password. The code works like a password — do not share it.</div>
        </div>
        <button type="button" className="btn btn-outline" onClick={getCode}>Get sign-in code</button>
      </div>
      {code && (
        <div className="input-with-btn">
          <input className="input mono" readOnly value={code} onFocus={(e) => e.target.select()} />
          <button type="button" className="icon-btn" title="Copy" onClick={() => navigator.clipboard.writeText(code).then(() => toast('Copied', 'success'))}><Copy size={16} /></button>
        </div>
      )}
    </div>
  );
}
