/**
 * Stremio VietSub Addon - Core Logic
 * Defines the Stremio manifest and subtitle handler.
 * Aggregates subtitles from multiple sources and serves them via proxy.
 */

const { addonBuilder } = require('stremio-addon-sdk');
const { searchOpenSubtitles } = require('./providers/opensubtitles');
const { searchSubDL } = require('./providers/subdl');
const { searchSubSource } = require('./providers/subsource');
const { searchYifi } = require('./providers/yifi');
const { searchPodnapisi } = require('./providers/podnapisi');
const { resolveToImdb } = require('./lib/tmdb');

/**
 * Supported languages list (common ones, Vietnamese first).
 */
const LANGUAGES = [
  { code: 'vie', name: 'Tiếng Việt' },
  { code: 'eng', name: 'English' },
  { code: 'chi', name: '中文 (Chinese)' },
  { code: 'jpn', name: '日本語 (Japanese)' },
  { code: 'kor', name: '한국어 (Korean)' },
  { code: 'tha', name: 'ไทย (Thai)' },
  { code: 'fre', name: 'Français (French)' },
  { code: 'ger', name: 'Deutsch (German)' },
  { code: 'spa', name: 'Español (Spanish)' },
  { code: 'por', name: 'Português (Portuguese)' },
  { code: 'pob', name: 'Português (BR)' },
  { code: 'ita', name: 'Italiano (Italian)' },
  { code: 'rus', name: 'Русский (Russian)' },
  { code: 'ara', name: 'العربية (Arabic)' },
  { code: 'tur', name: 'Türkçe (Turkish)' },
  { code: 'ind', name: 'Bahasa Indonesia' },
  { code: 'may', name: 'Bahasa Melayu' },
  { code: 'hin', name: 'हिन्दी (Hindi)' },
  { code: 'dut', name: 'Nederlands (Dutch)' },
  { code: 'pol', name: 'Polski (Polish)' },
  { code: 'rum', name: 'Română (Romanian)' },
  { code: 'cze', name: 'Čeština (Czech)' },
  { code: 'hun', name: 'Magyar (Hungarian)' },
  { code: 'dan', name: 'Dansk (Danish)' },
  { code: 'swe', name: 'Svenska (Swedish)' },
  { code: 'nor', name: 'Norsk (Norwegian)' },
  { code: 'fin', name: 'Suomi (Finnish)' },
  { code: 'ell', name: 'Ελληνικά (Greek)' },
  { code: 'bul', name: 'Български (Bulgarian)' },
  { code: 'hrv', name: 'Hrvatski (Croatian)' },
  { code: 'srp', name: 'Srpski (Serbian)' },
  { code: 'ukr', name: 'Українська (Ukrainian)' },
  { code: 'heb', name: 'עברית (Hebrew)' },
];

function getLanguageOptions() {
  return LANGUAGES.map(l => `${l.name} [${l.code}]`);
}

function getLanguageName(code) {
  const found = LANGUAGES.find(l => l.code === code);
  return found ? found.name : code;
}

// Addon version
const ADDON_VERSION = '1.0.0';

// Create manifest
const manifest = {
  id: 'community.vietsub.proxy',
  version: ADDON_VERSION,
  name: '🇻🇳 VietSub Proxy',
  description: 'Phụ đề Tiếng Việt từ 5 nguồn (OpenSubtitles, SubDL, SubSource, Yifi, Podnapisi). Hỗ trợ nhiều ID formats, xử lý server-side, tương thích 100% iOS.',
  resources: ['subtitles'],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'tm', 'tv'],
  catalogs: [
    {
      type: 'movie',
      id: 'top_movies',
      name: '🇻🇳 Top Movies with VietSub',
      extra: [{ name: 'search', isRequired: false }],
    },
    {
      type: 'series',
      id: 'top_series',
      name: '🇻🇳 Top Series with VietSub',
      extra: [{ name: 'search', isRequired: false }],
    },
  ],
  logo: 'https://em-content.zobj.net/source/apple/391/flag-vietnam_1f1fb-1f1f3.png',
  behaviorHints: {
    configurable: true,
    configurationRequired: false,
  },
  config: [
    {
      key: 'lang',
      type: 'select',
      title: 'Ngôn ngữ phụ đề / Subtitle Language',
      options: getLanguageOptions(),
      required: true,
      default: 'Tiếng Việt [vie]',
    },
    {
      key: 'osUser',
      type: 'text',
      title: 'OpenSubtitles.com Username',
      required: false,
    },
    {
      key: 'osToken',
      type: 'text',
      title: 'OpenSubtitles token (sau Test Credentials)',
      required: false,
    },
    {
      key: 'opensubsKey',
      type: 'text',
      title: '🔑 OpenSubtitles API Key (tùy chọn, tạo tại opensubtitles.com)',
      required: false,
    },
    {
      key: 'subdlKey',
      type: 'text',
      title: '🔑 SubDL API Key (tùy chọn, tạo miễn phí tại subdl.com)',
      required: false,
    },
    {
      key: 'subsourceKey',
      type: 'text',
      title: '🔑 SubSource API Key (tùy chọn, tạo miễn phí tại subsource.net)',
      required: false,
    },
    {
      key: 'enableYifi',
      type: 'select',
      title: '📥 Yifi Subtitles (miễn phí)',
      options: ['Bật', 'Tắt'],
      required: false,
      default: 'Bật',
    },
    {
      key: 'enablePodnapisi',
      type: 'select',
      title: '📥 Podnapisi (miễn phí)',
      options: ['Bật', 'Tắt'],
      required: false,
      default: 'Bật',
    },
  ],
};

const builder = new addonBuilder(manifest);

/**
 * Parse config string from URL path.
 * Config format: lang=vie|subdlKey=xxx|subsourceKey=yyy
 * Or encoded as base64/URI component
 */
function parseConfig(configStr) {
  const config = {
    lang: 'vie',
    opensubsKey: '',
    subdlKey: '',
    subsourceKey: '',
    tmdbUser: '',
    tmdbSession: '',
    tmdbPass: '',
    osUser: '',
    osToken: '',
    osPass: '',
    enableYifi: 'Bật',
    enablePodnapisi: 'Bật',
  };

  if (!configStr) return config;

  try {
    // Try JSON parse (from Stremio SDK)
    const parsed = JSON.parse(decodeURIComponent(configStr));
    if (parsed.lang) {
      // Extract 3-letter code from "Tiếng Việt [vie]" format
      const match = parsed.lang.match(/\[(\w+)\]/);
      config.lang = match ? match[1] : parsed.lang;
    }
    if (parsed.opensubsKey) config.opensubsKey = parsed.opensubsKey;
    if (parsed.subdlKey) config.subdlKey = parsed.subdlKey;
    if (parsed.subsourceKey) config.subsourceKey = parsed.subsourceKey;
    if (parsed.tmdbUser) config.tmdbUser = parsed.tmdbUser;
    if (parsed.tmdbSession) config.tmdbSession = parsed.tmdbSession;
    if (parsed.tmdbPass) config.tmdbPass = parsed.tmdbPass;
    if (parsed.osUser) config.osUser = parsed.osUser;
    if (parsed.osToken) config.osToken = parsed.osToken;
    if (parsed.osPass) config.osPass = parsed.osPass;
    if (parsed.enableYifi) config.enableYifi = parsed.enableYifi;
    if (parsed.enablePodnapisi) config.enablePodnapisi = parsed.enablePodnapisi;
  } catch (e) {
    // Try pipe-delimited format
    const parts = configStr.split('|');
    for (const part of parts) {
      const [key, ...rest] = part.split('=');
      const value = rest.join('=');
      if (key === 'lang') config.lang = value;
      if (key === 'opensubsKey') config.opensubsKey = value;
      if (key === 'subdlKey') config.subdlKey = value;
      if (key === 'subsourceKey') config.subsourceKey = value;
      if (key === 'tmdbUser') config.tmdbUser = value;
      if (key === 'tmdbSession') config.tmdbSession = value;
      if (key === 'tmdbPass') config.tmdbPass = value;
      if (key === 'osUser') config.osUser = value;
      if (key === 'osToken') config.osToken = value;
      if (key === 'osPass') config.osPass = value;
      if (key === 'enableYifi') config.enableYifi = value;
      if (key === 'enablePodnapisi') config.enablePodnapisi = value;
    }
  }

  return config;
}

/**
 * Parse ID and season/episode from Stremio ID string.
 * Supports multiple ID formats:
 * - IMDb: "tt1234567" or "tt1234567:1:5" (season 1, episode 5)
 * - TMDB: "tm1234567" or "tm1234567:1:5"
 * - TVDB: "tv1234567" or "tv1234567:1:5"
 */
function parseStremioId(id) {
  const parts = id.split(':');
  var originalId = parts[0];
  var imdbId = originalId;
  
  // Convert TMDB/TVDB to IMDb-like format for search
  // Note: This is a fallback - ideally we'd have proper ID conversion
  if (originalId.startsWith('tm')) {
    imdbId = originalId.replace('tm', '');
    console.log('[addon] TMDB ID detected, using as search term: ' + imdbId);
  } else if (originalId.startsWith('tv')) {
    imdbId = originalId.replace('tv', '');
    console.log('[addon] TVDB ID detected, using as search term: ' + imdbId);
  } else {
    imdbId = originalId.replace('tt', '');
  }
  
  const season = parts[1] ? parseInt(parts[1], 10) : null;
  const episode = parts[2] ? parseInt(parts[2], 10) : null;
  return { imdbId, season, episode, originalId };
}

/**
 * Core subtitle search logic with improved fallback and multi-ID support.
 * Exported directly so server.js can call it without going through SDK interface.
 *
 * @param {string} type - 'movie' or 'series'
 * @param {string} id - Stremio ID (e.g. 'tt0111161' or 'tt0111161:1:5')
 * @param {object} addonConfig - Config from URL path
 * @returns {Promise<{subtitles: Array}>}
 */
async function searchSubtitles(type, id, addonConfig) {
  console.log('[addon] Subtitle request: type=' + type + ' id=' + id);

  const config = parseConfig(
    addonConfig ? JSON.stringify(addonConfig) : ''
  );

  // Use config from addon if available, fallback to defaults
  if (addonConfig && addonConfig.lang) {
    const match = addonConfig.lang.match(/\[(\w+)\]/);
    config.lang = match ? match[1] : (addonConfig.lang || 'vie');
  }
  if (addonConfig && addonConfig.opensubsKey) config.opensubsKey = addonConfig.opensubsKey;
  if (addonConfig && addonConfig.subdlKey) config.subdlKey = addonConfig.subdlKey;
  if (addonConfig && addonConfig.subsourceKey) config.subsourceKey = addonConfig.subsourceKey;
  if (addonConfig && addonConfig.tmdbUser) config.tmdbUser = addonConfig.tmdbUser;
  if (addonConfig && addonConfig.tmdbSession) config.tmdbSession = addonConfig.tmdbSession;
  if (addonConfig && addonConfig.tmdbPass) config.tmdbPass = addonConfig.tmdbPass;
  if (addonConfig && addonConfig.osUser) config.osUser = addonConfig.osUser;
  if (addonConfig && addonConfig.osToken) config.osToken = addonConfig.osToken;
  if (addonConfig && addonConfig.osPass) config.osPass = addonConfig.osPass;
  if (addonConfig && addonConfig.enableYifi) config.enableYifi = addonConfig.enableYifi;
  if (addonConfig && addonConfig.enablePodnapisi) config.enablePodnapisi = addonConfig.enablePodnapisi;

  const parsed = parseStremioId(id);
  var season = parsed.season;
  var episode = parsed.episode;
  var originalId = parsed.originalId;
  var imdbId = parsed.imdbId;

  if (originalId.indexOf('tm') === 0 || originalId.indexOf('tv') === 0) {
    try {
      var resolved = await resolveToImdb(originalId, type);
      if (resolved) {
        imdbId = String(resolved).replace(/^tt/, '');
        console.log('[addon] TMDB resolved ' + originalId + ' -> tt' + imdbId);
      }
    } catch (resolveErr) {
      console.error('[addon] TMDB resolve error:', resolveErr.message);
    }
  }

  const langCode = config.lang || 'vie';

  const providerOptions = {
    season,
    episode,
    apiKey: '',
  };

  // Launch all providers in parallel with better error handling
  const promises = [];

  // OpenSubtitles — always enabled, better results with API key
  promises.push(
    searchOpenSubtitles(imdbId, type, langCode, {
      ...providerOptions,
      apiKey: config.opensubsKey || '',
      osUser: config.osUser || '',
      osPass: config.osPass || '',
      osToken: config.osToken || '',
      tmdbId: originalId.indexOf('tm') === 0 ? originalId.replace(/^tm/, '') : '',
    })
      .catch(function(err) {
        console.error('[addon] OpenSubtitles failed:', err.message);
        return [];
      })
  );

  // SubDL — only if key provided
  if (config.subdlKey) {
    promises.push(
      searchSubDL(imdbId, type, langCode, { ...providerOptions, apiKey: config.subdlKey })
        .catch(function(err) {
          console.error('[addon] SubDL failed:', err.message);
          return [];
        })
    );
  }

  // SubSource — only if key provided
  if (config.subsourceKey) {
    promises.push(
      searchSubSource(imdbId, type, langCode, { ...providerOptions, apiKey: config.subsourceKey })
        .catch(function(err) {
          console.error('[addon] SubSource failed:', err.message);
          return [];
        })
    );
  }

  // Yifi — enabled for movies if not disabled in config (free, no API key needed)
  if (type === 'movie' && config.enableYifi !== 'Tắt') {
    promises.push(
      searchYifi(imdbId, type, langCode, providerOptions)
        .catch(function(err) {
          console.error('[addon] Yifi failed:', err.message);
          return [];
        })
    );
  }

  // Podnapisi — enabled if not disabled in config (free, no API key needed)
  if (config.enablePodnapisi !== 'Tắt') {
    promises.push(
      searchPodnapisi(imdbId, type, langCode, providerOptions)
        .catch(function(err) {
          console.error('[addon] Podnapisi failed:', err.message);
          return [];
        })
    );
  }

  // Wait for all providers
  const results = await Promise.all(promises);
  const allSubs = results.flat();

  if (allSubs.length === 0) {
    console.log('[addon] No subtitles found for ' + id + ' [' + langCode + ']');
    
    // Fallback: Try with different ID formats if original was TMDB/TVDB
    if (originalId.startsWith('tm') || originalId.startsWith('tv')) {
      console.log('[addon] Trying fallback search with different ID formats...');
      // Could add additional fallback logic here
    }
    
    return { subtitles: [] };
  }

  console.log('[addon] Found ' + allSubs.length + ' subtitles for ' + id + ' [' + langCode + ']');

  // Convert to Stremio subtitle format
  // Each subtitle URL points to our proxy endpoint
  const subtitles = allSubs.map(function(sub) {
    var encodedUrl = Buffer.from(sub.url).toString('base64url');

    return {
      id: sub.id,
      url: 'PROXY_BASE_URL/proxy/' + langCode + '/' + encodedUrl + '.srt',
      lang: getLanguageName(langCode),
      SubFileName: sub.title,
    };
  });

  return { subtitles: subtitles };
}

// Also register with Stremio SDK builder for standard SDK routing
builder.defineSubtitlesHandler(async function(args) {
  return searchSubtitles(args.type, args.id, args.config || {});
});

// Add catalog handler for better discoverability
builder.defineCatalogHandler(async function(args) {
  var meta = [];
  
  // Return some popular movies/series with Vietnamese subtitles
  var popularContent = [
    {
      id: 'tt0111161',
      type: 'movie',
      name: 'The Shawshank Redemption',
      poster: 'https://image.tmdb.org/t/p/w500/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg',
      description: 'Phim điện ảnh chính kịch Mỹ năm 1994',
    },
    {
      id: 'tt0068646',
      type: 'movie',
      name: 'The Godfather',
      poster: 'https://image.tmdb.org/t/p/w500/3bhkrj58Vtu7enYsRolD1fZdja1.jpg',
      description: 'Phim điện ảnh chính kịch Mỹ năm 1972',
    },
    {
      id: 'tt0468569',
      type: 'movie',
      name: 'The Dark Knight',
      poster: 'https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg',
      description: 'Phim siêu anh hùng Mỹ năm 2008',
    },
    {
      id: 'tt0944947',
      type: 'series',
      name: 'Game of Thrones',
      poster: 'https://image.tmdb.org/t/p/w500/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg',
      description: 'Phim truyền hình giả tưởng Mỹ (2011-2019)',
    },
    {
      id: 'tt0903747',
      type: 'series',
      name: 'Breaking Bad',
      poster: 'https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
      description: 'Phim truyền hình Mỹ (2008-2013)',
    },
  ];
  
  // Filter by type
  if (args.type === 'movie') {
    meta = popularContent.filter(function(item) { return item.type === 'movie'; });
  } else if (args.type === 'series') {
    meta = popularContent.filter(function(item) { return item.type === 'series'; });
  }
  
  // Filter by search if provided
  if (args.extra && args.extra.search) {
    var search = args.extra.search.toLowerCase();
    meta = meta.filter(function(item) {
      return item.name.toLowerCase().indexOf(search) !== -1;
    });
  }
  
  return { metas: meta };
});

module.exports = {
  builder,
  manifest,
  searchSubtitles,
  parseConfig,
  parseStremioId,
  getLanguageOptions,
  getLanguageName,
  LANGUAGES,
};