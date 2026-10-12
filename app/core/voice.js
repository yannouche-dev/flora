// @ts-check
// Voice search: the browser's speech recognition (Web Speech API), in French. Nothing is sent by the app
// itself; the browser decides where the audio is processed (Google's servers on Chrome). Module « voice ».

import { moduleOn } from './modules.js';

const Recognition = /** @type {any} */ (globalThis).SpeechRecognition || /** @type {any} */ (globalThis).webkitSpeechRecognition;

/** The browser can do it (whatever the module says). */
export const voiceSupported = () => Boolean(Recognition);

/** The mic button shows: supported and « Dictée vocale » on in the app mode. */
export const voiceAvailable = () => voiceSupported() && moduleOn('voice');

/**
 * The microphone, asked of the browser (its own prompt) unless already granted: a stream opened only for that, closed
 * at once — the recognition opens its own. 'granted'; 'denied' (refused now or before: the browser no longer asks);
 * 'none' (no microphone); 'unknown' (no way to ask here: the recognition will, if anything).
 * @returns {Promise<'granted' | 'denied' | 'none' | 'unknown'>}
 */
export async function askMicrophone() {
  try {
    const status = await navigator.permissions?.query({ name: /** @type {PermissionName} */ ('microphone') });
    if (status?.state === 'granted') return 'granted';
    if (status?.state === 'denied') return 'denied';
  } catch { /* 'microphone' unknown to this browser's permissions: asked below */ }
  if (!navigator.mediaDevices?.getUserMedia) return 'unknown';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    // The microphone let go before the recognition takes it (Android would otherwise find it busy).
    await new Promise(resolve => setTimeout(resolve, 150));
    return 'granted';
  } catch (error) {
    const name = /** @type {any} */ (error)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'none';
    return 'unknown';
  }
}

/** What to say when the browser refuses the microphone: where to allow it again. */
export const MIC_BLOCKED = 'Micro bloqué pour ce site : autorisez-le dans les réglages du navigateur (le cadenas ou ⓘ à gauche de l’adresse), puis touchez à nouveau.';

/**
 * Listens once (until a pause). `onText(text, final)` gets the interim then the final transcript;
 * `onEnd(error?)` is called once, whatever happens; `onStart()` when the microphone is really open (the
 * system's speech input: Android's or iOS's, through the browser). Returns a function that stops listening.
 * @param {(text: string, final: boolean) => void} onText
 * @param {(error?: string) => void} [onEnd]
 * @param {() => void} [onStart]
 */
export function listen(onText, onEnd = () => {}, onStart = () => {}) {
  if (!Recognition) { onEnd('unsupported'); return () => {}; }
  const recognition = new Recognition();
  recognition.lang = 'fr-FR';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  let ended = false;
  /** @type {string | undefined} */
  let failure;
  recognition.onresult = (/** @type {any} */ event) => {
    let text = '';
    let final = false;
    for (const result of event.results) {
      text += result[0].transcript;
      final = result.isFinal;
    }
    // Spoken queries end with a full stop on some engines.
    onText(text.trim().replace(/[.!?]$/, ''), final);
  };
  recognition.onerror = (/** @type {any} */ event) => { failure = event.error || 'error'; };
  recognition.onaudiostart = () => onStart();
  recognition.onend = () => {
    if (ended) return;
    ended = true;
    onEnd(failure);
  };
  try {
    recognition.start();
  } catch {
    ended = true;
    onEnd('start');
  }
  return () => { try { recognition.stop(); } catch { /* already stopped */ } };
}

/** What to tell the user when listening failed. @param {string | undefined} error */
export function voiceError(error) {
  if (!error || error === 'aborted' || error === 'no-speech') return error === 'no-speech' ? 'Rien entendu.' : null;
  if (error === 'not-allowed') return MIC_BLOCKED;
  if (error === 'service-not-allowed') return 'Dictée refusée par le navigateur (autorisez la reconnaissance vocale dans ses réglages).';
  if (error === 'audio-capture') return 'Micro indisponible (déjà utilisé, ou absent).';
  if (error === 'network') return 'Dictée indisponible hors ligne.';
  return 'Dictée impossible.';
}
