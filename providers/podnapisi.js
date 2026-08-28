/**
 * Podnapisi provider.
 * Free API that doesn't require authentication.
 * API: https://api.podnapisi.net
 */

const axios = require('axios');

const BASE_URL = 'https://api.podnapisi.net/subtitles';

/**
 * Map 3-letter codes to Podnapisi language codes.
 */
const LANG_MAP = {
  'vie': 'vie', 'eng': 'eng', 'fre': 'fre', 'fra': 'fre',
  'ger': 'ger', 'deu': 'ger', 'spa': 'spa', 'spl': 'spa',
  'por': 'por', 'pob': 'pob', 'ita': 'ita', 'rus': 'rus',
  'jpn': 'jpn', 'kor': 'kor', 'chi': 'chi', 'zho': 'chi',
  'tha': 'tha', 'ara': 'ara', 'tur': 'tur', 'pol': 'pol',
  'dut': 'dut', 'nld': 'dut', 'dan': 'dan', 'swe': 'swe',
  'nor': 'nor', 'fin': 'fin', 'cze': 'cze', 'ces': 'cze',
  'hun': 'hun', 'rum': 'rum', 'ron': 'rum', 'bul': 'bul',
  'hrv': 'hrv', 'srp': 'srp', 'scc': 'srp', 'ukr': 'ukr',
  'heb': 'heb', 'ind': 'ind', 'may': 'may', 'msa': 'may',
  'hin': 'hin', 'ben': 'ben', 'ell': 'ell', 'gre': 'ell',
};

/**
 * Search subtitles from Podnapisi API.
 *
 * @param {string} imdbId - IMDb ID (without 'tt' prefix)
 * @param {string} type - 'movie' or 'series'
 * @param {string} langCode - 3-letter language code
 * @param {object} [options]
 * @param {number} [options.season]
 * @param {number} [options.episode]
 * @returns {Promise<Array>} Array of subtitle entries
 */
async function searchPodnapisi(imdbId, type, langCode, options = {}) {
  try {
    const podnapisiLang = LANG_MAP[langCode] || 'eng';

    const params = {
      languageIds: podnapisiLang,
      imdbId: 'tt' + imdbId,
    };

    if (type === 'series' && options.season) {
      params.seasonNumber = options.season;
    }
    if (type === 'series' && options.episode) {
      params.episodeNumber = options.episode;
    }

    const response = await axios.get(BASE_URL, {
      params,
      timeout: 15000,
      headers: { 'User-Agent': 'StremioVietSub/1.0' },
    });

    if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
      return [];
    }

    const results = [];

    for (const sub of response.data) {
      // Skip if no download link
      if (!sub.downloadUrl) continue;

      results.push({
        source: 'podnapisi',
        id: `pn-${sub.id || results.length}`,
        url: sub.downloadUrl,
        lang: langCode,
        title: `[Podnapisi] ${sub.release || sub.fileName || 'Unknown'}`,
        downloads: sub.downloads || 0,
        rating: sub.rating || 0,
      });
    }

    // Sort by downloads
    results.sort(function(a, b) { return (b.downloads || 0) - (a.downloads || 0); });

    // Limit to top 5 results
    return results.slice(0, 5);
  } catch (error) {
    console.error('[podnapisi] Search error:', error.message);
    return [];
  }
}

module.exports = { searchPodnapisi };
