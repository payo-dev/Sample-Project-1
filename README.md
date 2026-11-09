# Liner Notes

A small music space for two people: public music profiles for guests, and a
private feed of songs dedicated to each other.

Vanilla JavaScript (ES modules), vanilla CSS, Supabase, deployed on Vercel.
No framework and no bundler.

## File tree

```
index.html                    the single page; every route renders into <main id="view">
styles/
  tokens.css                  ALL colours, fonts and spacing as CSS variables (edit to re-theme)
  base.css                    reset, typography, header and page frame
  components.css              buttons, cards, forms, audio player, dedication cards
src/
  app.js                      entry point: routing, session UI, event wiring
  config.js                   GENERATED from .env, git-ignored
  api/
    supabaseClient.js         the one shared Supabase client
    spotify.js                browser-side call to our own /api/spotify-search
  auth/
    auth.js                   sign in, sign out, session restore, "auth:changed" event
  db/
    profiles.js               profiles, Top 10 lists, guest suggestions, passcode check
    dedications.js            CRUD for the secret feed and its edit history
  components/
    audioPlayer.js            custom HTML5 audio player
    profileView.js            public profile page
    dedicationsView.js        composer, song search and the feed
  utils/
    dom.js                    el() element builder, formatters, error helpers
api/
  spotify-search.js           Vercel serverless function (keeps the Spotify secret off the browser)
scripts/
  build-config.mjs            writes src/config.js from environment variables
  dev-server.mjs              zero-dependency local server
supabase/
  schema.sql                  tables, trigger, Row Level Security, seed
vercel.json
```

## Routes

| URL                   | Who     | What                                            |
| --------------------- | ------- | ----------------------------------------------- |
| `/?profile=machukaw`  | anyone  | Music profile (the default)                     |
| `/?profile=novyyzhv`  | anyone  | Music profile                                   |
| `/?view=ours`         | admins  | Dedication feed; the link appears after sign-in |

## Setup

### 1. Supabase

1. Create a project at supabase.com.
2. **SQL Editor**: paste and run `supabase/schema.sql`.
3. **Authentication > Users > Add user**: create the two accounts (tick "Auto Confirm").
4. **Authentication > Sign In / Providers**: turn off "Allow new users to sign up".
5. Back in the SQL Editor, run the seed statements at the bottom of
   `schema.sql` with your two emails filled in. This links each login to
   its profile, and that row is what makes a user an admin.
6. Optional: run the passcode statement from the same seed block.

The Top 10 lists are filled in from the Supabase **Table Editor**
(`music_favorites`) or with SQL. An in-app editor for them is a good next
feature to build yourself: the RLS policy for it already exists.

### 2. Run it locally

Requires Node 22 or newer. There is nothing to `npm install`.

```bash
cp .env.example .env
```

Fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Supabase > Project Settings >
API), then:

```bash
npm run dev
```

Open http://localhost:5173.

### 3. Spotify (optional)

Song search works without it, using the iTunes catalogue. To search
Spotify instead, create an app at developer.spotify.com/dashboard and put
its Client ID and Client Secret in `.env`.

Two things worth knowing:

- The Client Credentials flow needs a **secret**, so it cannot run in the
  browser. That is why `api/spotify-search.js` exists.
- Spotify stopped returning `preview_url` for most apps created after
  November 2024. When a track comes back without one, the function looks
  the song up on iTunes and uses that 30-second preview. You can also paste
  any `https://` audio link into the form by hand.

## Deploying to Vercel

1. Push this repository to GitHub.
2. vercel.com > **Add New > Project** > import the repository. Leave every
   build setting alone; `vercel.json` already sets them.
3. **Settings > Environment Variables**, add for Production and Preview:

   | Name                    | Required | Reaches the browser |
   | ----------------------- | -------- | ------------------- |
   | `SUPABASE_URL`          | yes      | yes (public)        |
   | `SUPABASE_ANON_KEY`     | yes      | yes (public)        |
   | `SPOTIFY_CLIENT_ID`     | no       | no                  |
   | `SPOTIFY_CLIENT_SECRET` | no       | no                  |

4. Deploy. The build command (`node scripts/build-config.mjs`) writes
   `src/config.js`; the deployment fails on purpose if the two Supabase
   values are missing.
5. In Supabase > **Authentication > URL Configuration**, set the Site URL
   to your Vercel domain.

Changing an environment variable needs a redeploy to take effect.

## How security works here

- The anon key is public by design. **Row Level Security is the only real
  protection**, and it lives in `schema.sql`. Never put the `service_role`
  key in this project.
- Dedications and their edit logs are readable only by users who own a
  `profiles` row. Only the author can edit, archive or delete a dedication.
- Guests can insert a recommendation but cannot read any.
- The edit history is written by a database trigger, not by the browser,
  so it cannot be skipped.
- The guest passcode is a **soft gate**. It is checked in the database and
  never sent to the browser, but profiles and Top 10 lists are publicly
  readable by design, so someone technical could query them without it.
  Treat it as a welcome mat, not a lock. The private feed does not depend
  on it.

## Theming

Edit `styles/tokens.css`. To try the included light theme, change the
first line of `index.html` to `<html lang="en" data-theme="daylight">`.

## JavaScript patterns to look for

| Pattern                         | Where                                                          |
| ------------------------------- | -------------------------------------------------------------- |
| ES modules as singletons        | `src/api/supabaseClient.js`                                    |
| Closures for private state      | `auth.js` (`currentAdmin`), `audioPlayer.js`, `debounce`       |
| Factory functions               | `createAudioPlayer`                                            |
| Event delegation                | feed buttons and search results in `dedicationsView.js`; links in `app.js` |
| Custom events                   | `auth:changed` in `auth.js`, `player:play` in `audioPlayer.js` |
| async/await with try/catch/finally | `withBusy` in `dom.js`, every view                          |
| Cancelling stale requests       | `AbortController` in `dedicationsView.js`; the `stage` element in `app.js` |
| History API routing             | `bindNavigation` in `app.js`                                   |
| Safe DOM building (no XSS)      | `el()` in `dom.js`                                             |
