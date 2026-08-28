/**
 * SubDL provider.
 * API: https://api.subdl.com/api/v1/subtitles
 * Requires a free API key from subdl.com
 */

const axios = require('axios');

const BASE_URL = 'https://api.subdl.com/api/v1/subtitles';
const DOWNLOAD_BASE = 'https://dl.subdl.com';

/**
 * Map 3-letter codes to SubDL 2-letter language codes.
 */
const LANG_MAP = {
  'vie': 'VI', 'eng': 'EN', 'fre': 'FR', 'fra': 'FR',
  'ger': 'DE', 'deu': 'DE', 'spa': 'ES', 'spl': 'ES',
  'por': 'PT', 'pob': 'PT', 'ita': 'IT', 'rus': 'RU',
  'jpn': 'JA', 'kor': 'KO', 'chi': 'ZH', 'zho': 'ZH',
  'tha': 'TH', 'ara': 'AR', 'tur': 'TR', 'pol': 'PL',
  'dut': 'NL', 'nld': 'NL', 'dan': 'DA', 'swe': 'SV',
  'nor': 'NO', 'fin': 'FI', 'cze': 'CS', 'ces': 'CS',
  'hun': 'HU', 'rum': 'RO', 'ron': 'RO', 'bul': 'BG',
  'hrv': 'HR', 'srp': 'SR', 'scc': 'SR', 'ukr': 'UK',
  'heb': 'HE', 'ind': 'ID', 'may': 'MS', 'msa': 'MS',
  'hin': 'HI', 'ben': 'BN', 'ell': 'EL', 'gre': 'EL',
};

/**
 * Search subtitles from SubDL API.
 *
 * @param {string} imdbId - IMDb ID (without 'tt' prefix)
 * @param {string} type - 'movie' or 'series'
 * @param {string} langCode - 3-letter language code
 * @param {object} [options]
 * @param {string} [options.apiKey] - SubDL API key
 * @param {number} [options.season]
 * @param {number} [options.episode]
 * @returns {Promise<Array>} Array of subtitle entries
 */
async function searchSubDL(imdbId, type, langCode, options = {}) {
  if (!options.apiKey) {
    return []; // API key required
  }

  try {
    const subdlLang = LANG_MAP[langCode] || langCode.toUpperCase().slice(0, 2);

    const params = {
      api_key: options.apiKey,
      imdb_id: `tt${imdbId}`,
      languages: subdlLang,
      subs_per_page: 20,
      type: type === 'series' ? 'tv' : 'movie',
    };

    if (type === 'series' && options.season) {
      params.season_number = options.season;
    }
    if (type === 'series' && options.episode) {
      params.episode_number = options.episode;
    }

    const response = await axios.get(BASE_URL, {
      params,
      timeout: 15000,
      headers: { 'User-Agent': 'StremioVietSub/1.0' },
    });

    if (!response.data?.subtitles?.length) {
      return [];
    }

    const results = [];

    for (const sub of response.data.subtitles) {
      // SubDL returns an array of subtitle entries
      const downloadUrl = sub.url
        ? (sub.url.startsWith('http') ? sub.url : `${DOWNLOAD_BASE}${sub.url}`)
        : null;

      if (!downloadUrl) continue;

      results.push({
        source: 'subdl',
        id: `subdl-${sub.sd_id || results.length}`,
        url: downloadUrl,
        lang: langCode,
        title: `[SubDL] ${sub.release_name || sub.name || 'Unknown'}`,
        downloads: sub.downloads || 0,
        rating: sub.rating || 0,
        author: sub.author || '',
      });
    }

    return results;
  } catch (error) {
    console.error('[subdl] Search error:', error.message);
    return [];
  }
}

module.exports = { searchSubDL };