const $ = (id) => document.getElementById(id);
const LIB = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm';
const KEY = 'meine-ki-chat-v1';
let engine, busy = false, ready = false, history = [], stopped = false;
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
  if (Array.isArray(saved)) history = saved.filter(m => m && ['user','assistant'].includes(m.role) && typeof m.content === 'string').slice(-80);
} catch { /* Corrupt or unavailable storage must not prevent chat. */ }
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(history.slice(-80))); }
  catch { $('offline').textContent = 'Der Chat konnte nicht dauerhaft gespeichert werden. Er bleibt für diese Sitzung sichtbar.'; }
}
function bubble(role, content) {
  $('empty')?.remove();
  const item = document.createElement('article'); item.className = role;
  const label = document.createElement('strong'); label.textContent = role === 'user' ? 'DU' : 'MEINE KI';
  const text = document.createElement('div'); text.className = 'text'; text.textContent = content;
  item.append(label, text); $('messages').append(item); return text;
}
history.forEach(m => bubble(m.role, m.content));
function status(text) { $('status').textContent = text; }
function controls() {
  $('load').disabled = busy || ready; $('clear').disabled = busy;
  $('prompt').disabled = !ready || busy; $('send').disabled = !ready || busy;
  $('stop').hidden = !ready || !busy; $('send').hidden = ready && busy;
}
const offlineReady = (async () => {
  if (!isSecureContext || !('serviceWorker' in navigator)) {
    $('offline').textContent = 'Offline-Speicherung benötigt HTTPS oder localhost.'; return;
  }
  try {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Seite bitte einmal neu laden.')), 12000);
      navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, { once:true });
    });
    $('offline').textContent = 'App-Oberfläche gespeichert. Modell laden und anschließend den Flugmodus-Test durchführen.';
  } catch (e) { $('offline').textContent = 'Offline-Vorbereitung fehlgeschlagen: ' + e.message; }
})();
async function checkDevice() {
  if (!isSecureContext) throw new Error('Öffne die App über HTTPS. Eine Datei oder eine HTTP-Adresse des Windows-PCs reicht auf dem iPad nicht.');
  if (!navigator.gpu) throw new Error('WebGPU ist hier nicht verfügbar. Öffne die HTTPS-Seite direkt in Safari, nicht in einer eingebetteten Vorschau.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('Der Browser gibt keinen Zugriff auf die GPU. Schließe andere Apps und starte Safari neu.');
  return adapter;
}
checkDevice().then(() => { $('device').textContent = 'WebGPU verfügbar. Die Modellkompatibilität wird beim Laden geprüft.'; }).catch(e => { $('device').textContent = e.message; });
$('load').onclick = async () => {
  busy = true; controls(); $('progress').hidden = false; status('Gerät prüfen …');
  try {
    await checkDevice(); await offlineReady;
    try { await navigator.storage?.persist?.(); } catch { /* Optional. */ }
    const { MLCEngine, prebuiltAppConfig } = await import(LIB);
    const preferred = ['Qwen2.5-0.5B-Instruct-q4f16_1-MLC','Qwen2.5-0.5B-Instruct-q4f32_1-MLC'];
    const adapter = await navigator.gpu.requestAdapter();
    const names = adapter?.features.has('shader-f16') ? preferred : [...preferred].reverse();
    const model = names.find(id => prebuiltAppConfig.model_list.some(m => m.model_id === id));
    if (!model) throw new Error('Das vorgesehene kleine Qwen-Modell fehlt in dieser WebLLM-Version.');
    $('model-name').textContent = 'Modell: ' + model;
    engine = new MLCEngine({ initProgressCallback: p => {
      $('progress').value = Math.max(0, Math.min(1, p.progress || 0));
      status(p.text || 'Modell wird geladen …');
    }});
    await engine.reload(model, { context_window_size: 4096 });
    ready = true; $('load').textContent = 'KI geladen'; status('Bereit · Antworten werden auf diesem Gerät berechnet.');
  } catch (e) {
    if (engine) { try { await engine.unload(); } catch {} engine = undefined; }
    status('Start fehlgeschlagen: ' + e.message + ' Prüfe Internet und freien Speicher; schließe andere Apps und versuche es erneut.');
  } finally { busy = false; $('progress').hidden = true; controls(); if (ready) $('prompt').focus(); }
};
$('stop').onclick = () => { stopped = true; engine?.interruptGenerate(); };
$('clear').onclick = async () => {
  if (busy || !confirm('Den auf diesem Gerät gespeicherten Chat löschen?')) return;
  history = []; save(); $('messages').replaceChildren();
  status(ready ? 'Chat gelöscht · Bereit für eine neue Frage.' : 'Chat gelöscht.');
};
$('form').onsubmit = async (event) => {
  event.preventDefault(); if (!ready || busy) return;
  const input = $('prompt').value.trim(); if (!input) return;
  busy = true; stopped = false; controls();
  history.push({role:'user',content:input}); bubble('user',input); save(); $('prompt').value = '';
  const answer = bubble('assistant','…'); let output = '';
  // Keep a bounded suffix beginning with a user turn. Full history remains visible.
  let context = history.slice(-9);
  while (context.length > 1 && (context[0].role !== 'user' || context.reduce((n,m) => n + m.content.length, 0) > 2400)) context.shift();
  status('Die KI schreibt …');
  try {
    await engine.resetChat();
    const stream = await engine.chat.completions.create({
      messages:[{role:'system',content:'Du bist ein hilfreicher Assistent. Antworte auf Deutsch, knapp und verständlich. Sage ehrlich, wenn du etwas nicht weißt.'}, ...context],
      stream:true, temperature:0.7, max_tokens:384
    });
    for await (const chunk of stream) {
      output += chunk.choices[0]?.delta?.content || ''; answer.textContent = output || '…';
      if (stopped) engine.interruptGenerate();
    }
    if (output.trim()) { history.push({role:'assistant',content:output}); save(); }
    else { answer.textContent = stopped ? 'Antwort abgebrochen.' : 'Keine Antwort erzeugt. Bitte erneut versuchen.'; history.pop(); save(); }
    status(stopped ? 'Antwort gestoppt.' : 'Bereit · Lokal auf deinem Gerät.');
  } catch (e) {
    answer.textContent = output ? output + '\n\n[Antwort unvollständig]' : 'Die Antwort konnte nicht erzeugt werden.';
    // Remove failed user turn from future model context, leaving its visible bubble.
    history.pop(); save(); ready = false; $('load').textContent = 'KI erneut laden';
    try { await engine.unload(); } catch {} engine = undefined;
    status('Fehler: ' + e.message + ' Lade die KI erneut. Bei Speicherproblemen andere Apps schließen.');
  } finally { busy = false; controls(); if (ready) $('prompt').focus(); }
};
