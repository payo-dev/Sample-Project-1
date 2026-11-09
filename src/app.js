/**
 * Entry point. Three jobs:
 *   1. Routing  - decide which view the URL asks for
 *   2. Session  - keep the header in sync with who is signed in
 *   3. Wiring   - connect the header buttons and the login dialog
 *
 * Routes (all served by index.html):
 *   /?profile=machukaw   public profile (default)
 *   /?profile=novyyzhv   public profile
 *   /?view=ours          the secret dedication space, admins only
 */
import { isConfigured } from './api/supabaseClient.js';
import { initAuth, getAdmin, signIn, signOut, AUTH_CHANGED } from './auth/auth.js';
import { PROFILE_USERNAMES, checkGuestPasscode } from './db/profiles.js';
import { renderProfileView } from './components/profileView.js';
import { renderDedicationsView } from './components/dedicationsView.js';
import { stopAllPlayers } from './components/audioPlayer.js';
import { el, statusMessage, describeError, withBusy } from './utils/dom.js';

const GUEST_UNLOCKED_KEY = 'liner-notes:guest-unlocked';

const view = document.querySelector('#view');
const authButton = document.querySelector('#auth-button');
const sessionWho = document.querySelector('#session-who');
const oursLink = document.querySelector('#ours-link');
const loginDialog = document.querySelector('#login-dialog');
const loginForm = document.querySelector('#login-form');
const loginError = document.querySelector('#login-error');

// ---------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------

/** Turn the current URL into a small description of what to show. */
function readRoute() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('view') === 'ours') return { name: 'ours' };

  const requested = params.get('profile');
  // Never trust the URL: unknown names fall back to the first profile.
  const username = PROFILE_USERNAMES.includes(requested) ? requested : PROFILE_USERNAMES[0];
  return { name: 'profile', username };
}

/** Header state: highlight the current link, show or hide admin-only parts. */
function updateHeader(route, admin) {
  const current = route.name === 'ours' ? 'ours' : route.username;
  for (const link of document.querySelectorAll('.nav__link')) {
    if (link.dataset.route === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  oursLink.hidden = !admin;
  sessionWho.hidden = !admin;
  sessionWho.textContent = admin ? `Signed in as ${admin.display_name}` : '';
  authButton.textContent = admin ? 'Sign out' : 'Sign in';
}

// ---------------------------------------------------------------------
// Guest passcode gate
// ---------------------------------------------------------------------

/** sessionStorage lasts until the tab closes. It can throw in private modes, hence try/catch. */
function guestIsUnlocked() {
  try {
    return sessionStorage.getItem(GUEST_UNLOCKED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberGuestUnlocked() {
  try {
    sessionStorage.setItem(GUEST_UNLOCKED_KEY, '1');
  } catch {
    /* the guest will simply be asked again on reload */
  }
}

function gateView() {
  const input = el('input', { class: 'field__input', type: 'password', required: true, autocomplete: 'off' });
  const error = el('p', { class: 'form__error', role: 'alert', hidden: true });
  const submit = el('button', { class: 'btn', type: 'submit', text: 'Come in' });

  const form = el(
    'form',
    { class: 'form' },
    el('label', { class: 'field' }, el('span', { class: 'field__label', text: 'Passcode' }), input),
    error,
    el('div', { class: 'form__actions' }, submit),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    await withBusy(submit, async () => {
      try {
        if (await checkGuestPasscode(input.value)) {
          rememberGuestUnlocked();
          render();
          return;
        }
        error.textContent = 'Not quite. Ask one of us for the words.';
      } catch (err) {
        error.textContent = describeError(err);
      }
      error.hidden = false;
      input.select();
    });
  });

  return el(
    'section',
    { class: 'card card--narrow stack' },
    el('p', { class: 'eyebrow', text: 'By invitation' }),
    el('h1', { text: 'Every collection has a key' }),
    el('p', { class: 'muted', text: 'Enter the passcode we shared with you to look through ours.' }),
    form,
  );
}

// ---------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------

/**
 * Draw the view for the current URL and session.
 *
 * Views load data asynchronously, so two renders can overlap (click one
 * profile, then quickly the other). To stop the slower, older one from
 * painting over the newer one, every render gets its own fresh `stage`
 * element. A stale render keeps writing into a stage that is no longer
 * in the page, which is harmless.
 */
async function render() {
  stopAllPlayers();
  const route = readRoute();
  const admin = getAdmin();
  updateHeader(route, admin);

  const stage = el('div');
  view.replaceChildren(stage);

  if (route.name === 'ours') {
    if (!admin) {
      stage.replaceChildren(
        el(
          'section',
          { class: 'card card--narrow stack' },
          el('h1', { text: 'This part is ours' }),
          el('p', { class: 'muted', text: 'Sign in to open the dedication space.' }),
        ),
      );
      return;
    }
    await renderDedicationsView(stage, admin);
    return;
  }

  if (!admin && !guestIsUnlocked()) {
    stage.replaceChildren(statusMessage('Loading...'));
    try {
      // Called without an attempt, the database answers "is the site open?".
      if (await checkGuestPasscode()) rememberGuestUnlocked();
      else {
        stage.replaceChildren(gateView());
        return;
      }
    } catch (error) {
      stage.replaceChildren(statusMessage(describeError(error), { error: true }));
      return;
    }
  }

  await renderProfileView(stage, route.username, admin);
}

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

function bindNavigation() {
  // Delegated on document: handles every <a data-link>, present or future.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-link]');
    if (!link) return;
    // Let the browser handle ctrl/cmd/middle click (open in new tab).
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;

    event.preventDefault();
    // pushState changes the address bar without reloading the page...
    window.history.pushState({}, '', link.href);
    render();
  });

  // ...and popstate fires when the user presses Back or Forward.
  window.addEventListener('popstate', render);
}

function bindAuth() {
  authButton.addEventListener('click', async () => {
    if (!getAdmin()) {
      loginError.hidden = true;
      loginDialog.showModal();
      return;
    }
    await withBusy(authButton, () => signOut().catch((error) => window.alert(describeError(error))));
  });

  document.querySelector('#login-cancel').addEventListener('click', () => loginDialog.close());

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.hidden = true;
    const submit = loginForm.querySelector('[type="submit"]');
    const { email, password } = Object.fromEntries(new FormData(loginForm));

    await withBusy(submit, async () => {
      try {
        await signIn(email.trim(), password);
        loginForm.reset();
        loginDialog.close();
      } catch (error) {
        loginError.textContent = describeError(error);
        loginError.hidden = false;
      }
    });
  });

  // auth.js fires this on sign in, sign out and session expiry.
  // Re-rendering is all it takes to switch between guest and admin UI.
  document.addEventListener(AUTH_CHANGED, render);
}

function setupNotice() {
  return el(
    'section',
    { class: 'card card--narrow stack' },
    el('p', { class: 'eyebrow', text: 'Setup needed' }),
    el('h1', { text: 'Connect Supabase' }),
    el('p', {
      class: 'muted',
      text: 'Add SUPABASE_URL and SUPABASE_ANON_KEY to a .env file, then restart with "npm run dev". The README walks through it.',
    }),
  );
}

async function start() {
  if (!isConfigured) {
    authButton.hidden = true;
    view.replaceChildren(setupNotice());
    return;
  }

  bindNavigation();
  bindAuth();

  try {
    await initAuth();
  } catch (error) {
    view.replaceChildren(statusMessage(describeError(error), { error: true }));
    return;
  }
  await render();
}

start();
