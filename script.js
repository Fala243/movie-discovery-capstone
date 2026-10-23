/* ==========================================================================
   script.js — Shared JavaScript for all pages
   Purpose: Holds app configuration, finds the page elements that features
   use, and provides fetchMovies() for talking to our secure proxy.
   Each page's <body> has a data-page attribute ("home", "explore", or
   "watchlist") so this one file knows which page it is running on.

   SECURITY NOTE:
   The TMDB API Read Access Token must NEVER be placed in this file.
   Anything in frontend JavaScript is visible to every visitor.
   The browser calls our own serverless proxy (API_BASE_URL, see
   api/tmdb.js), and the proxy adds the token on the server.
   ========================================================================== */

'use strict';


/* ----- 1. Configuration ----- */

const CONFIG = {
  // Our serverless proxy route (same website, see api/tmdb.js).
  API_BASE_URL: '/api/tmdb',

  // Base URL for TMDB poster images (public, no token required).
  // A size such as "w342" goes between this and the poster path.
  IMAGE_BASE_URL: 'https://image.tmdb.org/t/p/',

  // Default poster width used by getMoviePosterUrl().
  // TMDB sizes: w92, w154, w185, w342, w500, w780, original.
  POSTER_SIZE: 'w342',
  // Larger poster for the movie details modal
  DETAILS_POSTER_SIZE: 'w500',
  // Streaming-provider logos are small squares (built with the same IMAGE_BASE_URL)
  PROVIDER_LOGO_SIZE: 'w92',

  // Countries offered in the "Where to Watch" selector (first = default)
  WATCH_REGIONS: [
    { code: 'US', name: 'United States' },
    { code: 'CA', name: 'Canada' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'FR', name: 'France' },
    { code: 'AU', name: 'Australia' },
  ],

  // Longest search the proxy accepts (must match isNonEmptyText(100) in api/tmdb.js).
  SEARCH_MAX_LENGTH: 100,

  // Give up on a request after this many milliseconds (15 s). The proxy
  // gives TMDB 8 s, so this leaves room for a slow first ("cold") start.
  REQUEST_TIMEOUT_MS: 15000,

  // Key used to save the watchlist in the browser's localStorage.
  WATCHLIST_STORAGE_KEY: 'movieDiscoveryWatchlist',
};


/* ----- 2. TMDB endpoints -----
   Multiple API endpoints: TMDB has a different URL path for each kind
   of data. All of them go through the SAME fetchMovies() function and
   the SAME proxy; only the "path" changes. The proxy only forwards paths
   on its allow-list (api/tmdb.js), and every one below is approved. */

const ENDPOINTS = {
  searchMovies: '/search/movie',         // needs { query: '...' }  (Explore)
  trendingMovies: '/trending/movie/week',// this week's trending      (Home)
  popularMovies: '/movie/popular',       // popular right now         (Home)
  movieDetails: '/movie/',               // + movie id, e.g. /movie/550 (modal)
  movieVideos: '/videos',                // added after the details path: /movie/550/videos
  watchProviders: '/watch/providers',    // added after the details path: /movie/550/watch/providers
  genres: '/genre/movie/list',           // [{ id: 28, name: 'Action' }, …] (Explore)
};


/* ----- 3. Page elements -----
   Looks up the shared containers. If an element is not on the current
   page, its value will simply be null. */

const elements = {
  loadingMessage: document.getElementById('loading-message'),
  errorMessage: document.getElementById('error-message'),

  // Homepage (index.html)
  trendingMovies: document.getElementById('trending-movies'),
  popularMovies: document.getElementById('popular-movies'),

  // Explore page (explore.html)
  searchForm: document.getElementById('search-form'),
  searchInput: document.getElementById('search-input'),
  searchButton: document.querySelector('#search-form button[type="submit"]'),
  genreSelect: document.getElementById('genre-select'),
  genreStatus: document.getElementById('genre-status'),
  resultsSummary: document.getElementById('results-summary'),
  searchResults: document.getElementById('search-results'),
  movieDetails: document.getElementById('movie-details'),
  movieDetailsContent: document.getElementById('movie-details-content'),
  movieDetailsTitle: document.getElementById('details-heading'),
  movieDetailsClose: document.querySelector('#movie-details .movie-details-close'),

  // Watchlist page (watchlist.html)
  watchlistMovies: document.getElementById('watchlist-movies'),
  watchlistEmpty: document.getElementById('watchlist-empty'),
  watchlistCount: document.getElementById('watchlist-count'),
};


/* ----- 4. Loading and error messages ----- */

/* Friendly messages shown to users, grouped by error type.
   HTTP errors: every reply from a server has a status code. 200 means OK;
   4xx means the request had a problem (400 invalid, 404 not found,
   429 too many requests); 5xx means the server had a problem (500 server
   error, 502 the next server failed, 504 the next server was too slow).
   The proxy also sends a short "code" (see api/tmdb.js) and getErrorType()
   turns both into one of the types below. No message ever contains
   tokens, stack traces, or server details. */
const ERROR_MESSAGES = {
  // Problems with what was asked for
  INVALID_REQUEST: 'That request was not valid. Please check your search and try again.',
  NOT_FOUND: 'No movie data was found for that request.',
  // Connection problems (on the visitor's side)
  OFFLINE: 'You appear to be offline. Check your internet connection, then try again.',
  NETWORK: 'Could not connect. Please check your internet connection and try again.',
  TIMEOUT: 'The movie service is taking too long to respond. Please try again.',
  // Problems on the server side
  AUTH: 'The movie service could not verify its access. Please try again later.',
  SERVER_CONFIG: 'The movie service isn’t set up correctly right now. Please try again later.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  SERVER: 'The movie service ran into a problem. Please try again in a moment.',
  API: 'The movie service sent an unexpected response. Please try again.',
  PROXY_UNAVAILABLE: 'The movie service is not available right now. Please try again later.',
  // Search input problems (checked in the browser before any request is sent)
  EMPTY_QUERY: 'Please enter a movie title to search.',
  QUERY_TOO_LONG: `Please shorten your search to ${CONFIG.SEARCH_MAX_LENGTH} characters or fewer.`,
  // Movie details problems
  INVALID_MOVIE_ID: 'This movie cannot be opened because its ID is missing or invalid.',
  DETAILS_NOT_FOUND: 'Details for this movie are not available.',
  TRAILER_NOT_FOUND: 'Trailer information isn’t available for this movie.',
  PROVIDERS_NOT_FOUND: 'Streaming availability isn’t available for this movie.',
  PROVIDERS_NONE: 'Streaming availability is not currently listed for this movie in your selected region.',
  // Watchlist (browser storage) problems
  STORAGE_UNAVAILABLE: 'Your watchlist can’t be saved because browser storage is turned off or blocked (for example in some private windows).',
  STORAGE_FULL: 'Your browser’s storage is full, so the watchlist couldn’t be updated. Try removing some saved movies.',
  STORAGE_CORRUPTED: 'Some saved watchlist data couldn’t be read and was skipped.',
  STORAGE_CORRUPTED_BACKUP: 'Your saved watchlist data was damaged. A backup copy was kept, and new saves will start a fresh list.',
  STORAGE_READ_FAILED: 'Your watchlist couldn’t be read right now, so nothing was changed. Please try again.',
};

/* Retry logic: some failures can fix themselves (a dropped connection,
   a slow or busy server), so we offer "Try Again". Others won't change
   by retrying (an invalid request, a missing movie, a server that isn't
   set up), so no button is shown for those. */
const RETRYABLE_ERRORS = new Set([
  'OFFLINE', 'NETWORK', 'TIMEOUT', 'RATE_LIMITED', 'SERVER', 'API', 'PROXY_UNAVAILABLE',
]);

// A custom error that also records the error type and HTTP status
class ApiError extends Error {
  constructor(type, status = null) {
    super(ERROR_MESSAGES[type] || ERROR_MESSAGES.API);
    this.name = 'ApiError';
    this.type = type;
    this.status = status;
  }
}

// true if pressing "Try Again" could help (unknown errors count as retryable)
function isRetryable(error) {
  return !(error instanceof ApiError) || RETRYABLE_ERRORS.has(error.type);
}

// The friendly text for any error (never the raw technical message)
function getErrorMessage(error) {
  return error instanceof ApiError ? error.message : ERROR_MESSAGES.API;
}

// Shows or hides the page's loading message
function setLoading(isLoading) {
  if (elements.loadingMessage) {
    elements.loadingMessage.hidden = !isLoading;
  }
}

// A "Try Again" button. onRetry runs only the operation that failed.
function createRetryButton(onRetry) {
  const button = createElement('button', 'button button-secondary button-small retry-button', 'Try Again');
  button.type = 'button';
  button.addEventListener('click', onRetry, { once: true });
  return button;
}

/* Shows the page's error message (role="alert" in the HTML, so screen
   readers announce it immediately). textContent/createElement are used,
   so no HTML is ever injected. Pass { onRetry } to add "Try Again". */
function showError(message, { onRetry = null } = {}) {
  if (!elements.errorMessage) return;
  elements.errorMessage.replaceChildren(createElement('span', 'status-text', message));
  if (onRetry) elements.errorMessage.append(createRetryButton(onRetry));
  elements.errorMessage.hidden = false;
}

function clearError() {
  if (elements.errorMessage) {
    elements.errorMessage.replaceChildren();
    elements.errorMessage.hidden = true;
  }
}

// Chooses an error type from the proxy's HTTP status and error code
function getErrorType(status, code) {
  if (code === 'SERVER_CONFIG_ERROR') return 'SERVER_CONFIG';
  if (code === 'TMDB_AUTH_FAILED' || status === 401 || status === 403) return 'AUTH';
  if (code === 'TMDB_TIMEOUT' || status === 504 || status === 408) return 'TIMEOUT';
  if (status === 400) return 'INVALID_REQUEST';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER'; // TMDB_UNREACHABLE, TMDB_ERROR, INTERNAL_ERROR, ...
  return 'API';
}


/* ----- 5. fetchMovies() -----
   Reusable function for every TMDB request.
   endpoint: a path from ENDPOINTS, e.g. ENDPOINTS.searchMovies
   params:   query parameters, e.g. { query: 'Avatar', page: 1 }
   options:  optional { signal } from an AbortController, used to cancel
             a request that is no longer needed (see searchMovies()).
   Returns TMDB's parsed JSON, or throws an ApiError.
   A cancelled request throws the browser's own "AbortError" instead.

   try/catch/finally in one sentence: code in "try" runs normally; if
   anything in it throws an error, "catch" runs instead of crashing; and
   "finally" ALWAYS runs afterwards (success, failure, or timeout), which
   makes it the right place for clean-up such as stopping a timer.

   Timeouts: fetch() has no time limit of its own, so a stuck request could
   leave a spinner on screen forever. We use our own AbortController and
   abort it after CONFIG.REQUEST_TIMEOUT_MS. If the CALLER cancels (their
   signal), the AbortError is passed on as a cancellation; if OUR timer
   fired, it becomes a friendly TIMEOUT error. */

async function fetchMovies(endpoint, params = {}, options = {}) {
  // Opening the HTML file directly (file://) cannot reach the proxy
  if (window.location.protocol === 'file:') {
    console.warn('The proxy only works through a server. Run "vercel dev" and open http://localhost:3000.');
    throw new ApiError('PROXY_UNAVAILABLE');
  }

  // The browser already knows it has no connection: don't even try
  if (navigator.onLine === false) throw new ApiError('OFFLINE');

  const searchParams = new URLSearchParams({ path: endpoint, ...params });
  const url = `${CONFIG.API_BASE_URL}?${searchParams.toString()}`;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CONFIG.REQUEST_TIMEOUT_MS);

  // Forward the caller's cancel signal to our controller
  const callerSignal = options.signal;
  const forwardAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', forwardAbort, { once: true });
  }

  // Turns an AbortError into TIMEOUT if our timer caused it
  const handleAbort = (error) => {
    if (error && error.name === 'AbortError') {
      if (timedOut) throw new ApiError('TIMEOUT');
      throw error; // cancelled by the caller: pass it on unchanged
    }
  };

  try {
    let response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      handleAbort(error);
      // fetch() only throws when the request could not be sent at all
      throw new ApiError(navigator.onLine === false ? 'OFFLINE' : 'NETWORK');
    }

    // If the proxy is not running (e.g. a static-only server), we get an HTML page instead of JSON
    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) {
      console.warn(`Expected JSON from ${CONFIG.API_BASE_URL} but got "${contentType}". Is "vercel dev" running?`);
      throw new ApiError(response.status >= 500 ? 'SERVER' : 'PROXY_UNAVAILABLE', response.status);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      handleAbort(error); // cancelled or timed out while reading
      throw new ApiError('API', response.status);
    }

    if (!response.ok) {
      const code = data && data.error ? data.error.code : undefined;
      // Logged for developers; visitors only see the friendly message
      console.error(`Proxy error ${response.status} (${code}):`, data && data.error ? data.error.message : '');
      throw new ApiError(getErrorType(response.status, code), response.status);
    }

    return data;
  } finally {
    // Always runs: stop the timer and stop listening to the caller's signal
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener('abort', forwardAbort);
  }
}


/* ----- 6. Transforming movie data (Step 3) -----
   TMDB sends back JSON (JavaScript Object Notation): text that the browser
   turns into ordinary JavaScript objects and arrays with response.json().
   Each movie object from TMDB has about 15 properties, and some may be
   missing or empty. "Transforming" means building a new, smaller object
   for each movie that holds only the properties this app uses, with safe
   fallback values filled in. The rest of the app then works with one
   predictable shape and never has to check TMDB's raw data again. */

// Fallback values used when TMDB leaves a field empty
const FALLBACKS = {
  title: 'Untitled',
  overview: 'No description available.',
  releaseDate: 'Release date unknown',
};

// A valid TMDB poster path looks like "/abc123XYZ.jpg"
const POSTER_PATH_PATTERN = /^\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/i;

/* getMoviePosterUrl() — a reusable function.
   Reusable functions are written once and called from anywhere, so the
   poster URL rule lives in one place. If it ever changes, we fix it once.
   posterPath: TMDB's poster_path, e.g. "/kyeqWdyUXW608qlYkRqosgbbJyK.jpg"
   size:       optional TMDB size, defaults to CONFIG.POSTER_SIZE
   Returns a full image URL, or null when there is no usable poster.
   null means "no poster" so a later step can show a placeholder instead. */

function getMoviePosterUrl(posterPath, size = CONFIG.POSTER_SIZE) {
  if (typeof posterPath !== 'string' || !POSTER_PATH_PATTERN.test(posterPath)) {
    return null;
  }
  // Example result: https://image.tmdb.org/t/p/w342/kyeqWdyUXW608qlYkRqosgbbJyK.jpg
  return `${CONFIG.IMAGE_BASE_URL}${size}${posterPath}`;
}

// Returns trimmed text, or the fallback when the value is missing or blank
function getTextOrFallback(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

/* Turns ONE raw TMDB movie into the app's movie object.
   Reading object properties: movie.title reads the "title" property of
   the movie object. TMDB uses snake_case names (release_date), and we
   rename them to camelCase (releaseDate) to match normal JavaScript style. */

function transformMovie(movie) {
  // TMDB uses vote_average 0 when nobody has rated a movie yet.
  // We store null ("no rating") so it is not shown as a real 0/10 score.
  const hasRating = typeof movie.vote_average === 'number' && movie.vote_count > 0;

  return {
    id: movie.id,
    title: getTextOrFallback(movie.title, FALLBACKS.title),
    overview: getTextOrFallback(movie.overview, FALLBACKS.overview),
    releaseDate: getTextOrFallback(movie.release_date, FALLBACKS.releaseDate),
    rating: hasRating ? Math.round(movie.vote_average * 10) / 10 : null, // e.g. 7.583 -> 7.6
    posterPath: typeof movie.poster_path === 'string' ? movie.poster_path : null,
    posterUrl: getMoviePosterUrl(movie.poster_path),
    genreIds: Array.isArray(movie.genre_ids) ? movie.genre_ids : [],
  };
}

/* transformMovieData() — reusable for search, trending, popular, etc.
   rawMovies: the "results" array from any TMDB movie list response.
   Returns a new array of clean movie objects.

   How map() works: map() visits every item in an array, passes it to the
   function you give it, and collects each return value into a NEW array
   of the same length. The original array is not changed.
     [movieA, movieB].map(transformMovie)  ->  [cleanA, cleanB]  */

function transformMovieData(rawMovies) {
  if (!Array.isArray(rawMovies)) {
    return [];
  }

  return rawMovies
    // Skip anything that is not a usable movie object (no object or no numeric id)
    .filter((movie) => movie && typeof movie === 'object' && Number.isInteger(movie.id))
    .map(transformMovie);
}


/* ----- Motion helper (Step 13) -----
   prefers-reduced-motion is a setting in the visitor's operating system.
   CSS reads it with @media (prefers-reduced-motion: reduce); JavaScript
   reads the same setting with window.matchMedia(). It is checked each time
   (not saved once), so changing the setting takes effect without a reload. */
function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}


/* ----- 7. Rendering movie cards (Step 5) -----
   "Rendering" means turning data (our movie objects) into elements on the page.

   We build every element with document.createElement() and fill in text
   with textContent, instead of writing HTML strings with innerHTML.
   textContent always treats data as plain text, so a movie title such as
   "<script>…" can never run as code. This keeps the page safe. */

// Small helper: creates an element with a class name and optional text
function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/* Builds the styled box shown when a movie has no poster, or when the
   poster image fails to load (broken link, network problem, etc.). */
function createPosterFallback(title) {
  const fallback = createElement('div', 'poster-fallback');
  // role="img" + aria-label lets screen readers describe the box like an image
  fallback.setAttribute('role', 'img');
  fallback.setAttribute('aria-label', `No poster available for ${title}`);
  fallback.append(createElement('span', 'poster-fallback-text', 'No poster available'));
  return fallback;
}

/* Builds the poster area: a real <img> when TMDB has a poster, otherwise the fallback. */
function createPosterElement(movie) {
  const poster = createElement('div', 'movie-card-poster');

  if (movie.posterUrl) {
    const img = document.createElement('img');
    img.src = movie.posterUrl;
    img.alt = `Poster for ${movie.title}`;
    // width/height tell the browser the image shape before it downloads
    img.width = 342;
    img.height = 513;
    // loading="lazy": posters further down the page only download when the
    // user scrolls near them, which makes the first page load faster.
    img.loading = 'lazy';
    img.decoding = 'async';

    // Image fallback: if the poster fails to load, swap the broken <img>
    // for the styled fallback box. { once: true } runs this only one time.
    img.addEventListener('error', () => {
      img.replaceWith(createPosterFallback(movie.title));
    }, { once: true });

    poster.append(img);
  } else {
    poster.append(createPosterFallback(movie.title));
  }

  poster.append(createRatingBadge(movie.rating));
  return poster;
}

/* Rating badge, e.g. "★ 7.6/10" or "Not rated".
   A visually hidden "Rating:" label gives screen readers context. */
function createRatingBadge(rating) {
  const badge = createElement('span', 'rating-badge');
  badge.append(createElement('span', 'visually-hidden', 'Rating: '));

  if (typeof rating === 'number') {
    badge.append(rating.toFixed(1)); // 7 -> "7.0", 7.6 -> "7.6"
    badge.append(createElement('span', 'rating-scale', '/10'));
  } else {
    badge.classList.add('is-unrated');
    badge.append('Not rated');
  }
  return badge;
}

/* Release year inside a <time> element, e.g. <time datetime="2009-12-15">2009</time>.
   The datetime attribute keeps the full date for browsers and assistive tech. */
function createReleaseInfo(releaseDate) {
  const meta = createElement('p', 'movie-card-meta');

  if (/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
    const time = createElement('time', '', releaseDate.slice(0, 4));
    time.dateTime = releaseDate;
    meta.append(time);
  } else {
    meta.textContent = releaseDate; // already a fallback such as "Release date unknown"
  }
  return meta;
}

/* createMovieCard(movie) — reusable: works for search results, trending,
   popular, and the watchlist, because every list uses the same transformed
   movie objects from transformMovieData().
   Returns an <article> element (not yet on the page). */

// Counter for unique card title ids (the same movie can appear twice on
// the homepage, in Trending and Popular, so the movie id alone isn't unique)
let cardTitleCount = 0;

function createMovieCard(movie) {
  const card = createElement('article', 'movie-card');

  // Movie IDs: every TMDB movie has a unique number (Avatar is 19995).
  // Storing it in data-movie-id lets later code know which movie a card
  // or button belongs to, so we can ask TMDB for exactly that movie.
  card.dataset.movieId = String(movie.id);

  // Accessibility: aria-labelledby names the <article> after its title,
  // so screen-reader users moving between articles hear the movie name.
  const title = createElement('h3', 'movie-card-title', movie.title);
  cardTitleCount += 1;
  title.id = `movie-card-title-${cardTitleCount}`;
  card.setAttribute('aria-labelledby', title.id);

  const body = createElement('div', 'movie-card-body');
  body.append(
    title,
    createReleaseInfo(movie.releaseDate),
    createElement('p', 'movie-card-overview', movie.overview),
  );

  const actions = createElement('div', 'card-actions');

  // "View Details" button, only on pages that have the details modal,
  // so the button never appears without working.
  if (elements.movieDetails) {
    const detailsButton = createElement(
      'button',
      'button button-secondary button-small button-block view-details-button',
      'View Details',
    );
    detailsButton.type = 'button';
    detailsButton.dataset.movieId = String(movie.id);
    // The visible text is the same on every card, so the label adds the
    // title for screen-reader users ("View details for Avatar").
    detailsButton.setAttribute('aria-label', `View details for ${movie.title}`);
    // Tells assistive technology that this button opens a dialog
    detailsButton.setAttribute('aria-haspopup', 'dialog');
    actions.append(detailsButton);
  }

  // Watchlist button: "Remove from Watchlist" on the Watchlist page,
  // a Save / Saved toggle everywhere else (Step 9)
  actions.append(
    elements.watchlistMovies ? createRemoveButton(movie) : createWatchlistToggleButton(movie),
  );
  body.append(actions);

  card.append(createPosterElement(movie), body);
  return card;
}

/* Skeleton placeholders (Step 12): grey card-shaped boxes shown while
   movies load. They take up roughly the same space as real cards, so the
   page doesn't jump when the results arrive. They contain no movie data
   and are hidden from screen readers (the loading text is announced
   separately). They are NOT .movie-card elements, so no code mistakes
   them for real cards. */
function createSkeletonCards(count = 10) {
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
    const card = createElement('div', 'skeleton-card');
    card.setAttribute('aria-hidden', 'true');
    card.append(
      createElement('div', 'skeleton-block skeleton-poster'),
      createElement('div', 'skeleton-block skeleton-line'),
      createElement('div', 'skeleton-block skeleton-line skeleton-line-short'),
    );
    fragment.append(card);
  }
  return fragment;
}

/* Card entrance animations (Step 13).
   ENTRANCE_STAGGER_LIMIT caps the wave: cards after the 12th all start
   with the 12th, so a long list never takes more than about half a second. */
const ENTRANCE_STAGGER_LIMIT = 12;

// Saved movie ids, read once per renderMovies() call (see below), or null
let savedIdsForRender = null;

/* renderMovies(movies, container, emptyMessage, options) — puts a list of movie cards on the page.
   movies:       array of transformed movie objects
   container:    the element to fill, e.g. elements.searchResults
   emptyMessage: optional text shown when the array is empty
   options.animate: which cards get the entrance animation
     'all'  (default) every card: new search, genre change, Trending/Popular
     'new'  only movies that were NOT already in this grid (the Watchlist
            page: removing one movie must not replay the animation on all
            the others)
     'none' no animation */

function renderMovies(movies, container, emptyMessage = 'No movies found.', { animate = 'all' } = {}) {
  if (!container) return;

  // Empty state: show a message instead of a blank area (or old results)
  if (!Array.isArray(movies) || movies.length === 0) {
    container.replaceChildren(createElement('p', 'movie-grid-message', emptyMessage));
    return;
  }

  // For 'new': remember which movie ids are on screen before redrawing
  const previousIds = animate === 'new'
    ? new Set(Array.from(container.querySelectorAll('.movie-card'), (card) => card.dataset.movieId))
    : null;

  // Performance (Step 14): read the saved watchlist ONCE for the whole list,
  // instead of once per Save button (20 reads of localStorage + JSON.parse).
  // The Watchlist page uses Remove buttons, so it doesn't need this.
  savedIdsForRender = elements.watchlistMovies ? null : new Set(getWatchlist().map((saved) => saved.id));

  // A DocumentFragment is an invisible holding box. We build all the cards
  // inside it first, then add it to the page in one step, so the browser
  // redraws the page once instead of once per card.
  const fragment = document.createDocumentFragment();
  let entering = 0; // how many cards are animating so far (for the stagger)

  // Array iteration: forEach() runs the arrow function once for every movie
  movies.forEach((movie) => {
    const card = createMovieCard(movie);
    const isNew = animate === 'all' || (animate === 'new' && !previousIds.has(String(movie.id)));
    if (isNew) {
      // The CSS animation (.is-entering) reads --stagger to delay each card a little more
      card.classList.add('is-entering');
      card.style.setProperty('--stagger', String(Math.min(entering, ENTRANCE_STAGGER_LIMIT)));
      entering += 1;
    }
    fragment.appendChild(card);
  });

  savedIdsForRender = null; // only valid while this list is being built

  // replaceChildren() removes whatever was in the container before
  // (old cards or messages) and inserts the new cards.
  container.replaceChildren(fragment);
}

/* Removes .is-entering once a card's entrance animation has finished.
   Without this, moving a card in the page could replay the animation.
   ONE listener on the whole document catches every card (animation
   events "bubble" up), so no extra listener is added per card or per
   render. animationcancel covers animations that were interrupted. */
let cardAnimationsReady = false;

function setupCardAnimations() {
  if (cardAnimationsReady) return; // never add the listeners twice
  cardAnimationsReady = true;

  const finishEntrance = (event) => {
    const card = event.target;
    if (card instanceof Element && card.classList.contains('is-entering')) {
      card.classList.remove('is-entering');
      card.style.removeProperty('--stagger');
    }
  };
  document.addEventListener('animationend', finishEntrance);
  document.addEventListener('animationcancel', finishEntrance);
}


/* ----- 8. Interactive movie search (Step 6) -----

   async/await in one sentence: an "async" function can pause at each
   "await" until a slow task (like an API request) finishes, without
   freezing the page, and then continue on the next line with the result.

   The "stale response" problem:
   Requests don't always finish in the order they started. If a visitor
   searches "Batman" and then quickly "Superman", the Batman reply could
   arrive LAST and replace the Superman results. Two safety nets stop this:
   1. AbortController: each new search cancels the previous request.
      fetch() then rejects with an "AbortError", which we quietly ignore.
   2. Request id: every search gets a number (1, 2, 3…). When a reply
      arrives, we only use it if its number is still the latest one. */

let latestSearchId = 0;          // id of the most recent search
let activeSearchController = null; // AbortController for the request in flight

/* State management: "state" is the data the page needs to remember
   between events. We keep the last successful search here, so changing
   the genre dropdown can re-filter these movies WITHOUT asking TMDB again. */
const searchState = {
  query: '',        // the trimmed text that was searched, e.g. "Avatar"
  results: [],      // ALL transformed movies from that search (unfiltered)
  totalResults: 0,  // how many matches TMDB has across all its pages
};

// Forgets the previous search (used before a new search and after errors)
function resetSearchState() {
  searchState.query = '';
  searchState.results = [];
  searchState.totalResults = 0;
}

// Shows or hides the "busy" state of the search form
function setSearchBusy(isBusy) {
  setLoading(isBusy);

  if (elements.searchButton) {
    // disabled = true prevents double-clicks from sending duplicate requests.
    // A disabled default button also stops Enter from submitting the form again.
    elements.searchButton.disabled = isBusy;
    elements.searchButton.textContent = isBusy ? 'Searching…' : 'Search';
  }
  if (elements.searchResults) {
    // aria-busy tells screen readers the results area is still updating
    elements.searchResults.setAttribute('aria-busy', String(isBusy));
  }
}

/* Marks the search box as invalid (or valid again) for assistive technology.
   aria-invalid="true" makes screen readers say "invalid entry", and
   aria-describedby links the box to the error message, so the reason is
   read out again whenever the visitor returns to the field. */
function setSearchInvalid(isInvalid) {
  const input = elements.searchInput;
  if (!input) return;
  if (isInvalid) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', 'error-message');
  } else {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
}

// Writes the line under the "Results" heading (empty string hides it)
function setResultsSummary(text) {
  if (elements.resultsSummary) {
    elements.resultsSummary.textContent = text;
  }
}

/* searchMovies(query) — reusable search.
   Validates the text, asks the proxy for matching movies, transforms
   the JSON, and renders the cards. Never throws: every problem ends as
   a friendly message on the page. */

async function searchMovies(query) {
  const container = elements.searchResults;

  // Input validation: trim() removes spaces from both ends, so "  avatar "
  // becomes "avatar" and a search made only of spaces becomes "".
  const searchText = typeof query === 'string' ? query.trim() : '';

  // DOM updates: clear the old error, summary, and cards before every search
  // so nothing outdated stays on screen.
  clearError();
  setResultsSummary('');
  if (container) container.replaceChildren();
  resetSearchState();

  // If the genre list failed to load earlier, quietly try again now
  if (elements.genreSelect && !genresLoaded) loadGenres();

  // Cancel the previous request (if any) and give this search a new id.
  // This happens even if the new text turns out to be invalid, so an older
  // request can never fill the page after the visitor has moved on.
  if (activeSearchController) activeSearchController.abort();
  activeSearchController = null;
  const searchId = ++latestSearchId;

  if (searchText === '' || searchText.length > CONFIG.SEARCH_MAX_LENGTH) {
    setSearchBusy(false);
    showError(searchText === '' ? ERROR_MESSAGES.EMPTY_QUERY : ERROR_MESSAGES.QUERY_TOO_LONG);
    setSearchInvalid(true);
    elements.searchInput?.focus();
    return;
  }
  setSearchInvalid(false);

  const controller = new AbortController();
  activeSearchController = controller;
  // Loading state: spinner + "Searching for movies…" above, placeholders below
  setSearchBusy(true);
  if (container) container.replaceChildren(createSkeletonCards());

  try {
    // API request: goes to OUR proxy (/api/tmdb), which adds the secret
    // token on the server. The browser never sees the token.
    const data = await fetchMovies(
      ENDPOINTS.searchMovies,
      { query: searchText },
      { signal: controller.signal },
    );

    // A newer search started while we were waiting: drop this reply
    if (searchId !== latestSearchId) return;

    if (!data || !Array.isArray(data.results)) {
      throw new ApiError('API');
    }

    // Save the full, unfiltered results in state, then draw them
    // (renderSearchResults applies the selected genre, if any).
    const movies = transformMovieData(data.results);
    searchState.query = searchText;
    searchState.results = movies;
    searchState.totalResults = Number(data.total_results) || movies.length;
    renderSearchResults();
  } catch (error) {
    // Cancelled on purpose because a newer search replaced it: not an error
    if (error.name === 'AbortError' || searchId !== latestSearchId) return;

    // The search box is never cleared, so the visitor's text is still there.
    // "Try Again" repeats exactly this search (and only this search).
    showError(getErrorMessage(error), {
      onRetry: isRetryable(error)
        ? () => {
          elements.searchInput?.focus(); // the retry button disappears; keep focus nearby
          searchMovies(searchText);
        }
        : null,
    });
    console.error(`Search for "${searchText}" failed:`, error);
    // Make sure no partial or old results remain after a failure
    if (container) container.replaceChildren();
    setResultsSummary('');
    resetSearchState();
  } finally {
    // "finally" runs after success AND failure, so the button always comes back.
    // Only the latest search may end the busy state; an older, cancelled
    // search must not re-enable the button while the newer one is running.
    if (searchId === latestSearchId) {
      setSearchBusy(false);
      activeSearchController = null;
    }
  }
}

/* Connects the search form to searchMovies().

   addEventListener('submit', handler) asks the browser to run "handler"
   every time the form is submitted. A form submits both when the Search
   button is clicked and when Enter is pressed inside the text field, so
   one listener covers both.

   event.preventDefault() stops the browser's default behaviour for forms,
   which is to reload the page (and lose everything on it). We handle the
   search ourselves with JavaScript instead. */

function setupSearchForm() {
  if (!elements.searchForm || !elements.searchInput) return;

  elements.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    searchMovies(elements.searchInput.value);
  });

  // As soon as the visitor types again, the field is no longer marked invalid
  elements.searchInput.addEventListener('input', () => {
    if (elements.searchInput.hasAttribute('aria-invalid')) setSearchInvalid(false);
  });
}


/* ----- 9. Genres and genre filtering (Step 8, Explore page) -----

   Genre IDs: TMDB doesn't store genre NAMES on each movie. Every movie
   has a genre_ids array of numbers (we call it movie.genreIds), e.g.
   Avatar has [28, 12, 878]. The /genre/movie/list endpoint tells us what
   each number means: 28 = "Action", 12 = "Adventure", 878 = "Science Fiction".
   So the dropdown shows names, but filtering compares the numbers. */

let genresLoaded = false;   // true once the dropdown has been filled
let genresRequest = null;   // the request in progress (prevents duplicates)
const genreNames = new Map(); // genre id -> name, e.g. 28 -> "Action"

// Shows a short message under the genre dropdown ('' hides it)
function setGenreStatus(text, isError = false) {
  if (!elements.genreStatus) return;
  elements.genreStatus.textContent = text;
  elements.genreStatus.classList.toggle('is-error', isError);
}

/* loadGenres() — fills the genre dropdown from TMDB.
   Returns the same promise if it is already running, so it can never
   send two requests at once. */
function loadGenres() {
  const select = elements.genreSelect;
  if (!select) return Promise.resolve();
  if (genresLoaded) return Promise.resolve();
  if (genresRequest) return genresRequest;

  genresRequest = (async () => {
    // Loading state: the dropdown can't be used until the genres arrive
    select.disabled = true;
    select.setAttribute('aria-busy', 'true');
    setGenreStatus('Loading genres…');

    try {
      const data = await fetchMovies(ENDPOINTS.genres);
      if (!data || !Array.isArray(data.genres)) throw new ApiError('API');

      // Keep only well-formed genres, then sort them A–Z by name
      const genres = data.genres
        .filter((genre) => genre && Number.isInteger(genre.id) && typeof genre.name === 'string' && genre.name.trim() !== '')
        .sort((a, b) => a.name.localeCompare(b.name));

      if (genres.length === 0) {
        // Empty state: leave just "All genres" and say why
        setGenreStatus('No genres are available right now.', true);
        return;
      }

      // Dynamic DOM update: remove any old genre options but KEEP the first
      // "All genres" option, then add one <option> per genre.
      while (select.options.length > 1) select.remove(1);
      genreNames.clear();

      const fragment = document.createDocumentFragment();
      genres.forEach((genre) => {
        // new Option(text, value): the text is shown, the value is the id
        fragment.appendChild(new Option(genre.name.trim(), String(genre.id)));
        genreNames.set(genre.id, genre.name.trim());
      });
      select.appendChild(fragment);

      genresLoaded = true;
      setGenreStatus('');
    } catch (error) {
      // Error state: search still works; only the filter is unavailable
      console.error('Loading genres failed:', error);
      setGenreStatus('Genres couldn’t load. Retrying on your next search.', true);
    } finally {
      select.disabled = !genresLoaded;
      select.removeAttribute('aria-busy');
      genresRequest = null;
    }
  })();

  return genresRequest;
}

// Reads the dropdown: a genre id number, or null for "All genres"
function getSelectedGenreId() {
  const value = elements.genreSelect ? elements.genreSelect.value : '';
  const id = Number(value);
  return value !== '' && genreNames.has(id) ? id : null;
}

/* renderSearchResults() — draws the saved search results, filtered by the
   selected genre. Called after every search and every genre change. */
function renderSearchResults() {
  const container = elements.searchResults;
  const { query, results, totalResults } = searchState;
  if (!query) return; // nothing has been searched successfully yet

  if (results.length === 0) {
    renderMovies([], container, 'No movies found. Try another title.');
    setResultsSummary(`No results for "${query}".`);
    return;
  }

  const genreId = getSelectedGenreId();

  // "All genres": show every loaded movie
  if (genreId === null) {
    renderMovies(results, container);
    setResultsSummary(`Showing ${results.length} of ${totalResults.toLocaleString()} results for "${query}".`);
    return;
  }

  // Array filtering: filter() keeps only the items for which the arrow
  // function returns true. includes() checks if the genre id is in the
  // movie's genreIds array. The original results array is not changed,
  // so choosing "All genres" again can show everything without a new request.
  const filtered = results.filter((movie) => movie.genreIds.includes(genreId));

  renderMovies(
    filtered,
    container,
    'No movies match this genre in the current results. Try another genre or search.',
  );
  // "loaded movies" makes clear this counts only the movies on screen,
  // not every match across all of TMDB's pages.
  setResultsSummary(
    `Showing ${filtered.length} of ${results.length} loaded movies for "${query}" — ${genreNames.get(genreId)}.`,
  );
}

// Re-filters the current results whenever the dropdown changes
function setupGenreFilter() {
  if (!elements.genreSelect) return;

  // The "change" event fires when the visitor picks a different option
  // (with a mouse, touch, or the keyboard).
  elements.genreSelect.addEventListener('change', () => {
    // During a search the new genre is applied when the results arrive
    if (activeSearchController) return;
    renderSearchResults();
  });
}


/* ----- 10. Trending and Popular movies (Step 8, Homepage) ----- */

// Requests in progress, by container id. Prevents duplicate requests
// for the same section (e.g. clicking "Try again" twice quickly).
const sectionRequests = new Map();

// A message inside a movie grid: loading spinner or error with a retry button
function renderSectionMessage(container, text, { isError = false, onRetry = null } = {}) {
  const message = createElement('div', `movie-grid-message ${isError ? 'is-error' : 'is-loading'}`);
  const textElement = createElement('p', isError ? '' : 'loading-indicator', text);
  // role="status" is read politely; role="alert" is read immediately
  textElement.setAttribute('role', isError ? 'alert' : 'status');
  message.append(textElement);

  if (onRetry) message.append(createRetryButton(onRetry));
  container.replaceChildren(message);
}

/* Loading state for a homepage grid: a one-line status (with spinner)
   across the top, then skeleton cards in the shape of the real ones.
   TMDB returns 20 movies per list, so 20 placeholders keep the section
   about the same height and the sections below don't jump. */
function renderSectionLoading(container, text) {
  const status = createElement('p', 'grid-loading-status loading-indicator', text);
  status.setAttribute('role', 'status');
  container.replaceChildren(status, createSkeletonCards(20));
}

/* Loads one homepage section. Shared by loadTrendingMovies() and
   loadPopularMovies(), so both behave the same way.
   The returned promise rejects on failure, which Promise.allSettled()
   (below) records without stopping the other section. */
function loadMovieSection(container, endpoint, sectionName) {
  if (!container) return Promise.resolve(0);
  if (sectionRequests.has(container.id)) return sectionRequests.get(container.id);

  const request = (async () => {
    container.setAttribute('aria-busy', 'true');
    renderSectionLoading(container, `Loading ${sectionName}…`);

    try {
      const data = await fetchMovies(endpoint);
      if (!data || !Array.isArray(data.results)) throw new ApiError('API');

      const movies = transformMovieData(data.results);
      // Empty state if TMDB returns an empty list
      renderMovies(movies, container, `No ${sectionName} are available right now. Please check back later.`);
      return movies.length;
    } catch (error) {
      renderSectionMessage(container, `Could not load ${sectionName}. ${getErrorMessage(error)}`, {
        isError: true,
        // Retry ONLY this section; the failure is already shown, so the
        // returned rejection is ignored. Focus moves to the section heading
        // because the clicked button is replaced by the loading state.
        onRetry: isRetryable(error)
          ? () => {
            const heading = container.closest('section')?.querySelector('h2');
            if (heading) { heading.tabIndex = -1; heading.focus(); }
            loadMovieSection(container, endpoint, sectionName).catch(() => {});
          }
          : null,
      });
      throw error;
    } finally {
      container.removeAttribute('aria-busy');
      sectionRequests.delete(container.id);
    }
  })();

  sectionRequests.set(container.id, request);
  return request;
}

// This week's trending movies -> #trending-movies
function loadTrendingMovies() {
  return loadMovieSection(elements.trendingMovies, ENDPOINTS.trendingMovies, 'trending movies');
}

// Popular movies -> #popular-movies
function loadPopularMovies() {
  return loadMovieSection(elements.popularMovies, ENDPOINTS.popularMovies, 'popular movies');
}

/* Loads both homepage sections at the same time.

   Promise.allSettled([...]) starts both requests together and waits until
   EVERY one has finished, whether it succeeded ("fulfilled") or failed
   ("rejected"). Promise.all() would stop at the first failure; allSettled
   doesn't, so if Trending fails, Popular still loads (and vice versa).
   Each section already shows its own success or error message. */
async function loadHomepageMovies() {
  const results = await Promise.allSettled([loadTrendingMovies(), loadPopularMovies()]);

  results.forEach((result, index) => {
    const name = index === 0 ? 'Trending' : 'Popular';
    if (result.status === 'fulfilled') {
      console.log(`${name} movies loaded: ${result.value}`);
    } else {
      console.error(`${name} movies failed:`, result.reason);
    }
  });
}


/* ----- 11. Watchlist with localStorage (Step 9) -----

   localStorage is a small storage area (about 5 MB) that the browser keeps
   for this website. Data saved there survives page reloads, closing the
   tab, and moving between our three pages, so the watchlist is shared by
   Home, Explore, and Watchlist. It belongs to this browser on this device
   only (no account or server is involved).

   localStorage can only store TEXT, so:
   - JSON.stringify(array) turns our array of movie objects into a text string,
   - JSON.parse(text) turns that string back into a real array of objects.

   localStorage can also fail: it may be blocked (privacy settings, some
   private windows), full (quota exceeded), or contain damaged text that
   JSON.parse() can't read. Every access is wrapped in try...catch so a
   problem shows a friendly message instead of breaking the page. */

// Messages already shown on this page, so a problem is reported only once
const reportedStorageProblems = new Set();

// Tells the visitor about a storage problem (once per problem per page)
function reportStorageProblem(message) {
  if (reportedStorageProblems.has(message)) return;
  reportedStorageProblems.add(message);
  console.warn('Watchlist storage problem:', message);
  showToast(message, { isError: true });
}

/* Checks one stored record and rebuilds it as a clean movie object.
   Anything could be in localStorage (old versions, manual edits, damage),
   so every field is validated. Returns null if the record is unusable. */
function sanitizeWatchlistMovie(item) {
  if (!item || typeof item !== 'object' || !Number.isInteger(item.id) || item.id <= 0) {
    return null;
  }
  const posterPath = typeof item.posterPath === 'string' && POSTER_PATH_PATTERN.test(item.posterPath)
    ? item.posterPath
    : null;
  const rating = typeof item.rating === 'number' && item.rating >= 0 && item.rating <= 10
    ? item.rating
    : null;

  return {
    id: item.id,
    title: getTextOrFallback(item.title, FALLBACKS.title).slice(0, 300),
    overview: getTextOrFallback(item.overview, FALLBACKS.overview).slice(0, 3000),
    releaseDate: getTextOrFallback(item.releaseDate, FALLBACKS.releaseDate).slice(0, 40),
    rating,
    posterPath,
    // The full URL is rebuilt here instead of being trusted from storage
    posterUrl: getMoviePosterUrl(posterPath),
    genreIds: Array.isArray(item.genreIds)
      ? item.genreIds.filter((genreId) => Number.isInteger(genreId) && genreId > 0)
      : [],
  };
}

// Only the fields needed to draw a card are stored (no posterUrl: it is rebuilt)
function toStoredMovie(movie) {
  return {
    id: movie.id,
    title: movie.title,
    posterPath: movie.posterPath,
    releaseDate: movie.releaseDate,
    rating: movie.rating,
    overview: movie.overview,
    genreIds: movie.genreIds,
  };
}

/* Never silently erase saved movies (Step 12):
   If the stored text is damaged, a copy of it is saved under a separate
   backup key BEFORE anything new is written, so nothing is lost for good.
   Returns true if the backup exists (or wasn't needed). */
const WATCHLIST_BACKUP_KEY = `${CONFIG.WATCHLIST_STORAGE_KEY}-backup`;

function backUpDamagedWatchlist(text) {
  try {
    if (window.localStorage.getItem(WATCHLIST_BACKUP_KEY) !== text) {
      window.localStorage.setItem(WATCHLIST_BACKUP_KEY, text);
    }
    return true;
  } catch (error) {
    console.warn('Could not back up the damaged watchlist:', error);
    return false;
  }
}

/* readWatchlist() — reads the saved movies safely.
   Returns { ok, movies }:
   - ok: true  -> movies is the valid saved list ([] if nothing is saved)
   - ok: false -> storage couldn't be read right now (blocked, or damaged
                  data that couldn't be backed up). Callers must NOT save
                  in that case, or they would overwrite the real list. */
function readWatchlist() {
  let text;
  try {
    text = window.localStorage.getItem(CONFIG.WATCHLIST_STORAGE_KEY);
  } catch (error) {
    // Accessing localStorage itself can throw when storage is blocked
    reportStorageProblem(ERROR_MESSAGES.STORAGE_UNAVAILABLE);
    return { ok: false, movies: [], message: ERROR_MESSAGES.STORAGE_UNAVAILABLE };
  }
  if (text === null) return { ok: true, movies: [] }; // nothing saved yet

  let data;
  try {
    data = JSON.parse(text); // text -> array of objects
  } catch (error) {
    data = null; // damaged JSON
  }
  if (!Array.isArray(data)) {
    const backedUp = backUpDamagedWatchlist(text);
    reportStorageProblem(backedUp ? ERROR_MESSAGES.STORAGE_CORRUPTED_BACKUP : ERROR_MESSAGES.STORAGE_READ_FAILED);
    return { ok: backedUp, movies: [], message: ERROR_MESSAGES.STORAGE_READ_FAILED };
  }

  // Validate every record and drop duplicates (same TMDB id twice).
  // Valid movies are always kept.
  const seenIds = new Set();
  const movies = [];
  data.forEach((item) => {
    const movie = sanitizeWatchlistMovie(item);
    if (movie && !seenIds.has(movie.id)) {
      seenIds.add(movie.id);
      movies.push(movie);
    }
  });
  if (movies.length !== data.length) {
    // Keep the original text too, in case a skipped record mattered
    backUpDamagedWatchlist(text);
    reportStorageProblem(ERROR_MESSAGES.STORAGE_CORRUPTED);
  }
  return { ok: true, movies };
}

/* getWatchlist() — the saved movies as an array (empty if nothing is
   saved or storage can't be read). Safe for displaying. */
function getWatchlist() {
  return readWatchlist().movies;
}

/* saveWatchlist(movies) — writes the whole list back to localStorage.
   Returns true on success, false if the browser refused to save. */
function saveWatchlist(movies) {
  try {
    const text = JSON.stringify(movies.map(toStoredMovie)); // array -> text
    window.localStorage.setItem(CONFIG.WATCHLIST_STORAGE_KEY, text);
    return true;
  } catch (error) {
    // QuotaExceededError = storage full; anything else = storage blocked
    const isFull = error && (error.name === 'QuotaExceededError' || error.code === 22);
    const message = isFull ? ERROR_MESSAGES.STORAGE_FULL : ERROR_MESSAGES.STORAGE_UNAVAILABLE;
    console.warn('Saving the watchlist failed:', error);
    showToast(message, { isError: true }); // shown every time: the click didn't work
    return false;
  }
}

/* isInWatchlist(movieId) — true if this TMDB id is saved.
   some() returns true as soon as ONE item passes the test. */
function isInWatchlist(movieId) {
  const id = Number(movieId);
  return getWatchlist().some((movie) => movie.id === id);
}

/* addToWatchlist(movie) — saves a movie (once). Returns true if the movie
   is saved afterwards. find() returns the first matching item, or
   undefined if there is none, which is how duplicates are prevented. */
function addToWatchlist(movie) {
  const saved = sanitizeWatchlistMovie(movie);
  if (!saved) return false;

  // If the current list couldn't be read, saving would overwrite it: stop.
  const { ok, movies, message } = readWatchlist();
  if (!ok) {
    showToast(message, { isError: true });
    return false;
  }
  const existing = movies.find((item) => item.id === saved.id);
  if (existing) return true; // already saved: don't store it twice

  movies.push(saved);
  return saveWatchlist(movies);
}

/* removeFromWatchlist(movieId) — deletes a movie by its TMDB id.
   filter() builds a NEW array containing every movie EXCEPT that one. */
function removeFromWatchlist(movieId) {
  const id = Number(movieId);
  const { ok, movies, message } = readWatchlist();
  if (!ok) {
    showToast(message, { isError: true });
    return false;
  }
  const remaining = movies.filter((movie) => movie.id !== id);
  if (remaining.length === movies.length) return true; // wasn't saved
  return saveWatchlist(remaining);
}


/* --- Feedback message ("toast") ---
   A small message at the bottom of the screen, e.g. "Avatar was added to
   your watchlist." Two separate live regions are used, because screen
   readers only reliably notice a region that already exists:
   - success messages: role="status" (announced politely, after speech)
   - error messages:   role="alert"  (announced immediately)
   Only one is visible at a time. */
const toastRegions = { status: null, alert: null };
let toastTimer = null;

function getToastRegion(role) {
  if (!toastRegions[role]) {
    const region = createElement('div', role === 'alert' ? 'toast is-error' : 'toast');
    region.setAttribute('role', role);
    region.setAttribute('aria-live', role === 'alert' ? 'assertive' : 'polite');
    region.setAttribute('aria-atomic', 'true');
    document.body.append(region);
    toastRegions[role] = region;
  }
  return toastRegions[role];
}

function showToast(message, { isError = false } = {}) {
  const shown = getToastRegion(isError ? 'alert' : 'status');
  const other = getToastRegion(isError ? 'status' : 'alert');
  other.textContent = '';
  shown.textContent = message;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    shown.textContent = '';
  }, isError ? 7000 : 4000);
}


/* --- Watchlist buttons on movie cards --- */

// Bookmark icon built with SVG DOM methods (createElementNS is the SVG
// version of createElement). aria-hidden: the button text describes it.
function createBookmarkIcon() {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('bookmark-icon');
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z');
  svg.append(path);
  return svg;
}

/* Shows a toggle button's current state.
   Not saved: "Save to Watchlist" (outline bookmark).
   Saved:     "Saved" (filled bookmark); clicking again removes it.
   aria-label adds the movie title and says what a click will do. */
function updateWatchlistButton(button, isSaved) {
  const title = button.dataset.movieTitle || 'this movie';
  button.classList.toggle('is-saved', isSaved);
  button.querySelector('.watchlist-button-text').textContent = isSaved ? 'Saved' : 'Save to Watchlist';
  button.setAttribute(
    'aria-label',
    isSaved ? `Saved: ${title}. Remove from Watchlist` : `Save to Watchlist: ${title}`,
  );
  button.title = isSaved ? 'Remove from Watchlist' : 'Save to Watchlist';
}

// Save / Saved toggle for Home and Explore cards
function createWatchlistToggleButton(movie) {
  const button = createElement('button', 'button button-small button-block watchlist-button');
  button.type = 'button';
  button.dataset.movieId = String(movie.id);
  button.dataset.movieTitle = movie.title;
  button.append(createBookmarkIcon(), createElement('span', 'watchlist-button-text'));
  // During renderMovies() the saved ids were already read once; otherwise read now
  updateWatchlistButton(button, savedIdsForRender ? savedIdsForRender.has(movie.id) : isInWatchlist(movie.id));

  // The listener remembers "movie" (a closure), so it knows exactly which
  // movie to save. It's a separate button from "View Details", so a save
  // click never opens the modal.
  button.addEventListener('click', () => toggleWatchlist(movie));
  return button;
}

// "Remove from Watchlist" button for cards on the Watchlist page
function createRemoveButton(movie) {
  const button = createElement('button', 'button button-small button-block watchlist-button is-remove');
  button.type = 'button';
  button.dataset.movieId = String(movie.id);
  button.append(createBookmarkIcon(), createElement('span', 'watchlist-button-text', 'Remove from Watchlist'));
  button.setAttribute('aria-label', `Remove from Watchlist: ${movie.title}`);
  button.addEventListener('click', () => removeFromWatchlistPage(movie, button));
  return button;
}

/* Dynamic DOM update: the same movie can appear on several cards
   (e.g. in both Trending and Popular), so every matching button is updated. */
function refreshWatchlistButtons() {
  const savedIds = new Set(getWatchlist().map((movie) => movie.id));
  document.querySelectorAll('.watchlist-button:not(.is-remove)').forEach((button) => {
    updateWatchlistButton(button, savedIds.has(Number(button.dataset.movieId)));
  });
}

// Click on Save / Saved (Home and Explore)
function toggleWatchlist(movie) {
  const wasSaved = isInWatchlist(movie.id);
  const ok = wasSaved ? removeFromWatchlist(movie.id) : addToWatchlist(movie);
  if (!ok) return; // saveWatchlist() already showed what went wrong

  refreshWatchlistButtons();
  showToast(wasSaved
    ? `“${movie.title}” was removed from your watchlist.`
    : `“${movie.title}” was added to your watchlist.`);
}

// Click on "Remove from Watchlist" (Watchlist page)
function removeFromWatchlistPage(movie, button) {
  // Remember the card's position so focus can move to a nearby card,
  // because the clicked button disappears when the list is redrawn.
  const buttons = Array.from(elements.watchlistMovies.querySelectorAll('.watchlist-button'));
  const position = buttons.indexOf(button);

  if (!removeFromWatchlist(movie.id)) return;

  renderWatchlist();
  showToast(`“${movie.title}” was removed from your watchlist.`);

  // Focus management for keyboard users
  const remaining = elements.watchlistMovies.querySelectorAll('.watchlist-button');
  if (remaining.length > 0) {
    remaining[Math.min(position, remaining.length - 1)].focus();
  } else {
    elements.watchlistEmpty?.querySelector('a, button')?.focus();
  }
}

/* renderWatchlist() — draws the Watchlist page from localStorage,
   reusing renderMovies() and createMovieCard(). */
function renderWatchlist() {
  const grid = elements.watchlistMovies;
  if (!grid) return;

  const { ok, movies: saved, message } = readWatchlist();
  clearError();

  // Storage can't be read right now: say so (with "Try Again") instead of
  // wrongly claiming the watchlist is empty.
  if (!ok) {
    if (elements.watchlistEmpty) elements.watchlistEmpty.hidden = true;
    grid.replaceChildren();
    if (elements.watchlistCount) elements.watchlistCount.textContent = '';
    showError(message, { onRetry: () => renderWatchlist() });
    return;
  }

  // Newest first: reverse() a copy, so the stored order isn't changed
  const movies = saved.slice().reverse();
  const isEmpty = movies.length === 0;

  // Show the empty-state message only when nothing is saved
  if (elements.watchlistEmpty) elements.watchlistEmpty.hidden = !isEmpty;

  if (isEmpty) {
    grid.replaceChildren(); // the empty-state box explains instead
  } else {
    // 'new': only movies that weren't already shown animate in. On first
    // load every card is new; after removing a movie nothing replays.
    renderMovies(movies, grid, undefined, { animate: 'new' });
  }

  if (elements.watchlistCount) {
    elements.watchlistCount.textContent = isEmpty
      ? ''
      : `${movies.length} ${movies.length === 1 ? 'movie' : 'movies'} saved on this device`;
  }
}

/* Keeps every page in sync with the stored watchlist:
   - "storage" fires when ANOTHER tab of this site changes localStorage.
   - "pageshow" with persisted = true fires when the Back/Forward button
     restores a page from memory, which may show outdated buttons. */
function setupWatchlistSync() {
  const refresh = () => {
    if (elements.watchlistMovies) renderWatchlist();
    else refreshWatchlistButtons();
  };

  window.addEventListener('storage', (event) => {
    if (event.key === CONFIG.WATCHLIST_STORAGE_KEY || event.key === null) refresh();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) refresh();
  });
}


/* ----- 12. Movie details modal (Steps 7–9; all three pages) -----

   How it fits together:
   1. Each card has a "View Details" button holding the movie's TMDB id.
   2. Clicking it opens the <dialog> (openMovieDetails) and asks the proxy
      for /movie/{id} (loadMovieDetails).
   3. The reply is transformed (transformMovieDetails) and drawn into
      #movie-details-content (renderMovieDetails).

   Modal accessibility checklist:
   - showModal() makes the rest of the page "inert" (not clickable or
     focusable) and announces the dialog to screen readers.
   - Focus moves INTO the dialog (the Close button) when it opens.
   - Tab / Shift+Tab are kept inside the dialog (trapDetailsFocus).
   - Escape, the Close button, and clicking the dark backdrop all close it.
   - Focus returns to the "View Details" button that opened it. */

let latestDetailsRequestId = 0;      // id of the newest details request
let activeDetailsController = null;  // AbortController for the request in flight
let loadingDetailsMovieId = null;    // movie id currently being fetched
let detailsTriggerButton = null;     // button to send focus back to on close
let detailsOpenedAt = 0;             // time the modal opened (see backdrop click)

// Already-loaded details, keyed by movie id. Opening the same movie
// again shows it instantly without a second request.
const detailsCache = new Map();

/* Turns TMDB's /movie/{id} JSON into the app's details object.
   transformMovie() already handles the shared fields (title, overview,
   rating, poster...). The "..." spread copies all of those properties
   into the new object, and we add the extra details-only fields. */
function transformMovieDetails(raw) {
  return {
    ...transformMovie(raw),
    voteCount: Number.isInteger(raw.vote_count) ? raw.vote_count : 0,
    runtime: Number.isInteger(raw.runtime) && raw.runtime > 0 ? raw.runtime : null,
    // The details endpoint sends genres as objects: [{ id: 28, name: "Action" }]
    genres: Array.isArray(raw.genres)
      ? raw.genres
        .map((genre) => (genre && typeof genre.name === 'string' ? genre.name.trim() : ''))
        .filter((name) => name !== '')
      : [],
    originalLanguage: typeof raw.original_language === 'string' ? raw.original_language : '',
    tagline: getTextOrFallback(raw.tagline, ''), // '' means "no tagline"
  };
}

// "2009-12-15" -> "December 15, 2009" (other text is returned unchanged)
function formatReleaseDate(releaseDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return releaseDate;
  // timeZone 'UTC' stops the date shifting by a day in some time zones
  const date = new Date(`${releaseDate}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? releaseDate
    : date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// 162 -> "2h 42m (162 min)", 45 -> "45 min", null -> "Runtime unknown"
function formatRuntime(minutes) {
  if (!minutes) return 'Runtime unknown';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${rest ? ` ${rest}m` : ''} (${minutes} min)`;
}

// "en" -> "English", using the browser's built-in language names
function formatLanguage(code) {
  if (!/^[a-z]{2,3}$/i.test(code) || code === 'xx') return 'Not specified';
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code);
    return name && name !== code ? name : code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

// 7.6 + 32145 votes -> "7.6/10 (32,145 votes)"
function formatDetailsRating(rating, voteCount) {
  if (typeof rating !== 'number') return 'Not rated';
  const votes = voteCount === 1 ? '1 vote' : `${voteCount.toLocaleString()} votes`;
  return `${rating.toFixed(1)}/10 (${votes})`;
}

// Adds one "label: value" pair to a <dl> (description list)
function addDetailsFact(list, label, value) {
  const row = createElement('div', 'details-fact');
  const valueElement = createElement('dd');
  // value may be plain text or an element (e.g. a list of genre tags)
  valueElement.append(value);
  row.append(createElement('dt', '', label), valueElement);
  list.append(row);
}

// Sets the dialog heading (also the dialog's accessible name)
function setDetailsTitle(text) {
  if (elements.movieDetailsTitle) elements.movieDetailsTitle.textContent = text;
}

/* Replaces the modal content. If keyboard focus was on something inside
   the old content (e.g. the country selector), it would be lost, so focus
   is moved to the Close button to keep it inside the dialog. */
function replaceDetailsContent(...nodes) {
  const content = elements.movieDetailsContent;
  if (!content) return;
  const focusWasInside = content.contains(document.activeElement);
  content.replaceChildren(...nodes);
  if (focusWasInside && elements.movieDetails?.open) elements.movieDetailsClose?.focus();
}

// Loading state inside the modal
function renderDetailsLoading() {
  setDetailsTitle('Loading…');
  const message = createElement('p', 'status-message loading-indicator', 'Loading movie details…');
  message.setAttribute('role', 'status');
  replaceDetailsContent(message);
  elements.movieDetails?.setAttribute('aria-busy', 'true');
}

// Error state inside the modal (role="alert" is announced immediately).
// onRetry (optional) adds "Try Again", which reloads only this movie.
function renderDetailsError(message, onRetry = null) {
  setDetailsTitle('Details unavailable');
  const error = createElement('p', 'status-message status-error');
  error.append(createElement('span', 'status-text', message));
  error.setAttribute('role', 'alert');
  if (onRetry) error.append(createRetryButton(onRetry));
  replaceDetailsContent(error);
  elements.movieDetails?.removeAttribute('aria-busy');
}

/* renderMovieDetails(details) — draws the details into the modal.
   Same safe approach as the cards: createElement() + textContent only. */
function renderMovieDetails(details) {
  const content = elements.movieDetailsContent;
  if (!content) return;

  setDetailsTitle(details.title);

  // Poster column (larger w500 image, or the shared fallback box)
  const poster = createElement('div', 'details-poster');
  const posterUrl = getMoviePosterUrl(details.posterPath, CONFIG.DETAILS_POSTER_SIZE);
  if (posterUrl) {
    const img = document.createElement('img');
    img.src = posterUrl;
    img.alt = `Poster for ${details.title}`;
    img.width = 500;
    img.height = 750;
    img.addEventListener('error', () => {
      img.replaceWith(createPosterFallback(details.title));
    }, { once: true });
    poster.append(img);
  } else {
    poster.append(createPosterFallback(details.title));
  }

  // Information column
  const info = createElement('div', 'details-info');

  if (details.tagline) {
    info.append(createElement('p', 'details-tagline', details.tagline));
  }

  // Trailer controls (Step 10): filled in by setupTrailerArea() below
  const trailerArea = createElement('div', 'details-trailer');
  info.append(trailerArea);

  // Genres as a list of small pill tags
  let genres = 'Not listed';
  if (details.genres.length > 0) {
    genres = createElement('ul', 'details-genres');
    details.genres.forEach((name) => genres.append(createElement('li', 'tag', name)));
  }

  // Release date inside <time> so the machine-readable date is kept
  let release = details.releaseDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(details.releaseDate)) {
    release = createElement('time', '', formatReleaseDate(details.releaseDate));
    release.dateTime = details.releaseDate;
  }

  const facts = createElement('dl', 'details-facts');
  addDetailsFact(facts, 'Rating', formatDetailsRating(details.rating, details.voteCount));
  addDetailsFact(facts, 'Release date', release);
  addDetailsFact(facts, 'Runtime', formatRuntime(details.runtime));
  addDetailsFact(facts, 'Original language', formatLanguage(details.originalLanguage));
  addDetailsFact(facts, 'Genres', genres);

  info.append(
    facts,
    createElement('h3', 'details-subheading', 'Overview'),
    createElement('p', 'details-overview', details.overview), // full text, not shortened
  );

  const layout = createElement('div', 'details-layout');
  layout.append(poster, info);
  // "Where to Watch" (Step 11) goes below the poster, information, and trailer controls
  const watchSection = createWatchSection(details);

  replaceDetailsContent(layout, watchSection);
  elements.movieDetails?.removeAttribute('aria-busy');

  // Check for a trailer now, but don't load any video until it's clicked
  setupTrailerArea(details, trailerArea);
  // Load streaming availability for the selected country
  showWatchProviders(details, watchSection);
}

/* loadMovieDetails(movieId) — fetches and shows one movie's details.

   Asynchronous requests: "await fetchMovies(...)" pauses this function
   until the proxy answers, while the rest of the page keeps working.
   The same two safety nets as the search protect the result:
   - an AbortController cancels the previous details request, and
   - a request id makes sure only the NEWEST request can draw the modal,
   so a slow reply for movie A can't replace details for movie B. */
async function loadMovieDetails(movieId) {
  const id = Number(movieId);

  // No duplicate requests: this movie is already loading
  if (id === loadingDetailsMovieId && activeDetailsController) return;

  // Another movie was selected: stop any trailer that is playing and
  // cancel any "Where to Watch" request for the previous movie
  closeTrailer({ restoreFocus: false });
  cancelWatchProvidersRequest();

  // Cancel any older request and claim the newest request id
  if (activeDetailsController) activeDetailsController.abort();
  activeDetailsController = null;
  loadingDetailsMovieId = null;
  const requestId = ++latestDetailsRequestId;

  // A movie id must be a positive whole number (the proxy checks this too)
  if (!Number.isInteger(id) || id <= 0) {
    renderDetailsError(ERROR_MESSAGES.INVALID_MOVIE_ID);
    return;
  }

  // Already loaded earlier: show it without another request
  if (detailsCache.has(id)) {
    renderMovieDetails(detailsCache.get(id));
    return;
  }

  const controller = new AbortController();
  activeDetailsController = controller;
  loadingDetailsMovieId = id;
  renderDetailsLoading();

  try {
    // Becomes GET /api/tmdb?path=/movie/19995 (the proxy adds the token)
    const data = await fetchMovies(`${ENDPOINTS.movieDetails}${id}`, {}, { signal: controller.signal });

    if (requestId !== latestDetailsRequestId) return; // a newer request took over
    if (!data || data.id !== id) throw new ApiError('API');

    const details = transformMovieDetails(data);
    detailsCache.set(id, details);
    renderMovieDetails(details);
  } catch (error) {
    if (error.name === 'AbortError' || requestId !== latestDetailsRequestId) return;

    let message = getErrorMessage(error);
    if (error.type === 'NOT_FOUND') message = ERROR_MESSAGES.DETAILS_NOT_FOUND;
    renderDetailsError(message, isRetryable(error)
      ? () => {
        elements.movieDetailsClose?.focus(); // keep focus inside the dialog
        loadMovieDetails(id);
      }
      : null);
    console.error(`Loading details for movie ${id} failed:`, error);
  } finally {
    if (requestId === latestDetailsRequestId) {
      activeDetailsController = null;
      loadingDetailsMovieId = null;
    }
  }
}

/* Opens the modal and starts loading the movie.
   triggerButton is remembered so focus can return to it on close. */
function openMovieDetails(movieId, triggerButton) {
  const dialog = elements.movieDetails;
  if (!dialog) return;

  detailsTriggerButton = triggerButton || null;
  cancelDetailsClosing(); // reopened during the fade-out: keep it open

  if (!dialog.open) {
    // showModal() adds the "open" attribute, which starts the CSS
    // opening animation (.movie-details[open] in styles.css)
    dialog.showModal();
    detailsOpenedAt = performance.now();
  }
  // Focus management: move keyboard focus into the dialog
  elements.movieDetailsClose?.focus();

  loadMovieDetails(movieId);
}

/* Closing animation (Step 13).
   dialog.close() hides a <dialog> instantly, which leaves no time for a
   fade-out. So closeMovieDetails() first adds .is-closing (the CSS fade),
   waits MODAL_CLOSE_MS, and then calls close(). The "close" event still
   does all the clean-up and focus restoration, exactly as before.
   A timer is used instead of waiting for "animationend", because that
   event never fires if animations are turned off, which could leave the
   window stuck open. */
const MODAL_CLOSE_MS = 180; // must match --duration-modal-close in styles.css
let detailsClosing = false;
let detailsCloseTimer = null;

function cancelDetailsClosing() {
  clearTimeout(detailsCloseTimer);
  detailsCloseTimer = null;
  detailsClosing = false;
  elements.movieDetails?.classList.remove('is-closing');
}

function closeMovieDetails() {
  const dialog = elements.movieDetails;
  if (!dialog?.open || detailsClosing) return; // not open, or already closing

  // Stop the trailer FIRST, so the video and its sound end immediately
  // instead of playing on during the fade-out.
  closeTrailer({ restoreFocus: false });

  // Reduced motion: close at once, with no fade
  if (prefersReducedMotion()) {
    dialog.close();
    return;
  }

  detailsClosing = true;
  dialog.classList.add('is-closing');
  detailsCloseTimer = setTimeout(() => {
    cancelDetailsClosing();
    if (dialog.open) dialog.close();
    // Clean-up happens in the dialog's "close" event (see setupMovieDetails),
    // because the browser can also close the dialog directly.
  }, MODAL_CLOSE_MS);
}

/* Focus trap: when Tab would leave the dialog, wrap around to the other end.
   (showModal() already blocks the page behind, this keeps the cycle tidy.)
   Only controls that can really receive focus count: disabled controls
   and elements that are hidden (no size on screen) are skipped, otherwise
   Tab could "land" on something invisible and seem to get stuck. */
function trapDetailsFocus(event) {
  if (event.key !== 'Tab') return;

  const dialog = elements.movieDetails;
  const focusable = Array.from(dialog.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getClientRects().length > 0);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* Connects all the modal's event listeners (runs once on the Explore page).

   Event listeners: addEventListener(type, handler) tells the browser
   "when this event happens on this element, run this function". */
function setupMovieDetails() {
  const dialog = elements.movieDetails;
  if (!dialog) return;

  // Every movie grid on this page (search results on Explore,
  // trending + popular on Home). Missing ones are null and skipped.
  const grids = [
    elements.searchResults,
    elements.trendingMovies,
    elements.popularMovies,
    elements.watchlistMovies,
  ].filter(Boolean);

  // Event delegation: instead of one listener per card (cards are created
  // and destroyed on every search), ONE listener per grid catches clicks
  // from any button inside it. closest() finds the "View Details" button
  // even if the click landed on its text.
  grids.forEach((grid) => {
    grid.addEventListener('click', (event) => {
      const button = event.target.closest('.view-details-button');
      if (!button || !grid.contains(button)) return;
      openMovieDetails(button.dataset.movieId, button);
    });
  });

  elements.movieDetailsClose?.addEventListener('click', closeMovieDetails);

  dialog.addEventListener('keydown', trapDetailsFocus);

  // Backdrop click: the panel fills the whole <dialog> box, so a click
  // whose target is the <dialog> itself must have landed on the dark
  // backdrop around it. We also check where the press STARTED, so
  // selecting text and releasing outside doesn't close the dialog, and
  // ignore clicks in the first moment after opening (a fast double-click
  // on "View Details" would otherwise close it again straight away).
  let pressStartedOnBackdrop = false;
  dialog.addEventListener('pointerdown', (event) => {
    pressStartedOnBackdrop = event.target === dialog;
  });
  dialog.addEventListener('click', (event) => {
    const justOpened = performance.now() - detailsOpenedAt < 400;
    if (event.target === dialog && pressStartedOnBackdrop && !justOpened) {
      closeMovieDetails();
    }
  });

  // Escape key: the browser fires "cancel" and then closes the dialog by
  // itself, which triggers the "close" event below.
  // Step 10: if a trailer is open, the first Escape closes only the
  // trailer (preventDefault keeps the details window open).
  // Step 13: otherwise we take over the closing so it can fade out.
  // Some browsers don't let a page block Escape twice in a row
  // (event.cancelable is then false); the browser closes the dialog at
  // once, and the "close" event below still cleans everything up.
  dialog.addEventListener('cancel', (event) => {
    if (activeTrailer && event.cancelable) {
      event.preventDefault();
      closeTrailer();
      return;
    }
    if (event.cancelable && !prefersReducedMotion()) {
      event.preventDefault();
      closeMovieDetails(); // animated close (ignored if already closing)
    }
  });

  // Runs however the dialog was closed (button, Escape, or backdrop)
  dialog.addEventListener('close', () => {
    cancelDetailsClosing(); // remove .is-closing so the next opening animates

    // Remove the trailer iframe first so the video stops immediately
    closeTrailer({ restoreFocus: false });
    // Stop any "Where to Watch" request that is still running
    cancelWatchProvidersRequest();

    // Stop any request still running for the modal that was just closed
    if (activeDetailsController) activeDetailsController.abort();
    activeDetailsController = null;
    loadingDetailsMovieId = null;
    latestDetailsRequestId += 1; // any late reply is now outdated

    dialog.removeAttribute('aria-busy');
    elements.movieDetailsContent?.replaceChildren();
    setDetailsTitle('Movie Details');

    // Focus management: return focus to the button that opened the modal.
    // If that card was removed (e.g. by a new search), use the search box
    // on Explore, or the main content area on other pages.
    const target = detailsTriggerButton && detailsTriggerButton.isConnected
      ? detailsTriggerButton
      : elements.searchInput || document.getElementById('main-content');
    // <main> can't normally receive focus; tabindex="-1" allows it by script only
    if (target && target.tagName === 'MAIN') target.setAttribute('tabindex', '-1');
    target?.focus();
    detailsTriggerButton = null;
  });
}


/* ----- 13. Movie trailers (Step 10) -----

   The TMDB videos endpoint (/movie/{id}/videos) returns a "results" array
   of every video TMDB knows for a movie: trailers, teasers, clips,
   featurettes, behind-the-scenes... Each item looks like:
     { site: "YouTube", type: "Trailer", official: true,
       iso_639_1: "en", key: "5PSNL1qE6VY", name: "Official Trailer", ... }
   The "key" is YouTube's video id. TMDB doesn't host videos; it tells us
   where to find them. The order is not meaningful, so we must CHOOSE the
   trailer ourselves (for Avatar, the first item is a featurette). */

// A YouTube video id is exactly 11 letters, digits, "-" or "_"
const YOUTUBE_KEY_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_EMBED_BASE = 'https://www.youtube-nocookie.com/embed/';
const TRAILER_VIEW_ID = 'trailer-view';

const trailerCache = new Map();    // movie id -> chosen trailer, or null (none)
const trailerRequests = new Map(); // movie id -> request in progress
let activeTrailer = null;          // { view, triggerButton } while a player is open

/* Trailer selection: picks the best trailer, or null if there is none.
   1. Keep only YouTube videos of type "Trailer" with a valid key.
   2. Score each one: official +2, English +1, so the order of preference is
      official English (3) > official other language (2) >
      unofficial English (1) > any other YouTube trailer (0).
   3. If scores tie, use the movie's release date: prefer the LAST trailer
      published before release (the final theatrical trailer). If every
      trailer came out after release (e.g. anniversary re-releases), take
      the EARLIEST one. Without a release date, the newest trailer wins.
      Example: Avatar (2009) gets its 2009 "Official Trailer", not the
      2022 "Back in Theatres" re-release trailer. */
function selectTrailer(videos, releaseDate = '') {
  if (!Array.isArray(videos)) return null;

  const trailers = videos.filter((video) => video
    && video.site === 'YouTube'
    && video.type === 'Trailer'
    && typeof video.key === 'string'
    && YOUTUBE_KEY_PATTERN.test(video.key));
  if (trailers.length === 0) return null;

  const score = (video) => (video.official === true ? 2 : 0) + (video.iso_639_1 === 'en' ? 1 : 0);
  const published = (video) => Date.parse(video.published_at) || 0;
  const release = /^\d{4}-\d{2}-\d{2}$/.test(releaseDate)
    ? Date.parse(`${releaseDate}T23:59:59Z`)
    : NaN;

  const compareDates = (a, b) => {
    if (Number.isNaN(release)) return published(b) - published(a); // newest first
    const aBefore = published(a) <= release;
    const bBefore = published(b) <= release;
    if (aBefore !== bBefore) return aBefore ? -1 : 1; // pre-release trailers first
    return aBefore
      ? published(b) - published(a)  // latest pre-release trailer
      : published(a) - published(b); // earliest post-release trailer
  };

  // sort() a copy: highest score first, then by the date rule above
  const [best] = trailers.slice().sort((a, b) => score(b) - score(a) || compareDates(a, b));

  return {
    key: best.key,
    name: getTextOrFallback(best.name, 'Trailer').slice(0, 200),
    official: best.official === true,
  };
}

/* loadMovieTrailer(movieId, releaseDate) — finds the trailer for one movie.
   releaseDate is optional ("2009-12-16") and only helps choose between
   several equally good trailers (see selectTrailer).
   Returns the trailer object, or null when the movie has no trailer.
   Throws an ApiError for invalid ids, API errors, and network failures.
   No duplicate requests: a finished answer is cached, and a request that
   is still running is shared with anyone else who asks for it. */
function loadMovieTrailer(movieId, releaseDate = '') {
  const id = Number(movieId);
  if (!Number.isInteger(id) || id <= 0) {
    return Promise.reject(new ApiError('INVALID_MOVIE_ID'));
  }
  if (trailerCache.has(id)) return Promise.resolve(trailerCache.get(id));
  if (trailerRequests.has(id)) return trailerRequests.get(id);

  const request = (async () => {
    try {
      // Becomes GET /api/tmdb?path=/movie/19995/videos (token added by the proxy)
      const data = await fetchMovies(`${ENDPOINTS.movieDetails}${id}${ENDPOINTS.movieVideos}`);
      if (!data || !Array.isArray(data.results)) throw new ApiError('API');

      const trailer = selectTrailer(data.results, releaseDate);
      trailerCache.set(id, trailer); // null is cached too: "no trailer"
      return trailer;
    } finally {
      trailerRequests.delete(id);
    }
  })();

  trailerRequests.set(id, request);
  return request;
}

// Small play-triangle icon for the Watch Trailer button
function createPlayIcon() {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('play-icon');
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', 'M8 5v14l11-7z');
  svg.append(path);
  return svg;
}

/* Fills the trailer area inside the details window:
   loading -> "Watch Trailer" (enabled) / "No Trailer Available" (disabled) / error.
   area.isConnected is false if the window was closed or another movie was
   opened while we waited, so a late answer can never show the wrong trailer. */
async function setupTrailerArea(details, area) {
  const button = createElement('button', 'button watch-trailer-button');
  button.type = 'button';
  button.disabled = true;
  const buttonText = createElement('span', '', 'Watch Trailer');
  button.append(createPlayIcon(), buttonText);

  const status = createElement('p', 'details-trailer-status loading-indicator', 'Finding trailers…');
  status.setAttribute('role', 'status');
  area.replaceChildren(button, status);

  try {
    const trailer = await loadMovieTrailer(details.id, details.releaseDate);
    if (!area.isConnected) return; // outdated answer: ignore it

    if (!trailer) {
      // Unavailable state: a clearly disabled button plus a short explanation
      buttonText.textContent = 'No Trailer Available';
      status.className = 'details-trailer-status';
      status.textContent = 'No trailer is available for this movie yet.';
      return;
    }

    button.disabled = false;
    // aria-expanded / aria-controls: the button shows and hides the player
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', TRAILER_VIEW_ID);
    status.textContent = '';
    status.hidden = true;
    button.addEventListener('click', () => openTrailer(trailer, details, button));
  } catch (error) {
    if (!area.isConnected) return;

    let message = getErrorMessage(error);
    if (error.type === 'NOT_FOUND') message = ERROR_MESSAGES.TRAILER_NOT_FOUND;
    console.error(`Loading the trailer for movie ${details.id} failed:`, error);

    buttonText.textContent = 'Trailer Unavailable';
    status.className = 'details-trailer-status is-error';
    status.setAttribute('role', 'alert');
    status.textContent = message;

    // Errors are not cached, so "Try again" sends a fresh request
    if (isRetryable(error)) {
      area.append(createRetryButton(() => retryTrailer(details, area)));
    }
  }
}

/* "Try again" removes the button that has keyboard focus, so focus is
   parked on the trailer area while loading, then moved to whatever
   control appears next (Watch Trailer, or Try again if it failed again). */
async function retryTrailer(details, area) {
  area.tabIndex = -1; // focusable by script only, so focus stays inside the dialog
  area.focus();
  await setupTrailerArea(details, area);
  if (!area.isConnected || document.activeElement !== area) return;

  const next = area.querySelector('.watch-trailer-button:not([disabled])')
    || area.querySelector('.button-small')
    || elements.movieDetailsClose;
  next?.focus();
}

/* Opens the player inside the details window (no second dialog).
   iframe creation: an <iframe> shows another web page (here YouTube's
   player) inside ours. We build it with createElement and set each
   attribute separately, never with an HTML string. The video key was
   validated by YOUTUBE_KEY_PATTERN, so the URL can only point at
   youtube-nocookie.com/embed/<11 safe characters>. */
function openTrailer(trailer, details, triggerButton) {
  const content = elements.movieDetailsContent;
  if (!content || !YOUTUBE_KEY_PATTERN.test(trailer.key)) return;

  // Already open: just move focus to it
  if (activeTrailer && activeTrailer.view.isConnected) {
    activeTrailer.view.querySelector('.trailer-close')?.focus();
    return;
  }

  const view = createElement('section', 'trailer-view');
  view.id = TRAILER_VIEW_ID;
  view.setAttribute('aria-label', `Trailer for ${details.title}`);

  const header = createElement('div', 'trailer-view-header');
  const heading = createElement('h3', 'trailer-view-title', trailer.name);
  const closeButton = createElement('button', 'button button-secondary button-small trailer-close', 'Close Trailer');
  closeButton.type = 'button';
  closeButton.addEventListener('click', () => closeTrailer());
  header.append(heading, closeButton);

  // YouTube embedding: the privacy-enhanced "nocookie" domain, with
  // related videos limited to the same channel (rel=0).
  // Step 13: NO autoplay. The player appears (with a short fade-in, see
  // .trailer-view in styles.css) and the visitor presses play when ready,
  // so sound never starts unexpectedly (important for screen-reader users).
  const url = new URL(`${YOUTUBE_EMBED_BASE}${encodeURIComponent(trailer.key)}`);
  url.searchParams.set('rel', '0');

  const frame = createElement('div', 'trailer-frame');
  const iframe = document.createElement('iframe');
  iframe.src = url.toString();
  iframe.title = `${trailer.name} – ${details.title}`; // describes the frame for screen readers
  iframe.allow = 'encrypted-media; picture-in-picture; fullscreen';
  iframe.allowFullscreen = true;
  // YouTube needs to know which site embeds the player
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.append(iframe);

  view.append(header, frame);
  content.prepend(view); // above the poster and details

  activeTrailer = { view, triggerButton };
  triggerButton.setAttribute('aria-expanded', 'true');

  // Show the player from the top and move keyboard focus to its Close button
  const panel = elements.movieDetails?.querySelector('.movie-details-panel');
  if (panel) panel.scrollTop = 0;
  closeButton.focus();
}

/* Video cleanup: removing the iframe from the page stops the video and
   its sound immediately (pausing would leave it loaded in the background).
   Called by Close Trailer, Escape, closing the window, and opening
   another movie. Returns true if a trailer was open. */
function closeTrailer({ restoreFocus = true } = {}) {
  if (!activeTrailer) return false;

  const { view, triggerButton } = activeTrailer;
  activeTrailer = null;

  // If keyboard focus is inside the player we're about to remove (and focus
  // isn't being sent back to Watch Trailer), keep it inside the dialog.
  const focusWasInside = view.contains(document.activeElement);
  view.remove();
  if (focusWasInside && !restoreFocus && elements.movieDetails?.open) {
    elements.movieDetailsClose?.focus();
  }

  if (triggerButton.isConnected) {
    triggerButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) triggerButton.focus();
  }
  return true;
}


/* ----- 14. Where to Watch: streaming availability (Step 11) -----

   This app does NOT stream movies. It shows where a movie may be available
   to watch legally, using JustWatch data that TMDB shares.

   The watch-provider endpoint (/movie/{id}/watch/providers) returns
   country-specific JSON. "results" is an object with one entry per
   two-letter country code:
     results: {
       US: { link: "https://www.themoviedb.org/movie/19995-avatar/watch?locale=US",
             flatrate: [ { provider_id: 337, provider_name: "Disney Plus", logo_path: "/....jpg", display_priority: 1 } ],
             rent: [ ... ], buy: [ ... ] },
       CA: { ... }, GB: { ... }, ...
     }
   Inside each country:
   - flatrate = included with a subscription ("Stream")
   - rent     = pay once to watch for a limited time ("Rent")
   - buy      = pay once to keep it in a digital library ("Buy")
   Any of these lists, or a whole country, may be missing.

   One request returns ALL countries, so changing the country selector
   reuses the saved reply instead of asking TMDB again. */

const WATCH_REGION_CODES = new Set(CONFIG.WATCH_REGIONS.map((region) => region.code));
let selectedWatchRegion = CONFIG.WATCH_REGIONS[0].code; // remembered while on this page

const providersCache = new Map();    // movie id -> results object (all countries)
const providersRequests = new Map(); // movie id -> request in progress
let activeProvidersController = null;

// The three categories, in display order
const PROVIDER_CATEGORIES = [
  { key: 'flatrate', label: 'Stream', hint: 'Included with a subscription' },
  { key: 'rent', label: 'Rent', hint: 'Pay to watch for a limited time' },
  { key: 'buy', label: 'Buy', hint: 'Pay once to keep it' },
];

/* Cleans one provider list: keeps well-formed entries, sorts them by
   TMDB's display_priority, and removes duplicates (same provider_id)
   INSIDE this list only. The same provider can still appear under
   Stream and Rent, because those are different ways to watch. */
function cleanProviderList(list) {
  if (!Array.isArray(list)) return [];

  const seen = new Set();
  return list
    .filter((provider) => provider
      && Number.isInteger(provider.provider_id)
      && typeof provider.provider_name === 'string'
      && provider.provider_name.trim() !== '')
    .sort((a, b) => (Number(a.display_priority) || 999) - (Number(b.display_priority) || 999))
    .filter((provider) => {
      if (seen.has(provider.provider_id)) return false;
      seen.add(provider.provider_id);
      return true;
    })
    .map((provider) => ({
      id: provider.provider_id,
      name: provider.provider_name.trim().slice(0, 80),
      // Same TMDB image rules as posters: validated path + IMAGE_BASE_URL + size
      logoUrl: getMoviePosterUrl(provider.logo_path, CONFIG.PROVIDER_LOGO_SIZE),
    }));
}

// Only accept TMDB's own https watch page (never invented streaming links)
function getSafeWatchLink(link) {
  try {
    const url = new URL(link);
    const isTmdb = url.hostname === 'www.themoviedb.org' || url.hostname === 'themoviedb.org';
    return url.protocol === 'https:' && isTmdb ? url.href : null;
  } catch {
    return null; // missing or not a URL
  }
}

/* Picks one country out of the "results" object: data.results[region].
   Object.hasOwn() makes sure the key really belongs to the data.
   Returns { link, flatrate, rent, buy } or null when nothing is listed. */
function getRegionProviders(allRegions, region) {
  if (!allRegions || typeof allRegions !== 'object' || !Object.hasOwn(allRegions, region)) {
    return null;
  }
  const regionData = allRegions[region];
  if (!regionData || typeof regionData !== 'object') return null;

  const providers = {
    link: getSafeWatchLink(regionData.link),
    flatrate: cleanProviderList(regionData.flatrate),
    rent: cleanProviderList(regionData.rent),
    buy: cleanProviderList(regionData.buy),
  };
  const hasAny = providers.flatrate.length + providers.rent.length + providers.buy.length > 0;
  return hasAny ? providers : null;
}

/* loadWatchProviders(movieId, region) — streaming availability for one
   movie in one country. Returns { link, flatrate, rent, buy } or null.
   The first call for a movie asks the proxy; later calls (any country)
   reuse the saved reply. A request that is already running is shared,
   so there are never two requests for the same movie at once. */
async function loadWatchProviders(movieId, region = selectedWatchRegion) {
  const id = Number(movieId);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError('INVALID_MOVIE_ID');
  const regionCode = WATCH_REGION_CODES.has(region) ? region : CONFIG.WATCH_REGIONS[0].code;

  if (!providersCache.has(id)) {
    if (!providersRequests.has(id)) {
      const controller = new AbortController();
      activeProvidersController = controller;

      const request = (async () => {
        try {
          // Becomes GET /api/tmdb?path=/movie/19995/watch/providers
          const data = await fetchMovies(
            `${ENDPOINTS.movieDetails}${id}${ENDPOINTS.watchProviders}`,
            {},
            { signal: controller.signal },
          );
          if (!data || typeof data.results !== 'object' || data.results === null) {
            throw new ApiError('API');
          }
          providersCache.set(id, data.results); // all countries, saved for reuse
        } finally {
          providersRequests.delete(id);
          if (activeProvidersController === controller) activeProvidersController = null;
        }
      })();
      providersRequests.set(id, request);
    }
    await providersRequests.get(id);
  }

  return getRegionProviders(providersCache.get(id), regionCode);
}

// Clean-up when the details window closes or another movie is opened
function cancelWatchProvidersRequest() {
  if (activeProvidersController) activeProvidersController.abort();
  activeProvidersController = null;
}

/* Builds the "Where to Watch" section (heading, country selector, results
   area, attribution). Its content is filled by showWatchProviders(). */
function createWatchSection(details) {
  const section = createElement('section', 'watch-section');
  section.setAttribute('aria-labelledby', 'watch-heading');

  const header = createElement('div', 'watch-header');
  const intro = createElement('div');
  const heading = createElement('h3', 'watch-title', 'Where to Watch');
  heading.id = 'watch-heading';
  intro.append(
    heading,
    createElement('p', 'watch-intro',
      'See where this movie may be available to stream, rent, or buy legally. Movie Discovery doesn’t stream movies itself.'),
  );

  // Country selector (US first, the default)
  const regionField = createElement('div', 'watch-region');
  const label = createElement('label', '', 'Country');
  label.htmlFor = 'watch-region-select';
  const select = createElement('select', 'form-control select-control');
  select.id = 'watch-region-select';
  CONFIG.WATCH_REGIONS.forEach((region) => select.append(new Option(region.name, region.code)));
  select.value = selectedWatchRegion;
  regionField.append(label, select);
  header.append(intro, regionField);

  const results = createElement('div', 'watch-results');
  // A short sentence screen readers hear after each update
  const announcer = createElement('p', 'visually-hidden watch-announcer');
  announcer.setAttribute('role', 'status');

  // Required data attribution
  const attribution = createElement('p', 'watch-attribution', 'Streaming availability data provided by JustWatch via TMDB.');

  section.append(header, results, announcer, attribution);

  // Changing the country re-renders from the saved reply (no page reload)
  select.addEventListener('change', () => {
    selectedWatchRegion = WATCH_REGION_CODES.has(select.value) ? select.value : CONFIG.WATCH_REGIONS[0].code;
    showWatchProviders(details, section);
  });

  return section;
}

// One provider: logo (or a letter badge if the logo is missing/broken) + name
function createProviderItem(provider) {
  const item = createElement('li', 'provider');

  const fallback = () => {
    const badge = createElement('span', 'provider-logo provider-logo-fallback', provider.name.charAt(0).toUpperCase());
    badge.setAttribute('aria-hidden', 'true');
    return badge;
  };

  if (provider.logoUrl) {
    const logo = document.createElement('img');
    logo.className = 'provider-logo';
    logo.src = provider.logoUrl;
    logo.alt = ''; // the provider name is written right next to it
    logo.width = 40;
    logo.height = 40;
    logo.loading = 'lazy';
    logo.addEventListener('error', () => logo.replaceWith(fallback()), { once: true });
    item.append(logo);
  } else {
    item.append(fallback());
  }

  item.append(createElement('span', 'provider-name', provider.name));
  return item;
}

/* Dynamic rendering of one country's availability: three labelled
   categories (empty ones say so), plus TMDB's watch page link if valid. */
function renderWatchProviders(results, providers) {
  if (!providers) {
    results.replaceChildren(createElement('p', 'watch-message', ERROR_MESSAGES.PROVIDERS_NONE));
    return;
  }

  const categories = createElement('div', 'watch-categories');
  PROVIDER_CATEGORIES.forEach(({ key, label, hint }) => {
    const category = createElement('div', 'watch-category');
    category.append(
      createElement('h4', 'watch-category-title', label),
      createElement('p', 'watch-category-hint', hint),
    );

    const list = providers[key];
    if (list.length > 0) {
      const ul = createElement('ul', 'provider-list');
      ul.setAttribute('aria-label', `${label} options`);
      list.forEach((provider) => ul.append(createProviderItem(provider)));
      category.append(ul);
    } else {
      category.append(createElement('p', 'watch-category-empty', `No ${label.toLowerCase()} options listed.`));
    }
    categories.append(category);
  });

  const parts = [categories];
  if (providers.link) {
    // New tab with rel="noopener noreferrer": the new page can't control
    // this one, and it isn't told which page linked to it.
    const link = createElement('a', 'button button-secondary button-small watch-link', 'View Watching Options');
    link.href = providers.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(createElement('span', 'visually-hidden', ' on TMDB (opens in a new tab)'));
    parts.push(link);
  }
  results.replaceChildren(...parts);
}

/* Loads (or reuses) the data and draws it for the selected country.
   Error handling: every problem becomes a message inside this section,
   so the rest of the details window keeps working. section.isConnected
   is false if the window closed or another movie opened meanwhile, so
   a late reply is ignored instead of showing the wrong movie's providers. */
async function showWatchProviders(details, section) {
  const results = section.querySelector('.watch-results');
  const announcer = section.querySelector('.watch-announcer');
  const region = selectedWatchRegion;
  const regionName = CONFIG.WATCH_REGIONS.find((item) => item.code === region)?.name || region;

  // Loading message only when we actually have to wait for the network
  if (!providersCache.has(Number(details.id))) {
    const loading = createElement('p', 'watch-message loading-indicator', 'Checking streaming availability…');
    loading.setAttribute('role', 'status');
    results.replaceChildren(loading);
    results.setAttribute('aria-busy', 'true');
  }

  try {
    const providers = await loadWatchProviders(details.id, region);
    // Outdated: window closed, another movie opened, or country changed again
    if (!section.isConnected || region !== selectedWatchRegion) return;

    renderWatchProviders(results, providers);
    if (announcer) {
      announcer.textContent = providers
        ? `Where to Watch updated for ${regionName}.`
        : `No streaming availability listed for ${regionName}.`;
    }
  } catch (error) {
    if (error.name === 'AbortError' || !section.isConnected) return;

    let message = getErrorMessage(error);
    if (error.type === 'NOT_FOUND') message = ERROR_MESSAGES.PROVIDERS_NOT_FOUND;
    console.error(`Loading watch providers for movie ${details.id} failed:`, error);

    const errorMessage = createElement('p', 'watch-message is-error', message);
    errorMessage.setAttribute('role', 'alert');
    const parts = [errorMessage];

    // Connection/server problems can be retried; invalid ids and 404s cannot.
    // The retry reloads only this section, not the details or the page.
    if (isRetryable(error)) {
      parts.push(createRetryButton(async () => {
        // Keep keyboard focus inside the dialog while the button is replaced
        results.tabIndex = -1;
        results.focus();
        await showWatchProviders(details, section);
        if (document.activeElement === results) {
          (results.querySelector('a, button') || section.querySelector('select'))?.focus();
        }
      }));
    }
    results.replaceChildren(...parts);
  } finally {
    if (section.isConnected) results.removeAttribute('aria-busy');
  }
}


/* ----- 15. Connection test (developer helper, Steps 2–5) -----
   No longer runs automatically. To check the proxy by hand, open the
   Explore page, press F12, and type testTmdbConnection() in the Console.
   It searches for "Avatar", logs a table, and renders the cards. */

async function testTmdbConnection() {
  const container = elements.searchResults;

  clearError();
  setLoading(true);
  // aria-busy tells screen readers this area is still updating
  if (container) container.setAttribute('aria-busy', 'true');

  try {
    const data = await fetchMovies(ENDPOINTS.searchMovies, { query: 'Avatar' });

    if (!Array.isArray(data.results)) {
      throw new ApiError('API');
    }

    const movies = transformMovieData(data.results);

    console.log(`TMDB connection OK: ${data.total_results} results for "Avatar" (page 1 shows ${movies.length}).`);

    // console.table() prints an array of objects as rows and columns.
    // The overview is shortened here only so the table stays readable.
    console.table(movies.map((movie) => ({
      id: movie.id,
      title: movie.title,
      releaseDate: movie.releaseDate,
      rating: movie.rating ?? 'Not rated',
      genreIds: movie.genreIds.join(', '),
      posterUrl: movie.posterUrl ?? 'No poster',
      overview: movie.overview.length > 60 ? `${movie.overview.slice(0, 60)}…` : movie.overview,
    })));

    // The full transformed objects, for inspecting every field
    console.log('Transformed movies:', movies);

    // Step 5: show the live results as cards
    renderMovies(movies, container);
    if (elements.resultsSummary) {
      elements.resultsSummary.textContent = movies.length > 0
        ? `Showing ${movies.length} of ${(Number(data.total_results) || movies.length).toLocaleString()} results for "Avatar"`
        : 'No results for "Avatar"';
    }
  } catch (error) {
    showError(getErrorMessage(error));
    console.error('TMDB connection test failed:', error);

    // Never show stale or fake movies after a failed request
    if (container) container.replaceChildren();
    if (elements.resultsSummary) elements.resultsSummary.textContent = '';
  } finally {
    setLoading(false);
    if (container) container.removeAttribute('aria-busy');
  }
}


/* ----- 16. Scroll reveal with IntersectionObserver (Step 13) -----

   IntersectionObserver is a built-in browser tool that tells us when an
   element enters (or leaves) the visible part of the screen. It is much
   more efficient than listening to every "scroll" event and measuring
   elements ourselves: the browser does the checking, and our function only
   runs when something actually crosses into view.

   How the reveal works:
   1. At start-up we measure each section ONCE. Sections already on screen
      are left alone (no flicker). Only sections further down get .reveal,
      which makes them transparent and slightly lower (see styles.css).
   2. The observer watches those sections. When one scrolls into view, we
      add .is-revealed (CSS fades it in and slides it up), then stop
      watching it with unobserve(), so it animates only once.
   3. Progressive enhancement: if JavaScript is off, the observer isn't
      supported, or the visitor prefers reduced motion, .reveal is never
      added, so every section is simply visible. */

let revealObserver = null;

function setupScrollReveal() {
  if (revealObserver) return; // only one observer, ever
  if (!('IntersectionObserver' in window) || prefersReducedMotion()) return;

  const sections = Array.from(document.querySelectorAll('main > section:not(.hero)'));

  // Read all positions first, then change classes (reading layout after
  // each change would make the browser recalculate the page every time).
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const belowTheFold = sections.filter((section) => section.getBoundingClientRect().top > viewportHeight * 0.9);
  if (belowTheFold.length === 0) return;

  let remaining = belowTheFold.length;
  revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-revealed');
      observer.unobserve(entry.target); // animate once only
      remaining -= 1;
    });
    if (remaining === 0) observer.disconnect(); // nothing left to watch
  }, {
    // Reveal when a section's top passes 90% of the screen height
    rootMargin: '0px 0px -10% 0px',
    threshold: 0,
  });

  belowTheFold.forEach((section) => {
    section.classList.add('reveal');
    revealObserver.observe(section);
  });
}


/* ----- 17. Start-up -----
   Reads which page is open. Page-specific features will be added
   to this switch one at a time in later steps. */

function init() {
  const currentPage = document.body.dataset.page;

  // Step 13: shared animation helpers (each sets itself up only once)
  setupCardAnimations();
  setupScrollReveal();

  switch (currentPage) {
    case 'home':
      // Step 8: "View Details" on homepage cards, then load both sections.
      setupMovieDetails();
      setupWatchlistSync(); // Step 9: keep Save buttons up to date
      loadHomepageMovies();
      break;
    case 'explore':
      // Step 6: searches run only when the visitor submits the form.
      setupSearchForm();
      // Step 7: "View Details" buttons open the movie details modal.
      setupMovieDetails();
      // Step 8: fill the genre dropdown and filter results when it changes.
      setupGenreFilter();
      loadGenres();
      setupWatchlistSync(); // Step 9: keep Save buttons up to date
      break;
    case 'watchlist':
      // Step 9: show saved movies from localStorage (no API request needed)
      setupMovieDetails();
      setupWatchlistSync();
      renderWatchlist();
      break;
    default:
      // Unknown page: nothing to set up.
      break;
  }
}

init();
