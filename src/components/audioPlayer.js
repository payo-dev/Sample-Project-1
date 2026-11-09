/**
 * A small custom audio player for 30-second previews.
 *
 * createAudioPlayer() is a factory function: every call builds a fresh
 * set of elements plus one Audio object, and the event handlers inside
 * keep access to them through closure. No classes, no global state.
 *
 * The <audio> element (here created with `new Audio()`) does the real
 * work. We only build our own buttons and keep them in sync by listening
 * to the events it fires: loadedmetadata, timeupdate, play, pause, ended,
 * waiting, canplay and error.
 */
import { el, formatTime } from '../utils/dom.js';

const PLAYER_PLAY = 'player:play';

// Static, hand-written markup, so innerHTML is safe for these two icons.
const ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>';

/** Pause every player on the page. Called before a view is re-rendered. */
export function stopAllPlayers() {
  document.dispatchEvent(new CustomEvent(PLAYER_PLAY, { detail: { audio: null } }));
}

/**
 * @param {string} src   URL of the audio file
 * @param {string} label spoken by screen readers, e.g. the song title
 * @returns {HTMLElement} the player, ready to be appended anywhere
 */
export function createAudioPlayer(src, label = 'preview') {
  const audio = new Audio();
  audio.preload = 'metadata'; // fetch only the duration up front, not the whole file

  const toggle = el('button', { class: 'player__toggle', type: 'button', 'aria-label': `Play ${label}` });
  toggle.innerHTML = ICON_PLAY;

  const scrub = el('input', {
    class: 'player__scrub',
    type: 'range',
    min: 0,
    max: 30,
    step: 0.1,
    value: 0,
    'aria-label': `Seek ${label}`,
  });

  const time = el('span', { class: 'player__time', text: '0:00 / 0:30' });
  const root = el('div', { class: 'player' }, toggle, scrub, time);

  /** Redraw the bar and the clock from the audio element's current state. */
  function renderProgress() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 30;
    scrub.max = duration;
    scrub.value = audio.currentTime;
    // A CSS variable carries the percentage to the stylesheet, which paints
    // the played part of the track (see .player__scrub in components.css).
    scrub.style.setProperty('--progress', `${(audio.currentTime / duration) * 100}%`);
    time.textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
  }

  function renderToggle() {
    const playing = !audio.paused;
    toggle.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    toggle.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${label}`);
  }

  function showError(message) {
    toggle.disabled = true;
    scrub.disabled = true;
    root.classList.add('player--error');
    if (!root.querySelector('.player__error')) {
      root.append(el('p', { class: 'player__error', role: 'alert', text: message }));
    }
  }

  // ---- User actions -------------------------------------------------

  toggle.addEventListener('click', async () => {
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      // play() returns a promise. It rejects when the browser blocks
      // playback or the file cannot be loaded.
      await audio.play();
    } catch (error) {
      // AbortError only means pause() interrupted a pending play(): not a real failure.
      if (error.name !== 'AbortError') showError('This preview could not be played.');
    }
  });

  // 'input' fires continuously while the thumb is dragged
  // ('change' would fire only once, on release).
  scrub.addEventListener('input', () => {
    audio.currentTime = Number(scrub.value);
    renderProgress();
  });

  // ---- Audio element events ----------------------------------------

  audio.addEventListener('loadedmetadata', renderProgress);
  audio.addEventListener('timeupdate', renderProgress);
  audio.addEventListener('pause', renderToggle);
  audio.addEventListener('waiting', () => { time.textContent = 'Loading...'; });
  audio.addEventListener('canplay', renderProgress);

  audio.addEventListener('play', () => {
    renderToggle();
    // Tell every other player that this one has started.
    document.dispatchEvent(new CustomEvent(PLAYER_PLAY, { detail: { audio } }));
  });

  audio.addEventListener('ended', () => {
    audio.currentTime = 0;
    renderProgress();
    renderToggle();
  });

  // Fires for a dead link, an unsupported format or a network failure.
  audio.addEventListener('error', () => showError('This preview is no longer available.'));

  // ---- Only one player at a time -----------------------------------
  // Players do not know about each other. Each listens on `document` for
  // the shared event and pauses itself when someone else started.
  function onAnyPlayerPlay(event) {
    if (event.detail.audio !== audio) audio.pause();
    // A listener on `document` would keep this player alive forever, even
    // after its card was removed. Once we notice we are no longer in the
    // page, unsubscribe so the browser can free the memory.
    if (!root.isConnected) document.removeEventListener(PLAYER_PLAY, onAnyPlayerPlay);
  }
  document.addEventListener(PLAYER_PLAY, onAnyPlayerPlay);

  // Set src last, so no event can fire before its listener is attached.
  audio.src = src;
  return root;
}
