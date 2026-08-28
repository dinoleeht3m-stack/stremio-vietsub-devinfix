/**
 * Subtitle proxy — downloads, decompresses, decodes, and normalizes subtitles.
 * This is the key component that makes subtitles work on iOS:
 * - Downloads from original source
 * - Decompresses .gz / .zip files
 * - Detects and converts encoding to UTF-8
 * - Strips ASS/SSA/VTT formatting to clean SRT
 * - Serves with proper CORS and content-type headers
 */

const axios = require('axios');
const pako = require('pako');
const AdmZip = require('adm-zip');
const { decodeSubtitleBuffer } = require('./encoding');
const { normalizeToSrt } = require('./formatter');

/**
 * Fetch subtitle from URL with retry logic.
 */
async function fetchWithRetry(url, options = {}, retries = 2, backoffMs = 500) {
  try {
    return await axios.get(url, {
      timeout: 15000,
      maxContentLength: 10 * 1024 * 1024, // 10MB limit
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'StremioVietSub/1.0',
      },
      ...options,
    });
  } catch (error) {
    const status = error?.response?.status;
    if (retries > 0 && (status === 429 || status === 503 || status === 504)) {
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      return fetchWithRetry(url, options, retries - 1, backoffMs * 2);
    }
    throw error;
  }
}

/**
 * Detect if buffer is gzip compressed.
 */
function isGzip(buffer) {
  return buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

/**
 * Detect if buffer is a ZIP archive.
 */
function isZip(buffer) {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b &&
         buffer[2] === 0x03 && buffer[3] === 0x04;
}

/**
 * Extract subtitle file from a ZIP archive.
 * Finds the first .srt, .ass, .ssa, or .vtt file inside.
 */
function extractFromZip(buffer) {
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    // Priority: .srt > .vtt > .ass > .ssa > any text file
    const subtitleExts = ['.srt', '.vtt', '.ass', '.ssa', '.sub'];
    for (const ext of subtitleExts) {
      const entry = entries.find(e =>
        !e.isDirectory &&
        e.entryName.toLowerCase().endsWith(ext) &&
        !e.entryName.startsWith('__MACOSX') &&
        !e.entryName.startsWith('.')
      );
      if (entry) {
        return entry.getData();
      }
    }

    // Fallback: first non-directory entry
    const first = entries.find(e => !e.isDirectory && !e.entryName.startsWith('__MACOSX'));
    if (first) {
      return first.getData();
    }
  } catch (e) {
    console.error('[proxy] ZIP extraction error:', e.message);
  }
  return null;
}

/**
 * Download, decompress, decode, and normalize a subtitle file.
 *
 * @param {string} url - The original subtitle URL
 * @param {string} [languageCode] - Language hint for encoding detection
 * @returns {Promise<string|null>} Clean SRT text or null on failure
 */
async function proxySubtitle(url, languageCode = 'vie') {
  try {
    const response = await fetchWithRetry(url);
    let buffer = Buffer.from(response.data);

    // Step 1: Decompress if needed
    if (isGzip(buffer) || url.endsWith('.gz')) {
      try {
        buffer = Buffer.from(pako.ungzip(buffer));
      } catch (e) {
        console.error('[proxy] Gzip decompression failed:', e.message);
        return null;
      }
    } else if (isZip(buffer) || url.endsWith('.zip')) {
      const extracted = extractFromZip(buffer);
      if (!extracted) {
        console.error('[proxy] No subtitle found in ZIP');
        return null;
      }
      buffer = extracted;
    }

    // Step 2: Decode to UTF-8 string
    const text = decodeSubtitleBuffer(buffer, languageCode);
    if (!text || text.trim().length === 0) {
      console.error('[proxy] Empty subtitle after decoding');
      return null;
    }

    // Step 3: Normalize to clean SRT
    const srt = normalizeToSrt(text);
    if (!srt || srt.trim().length === 0) {
      console.error('[proxy] Empty subtitle after normalization');
      return null;
    }

    return srt;
  } catch (error) {
    console.error('[proxy] Error fetching subtitle:', error.message);
    return null;
  }
}

module.exports = {
  proxySubtitle,
  fetchWithRetry,
  extractFromZip,
};