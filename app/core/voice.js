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
 * Listens once (until a pause). `onText(text, final)` gets the interim then the final transcript;
 * `onEnd(error?)` is called once, whatever happens. Returns a function that stops listening.
 * @param {(text: string, final: boolean) => void} onText
 * @param {(error?: string) => void} [onEnd]
 */
export function listen(onText, onEnd = () => {}) {
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
  if (error === 'not-allowed' || error === 'service-not-allowed') return 'Micro refusé (autorisez-le dans le navigateur).';
  if (error === 'network') return 'Dictée indisponible hors ligne.';
  return 'Dictée impossible.';
}
