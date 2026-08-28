/**
 * OpenSubtitles provider.
 * - Without API key: Uses Stremio's public proxy (basic, limited)
 * - With API key: Uses official OpenSubtitles REST API v1 (better results)
 */

const axios = require('axios');

const STREMIO_PROXY_URL = 'https://opensubtitles-v3.strem.io/subtitles';
const OFFICIAL_API_URL = 'https://api.opensubtitles.com/api/v1';

/**
 * Language code aliases for OpenSubtitles.
 */
const LANGUAGE_ALIASES = {
  'vie': ['vie'],
  'eng': ['eng'],
  'chi': ['chi', 'zho'],
  'zho': ['zho', 'chi'],
  'fre': ['fre', 'fra'],
  'fra': ['fra', 'fre'],
  'ger': ['ger', 'deu'],
  'deu': ['deu', 'ger'],
  'por': ['por', 'pob'],
  'pob': ['pob', 'por'],
  'spa': ['spa', 'spl'],
  'spl': ['spl', 'spa'],
  'dut': ['dut', 'nld'],
  'nld': ['nld', 'dut'],
  'rum': ['rum', 'ron'],
  'ron': ['ron', 'rum'],
  'cze': ['cze', 'ces'],
  'ces': ['ces', 'cze'],
  'scc': ['scc', 'srp'],
  'srp': ['srp', 'scc'],
};

/**
 * Map 3-letter codes to 2-letter for official API.
 */
const LANG_TO_2 = {
  'vie': 'vi', 'eng': 'en', 'fre': 'fr', 'fra': 'fr',
  'ger': 'de', 'deu': 'de', 'spa': 'es', 'spl': 'es',
  'por': 'pt', 'pob': 'pt', 'ita': 'it', 'rus': 'ru',
  'jpn': 'ja', 'kor': 'ko', 'chi': 'zh', 'zho': 'zh',
  'tha': 'th', 'ara': 'ar', 'tur': 'tr', 'pol': 'pl',
  'dut': 'nl', 'nld': 'nl', 'dan': 'da', 'swe': 'sv',
  'nor': 'no', 'fin': 'fi', 'cze': 'cs', 'ces': 'cs',
  'hun': 'hu', 'rum': 'ro', 'ron': 'ro', 'bul': 'bg',
  'hrv': 'hr', 'srp': 'sr', 'scc': 'sr', 'ukr': 'uk',
  'heb': 'he', 'ind': 'id', 'may': 'ms', 'msa': 'ms',
  'hin': 'hi', 'ben': 'bn', 'ell': 'el', 'gre': 'el',
};

function getAliases(langCode) {
  return LANGUAGE_ALIASES[langCode] || [langCode];
}

/**
 * Search via Stremio public proxy (no key needed).
 * Improved with better error handling and fallback logic.
 */
async function searchViaProxy(imdbId, type, langCode, options) {
  try {
    var apiUrl = STREMIO_PROXY_URL + '/' + type + '/tt' + imdbId;

    if (type === 'series' && options.season && options.episode) {
      apiUrl += ':' + options.season + ':' + options.episode;
    }

    apiUrl += '.json';

    var response = await axios.get(apiUrl, {
      timeout: 15000,
      headers: { 'User-Agent': 'StremioVietSub/1.0' },
    });

    if (!response.data || !response.data.subtitles || !response.data.subtitles.length) {
      return [];
    }

    var codesToMatch = getAliases(langCode);
    var filtered = response.data.subtitles.filter(function(sub) {
      return codesToMatch.includes(sub.lang);
    });

    filtered.sort(function(a, b) { return (b.downloads || 0) - (a.downloads || 0); });

    return filtered.map(function(sub, idx) {
      return {
        source: 'opensubtitles',
        id: sub.id || ('os-' + idx),
        url: sub.url,
        lang: sub.lang,
        title: '[OpenSubs] ' + (sub.SubFileName || sub.lang || 'Unknown'),
        downloads: sub.downloads || 0,
        rating: sub.SubRating || 0,
      };
    });
  } catch (error) {
    console.error('[opensubtitles] Proxy search error:', error.message);
    return [];
  }
}

/**
 * Search via official OpenSubtitles REST API (with API key — better results).
 */
async function searchViaAPI(imdbId, type, langCode, options) {
  var lang2 = LANG_TO_2[langCode] || langCode.substring(0, 2);

  var params = {
    imdb_id: 'tt' + imdbId,
    languages: lang2,
    order_by: 'download_count',
    order_direction: 'desc',
  };

  if (type === 'series' && options.season) {
    params.season_number = options.season;
  }
  if (type === 'series' && options.episode) {
    params.episode_number = options.episode;
  }

  var response = await axios.get(OFFICIAL_API_URL + '/subtitles', {
    params: params,
    timeout: 15000,
    headers: {
      'User-Agent': 'StremioVietSub/1.0',
      'Api-Key': options.apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!response.data || !response.data.data || !response.data.data.length) {
    return [];
  }

  var results = [];

  for (var i = 0; i < response.data.data.length; i++) {
    var item = response.data.data[i];
    var attrs = item.attributes || {};
    var files = attrs.files || [];

    if (files.length === 0) continue;

    // Get download link for the first file
    var fileId = files[0].file_id;
    var fileName = attrs.release || attrs.feature_details && attrs.feature_details.title || 'Unknown';

    // Use the download endpoint to get a temporary link
    try {
      var dlResponse = await axios.post(OFFICIAL_API_URL + '/download', {
        file_id: fileId,
      }, {
        timeout: 10000,
        headers: {
          'User-Agent': 'StremioVietSub/1.0',
          'Api-Key': options.apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (dlResponse.data && dlResponse.data.link) {
        results.push({
          source: 'opensubtitles',
          id: 'os-api-' + fileId,
          url: dlResponse.data.link,
          lang: langCode,
          title: '[OpenSubs\u2605] ' + fileName,
          downloads: attrs.download_count || 0,
          rating: attrs.ratings || 0,
        });
      }
    } catch (dlErr) {
      console.error('[opensubtitles] Download link error for file ' + fileId + ':', dlErr.message);
    }

    // Limit to top 10 to stay within rate limits
    if (results.length >= 10) break;
  }

  return results;
}

/**
 * Search subtitles from OpenSubtitles.
 * Uses official API if apiKey is provided, otherwise falls back to Stremio proxy.
 *
 * @param {string} imdbId - IMDb ID (without 'tt' prefix)
 * @param {string} type - 'movie' or 'series'
 * @param {string} langCode - 3-letter language code
 * @param {object} [options]
 * @param {string} [options.apiKey] - OpenSubtitles API key
 * @param {number} [options.season]
 * @param {number} [options.episode]
 * @returns {Promise<Array>}
 */
async function searchOpenSubtitles(imdbId, type, langCode, options) {
  if (!options) options = {};

  try {
    if (options.apiKey) {
      console.log('[opensubtitles] Using official API with key');
      var apiResults = await searchViaAPI(imdbId, type, langCode, options);
      // Also fetch from proxy to combine results
      var proxyResults = await searchViaProxy(imdbId, type, langCode, options).catch(function() { return []; });
      // Merge: API results first (marked with star), then proxy
      var seen = {};
      var merged = [];
      for (var i = 0; i < apiResults.length; i++) {
        merged.push(apiResults[i]);
      }
      for (var j = 0; j < proxyResults.length; j++) {
        merged.push(proxyResults[j]);
      }
      return merged;
    } else {
      console.log('[opensubtitles] Using Stremio proxy (no API key)');
      return await searchViaProxy(imdbId, type, langCode, options);
    }
  } catch (error) {
    console.error('[opensubtitles] Search error:', error.message);
    // Fallback to proxy if API fails
    if (options.apiKey) {
      try {
        return await searchViaProxy(imdbId, type, langCode, options);
      } catch (e) {
        return [];
      }
    }
    return [];
  }
}

module.exports = { searchOpenSubtitles };