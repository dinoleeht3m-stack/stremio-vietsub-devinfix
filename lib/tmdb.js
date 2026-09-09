/**
 * TMDB auth + ID resolution.
 * Users sign in with themoviedb.org username/password.
 * The application API key stays on the server (TMDB_API_KEY) — never on the form.
 */

const axios = require('axios');

const TMDB_API = 'https://api.themoviedb.org/3';
const idCache = new Map();
const MAX_CACHE = 500;

function getApiKey() {
  return String(process.env.TMDB_API_KEY || '').trim();
}

function tmdbClient() {
  return axios.create({
    baseURL: TMDB_API,
    timeout: 12000,
    params: { api_key: getApiKey() },
    headers: { Accept: 'application/json' },
  });
}

function tmdbErrorMessage(err) {
  var data = err.response && err.response.data;
  return (data && (data.status_message || data.error)) || err.message || 'Ping TMDB thất bại.';
}

/**
 * Validate TMDB username/password and return a session (quick ping).
 */
async function pingCredentials(username, password) {
  if (!getApiKey()) {
    return {
      ok: false,
      error: 'Server chưa cấu hình TMDB_API_KEY. Thêm biến môi trường trên host (không nhập trên form).',
      code: 'no_api_key',
    };
  }

  username = String(username || '').trim();
  password = String(password || '');

  if (!username || !password) {
    return { ok: false, error: 'Nhập username và password TMDB.', code: 'missing_credentials' };
  }

  try {
    var http = tmdbClient();
    var tokenRes = await http.get('/authentication/token/new');
    var requestToken = tokenRes.data && tokenRes.data.request_token;
    if (!requestToken) {
      return { ok: false, error: 'Không lấy được request token từ TMDB.', code: 'token' };
    }

    await http.post('/authentication/token/validate_with_login', {
      username: username,
      password: password,
      request_token: requestToken,
    });

    var sessionRes = await http.post('/authentication/session/new', {
      request_token: requestToken,
    });
    var sessionId = sessionRes.data && sessionRes.data.session_id;
    if (!sessionId) {
      return { ok: false, error: 'Đăng nhập TMDB thành công nhưng không nhận được session.', code: 'session' };
    }

    var accountRes = await http.get('/account', {
      params: { session_id: sessionId },
    });
    var account = accountRes.data || {};

    return {
      ok: true,
      sessionId: sessionId,
      username: account.username || username,
      name: account.name || account.username || username,
    };
  } catch (err) {
    var status = err.response && err.response.status;
    var code = status === 401 ? 'unauthorized' : 'tmdb_error';
    return {
      ok: false,
      error: status === 401
        ? (tmdbErrorMessage(err) || 'Sai username hoặc password TMDB.')
        : tmdbErrorMessage(err),
      code: code,
    };
  }
}

function rememberImdb(cacheKey, imdb) {
  if (!imdb) return imdb;
  idCache.set(cacheKey, imdb);
  if (idCache.size > MAX_CACHE) {
    idCache.delete(idCache.keys().next().value);
  }
  return imdb;
}

async function externalImdb(http, mediaPath) {
  var res = await http.get(mediaPath);
  return (res.data && res.data.imdb_id) || null;
}

/**
 * Convert TMDB (`tm123`) or TVDB (`tv123`) Stremio IDs to IMDb (`tt...`).
 */
async function resolveToImdb(originalId, type) {
  if (!originalId || !getApiKey()) return null;

  var cacheKey = String(type) + ':' + originalId;
  if (idCache.has(cacheKey)) {
    return idCache.get(cacheKey);
  }

  var http = tmdbClient();

  try {
    if (originalId.indexOf('tm') === 0) {
      var tmdbId = originalId.replace(/^tm/, '');
      var primary = type === 'series'
        ? '/tv/' + tmdbId + '/external_ids'
        : '/movie/' + tmdbId + '/external_ids';
      var fallback = type === 'series'
        ? '/movie/' + tmdbId + '/external_ids'
        : '/tv/' + tmdbId + '/external_ids';
      try {
        return rememberImdb(cacheKey, await externalImdb(http, primary));
      } catch (e) {
        return rememberImdb(cacheKey, await externalImdb(http, fallback));
      }
    }

    if (originalId.indexOf('tv') === 0) {
      var tvdbId = originalId.replace(/^tv/, '');
      var findRes = await http.get('/find/' + encodeURIComponent(tvdbId), {
        params: { external_source: 'tvdb_id' },
      });
      var movies = (findRes.data && findRes.data.movie_results) || [];
      var shows = (findRes.data && findRes.data.tv_results) || [];
      var hit = type === 'series' ? (shows[0] || movies[0]) : (movies[0] || shows[0]);
      if (!hit || !hit.id) return null;
      var mediaPath = (hit.media_type === 'movie' || (!shows[0] && movies[0]))
        ? '/movie/' + hit.id + '/external_ids'
        : '/tv/' + hit.id + '/external_ids';
      return rememberImdb(cacheKey, await externalImdb(http, mediaPath));
    }
  } catch (err) {
    console.error('[tmdb] resolve failed:', err.message);
  }

  return null;
}

module.exports = {
  pingCredentials,
  resolveToImdb,
  getApiKey,
};
