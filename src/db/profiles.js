/**
 * Data access for the public side: profiles, favorites lists, guest
 * recommendations and the optional guest passcode.
 *
 * Each function does one query and returns plain data. Keeping database
 * code out of the components means the UI never needs to know table names.
 */
import { supabase, unwrap } from '../api/supabaseClient.js';

/** The two valid ?profile= values. Object.freeze makes the array read-only. */
export const PROFILE_USERNAMES = Object.freeze(['machukaw', 'novyyzhv']);

/** @returns the profile row, or null when it has not been created yet. */
export async function fetchProfile(username) {
  return unwrap(
    await supabase
      .from('profiles')
      .select('id, username, display_name, tagline')
      .eq('username', username)
      .maybeSingle(), // "zero or one row" - returns null instead of an error for zero
  );
}

/**
 * All three lists for one profile, grouped by category:
 *   { favorite_song: [...], top_artist: [...], top_liked: [...] }
 */
export async function fetchFavorites(profileId) {
  const rows = unwrap(
    await supabase
      .from('music_favorites')
      .select('id, category, position, title, artist')
      .eq('profile_id', profileId)
      .order('position'),
  );

  // reduce() folds an array into one value. Here: an object of arrays.
  // `??=` assigns only when the left side is null or undefined.
  return rows.reduce((groups, row) => {
    (groups[row.category] ??= []).push(row);
    return groups;
  }, {});
}

/**
 * Ask the database whether a guest may enter.
 * Call with no argument to ask "is there a passcode at all?":
 * true means the site is open. The passcode itself never reaches the browser.
 */
export async function checkGuestPasscode(attempt = null) {
  return unwrap(await supabase.rpc('check_guest_passcode', { attempt }));
}

/** Insert a guest's song suggestion. Guests may insert but not read (see RLS). */
export async function submitRecommendation({ profileId, guestName, songTitle, artist, message }) {
  // No .select() after insert: guests have no read permission, so asking
  // for the new row back would be rejected by Row Level Security.
  unwrap(
    await supabase.from('recommendations').insert({
      profile_id: profileId,
      guest_name: guestName || null,
      song_title: songTitle,
      artist: artist || null,
      message: message || null,
    }),
  );
}

/** Admin only: suggestions guests left on one profile, newest first. */
export async function fetchRecommendations(profileId) {
  return unwrap(
    await supabase
      .from('recommendations')
      .select('id, guest_name, song_title, artist, message, created_at')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false }),
  );
}
