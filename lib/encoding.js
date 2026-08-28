/**
 * Subtitle encoding detection and conversion utilities.
 * Handles various encodings: UTF-8, UTF-16, legacy codepages, double-encoded text.
 * Optimized for Vietnamese subtitle files.
 */

const chardet = require('chardet');
const iconv = require('iconv-lite');

// Sample size for chardet detection
const CHARDET_SAMPLE_SIZE = 4096;

/**
 * Language-to-encoding priority mapping for legacy subtitle files.
 * When chardet is uncertain, we prefer these encodings for each language.
 */
const LANGUAGE_ENCODINGS = {
  'vi': ['utf-8', 'windows-1258', 'iso-8859-1'],
  'en': ['utf-8', 'windows-1252', 'iso-8859-1'],
  'ru': ['windows-1251', 'koi8-r', 'utf-8'],
  'uk': ['windows-1251', 'koi8-u', 'utf-8'],
  'ko': ['euc-kr', 'utf-8'],
  'ja': ['shift_jis', 'euc-jp', 'utf-8'],
  'zh': ['gb18030', 'big5', 'utf-8'],
  'th': ['tis-620', 'utf-8'],
  'ar': ['windows-1256', 'iso-8859-6', 'utf-8'],
  'he': ['windows-1255', 'iso-8859-8', 'utf-8'],
  'el': ['windows-1253', 'iso-8859-7', 'utf-8'],
  'tr': ['windows-1254', 'iso-8859-9', 'utf-8'],
  'pl': ['windows-1250', 'iso-8859-2', 'utf-8'],
  'cs': ['windows-1250', 'iso-8859-2', 'utf-8'],
  'hu': ['windows-1250', 'iso-8859-2', 'utf-8'],
  'ro': ['windows-1250', 'iso-8859-2', 'utf-8'],
  'bg': ['windows-1251', 'utf-8'],
  'sr': ['windows-1251', 'utf-8'],
  'hr': ['windows-1250', 'iso-8859-2', 'utf-8'],
  'pt': ['windows-1252', 'iso-8859-1', 'utf-8'],
  'es': ['windows-1252', 'iso-8859-1', 'utf-8'],
  'fr': ['windows-1252', 'iso-8859-1', 'utf-8'],
  'de': ['windows-1252', 'iso-8859-1', 'utf-8'],
  'it': ['windows-1252', 'iso-8859-1', 'utf-8'],
};

/**
 * Map 3-letter language codes to 2-letter codes for encoding lookup.
 */
const ISO639_3_TO_1 = {
  'vie': 'vi', 'eng': 'en', 'rus': 'ru', 'ukr': 'uk',
  'kor': 'ko', 'jpn': 'ja', 'chi': 'zh', 'zho': 'zh',
  'tha': 'th', 'ara': 'ar', 'heb': 'he', 'ell': 'el',
  'gre': 'el', 'tur': 'tr', 'pol': 'pl', 'cze': 'cs',
  'ces': 'cs', 'hun': 'hu', 'rum': 'ro', 'ron': 'ro',
  'bul': 'bg', 'srp': 'sr', 'scc': 'sr', 'hrv': 'hr',
  'por': 'pt', 'pob': 'pt', 'spa': 'es', 'fre': 'fr',
  'fra': 'fr', 'ger': 'de', 'deu': 'de', 'ita': 'it',
  'dut': 'nl', 'nld': 'nl', 'dan': 'da', 'swe': 'sv',
  'nor': 'no', 'fin': 'fi', 'ind': 'id', 'may': 'ms',
  'msa': 'ms', 'tgl': 'tl', 'hin': 'hi', 'ben': 'bn',
};

/**
 * Detect if buffer has a UTF-16 BOM.
 */
function detectBOM(buffer) {
  if (buffer.length < 2) return null;
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) return 'UTF-16LE';
  if (buffer[0] === 0xFE && buffer[1] === 0xFF) return 'UTF-16BE';
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) return 'UTF-8';
  return null;
}

/**
 * Check if text appears to be double-encoded UTF-8.
 * Common patterns: Ã¡ (á), Ã© (é), Ã³ (ó), etc.
 */
function isDoubleEncoded(text) {
  const patterns = [
    /Ã[\x80-\xBF]/,    // Two-byte UTF-8 sequences misread as Latin-1
    /Ã¡|Ã©|Ã³|Ãº|Ã±/,  // Common Spanish/Portuguese double-encoded chars
    /Ä[\x80-\xBF]/,    // Vietnamese double-encoded chars (ă, đ, etc.)
    /Æ[\x80-\xBF]/,    // More Vietnamese: ơ, ư
    /á»[\x80-\xBF]/,   // Vietnamese combining chars
  ];
  return patterns.some(p => p.test(text));
}

/**
 * Fix double-encoded UTF-8 text.
 */
function fixDoubleEncoding(text) {
  try {
    const buf = Buffer.from(text, 'latin1');
    const decoded = buf.toString('utf-8');
    // Verify the result makes more sense
    if (decoded && !isDoubleEncoded(decoded)) {
      return decoded;
    }
  } catch (e) {
    // Ignore errors
  }
  return text;
}

/**
 * Normalize a 3-letter language code to 2-letter.
 */
function normalizeLangCode(lang) {
  if (!lang) return null;
  const lower = lang.toLowerCase();
  if (lower.length === 2) return lower;
  return ISO639_3_TO_1[lower] || null;
}

/**
 * Decode a raw subtitle buffer to a UTF-8 string.
 * Handles BOM, chardet detection, language-specific fallbacks, and double-encoding.
 *
 * @param {Buffer} buffer - Raw subtitle file bytes
 * @param {string} [languageCode] - Optional language hint (2 or 3 letter code)
 * @returns {string} UTF-8 decoded text
 */
function decodeSubtitleBuffer(buffer, languageCode = null) {
  if (!buffer || buffer.length === 0) return '';

  // Step 1: Check for BOM
  const bom = detectBOM(buffer);
  if (bom) {
    const skipBytes = bom === 'UTF-8' ? 3 : 2;
    const text = iconv.decode(buffer.slice(skipBytes), bom);
    return text;
  }

  // Step 2: Try chardet detection
  const sample = buffer.slice(0, Math.min(buffer.length, CHARDET_SAMPLE_SIZE));
  let detected = null;
  try {
    detected = chardet.detect(sample);
  } catch (e) {
    // chardet can throw on very short/binary inputs
  }

  // Step 3: Determine encoding
  let encoding = 'utf-8';
  const lang2 = normalizeLangCode(languageCode);

  if (detected) {
    // chardet returns encoding name, normalize it
    const detectedNorm = detected.toLowerCase().replace(/[^a-z0-9]/g, '');

    // If chardet is confident about UTF-8, trust it
    if (detectedNorm === 'utf8') {
      encoding = 'utf-8';
    } else if (detectedNorm === 'ascii') {
      encoding = 'utf-8'; // ASCII is a subset of UTF-8
    } else {
      // Use detected encoding but validate against language hints
      encoding = detected;
    }
  } else if (lang2 && LANGUAGE_ENCODINGS[lang2]) {
    // Fallback to language-specific encoding
    encoding = LANGUAGE_ENCODINGS[lang2][0];
  }

  // Step 4: Decode
  let text;
  try {
    if (iconv.encodingExists(encoding)) {
      text = iconv.decode(buffer, encoding);
    } else {
      text = buffer.toString('utf-8');
    }
  } catch (e) {
    text = buffer.toString('utf-8');
  }

  // Step 5: Fix double-encoding if detected
  if (isDoubleEncoded(text)) {
    text = fixDoubleEncoding(text);
  }

  // Step 6: Remove null bytes (common in broken files)
  text = text.replace(/\0/g, '');

  return text;
}

module.exports = {
  decodeSubtitleBuffer,
  normalizeLangCode,
  LANGUAGE_ENCODINGS,
  ISO639_3_TO_1,
};