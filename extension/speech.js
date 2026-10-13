// Listens for one spoken sentence and returns the text. Shared by the extension and the web app.
// Two engines:
//  - 'cloud':  records a short clip and sends it to our server, which transcribes it with Groq Whisper
//              (primed with the user's project names). Works in every browser. Used when configured.
//  - 'native': the browser's built-in Web Speech API. Fallback; only works in Chrome and Edge.

const NativeSR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

export const recordingSupported = () => !!(globalThis.MediaRecorder && globalThis.navigator?.mediaDevices?.getUserMedia);

/**
 * Chooses the engine. Whisper on the server is preferred whenever it is set up: it is more accurate and
 * is primed with the user's project names. The built-in recognizer is the fallback.
 */
export function pickEngine({ cloudAvailable }) {
  if (cloudAvailable && recordingSupported()) return 'cloud';
  return NativeSR ? 'native' : null;
}

/**
 * @param {object} o
 * @param {'native'|'cloud'} o.engine
 * @param {string} o.lang                         'id-ID' | 'en-US'
 * @param {(blob: Blob, lang: string) => Promise<string>} o.transcribe   cloud only
 * @param {(text: string) => void} [o.onText]     live text (native only)
 * @param {(phase: 'listening'|'transcribing') => void} [o.onPhase]
 * @returns {{ stop(): void, cancel(): void, result: Promise<{ text?: string, error?: string, message?: string }> }}
 *   error: 'not-allowed' | 'no-mic' | 'network' | 'aborted' | 'unsupported' | 'cloud'
 */
export function listenOnce(o) {
  return o.engine === 'cloud' ? listenCloud(o) : listenNative(o);
}

function listenNative({ lang, onText, onPhase }) {
  if (!NativeSR) return { stop() {}, cancel() {}, result: Promise.resolve({ error: 'unsupported' }) };
  const rec = new NativeSR();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  let error = null;
  let cancelled = false;
  const result = new Promise((resolve) => {
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      onText?.(`${finalText} ${interim}`.trim());
    };
    rec.onerror = (e) => {
      error = e.error;
    };
    rec.onend = () => {
      if (cancelled || error === 'aborted') return resolve({ error: 'aborted' });
      if (error === 'not-allowed' || error === 'service-not-allowed') return resolve({ error: 'not-allowed' });
      if (error === 'audio-capture') return resolve({ error: 'no-mic' });
      if (error === 'network') return resolve({ error: 'network' });
      resolve({ text: finalText.trim() });
    };
  });
  onPhase?.('listening');
  try {
    rec.start();
  } catch {
    return { stop() {}, cancel() {}, result: Promise.resolve({ error: 'unsupported' }) };
  }
  return {
    stop: () => rec.stop(),
    cancel: () => {
      cancelled = true;
      rec.abort();
    },
    result,
  };
}

// Pause that ends the recording. People often stop for 1-2 s mid-sentence to think, so wait a bit longer.
const END_SILENCE_MS = 3000;
const NO_SPEECH_MS = 8000; // nothing said at all
const MAX_MS = 40000;

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

function listenCloud({ lang, transcribe, onPhase }) {
  let stopRecording = () => {};
  let cancelled = false;
  let stopRequested = false;

  const result = (async () => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return { error: 'no-mic' };
      return { error: 'not-allowed' };
    }
    if (cancelled) {
      stream.getTracks().forEach((t) => t.stop());
      return { error: 'aborted' };
    }
    const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    // Voice activity detection: stop by itself after a pause once the user has spoken.
    const ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const started = Date.now();
    let noise = null; // room noise level: the quietest moment seen so far
    let spoke = false;
    let lastVoice = 0;

    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    const finish = () => {
      clearInterval(timer);
      if (recorder.state !== 'inactive') recorder.stop();
    };
    stopRecording = finish;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const now = Date.now();
      // Track the noise floor from the quietest frames, so speaking right away does not raise it.
      noise = noise == null ? rms : Math.min(rms, noise * 1.02);
      const start = Math.min(0.05, Math.max(0.015, noise * 3));
      // Once speaking, softer sounds (trailing words, quiet voice) still count as speech.
      const threshold = spoke ? Math.max(0.01, start * 0.6) : start;
      if (rms > threshold) {
        spoke = true;
        lastVoice = now;
      }
      if ((spoke && now - lastVoice > END_SILENCE_MS) || (!spoke && now - started > NO_SPEECH_MS) || now - started > MAX_MS) finish();
    }, 100);

    onPhase?.('listening');
    recorder.start();
    if (stopRequested) finish();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
    if (cancelled) return { error: 'aborted' };
    if (!spoke && !stopRequested) return { text: '' };

    onPhase?.('transcribing');
    try {
      const blob = new Blob(chunks, { type: (recorder.mimeType || mimeType || 'audio/webm').split(';')[0] });
      return { text: (await transcribe(blob, lang)).trim() };
    } catch (err) {
      if (cancelled) return { error: 'aborted' };
      return { error: 'cloud', message: err.message };
    }
  })();

  return {
    stop: () => {
      stopRequested = true;
      stopRecording();
    },
    cancel: () => {
      cancelled = true;
      stopRecording();
    },
    result,
  };
}

/** Human-readable message for a listenOnce() error. */
export function speechErrorMessage(r, { engine, cloudAvailable, extension }) {
  switch (r.error) {
    case 'not-allowed':
      return extension
        ? 'The extension needs permission to use your microphone (one time only).'
        : 'Microphone access is blocked. Allow it from the icon at the left of the address bar, then try again.';
    case 'no-mic':
      return 'No microphone was found on this device.';
    case 'network':
      return cloudAvailable
        ? 'The built-in speech service is not available in this browser.'
        : 'This browser cannot use the built-in speech service (Brave, Opera, Arc and Vivaldi block it). Use Chrome or Edge, or ask your admin to enable backup speech recognition (GROQ_API_KEY).';
    case 'unsupported':
      return 'Dictation is not supported in this browser.';
    case 'cloud':
      return r.message || 'Could not transcribe the audio. Please try again.';
    default:
      return engine === 'cloud' ? 'Could not transcribe the audio. Please try again.' : 'Dictation stopped. Please try again.';
  }
}
