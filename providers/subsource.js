/**
 * SubSource provider (Subscene successor).
 * API: https://api.subsource.net/api/...
 * Requires a free API key from subsource.net
 */

const axios = require('axios');

const BASE_URL = 'https://api.subsource.net/api';

/**
 * Map 3-letter codes to SubSource language names.
 */
const LANG_MAP = {
  'vie': 'Vietnamese', 'eng': 'English', 'fre': 'French', 'fra': 'French',
  'ger': 'German', 'deu': 'German', 'spa': 'Spanish', 'spl': 'Spanish',
  'por': 'Portuguese', 'pob': 'Portuguese', 'ita': 'Italian', 'rus': 'Russian',
  'jpn': 'Japanese', 'kor': 'Korean', 'chi': 'Chinese', 'zho': 'Chinese',
  'tha': 'Thai', 'ara': 'Arabic', 'tur': 'Turkish', 'pol': 'Polish',
  'dut': 'Dutch', 'nld': 'Dutch', 'dan': 'Danish', 'swe': 'Swedish',
  'nor': 'Norwegian', 'fin': 'Finnish', 'cze': 'Czech', 'ces': 'Czech',
  'hun': 'Hungarian', 'rum': 'Romanian', 'ron': 'Romanian', 'bul': 'Bulgarian',
  'hrv': 'Croatian', 'srp': 'Serbian', 'scc': 'Serbian', 'ukr': 'Ukrainian',
  'heb': 'Hebrew', 'ind': 'Indonesian', 'may': 'Malay', 'msa': 'Malay',
  'hin': 'Hindi', 'ben': 'Bengali', 'ell': 'Greek', 'gre': 'Greek',
};

/**
 * Search subtitles from SubSource API.
 *
 * @param {string} imdbId - IMDb ID (without 'tt' prefix)
 * @param {string} type - 'movie' or 'series'
 * @param {string} langCode - 3-letter language code
 * @param {object} [options]
 * @param {string} [options.apiKey] - SubSource API key
 * @param {number} [options.season]
 * @param {number} [options.episode]
 * @returns {Promise<Array>} Array of subtitle entries
 */
async function searchSubSource(imdbId, type, langCode, options = {}) {
  if (!options.apiKey) {
    return []; // API key required
  }

  try {
    const language = LANG_MAP[langCode] || 'Vietnamese';

    // Step 1: Search for the movie/series
    const searchResponse = await axios.post(`${BASE_URL}/searchMovie`, {
      query: `tt${imdbId}`,
    }, {
      timeout: 15000,
      headers: {
        'User-Agent': 'StremioVietSub/1.0',
        'Content-Type': 'application/json',
        'apiKey': options.apiKey,
      },
    });

    if (!searchResponse.data?.found?.length) {
      return [];
    }

    const movieName = searchResponse.data.found[0].linkName;

    // Step 2: Get subtitles for this movie
    const subsBody = {
      movieName,
      langs: [language],
    };

    if (type === 'series' && options.season) {
      subsBody.season = `season-${options.season}`;
    }

    const subsResponse = await axios.post(`${BASE_URL}/getMovie`, subsBody, {
      timeout: 15000,
      headers: {
        'User-Agent': 'StremioVietSub/1.0',
        'Content-Type': 'application/json',
        'apiKey': options.apiKey,
      },
    });

    if (!subsResponse.data?.subs?.length) {
      return [];
    }

    const results = [];

    for (const sub of subsResponse.data.subs) {
      // Filter by episode if series
      if (type === 'series' && options.episode) {
        // SubSource may include episode info in the release name
        const epPattern = new RegExp(`[Ee]0?${options.episode}\\b`);
        const hasFullSeason = /full.season/i.test(sub.releaseName || '');
        if (!hasFullSeason && sub.releaseName && !epPattern.test(sub.releaseName)) {
          continue;
        }
      }

      // Step 3: Get download link for each subtitle
      try {
        const dlResponse = await axios.post(`${BASE_URL}/downloadSub`, {
          movie: movieName,
          lang: language,
          id: sub.subId,
        }, {
          timeout: 10000,
          headers: {
            'User-Agent': 'StremioVietSub/1.0',
            'Content-Type': 'application/json',
            'apiKey': options.apiKey,
          },
        });

        if (dlResponse.data?.sub?.downloadToken) {
          const downloadUrl = `${BASE_URL}/downloadSub/${dlResponse.data.sub.downloadToken}`;

          results.push({
            source: 'subsource',
            id: `ss-${sub.subId || results.length}`,
            url: downloadUrl,
            lang: langCode,
            title: `[SubSource] ${sub.releaseName || 'Unknown'}`,
            downloads: sub.downloads || 0,
            rating: sub.rating || 0,
            author: sub.author || '',
          });
        }
      } catch (dlErr) {
        console.error('[subsource] Download link error:', dlErr.message);
      }

      // Limit to top 10 results to avoid too many API calls
      if (results.length >= 10) break;
    }

    return results;
  } catch (error) {
    console.error('[subsource] Search error:', error.message);
    return [];
  }
}

module.exports = { searchSubSource };