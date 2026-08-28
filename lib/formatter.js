/**
 * Subtitle format normalizer.
 * Converts various subtitle formats (ASS/SSA, VTT, SUB, SBV) to clean SRT.
 * Strips all complex styling that would crash iOS players.
 */

/**
 * Parse SRT time format to milliseconds.
 * Accepts both comma (SRT: 00:01:23,456) and period (VTT: 00:01:23.456).
 */
function parseTimeToMs(timeStr) {
  if (!timeStr) return 0;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return 0;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const s = parseInt(match[3], 10);
  let ms = match[4];
  // Pad to 3 digits
  while (ms.length < 3) ms += '0';
  ms = parseInt(ms, 10);
  return h * 3600000 + m * 60000 + s * 1000 + ms;
}

/**
 * Convert milliseconds to SRT time format (00:01:23,456).
 */
function msToSrtTime(ms) {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const m = Math.floor(ms / 60000);
  ms -= m * 60000;
  const s = Math.floor(ms / 1000);
  const milli = ms - s * 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

/**
 * Strip ASS/SSA override tags: {\an8}, {\pos(x,y)}, {\fad(...)}, {\c&H...&}, etc.
 */
function stripAssTags(text) {
  // Remove all {...} override blocks
  text = text.replace(/\{[^}]*\}/g, '');
  // Remove \N (ASS newline)
  text = text.replace(/\\N/g, '\n');
  text = text.replace(/\\n/g, '\n');
  // Remove \h (ASS hard space)
  text = text.replace(/\\h/g, ' ');
  return text.trim();
}

/**
 * Strip HTML tags except basic <i>, <b>, <u>.
 * iOS Stremio supports these basic tags.
 */
function stripHtmlTags(text) {
  // Keep <i>, </i>, <b>, </b>, <u>, </u>
  // Remove everything else
  text = text.replace(/<(?!\/?(?:i|b|u)\b)[^>]+>/gi, '');
  // Convert <br> to newline
  text = text.replace(/<br\s*\/?>/gi, '\n');
  return text;
}

/**
 * Parse an SRT string into an array of cue objects.
 */
function parseSrt(srtText) {
  const lines = srtText.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const cues = [];
  let current = null;
  let pendingId = null;

  function pushCurrent() {
    if (current && current.startTime && current.endTime && current.text && current.text.trim()) {
      cues.push(current);
    }
    current = null;
  }

  const timePattern = /^\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Empty line = cue boundary
    if (!line) {
      pushCurrent();
      pendingId = null;
      continue;
    }

    // Timestamp line
    const timeMatch = line.match(timePattern);
    if (timeMatch) {
      pushCurrent();
      current = {
        id: pendingId || String(cues.length + 1),
        startTime: timeMatch[1].replace('.', ','),
        endTime: timeMatch[2].replace('.', ','),
        text: '',
      };
      pendingId = null;
      continue;
    }

    // If next line is a timestamp, this line is a cue ID
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
    if (nextLine.match(timePattern)) {
      if (current) pushCurrent();
      pendingId = line;
      continue;
    }

    // Skip preamble before first cue
    if (!current) continue;

    // Text line
    if (current.text) current.text += '\n';
    current.text += line;
  }

  pushCurrent();
  return cues;
}

/**
 * Parse ASS/SSA format to cue array.
 */
function parseAss(assText) {
  const cues = [];
  const lines = assText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let inEvents = false;
  let formatFields = null;
  let textIdx = -1;
  let startIdx = -1;
  let endIdx = -1;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.toLowerCase() === '[events]') {
      inEvents = true;
      continue;
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      inEvents = false;
      continue;
    }

    if (!inEvents) continue;

    if (trimmed.toLowerCase().startsWith('format:')) {
      formatFields = trimmed.substring(7).split(',').map(f => f.trim().toLowerCase());
      textIdx = formatFields.indexOf('text');
      startIdx = formatFields.indexOf('start');
      endIdx = formatFields.indexOf('end');
      continue;
    }

    if (!trimmed.toLowerCase().startsWith('dialogue:')) continue;
    if (textIdx < 0 || startIdx < 0 || endIdx < 0) continue;

    // Split by comma, but the Text field is the last and may contain commas
    const parts = trimmed.substring(9).split(',');
    if (parts.length <= textIdx) continue;

    const startRaw = parts[startIdx].trim();
    const endRaw = parts[endIdx].trim();
    // Text is everything from textIdx onward (may contain commas)
    const textRaw = parts.slice(textIdx).join(',').trim();

    // Convert ASS time (H:MM:SS.CC) to SRT time (HH:MM:SS,mmm)
    const startTime = assTimeToSrt(startRaw);
    const endTime = assTimeToSrt(endRaw);

    if (!startTime || !endTime) continue;

    // Clean text
    let text = stripAssTags(textRaw);
    text = stripHtmlTags(text);
    text = text.trim();

    if (!text) continue;

    cues.push({
      id: String(cues.length + 1),
      startTime,
      endTime,
      text,
    });
  }

  // Sort by start time
  cues.sort((a, b) => parseTimeToMs(a.startTime) - parseTimeToMs(b.startTime));
  return cues;
}

/**
 * Convert ASS time format (H:MM:SS.CC) to SRT format (HH:MM:SS,mmm).
 */
function assTimeToSrt(assTime) {
  const match = assTime.match(/^(\d+):(\d{2}):(\d{2})\.(\d{2,3})$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const s = parseInt(match[3], 10);
  let cs = match[4];
  // Convert centiseconds to milliseconds
  if (cs.length === 2) cs = cs + '0';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${cs}`;
}

/**
 * Parse WebVTT format to cue array.
 */
function parseVtt(vttText) {
  // Remove WEBVTT header and NOTE blocks
  let cleaned = vttText.replace(/^WEBVTT[^\n]*\n/i, '');
  cleaned = cleaned.replace(/NOTE[^\n]*\n(?:(?!\n\n).)*\n\n/gs, '');
  // Remove STYLE blocks
  cleaned = cleaned.replace(/STYLE[^\n]*\n(?:(?!\n\n).)*\n\n/gs, '');
  // VTT uses periods, SRT uses commas - parseSrt handles both
  return parseSrt(cleaned);
}

/**
 * Detect subtitle format from content.
 */
function detectFormat(text) {
  const trimmed = text.trim();

  if (trimmed.startsWith('WEBVTT') || trimmed.match(/^WEBVTT/i)) {
    return 'vtt';
  }

  if (trimmed.includes('[Script Info]') || trimmed.includes('[V4+ Styles]') || trimmed.includes('[V4 Styles]')) {
    return 'ass';
  }

  // Default to SRT
  return 'srt';
}

/**
 * Format cues array back to SRT string.
 */
function formatSrt(cues) {
  const lines = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    lines.push(String(i + 1));
    lines.push(`${cue.startTime} --> ${cue.endTime}`);
    lines.push(cue.text);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Clean subtitle text for iOS compatibility.
 * Strips complex formatting, normalizes to clean SRT.
 *
 * @param {string} rawText - Raw subtitle text in any format
 * @returns {string} Clean SRT text
 */
function normalizeToSrt(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';

  const format = detectFormat(rawText);
  let cues;

  switch (format) {
    case 'ass':
      cues = parseAss(rawText);
      break;
    case 'vtt':
      cues = parseVtt(rawText);
      break;
    case 'srt':
    default:
      cues = parseSrt(rawText);
      break;
  }

  if (!cues || cues.length === 0) return '';

  // Clean all cue text
  for (const cue of cues) {
    cue.text = stripAssTags(cue.text);
    cue.text = stripHtmlTags(cue.text);
    cue.text = cue.text.trim();
  }

  // Filter out empty cues
  const validCues = cues.filter(c => c.text && c.text.trim());

  return formatSrt(validCues);
}

module.exports = {
  normalizeToSrt,
  parseSrt,
  parseAss,
  parseVtt,
  formatSrt,
  detectFormat,
  parseTimeToMs,
  msToSrtTime,
  stripAssTags,
  stripHtmlTags,
};