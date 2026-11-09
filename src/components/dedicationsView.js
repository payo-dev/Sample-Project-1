/**
 * The secret dedication space: a composer (with song search) and the feed.
 */
import { el, statusMessage, formatDate, describeError, withBusy } from '../utils/dom.js';
import { createAudioPlayer, stopAllPlayers } from './audioPlayer.js';
import { searchTracks } from '../api/spotify.js';
import {
  fetchDedications,
  createDedication,
  updateDedicationNote,
  setDedicationArchived,
  deleteDedication,
  fetchEditLogs,
} from '../db/dedications.js';

/**
 * Debounce: wrap a function so it only runs once the calls have stopped
 * for `delay` ms. Typing "bloom" then triggers one search, not five.
 * `timer` survives between calls because the returned function closes over it.
 */
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const field = (label, input) =>
  el('label', { class: 'field' }, el('span', { class: 'field__label', text: label }), input);

// ---------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------

function buildComposer(onCreated) {
  const inputs = {
    title: el('input', { class: 'field__input', name: 'title', required: true, maxLength: 200 }),
    artist: el('input', { class: 'field__input', name: 'artist', required: true, maxLength: 200 }),
    audioUrl: el('input', { class: 'field__input', name: 'audioUrl', type: 'url', placeholder: 'https://' }),
    customTitle: el('input', { class: 'field__input', name: 'customTitle', maxLength: 120 }),
    lyricsSnippet: el('textarea', { class: 'field__input', name: 'lyricsSnippet', maxLength: 600 }),
    note: el('textarea', { class: 'field__input', name: 'note', maxLength: 4000 }),
  };

  const searchInput = el('input', {
    class: 'field__input',
    type: 'search',
    placeholder: 'Song title, artist...',
    autocomplete: 'off',
  });
  const searchStatus = el('p', { class: 'muted', role: 'status', hidden: true });
  const results = el('ul', { class: 'results' });
  const previewSlot = el('div');
  const error = el('p', { class: 'form__error', role: 'alert', hidden: true });
  const submit = el('button', { class: 'btn', type: 'submit', text: 'Send dedication' });

  let foundTracks = [];
  let activeSearch = null; // AbortController of the request in flight

  function showPreview() {
    stopAllPlayers();
    const url = inputs.audioUrl.value.trim();
    previewSlot.replaceChildren(
      url.startsWith('https://') ? createAudioPlayer(url, inputs.title.value || 'preview') : '',
    );
  }

  async function runSearch(query) {
    // Cancel the previous request. Without this, a slow response for "blo"
    // could arrive after the one for "bloom" and overwrite the newer results.
    activeSearch?.abort();
    results.replaceChildren();
    foundTracks = [];

    if (query.length < 2) {
      searchStatus.hidden = true;
      return;
    }

    activeSearch = new AbortController();
    searchStatus.hidden = false;
    searchStatus.textContent = 'Searching...';

    try {
      foundTracks = await searchTracks(query, activeSearch.signal);
      searchStatus.textContent = foundTracks.length ? 'Pick a song to fill in the details.' : 'No songs found.';
      results.replaceChildren(
        ...foundTracks.map((track, index) =>
          el(
            'li',
            {},
            el(
              'button',
              { class: 'results__item', type: 'button', dataset: { index } },
              el('span', { text: track.title }, el('span', { class: 'results__artist', text: track.artist })),
              el('span', { class: 'results__badge', text: track.previewUrl ? 'Preview' : 'No preview' }),
            ),
          ),
        ),
      );
    } catch (err) {
      if (err.name === 'AbortError') return; // we cancelled it ourselves
      searchStatus.textContent = `${describeError(err)} You can still type the details by hand.`;
    }
  }

  searchInput.addEventListener('input', debounce(() => runSearch(searchInput.value.trim()), 350));

  // Event delegation: one listener on the list handles clicks on every
  // result, including ones added later. closest() walks up from whatever
  // was actually clicked (maybe a <span> inside the button) to the button.
  results.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-index]');
    if (!button) return;
    const track = foundTracks[Number(button.dataset.index)];
    inputs.title.value = track.title;
    inputs.artist.value = track.artist;
    inputs.audioUrl.value = track.previewUrl || '';
    results.replaceChildren();
    searchStatus.textContent = track.previewUrl
      ? `Selected "${track.title}".`
      : `Selected "${track.title}". No preview was found, so paste an audio link if you have one.`;
    showPreview();
  });

  inputs.audioUrl.addEventListener('change', showPreview);

  const form = el(
    'form',
    { class: 'form' },
    field('Find the song', searchInput),
    searchStatus,
    results,
    el('div', { class: 'form__row' }, field('Song title', inputs.title), field('Artist', inputs.artist)),
    field('Preview audio link (30 seconds)', inputs.audioUrl),
    previewSlot,
    field('Your own title (optional)', inputs.customTitle),
    field('The lyric that says it', inputs.lyricsSnippet),
    field('A note', inputs.note),
    error,
    el('div', { class: 'form__actions' }, submit),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;

    const audioUrl = inputs.audioUrl.value.trim();
    if (audioUrl && !audioUrl.startsWith('https://')) {
      error.textContent = 'The audio link must start with https://';
      error.hidden = false;
      return;
    }

    await withBusy(submit, async () => {
      try {
        await createDedication({
          title: inputs.title.value.trim(),
          artist: inputs.artist.value.trim(),
          audioUrl,
          customTitle: inputs.customTitle.value.trim(),
          lyricsSnippet: inputs.lyricsSnippet.value.trim(),
          note: inputs.note.value.trim(),
        });
        form.reset();
        previewSlot.replaceChildren();
        searchStatus.hidden = true;
        await onCreated();
      } catch (err) {
        error.textContent = describeError(err);
        error.hidden = false;
      }
    });
  });

  return el('section', { class: 'card stack' }, el('h2', { text: 'Dedicate a song' }), form);
}

// ---------------------------------------------------------------------
// One card in the feed
// ---------------------------------------------------------------------

function dedicationCard(dedication, admin) {
  const isAuthor = dedication.author_id === admin.id;
  const wasEdited = dedication.updated_at !== dedication.created_at;
  const authorName = dedication.author?.display_name ?? 'Someone';

  // data-action tells the single delegated click handler what to do.
  const action = (name, label, extraClass = '') =>
    el('button', {
      class: `btn btn--ghost btn--small ${extraClass}`.trim(),
      type: 'button',
      dataset: { action: name },
      text: label,
    });

  return el(
    'article',
    {
      class: dedication.is_archived ? 'card dedication dedication--archived' : 'card dedication',
      dataset: { id: dedication.id },
    },
    el(
      'header',
      {},
      el('p', { class: 'eyebrow', text: dedication.is_archived ? `From ${authorName} - archived` : `From ${authorName}` }),
      el('h3', { text: dedication.custom_title || dedication.title }),
      el('p', { class: 'dedication__track', text: `${dedication.title} - ${dedication.artist}` }),
    ),
    dedication.lyrics_snippet && el('blockquote', { class: 'quote', text: dedication.lyrics_snippet }),
    dedication.audio_url?.startsWith('https://') && createAudioPlayer(dedication.audio_url, dedication.title),
    el('p', { class: 'dedication__note', text: dedication.note || '', hidden: !dedication.note }),
    el(
      'p',
      { class: 'dedication__meta' },
      el('time', { dateTime: dedication.created_at, text: formatDate(dedication.created_at) }),
      wasEdited && el('span', { text: `Edited ${formatDate(dedication.updated_at)}` }),
    ),
    el(
      'div',
      { class: 'dedication__actions' },
      isAuthor && action('edit', 'Edit note'),
      wasEdited && action('history', 'Edit history'),
      isAuthor && action(dedication.is_archived ? 'restore' : 'archive', dedication.is_archived ? 'Restore' : 'Archive'),
      isAuthor && action('delete', 'Delete', 'btn--danger'),
    ),
    el('div', { class: 'dedication__extra' }),
  );
}

function historyList(logs) {
  if (logs.length === 0) return el('p', { class: 'muted', text: 'The note has not been edited.' });
  return el(
    'ul',
    { class: 'history' },
    logs.map((log) =>
      el(
        'li',
        { class: 'history__item' },
        el('span', { class: 'history__when', text: `Changed ${formatDate(log.edited_at)}. Before that it read:` }),
        el('p', { class: 'history__text', text: log.previous_note || '(empty)' }),
      ),
    ),
  );
}

function noteEditor(currentNote) {
  return el(
    'div',
    { class: 'form' },
    field('Edit note', el('textarea', { class: 'field__input', maxLength: 4000, value: currentNote || '' })),
    el(
      'div',
      { class: 'form__actions' },
      el('button', { class: 'btn btn--ghost btn--small', type: 'button', dataset: { action: 'cancel' }, text: 'Cancel' }),
      el('button', { class: 'btn btn--small', type: 'button', dataset: { action: 'save' }, text: 'Save note' }),
    ),
  );
}

// ---------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------

export async function renderDedicationsView(root, admin) {
  let showArchived = false;
  // Map from id to row, so click handlers can look up the data for a card.
  let byId = new Map();

  const feed = el('div', { class: 'feed' });
  const archivedToggle = el('input', { type: 'checkbox' });

  async function loadFeed() {
    stopAllPlayers();
    feed.replaceChildren(statusMessage('Loading dedications...'));
    try {
      const dedications = await fetchDedications({ includeArchived: showArchived });
      byId = new Map(dedications.map((dedication) => [dedication.id, dedication]));
      feed.replaceChildren(
        ...(dedications.length
          ? dedications.map((dedication) => dedicationCard(dedication, admin))
          : [statusMessage('No dedications yet. Send the first one.')]),
      );
    } catch (error) {
      feed.replaceChildren(statusMessage(describeError(error), { error: true }));
    }
  }

  archivedToggle.addEventListener('change', () => {
    showArchived = archivedToggle.checked;
    loadFeed();
  });

  // What each button does. An object of functions replaces a long
  // if/else chain: the button's data-action picks the function to run.
  const actions = {
    edit(card, id, extra) {
      extra.replaceChildren(noteEditor(byId.get(id).note));
      extra.querySelector('textarea').focus();
    },
    cancel(card, id, extra) {
      extra.replaceChildren();
    },
    async save(card, id, extra) {
      await updateDedicationNote(id, extra.querySelector('textarea').value.trim());
      await loadFeed();
    },
    async history(card, id, extra) {
      extra.replaceChildren(historyList(await fetchEditLogs(id)));
    },
    async archive(card, id) {
      await setDedicationArchived(id, true);
      await loadFeed();
    },
    async restore(card, id) {
      await setDedicationArchived(id, false);
      await loadFeed();
    },
    async delete(card, id) {
      // confirm() is blunt but honest: this cannot be undone.
      if (!window.confirm('Delete this dedication for good? Archiving hides it without losing it.')) return;
      await deleteDedication(id);
      await loadFeed();
    },
  };

  // Event delegation again: one listener for every button on every card.
  feed.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const card = button.closest('[data-id]');
    const extra = card.querySelector('.dedication__extra');

    await withBusy(button, async () => {
      try {
        await actions[button.dataset.action](card, card.dataset.id, extra);
      } catch (error) {
        extra.replaceChildren(el('p', { class: 'form__error', role: 'alert', text: describeError(error) }));
      }
    });
  });

  root.replaceChildren(
    el(
      'div',
      { class: 'stack stack--loose' },
      el(
        'header',
        { class: 'hero' },
        el('p', { class: 'eyebrow', text: 'Only the two of us' }),
        el('h1', { text: 'Ours' }),
        el('p', { class: 'hero__tagline', text: 'Songs we sent each other, and why.' }),
      ),
      buildComposer(loadFeed),
      el(
        'div',
        { class: 'toolbar' },
        el('h2', { text: 'The feed' }),
        el('label', { class: 'check' }, archivedToggle, 'Show archived'),
      ),
      feed,
    ),
  );

  await loadFeed();
}
