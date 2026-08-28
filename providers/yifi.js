/**
 * Yifi Subtitles provider.
 * Free API that doesn't require authentication.
 * API: https://yifysubtitles.ch/api/v1
 */

const axios = require('axios');

const BASE_URL = 'https://yifysubtitles.ch/api/v1';

/**
 * Map 3-letter codes to Yifi language codes.
 */
const LANG_MAP = {
  'vie': 'vietnamese', 'eng': 'english', 'fre': 'french', 'fra': 'french',
  'ger': 'german', 'deu': 'german', 'spa': 'spanish', 'spl': 'spanish',
  'por': 'portuguese', 'pob': 'portuguese', 'ita': 'italian', 'rus': 'russian',
  'jpn': 'japanese', 'kor': 'korean', 'chi': 'chinese', 'zho': 'chinese',
  'tha': 'thai', 'ara': 'arabic', 'tur': 'turkish', 'pol': 'polish',
  'dut': 'dutch', 'nld': 'dutch', 'dan': 'danish', 'swe': 'swedish',
  'nor': 'norwegian', 'fin': 'finnish', 'cze': 'czech', 'ces': 'czech',
  'hun': 'hungarian', 'rum': 'romanian', 'ron': 'romanian', 'bul': 'bulgarian',
  'hrv': 'croatian', 'srp': 'serbian', 'scc': 'serbian', 'ukr': 'ukrainian',
  'heb': 'hebrew', 'ind': 'indonesian', 'may': 'malay', 'msa': 'malay',
  'hin': 'hindi', 'ben': 'bengali', 'ell': 'greek', 'gre': 'greek',
};

/**
 * Search subtitles from Yifi API.
 *
 * @param {string} imdbId - IMDb ID (without 'tt' prefix)
 * @param {string} type - 'movie' or 'series'
 * @param {string} langCode - 3-letter language code
 * @param {object} [options]
 * @param {number} [options.season]
 * @param {number} [options.episode]
 * @returns {Promise<Array>} Array of subtitle entries
 */
async function searchYifi(imdbId, type, langCode, options = {}) {
  try {
    // Yifi mainly supports movies, not series
    if (type === 'series') {
      console.log('[yifi] Skipping series search (not supported)');
      return [];
    }

    const yifiLang = LANG_MAP[langCode] || 'english';
    const apiUrl = `${BASE_URL}/subtitles/imdbid/tt${imdbId}`;

    const response = await axios.get(apiUrl, {
      timeout: 15000,
      headers: { 'User-Agent': 'StremioVietSub/1.0' },
    });

    if (!response.data?.subs?.length) {
      return [];
    }

    const results = [];

    for (const sub of response.data.subs) {
      // Filter by language
      if (sub.lang && sub.lang.toLowerCase() !== yifiLang.toLowerCase()) {
        continue;
      }

      // Get download link
      const downloadUrl = sub.url || null;
      if (!downloadUrl) continue;

      results.push({
        source: 'yifi',
        id: `yifi-${sub.subsId || results.length}`,
        url: downloadUrl,
        lang: langCode,
        title: `[Yifi] ${sub.release || sub.lang || 'Unknown'}`,
        downloads: sub.downloads || 0,
        rating: sub.rating || 0,
      });
    }

    // Sort by downloads
    results.sort(function(a, b) { return (b.downloads || 0) - (a.downloads || 0); });

    // Limit to top 5 results
    return results.slice(0, 5);
  } catch (error) {
    console.error('[yifi] Search error:', error.message);
    return [];
  }
}

module.exports = { searchYifi };
