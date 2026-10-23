/* ==========================================================================
   api/tmdb.js — Secure TMDB proxy (Vercel serverless function)
   Route: /api/tmdb   (Vercel turns every file in /api into a route)

   Why this exists:
   The TMDB API Read Access Token must stay secret. The browser calls this
   function instead of TMDB. This function runs on the server, reads the
   token from the TMDB_READ_ACCESS_TOKEN environment variable, adds it to
   the request, and sends TMDB's JSON back. The token is never sent to
   the browser.

   How the browser calls it:
     GET /api/tmdb?path=/search/movie&query=Avatar
     GET /api/tmdb?path=/movie/19995          (movie details)
     GET /api/tmdb?path=/movie/19995/videos   (trailers)
     GET /api/tmdb?path=/movie/19995/watch/providers  (where to watch)
     GET /api/tmdb?path=/trending/movie/week  (homepage)
     GET /api/tmdb?path=/movie/popular        (homepage)
     GET /api/tmdb?path=/genre/movie/list     (genre dropdown)

   Safety rules:
   - Only GET requests are accepted.
   - "path" must exactly match an entry in ALLOWED_ENDPOINTS, or fully
     match a pattern in ALLOWED_PATTERN_ENDPOINTS (e.g. /movie/{numeric id}).
   - Every other query parameter must be on that endpoint's allow-list
     and pass its validation check. Anything else is rejected.
   - The TMDB host and API version (/3) are fixed here on the server,
     so the proxy cannot be pointed at any other URL.
   - CORS: browsers may only call this proxy from the exact origins in
     ALLOWED_ORIGINS (GitHub Pages + local development) or from the same
     site that hosts it. Pages on any other website get 403.
   ========================================================================== */

'use strict';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const REQUEST_TIMEOUT_MS = 8000;


/* ----- CORS (Cross-Origin Resource Sharing) -----
   An "origin" is scheme + host + port, e.g. https://fala243.github.io
   (the /movie-discovery-capstone/ path is NOT part of the origin).

   Browsers block a page on one origin from reading responses from another
   origin unless the server says it's allowed, using the
   Access-Control-Allow-Origin header. The frontend lives on GitHub Pages
   and this proxy lives on Vercel, so the proxy must name GitHub Pages
   explicitly. We never use "*" (any website), because then any site could
   use our proxy and our TMDB quota.

   Browsers send the page's origin in the "Origin" request header:
   - allowed origin  -> we echo it back in Access-Control-Allow-Origin
   - other origin    -> 403, and TMDB is never called
   - no Origin       -> a same-site request (e.g. the copy of the site that
                        Vercel itself hosts, or `vercel dev`) or a tool like
                        curl/Postman; CORS doesn't apply, so it continues.

   Only add exact origins here (no wildcards, no trailing slash). */
const ALLOWED_ORIGINS = new Set([
  'https://fala243.github.io',  // GitHub Pages (production frontend)
  'http://localhost:5500',      // VS Code Live Server
  'http://127.0.0.1:5500',
  'http://localhost:8000',      // python -m http.server
  'http://127.0.0.1:8000',
]);

// true if this origin may call the proxy from a browser
function isAllowedOrigin(origin, host) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Same site: a page served by this Vercel deployment (or `vercel dev`)
  // calling its own /api/tmdb. Browsers usually omit Origin then, but
  // some send it, so it is accepted when the host matches exactly.
  try {
    return typeof host === 'string' && new URL(origin).host === host;
  } catch {
    return false; // "null" (file://) or malformed origins
  }
}

/* Adds CORS headers. Returns false if the browser origin isn't allowed.
   "Vary: Origin" tells caches (Vercel's CDN, browsers) that the reply
   depends on the Origin header, so a reply cached for one origin is never
   reused for another. */
function applyCors(req, res) {
  res.setHeader('Vary', 'Origin');
  const origin = req.headers && req.headers.origin;
  if (!origin) return true;
  if (!isAllowedOrigin(origin, req.headers.host)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  return true;
}


/* ----- Validation helpers ----- */

const isNonEmptyText = (max) => (value) => value.trim().length > 0 && value.length <= max;
const isPageNumber = (value) => /^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= 500;
const isYear = (value) => /^\d{4}$/.test(value);
const isBoolean = (value) => value === 'true' || value === 'false';
const isLanguage = (value) => /^[a-z]{2}(-[A-Z]{2})?$/.test(value); // e.g. "en" or "en-US"
const isRegion = (value) => /^[A-Z]{2}$/.test(value);                // e.g. "US"


/* ----- Approved TMDB endpoints -----
   Key: the TMDB path (without /3).
   params:   allowed query parameters and how to validate each one.
   required: parameters that must be present.
   defaults: values added when the browser does not send them.

   Every endpoint lists only the parameters it really needs. */

const ALLOWED_ENDPOINTS = new Map([
  // This week's trending movies (homepage)
  ['/trending/movie/week', {
    required: [],
    defaults: {},
    params: {
      page: isPageNumber,
      language: isLanguage,
    },
  }],
  // Popular movies (homepage)
  ['/movie/popular', {
    required: [],
    defaults: {},
    params: {
      page: isPageNumber,
      language: isLanguage,
      region: isRegion,
    },
  }],
  // Official list of movie genres, e.g. { id: 28, name: "Action" } (Explore page dropdown)
  ['/genre/movie/list', {
    required: [],
    defaults: {},
    params: {
      language: isLanguage,
    },
  }],
  ['/search/movie', {
    required: ['query'],
    defaults: { include_adult: 'false' },
    params: {
      query: isNonEmptyText(100),
      page: isPageNumber,
      include_adult: isBoolean,
      language: isLanguage,
      region: isRegion,
      year: isYear,
      primary_release_year: isYear,
    },
  }],
]);


/* ----- Approved endpoints that contain an ID -----
   Movie details live at /movie/{movie_id}, e.g. /movie/19995, so the path
   cannot be matched exactly. Each pattern must match the WHOLE path:
   [1-9]\d{0,9} allows only a positive whole number (1 to 10 digits, no
   leading zero), so "/movie/0", "/movie/abc", "/movie/-5", and
   "/movie/popular" are rejected. Only the "/videos" and "/watch/providers"
   sub-paths are allowed after an id; others such as "/movie/550/credits"
   are rejected. */

const ALLOWED_PATTERN_ENDPOINTS = [
  // Movie details: /movie/19995
  {
    pattern: /^\/movie\/[1-9]\d{0,9}$/,
    rules: {
      required: [],
      defaults: {},
      params: { language: isLanguage },
    },
  },
  // Movie videos (trailers, teasers, clips): /movie/19995/videos
  {
    pattern: /^\/movie\/[1-9]\d{0,9}\/videos$/,
    rules: {
      required: [],
      defaults: {},
      params: { language: isLanguage },
    },
  },
  // Where to watch (JustWatch data via TMDB): /movie/19995/watch/providers
  // Takes no query parameters; the reply contains every country at once.
  {
    pattern: /^\/movie\/[1-9]\d{0,9}\/watch\/providers$/,
    rules: {
      required: [],
      defaults: {},
      params: {},
    },
  },
];

// Finds the rules for a path: exact matches first, then ID patterns
function findEndpointRules(path) {
  if (ALLOWED_ENDPOINTS.has(path)) {
    return ALLOWED_ENDPOINTS.get(path);
  }
  const match = ALLOWED_PATTERN_ENDPOINTS.find((endpoint) => endpoint.pattern.test(path));
  return match ? match.rules : null;
}


/* ----- Request validation -----
   Returns { ok: true, path, params } or { ok: false, message }. */

function validateRequest(query) {
  const { path, ...rest } = query;

  if (typeof path !== 'string') {
    return { ok: false, message: 'Missing or invalid "path" parameter.' };
  }

  const rules = findEndpointRules(path);
  if (!rules) {
    return { ok: false, message: 'This endpoint is not allowed.' };
  }

  const params = {};
  for (const [name, value] of Object.entries(rest)) {
    if (!Object.hasOwn(rules.params, name)) {
      return { ok: false, message: `Unknown parameter "${name.slice(0, 30)}".` };
    }
    // A repeated parameter (?query=a&query=b) arrives as an array
    if (typeof value !== 'string') {
      return { ok: false, message: `Parameter "${name}" may only appear once.` };
    }
    if (!rules.params[name](value)) {
      return { ok: false, message: `Invalid value for "${name}".` };
    }
    params[name] = value;
  }

  for (const name of rules.required) {
    if (!(name in params)) {
      return { ok: false, message: `Missing required parameter "${name}".` };
    }
  }

  return { ok: true, path, params: { ...rules.defaults, ...params } };
}


/* ----- Error response helper -----
   Every error uses the same JSON shape: { error: { code, message } }
   The frontend uses "code" to choose a friendly message.
   Codes: ORIGIN_NOT_ALLOWED 403, METHOD_NOT_ALLOWED 405, INVALID_REQUEST 400, NOT_FOUND 404,
   RATE_LIMITED 429, SERVER_CONFIG_ERROR 500, INTERNAL_ERROR 500,
   TMDB_AUTH_FAILED / TMDB_UNREACHABLE / TMDB_BAD_RESPONSE / TMDB_ERROR 502,
   TMDB_TIMEOUT 504. Messages never include the token or TMDB's details. */

function sendError(res, status, code, message) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error: { code, message } });
}


/* ----- Main handler -----
   Wrapped in try/catch so that even an unexpected bug returns the usual
   JSON error shape (code INTERNAL_ERROR) instead of an HTML error page.
   The real error goes to the server logs only, never to the browser. */

module.exports = async function handler(req, res) {
  try {
    return await handleRequest(req, res);
  } catch (error) {
    console.error('Unexpected proxy error:', error);
    if (res.headersSent) return undefined;
    return sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong on the server.');
  }
};

async function handleRequest(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // 0. CORS: refuse browser pages from websites that aren't on the list
  //    (checked before anything else, so TMDB is never called for them)
  if (!applyCors(req, res)) {
    return sendError(res, 403, 'ORIGIN_NOT_ALLOWED', 'This website is not allowed to use this API.');
  }

  // Preflight: before some cross-origin requests the browser first sends
  // OPTIONS to ask "may I?". We answer 204 (no content) with what is
  // allowed. Our GET with only an Accept header usually needs no
  // preflight, but answering correctly keeps the proxy standards-compliant.
  // Max-Age lets the browser remember the answer for a day.
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(204).end();
  }

  // 1. Only allow GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET requests are allowed.');
  }

  // 2. Read the token from the server environment (never from the request)
  const token = process.env.TMDB_READ_ACCESS_TOKEN;
  if (!token) {
    console.error('TMDB_READ_ACCESS_TOKEN is not set on the server.');
    return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'The server is not configured to reach the movie service.');
  }

  // 3. Validate the path and query parameters
  const validation = validateRequest(req.query || {});
  if (!validation.ok) {
    return sendError(res, 400, 'INVALID_REQUEST', validation.message);
  }

  // 4. Build the TMDB URL from fixed parts plus validated parameters
  const tmdbUrl = new URL(TMDB_BASE_URL + validation.path);
  for (const [name, value] of Object.entries(validation.params)) {
    tmdbUrl.searchParams.set(name, value);
  }

  // 5. Call TMDB with the token in the Authorization header
  let tmdbResponse;
  try {
    tmdbResponse = await fetch(tmdbUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error.name === 'TimeoutError') {
      return sendError(res, 504, 'TMDB_TIMEOUT', 'The movie service took too long to respond.');
    }
    console.error('Could not reach TMDB:', error.message);
    return sendError(res, 502, 'TMDB_UNREACHABLE', 'Could not reach the movie service.');
  }

  // 6. Read TMDB's JSON (the same time limit covers reading the body)
  let data;
  try {
    data = await tmdbResponse.json();
  } catch (error) {
    if (error && error.name === 'TimeoutError') {
      return sendError(res, 504, 'TMDB_TIMEOUT', 'The movie service took too long to respond.');
    }
    return sendError(res, 502, 'TMDB_BAD_RESPONSE', 'The movie service sent an unreadable response.');
  }

  // 7. Translate TMDB errors (details go to server logs only)
  if (!tmdbResponse.ok) {
    console.error(`TMDB error ${tmdbResponse.status}:`, data && data.status_message);

    if (tmdbResponse.status === 401) {
      return sendError(res, 502, 'TMDB_AUTH_FAILED', 'The movie service rejected the server credentials.');
    }
    if (tmdbResponse.status === 404) {
      return sendError(res, 404, 'NOT_FOUND', 'The requested movie data was not found.');
    }
    if (tmdbResponse.status === 429) {
      return sendError(res, 429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.');
    }
    return sendError(res, 502, 'TMDB_ERROR', 'The movie service returned an error.');
  }

  // 8. Success: return TMDB's JSON. Vercel's CDN may cache it for 5 minutes.
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json(data);
}
