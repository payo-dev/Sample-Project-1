/**
 * Authentication state for the two admins.
 *
 * This module owns one piece of state, `currentAdmin`, and tells the rest
 * of the app when it changes by dispatching a custom DOM event. Nothing
 * else needs to know how Supabase Auth works.
 */
import { supabase, unwrap } from '../api/supabaseClient.js';

/** Event name other modules listen for: document.addEventListener(AUTH_CHANGED, ...) */
export const AUTH_CHANGED = 'auth:changed';

// Module-level variable. It is private to this file because it is not
// exported; the exported functions below "close over" it. That is a
// closure doing the job a private class field would do.
let currentAdmin = null;

// True while signIn() is doing its own bookkeeping, so the background
// listener below does not process the same login a second time.
let signingIn = false;

/** The signed-in partner's profile ({ id, username, display_name }) or null. */
export function getAdmin() {
  return currentAdmin;
}

/**
 * Being logged in is not enough: the user must also own a row in
 * `profiles`. That row is what makes someone one of the two admins.
 */
async function loadAdminProfile(userId) {
  return unwrap(
    await supabase.from('profiles').select('id, username, display_name').eq('id', userId).maybeSingle(),
  );
}

function announce() {
  // CustomEvent carries data in `detail`. Listeners stay decoupled from this file.
  document.dispatchEvent(new CustomEvent(AUTH_CHANGED, { detail: { admin: currentAdmin } }));
}

/**
 * Call once at startup. Restores a saved session (Supabase keeps it in
 * localStorage) and starts watching for later changes, such as a sign-out
 * in another tab or an expired session.
 */
export async function initAuth() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    currentAdmin = await loadAdminProfile(data.session.user.id).catch(() => null);
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    // Supabase warns against awaiting its own API inside this callback
    // (it can deadlock). setTimeout(..., 0) moves our work to a fresh
    // task that runs after the callback has returned.
    setTimeout(async () => {
      if (signingIn) return;
      const nextId = session?.user?.id ?? null;
      const currentId = currentAdmin?.id ?? null;
      if (nextId === currentId) return; // token refresh etc: nothing visible changed

      currentAdmin = nextId ? await loadAdminProfile(nextId).catch(() => null) : null;
      announce();
    }, 0);
  });

  return currentAdmin;
}

/** Sign in with email and password. Throws an Error with a readable message on failure. */
export async function signIn(email, password) {
  signingIn = true;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('That email and password do not match.');

    const profile = await loadAdminProfile(data.user.id);
    if (!profile) {
      // A valid account that is not one of the two partners.
      await supabase.auth.signOut();
      throw new Error('This account does not have access.');
    }

    currentAdmin = profile;
    announce();
    return profile;
  } finally {
    signingIn = false;
  }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
  currentAdmin = null;
  announce();
}
