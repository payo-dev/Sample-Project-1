/**
 * Small DOM helpers shared by every component.
 *
 * Why not innerHTML? Notes, lyrics and guest messages are typed by people.
 * If we glued them into an HTML string, a message like "<img onerror=...>"
 * would run as code (an XSS attack). Creating elements and assigning
 * textContent treats everything as plain text, so that cannot happen.
 */

/**
 * Create an element in one call.
 *
 *   el('a', { class: 'nav__link', href: '/', text: 'Home' })
 *   el('ul', { class: 'list' }, items.map((item) => el('li', { text: item })))
 *
 * `...children` is a rest parameter: all remaining arguments arrive as an
 * array. flat() lets callers pass arrays (from .map) next to single nodes.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    // Real DOM properties (type, value, required, hidden...) are set directly;
    // anything else (aria-label, for...) becomes an HTML attribute.
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }

  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

/** A centred one-line message used for loading, empty and error states. */
export function statusMessage(text, { error = false } = {}) {
  return el('p', {
    class: error ? 'status status--error' : 'status',
    role: error ? 'alert' : 'status',
    text,
  });
}

/** 75.4 -> "1:15". Number.isFinite guards against NaN before audio metadata loads. */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// Intl.DateTimeFormat is built into the browser and formats dates in the
// visitor's own language and time zone. Creating it once and reusing it is
// cheaper than building a new formatter for every card.
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(isoString) {
  return dateFormatter.format(new Date(isoString));
}

/**
 * Turn any thrown value into a sentence fit for the UI.
 * fetch() rejects with a TypeError when the network itself fails
 * (offline, DNS, blocked), which deserves a friendlier message.
 */
export function describeError(error) {
  if (error instanceof TypeError) return 'Could not reach the server. Check your connection and try again.';
  return error?.message || 'Something went wrong. Please try again.';
}

/**
 * Run an async action while a button is disabled, so a double click
 * cannot fire it twice. try/finally guarantees the button is re-enabled
 * whether the action succeeds or throws.
 */
export async function withBusy(button, action) {
  button.disabled = true;
  try {
    return await action();
  } finally {
    button.disabled = false;
  }
}
