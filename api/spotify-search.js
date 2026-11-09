/**
 * GET /api/spotify-search?q=...
 *
 * A Vercel Serverless Function: any file in /api becomes an HTTP endpoint.
 * It runs on the server (Node.js), so it may use secrets that the browser
 * must never see. scripts/dev-server.mjs runs the same file locally.
 *
 * Flow:
 *   1. Trade the client id + secret for a short-lived access token
 *      (the Spotify "Client Credentials" flow), and cache it.
 *   2. Search Spotify for tracks.
 *   3. Spotify stopped returning preview_url for most apps created after
 *      November 2024, so any track without one is looked up in the public
 *      iTunes Search API, which still serves 30-second previews.
 *
 * Without Spotify credentials the function searches iTunes only, so the
 * feature works before you have registered a Spotify app.
 */

const RESULT_LIMIT = 6;

// Module scope survives between requests while the function stays "warm",
// so the token is requested about once an hour instead of on every search.
let cachedToken = null; // { value, expiresAt }

async function getSpotifyToken(clientId, clientSecret) {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      // HTTP Basic auth: base64 of "id:secret".
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error(`Spotify token request failed (${response.status})`);

  const { access_token: value, expires_in: lifetimeSeconds } = await response.json();
  // Refresh one minute early so a token never expires mid-request.
  cachedToken = { value, expiresAt: Date.now() + (lifetimeSeconds - 60) * 1000 };
  return value;
}

async function searchSpotify(query, token) {
  const url = new URL('https://api.spotify.com/v1/search');
  // URLSearchParams handles the encoding of spaces and symbols for us.
  url.search = new URLSearchParams({ q: query, type: 'track', limit: RESULT_LIMIT });

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Spotify search failed (${response.status})`);

  const { tracks } = await response.json();
  return tracks.items.map((track) => ({
    id: track.id,
    title: track.name,
    artist: track.artists.map((artist) => artist.name).join(', '),
    album: track.album?.name ?? '',
    previewUrl: track.preview_url ?? null,
    source: 'spotify',
  }));
}

async function searchItunes(query, limit = RESULT_LIMIT) {
  const url = new URL('https://itunes.apple.com/search');
  url.search = new URLSearchParams({ term: query, media: 'music', entity: 'song', limit });

  const response = await fetch(url);
  if (!response.ok) throw new Error(`iTunes search failed (${response.status})`);

  const { results } = await response.json();
  return results.map((song) => ({
    id: String(song.trackId),
    title: song.trackName,
    artist: song.artistName,
    album: song.collectionName ?? '',
    previewUrl: song.previewUrl ?? null,
    source: 'itunes',
  }));
}

/** Fill in missing previews. A failed lookup just leaves that track without one. */
async function addMissingPreviews(tracks) {
  return Promise.all(
    tracks.map(async (track) => {
      if (track.previewUrl) return track;
      const [match] = await searchItunes(`${track.title} ${track.artist}`, 1).catch(() => []);
      return match?.previewUrl ? { ...track, previewUrl: match.previewUrl } : track;
    }),
  );
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Use GET.' });

  // req.url is only a path ("/api/spotify-search?q=..."); the second
  // argument gives URL() the base it needs to parse it.
  const query = new URL(req.url, 'http://localhost').searchParams.get('q')?.trim() ?? '';
  if (query.length < 2 || query.length > 120) {
    return sendJson(res, 400, { error: 'Search for between 2 and 120 characters.' });
  }

  const { SPOTIFY_CLIENT_ID: clientId, SPOTIFY_CLIENT_SECRET: clientSecret } = process.env;

  try {
    let tracks;
    if (clientId && clientSecret) {
      const token = await getSpotifyToken(clientId, clientSecret);
      tracks = await addMissingPreviews(await searchSpotify(query, token));
    } else {
      tracks = await searchItunes(query);
    }

    // Let Vercel's CDN reuse the answer for the same query for an hour.
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return sendJson(res, 200, { tracks });
  } catch (error) {
    console.error(error);
    return sendJson(res, 502, { error: 'The song search service is unavailable right now.' });
  }
}
