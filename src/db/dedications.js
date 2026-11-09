/**
 * CRUD for the secret dedication feed.
 *
 * Nothing here checks "is the user allowed?". That is deliberate: the
 * browser cannot be trusted to enforce rules, so the database does it
 * (Row Level Security in supabase/schema.sql). If a guest somehow called
 * these functions, Postgres would simply return no rows or refuse.
 */
import { supabase, unwrap } from '../api/supabaseClient.js';

// `author:profiles(...)` follows the author_id foreign key and nests the
// matching profile inside each row as `author` - a join, written inline.
const DEDICATION_COLUMNS = `
  id, title, artist, audio_url, lyrics_snippet, custom_title, note,
  is_archived, created_at, updated_at, author_id,
  author:profiles ( username, display_name )
`;

/** READ - newest first. Archived posts are left out unless asked for. */
export async function fetchDedications({ includeArchived = false } = {}) {
  // The query builder is chainable and nothing is sent until it is awaited,
  // so conditions can be added step by step.
  let query = supabase.from('dedications').select(DEDICATION_COLUMNS).order('created_at', { ascending: false });
  if (!includeArchived) query = query.eq('is_archived', false);
  return unwrap(await query);
}

/** CREATE - author_id is filled in by the database from the session (default auth.uid()). */
export async function createDedication({ title, artist, audioUrl, lyricsSnippet, customTitle, note }) {
  return unwrap(
    await supabase
      .from('dedications')
      .insert({
        title,
        artist,
        audio_url: audioUrl || null,
        lyrics_snippet: lyricsSnippet || null,
        custom_title: customTitle || null,
        note: note || null,
      })
      .select(DEDICATION_COLUMNS)
      .single(),
  );
}

/**
 * UPDATE - change the note.
 * The edit history is NOT written from here. A database trigger copies the
 * old and new note into dedication_edit_logs in the same transaction, so
 * the update and its log entry either both happen or neither does.
 */
export async function updateDedicationNote(id, note) {
  return unwrap(
    await supabase
      .from('dedications')
      .update({ note: note || null })
      .eq('id', id)
      .select(DEDICATION_COLUMNS)
      .single(),
  );
}

/** ARCHIVE / RESTORE - a "soft delete": the row stays, it is only hidden. */
export async function setDedicationArchived(id, isArchived) {
  return unwrap(
    await supabase
      .from('dedications')
      .update({ is_archived: isArchived })
      .eq('id', id)
      .select('id')
      .single(),
  );
}

/** DELETE - permanent. The edit history goes with it (on delete cascade). */
export async function deleteDedication(id) {
  // .select() makes Supabase return the deleted rows. An empty result means
  // RLS filtered the row out, i.e. you are not the author.
  const deleted = unwrap(await supabase.from('dedications').delete().eq('id', id).select('id'));
  if (deleted.length === 0) throw new Error('Only the author can delete this dedication.');
}

/** The note's edit history, newest first. */
export async function fetchEditLogs(dedicationId) {
  return unwrap(
    await supabase
      .from('dedication_edit_logs')
      .select('id, previous_note, new_note, edited_at')
      .eq('dedication_id', dedicationId)
      .order('edited_at', { ascending: false }),
  );
}
