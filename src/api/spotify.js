/**
 * Song search, browser side.
 *
 * The browser never talks to Spotify directly. The Client Credentials
 * flow needs a client SECRET, and anything shipped to the browser can be
 * read by anyone. So we call our own tiny server function
 * (api/spotify-search.js) which holds the secret and forwards the search.
 */

/**
 * @param {string} query free text, for example "bloom the paper kites"
 * @param {AbortSignal} [signal] lets the caller cancel a search that is no longer wanted
 * @returns {Promise<Array<{id, title, artist, album, previewUrl, source}>>}
 */
export async function searchTracks(query, signal) {
  // encodeURIComponent makes characters like & or ? safe inside a URL.
  const response = await fetch(`/api/spotify-search?q=${encodeURIComponent(query)}`, { signal });

  // fetch only rejects on network failure. A 404 or 500 still resolves,
  // so the status has to be checked by hand.
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Song search failed (${response.status}).`);
  }

  const { tracks } = await response.json();
  return tracks;
}
