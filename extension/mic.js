// Extension popups cannot show the microphone permission prompt, so it is requested from this tab once.
const status = document.getElementById('status');
const button = document.getElementById('allow');

async function request() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    status.innerHTML = '<span class="ok">✓ Microphone allowed.</span><br>Close this tab, open the Time Tracker extension and tap the mic again.';
    button.textContent = 'Close tab';
    button.onclick = () => window.close();
  } catch (err) {
    status.innerHTML = '<span class="err">Microphone access was blocked.</span><br>Click the icon at the left of the address bar, set Microphone to <b>Allow</b>, then try again.';
    button.textContent = 'Try again';
  }
}

button.addEventListener('click', request);
request();
