/**
 * Public profile page: three lists and the recommendation box.
 * Admins additionally see the suggestions guests have left.
 */
import { el, statusMessage, formatDate, describeError, withBusy } from '../utils/dom.js';
import { fetchProfile, fetchFavorites, fetchRecommendations, submitRecommendation } from '../db/profiles.js';

// Data that drives the layout. Adding a fourth list later means adding
// one line here (and one value to the SQL check constraint).
const SECTIONS = [
  { category: 'favorite_song', heading: 'Favorite Songs' },
  { category: 'top_artist', heading: 'Top 10 Artists' },
  { category: 'top_liked', heading: 'Top 10 Liked Tracks' },
];

function favoritesCard({ heading }, items = []) {
  const list = items.length
    ? el(
        'ol',
        { class: 'ranked' },
        items.map((item) =>
          el(
            'li',
            { class: 'ranked__item' },
            el('span', { class: 'ranked__position', text: String(item.position).padStart(2, '0') }),
            el(
              'span',
              { class: 'ranked__title', text: item.title },
              item.artist && el('span', { class: 'ranked__artist', text: item.artist }),
            ),
          ),
        ),
      )
    : el('p', { class: 'muted', text: 'Nothing here yet.' });

  return el('section', { class: 'card' }, el('h2', { text: heading }), list);
}

function recommendationForm(profile) {
  const feedback = el('p', { role: 'status', hidden: true });
  const submit = el('button', { class: 'btn', type: 'submit', text: 'Send suggestion' });

  const field = (label, input) => el('label', { class: 'field' }, el('span', { class: 'field__label', text: label }), input);

  const form = el(
    'form',
    { class: 'form' },
    el(
      'div',
      { class: 'form__row' },
      field('Song', el('input', { class: 'field__input', name: 'songTitle', required: true, maxLength: 200 })),
      field('Artist', el('input', { class: 'field__input', name: 'artist', maxLength: 200 })),
    ),
    field('Your name (optional)', el('input', { class: 'field__input', name: 'guestName', maxLength: 80 })),
    field('Why this one? (optional)', el('textarea', { class: 'field__input', name: 'message', maxLength: 500 })),
    feedback,
    el('div', { class: 'form__actions' }, submit),
  );

  form.addEventListener('submit', async (event) => {
    // Stop the browser's default behaviour: a full page reload.
    event.preventDefault();

    // FormData reads every named input; Object.fromEntries turns it into
    // a plain object like { songTitle: '...', artist: '...' }.
    const values = Object.fromEntries(new FormData(form));
    feedback.hidden = true;

    await withBusy(submit, async () => {
      try {
        await submitRecommendation({
          profileId: profile.id,
          guestName: values.guestName.trim(),
          songTitle: values.songTitle.trim(),
          artist: values.artist.trim(),
          message: values.message.trim(),
        });
        form.reset();
        feedback.className = 'form__success';
        feedback.textContent = `Thank you. ${profile.display_name} will give it a listen.`;
      } catch (error) {
        feedback.className = 'form__error';
        feedback.textContent = describeError(error);
      }
      feedback.hidden = false;
    });
  });

  return el(
    'section',
    { class: 'card stack' },
    el('h2', { text: 'Recommend a song' }),
    el('p', { class: 'muted', text: `Know something ${profile.display_name} should hear? Leave it here.` }),
    form,
  );
}

async function receivedRecommendations(profile) {
  const items = await fetchRecommendations(profile.id);
  const body = items.length
    ? el(
        'ul',
        { class: 'history' },
        items.map((item) =>
          el(
            'li',
            { class: 'history__item' },
            el('span', {
              class: 'history__when',
              text: `${item.guest_name || 'A guest'} - ${formatDate(item.created_at)}`,
            }),
            el('strong', { text: item.artist ? `${item.song_title} - ${item.artist}` : item.song_title }),
            item.message && el('p', { class: 'history__text', text: item.message }),
          ),
        ),
      )
    : el('p', { class: 'muted', text: 'No suggestions yet.' });

  return el('section', { class: 'card stack' }, el('h2', { text: 'Suggestions from guests' }), body);
}

/**
 * @param {HTMLElement} root where to render
 * @param {string} username  'machukaw' or 'novyyzhv'
 * @param {object|null} admin the signed-in partner, if any
 */
export async function renderProfileView(root, username, admin) {
  root.replaceChildren(statusMessage('Loading profile...'));

  try {
    const profile = await fetchProfile(username);
    if (!profile) {
      root.replaceChildren(statusMessage(`The profile "${username}" has not been set up yet.`));
      return;
    }

    // Promise.all starts both requests at once and waits for both,
    // instead of waiting for one before even starting the other.
    const [favorites, received] = await Promise.all([
      fetchFavorites(profile.id),
      admin ? receivedRecommendations(profile) : null,
    ]);

    root.replaceChildren(
      el(
        'div',
        { class: 'stack stack--loose' },
        el(
          'header',
          { class: 'hero' },
          el('p', { class: 'eyebrow', text: 'Music profile' }),
          el('h1', { text: profile.display_name }),
          profile.tagline && el('p', { class: 'hero__tagline', text: profile.tagline }),
        ),
        el('div', { class: 'grid' }, SECTIONS.map((section) => favoritesCard(section, favorites[section.category]))),
        received,
        recommendationForm(profile),
      ),
    );
  } catch (error) {
    root.replaceChildren(statusMessage(describeError(error), { error: true }));
  }
}
