#!/usr/bin/env node

/**
 * Stremio VietSub Proxy - Express Server
 * Serves the addon with:
 * - Full CORS support (iOS/WebKit compatibility)
 * - Subtitle proxy endpoint (the magic that makes iOS work)
 * - Configuration page
 * - Rate limiting
 * - Gzip compression
 */

const fs = require('fs');
const path = require('path');
const express = require('express');

function loadDotEnv() {
  var envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  var lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.charAt(0) === '#') continue;
    var eq = line.indexOf('=');
    if (eq === -1) continue;
    var key = line.slice(0, eq).trim();
    var value = line.slice(eq + 1).trim();
    if ((value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') ||
        (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
loadDotEnv();
const compression = require('compression');
const { getRouter } = require('stremio-addon-sdk');
const { builder, manifest, searchSubtitles, getLanguageName, LANGUAGES } = require('./addon');
const { proxySubtitle } = require('./lib/proxy');
const { pingOpenSubtitles, getAppApiKey } = require('./providers/opensubtitles');

// Configuration
const PORT = process.env.PORT || 7000;
const HOST = process.env.HOST || '0.0.0.0';

/**
 * Get the external URL for building proxy links.
 */
function getExternalUrl(req) {
  if (process.env.EXTERNAL_URL) {
    return process.env.EXTERNAL_URL.replace(/\/$/, '');
  }
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return protocol + '://' + host;
}

/**
 * Get client IP for rate limiting.
 */
function getClientIP(req) {
  return (req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '')
    .toString()
    .split(',')[0]
    .trim();
}

// Create Express app
const app = express();

// Gzip compression
app.use(compression());

// JSON body parser
app.use(express.json());

// ============================================================================
// CORS MIDDLEWARE — Critical for iOS compatibility
// ============================================================================
app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Request logging
app.use(function(req, res, next) {
  var start = Date.now();
  res.on('finish', function() {
    var duration = Date.now() - start;
    console.log(req.method + ' ' + req.path + ' - ' + res.statusCode + ' (' + duration + 'ms)');
  });
  next();
});

// ============================================================================
// RATE LIMITER (per IP)
// ============================================================================
var RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
var RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 120);
var rateLimitStore = new Map();

// Clean up rate limit store every 5 minutes
setInterval(function() {
  var now = Date.now();
  for (var entry of rateLimitStore) {
    if (now > entry[1].resetAt) {
      rateLimitStore.delete(entry[0]);
    }
  }
}, 5 * 60 * 1000);

app.use(function(req, res, next) {
  if (req.path === '/health') return next();

  var ip = getClientIP(req);
  var now = Date.now();

  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  var entry = rateLimitStore.get(ip);
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
    return next();
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please wait.' });
  }

  entry.count += 1;
  next();
});

// ============================================================================
// STATIC ROUTES
// ============================================================================

// Health check
app.get('/health', function(req, res) {
  res.json({ status: 'ok', version: manifest.version, opensubtitlesAppKey: Boolean(getAppApiKey()) });
});



// ============================================================================
// PROXY ENDPOINT — The heart of iOS compatibility
// ============================================================================
app.get('/proxy/:langCode/:encodedUrl.srt', async function(req, res) {
  try {
    var langCode = req.params.langCode;
    var encodedUrl = req.params.encodedUrl;

    // Decode the original URL
    var originalUrl = Buffer.from(encodedUrl, 'base64url').toString('utf-8');

    console.log('[proxy] Fetching: ' + originalUrl.substring(0, 80) + '...');

    // Download, decode, and normalize the subtitle
    var srt = await proxySubtitle(originalUrl, langCode);

    if (!srt) {
      return res.status(404)
        .set('Content-Type', 'text/plain; charset=utf-8')
        .send('1\n00:00:00,000 --> 00:00:05,000\n[Khong tim thay phu de / Subtitle not found]\n');
    }

    // Serve with proper headers for iOS
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="subtitle.srt"');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.send(srt);
  } catch (error) {
    console.error('[proxy] Error:', error.message);
    res.status(500)
      .set('Content-Type', 'text/plain; charset=utf-8')
      .send('1\n00:00:00,000 --> 00:00:05,000\n[Loi tai phu de / Error loading subtitle]\n');
  }
});

// ============================================================================
// STREMIO ADDON SDK ROUTES
// ============================================================================

// Manifest endpoint (for direct access)
app.get('/manifest.json', function(req, res) {
  res.json(manifest);
});

// Config manifest endpoint
app.get('/:config/manifest.json', function(req, res) {
  res.json(manifest);
});

// Subtitles endpoint — intercept to inject proxy base URL
app.get('/:config/subtitles/:type/:id.json', async function(req, res) {
  try {
    var config = req.params.config;
    var type = req.params.type;
    var id = req.params.id;
    var baseUrl = getExternalUrl(req);

    // Parse config
    var addonConfig = {};
    try {
      addonConfig = JSON.parse(decodeURIComponent(config));
    } catch (e) {
      // Config may be empty or invalid
    }

    // Call the search function directly
    var result = await searchSubtitles(type, id, addonConfig);

    // Replace PROXY_BASE_URL with actual base URL
    if (result && result.subtitles) {
      for (var i = 0; i < result.subtitles.length; i++) {
        var sub = result.subtitles[i];
        if (sub.url) {
          sub.url = sub.url.replace('PROXY_BASE_URL', baseUrl);
        }
      }
    }

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
    res.json(result);
  } catch (error) {
    console.error('[server] Subtitles handler error:', error.message);
    res.json({ subtitles: [] });
  }
});

// Root subtitles endpoint (no config)
app.get('/subtitles/:type/:id.json', async function(req, res) {
  try {
    var type = req.params.type;
    var id = req.params.id;
    var baseUrl = getExternalUrl(req);

    var result = await searchSubtitles(type, id, {});

    if (result && result.subtitles) {
      for (var i = 0; i < result.subtitles.length; i++) {
        var sub = result.subtitles[i];
        if (sub.url) {
          sub.url = sub.url.replace('PROXY_BASE_URL', baseUrl);
        }
      }
    }

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
    res.json(result);
  } catch (error) {
    console.error('[server] Subtitles handler error:', error.message);
    res.json({ subtitles: [] });
  }
});

// Catalog endpoint - for better discoverability
app.get('/:config/catalog/:type/:id.json', async function(req, res) {
  try {
    var config = req.params.config;
    var type = req.params.type;
    var id = req.params.id;
    var extra = req.query.extra ? JSON.parse(req.query.extra) : {};

    // Parse config
    var addonConfig = {};
    try {
      addonConfig = JSON.parse(decodeURIComponent(config));
    } catch (e) {
      // Config may be empty or invalid
    }

    // Use the catalog handler from builder
    var catalogHandler = builder.handlers.catalog;
    if (catalogHandler) {
      var result = await catalogHandler({ type: type, id: id, extra: extra, config: addonConfig });
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=7200');
      res.json(result);
    } else {
      res.json({ metas: [] });
    }
  } catch (error) {
    console.error('[server] Catalog handler error:', error.message);
    res.json({ metas: [] });
  }
});

// Root catalog endpoint (no config)
app.get('/catalog/:type/:id.json', async function(req, res) {
  try {
    var type = req.params.type;
    var id = req.params.id;
    var extra = req.query.extra ? JSON.parse(req.query.extra) : {};

    var catalogHandler = builder.handlers.catalog;
    if (catalogHandler) {
      var result = await catalogHandler({ type: type, id: id, extra: extra, config: {} });
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=7200');
      res.json(result);
    } else {
      res.json({ metas: [] });
    }
  } catch (error) {
    console.error('[server] Catalog handler error:', error.message);
    res.json({ metas: [] });
  }
});

// ============================================================================
// CONFIGURE / LANDING PAGE
// ============================================================================
app.get('/', function(req, res) {
  res.redirect('/configure');
});

app.get('/configure', function(req, res) {
  var baseUrl = getExternalUrl(req);
  res.send(generateConfigPage(baseUrl));
});

app.get('/:config/configure', function(req, res) {
  var baseUrl = getExternalUrl(req);
  res.send(generateConfigPage(baseUrl));
});

/**
 * Generate the configuration page HTML.
 */
function generateConfigPage(baseUrl) {
  var langOptions = LANGUAGES.map(function(l) {
    return '<option value="' + l.code + '"' + (l.code === 'vie' ? ' selected' : '') + '>' + l.name + '</option>';
  }).join('\n');

  return '<!DOCTYPE html>\n' +
'<html lang="vi">\n' +
'<head>\n' +
'  <meta charset="UTF-8">\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'  <title>VietSub Proxy - Stremio Addon</title>\n' +
'  <meta name="description" content="Addon phu de Tieng Viet cho Stremio. Ho tro OpenSubtitles, SubDL, SubSource. Tuong thich iOS.">\n' +
'  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">\n' +
'  <style>\n' +
'    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n' +
'    :root {\n' +
'      --bg-primary: #0a0a0f;\n' +
'      --bg-card: rgba(255, 255, 255, 0.03);\n' +
'      --bg-card-hover: rgba(255, 255, 255, 0.06);\n' +
'      --border: rgba(255, 255, 255, 0.08);\n' +
'      --text-primary: #f0f0f5;\n' +
'      --text-secondary: #8888a0;\n' +
'      --text-muted: #555568;\n' +
'      --accent: #da2f68;\n' +
'      --accent-glow: rgba(218, 47, 104, 0.3);\n' +
'      --accent-2: #f89e00;\n' +
'      --success: #22c55e;\n' +
'      --info: #3b82f6;\n' +
'      --info-soft: rgba(59,130,246,0.14);\n' +
'      --radius: 16px;\n' +
'      --radius-sm: 10px;\n' +
'    }\n' +
'    body {\n' +
'      font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;\n' +
'      background: var(--bg-primary);\n' +
'      color: var(--text-primary);\n' +
'      min-height: 100vh;\n' +
'      overflow-x: hidden;\n' +
'    }\n' +
'    body::before {\n' +
'      content: "";\n' +
'      position: fixed;\n' +
'      top: -50%; left: -50%; width: 200%; height: 200%;\n' +
'      background: radial-gradient(ellipse at 30% 20%, rgba(218,47,104,0.08) 0%, transparent 50%),\n' +
'                  radial-gradient(ellipse at 70% 80%, rgba(99,102,241,0.06) 0%, transparent 50%),\n' +
'                  radial-gradient(ellipse at 50% 50%, rgba(248,158,0,0.04) 0%, transparent 50%);\n' +
'      animation: bgFloat 20s ease-in-out infinite;\n' +
'      z-index: -1;\n' +
'    }\n' +
'    @keyframes bgFloat {\n' +
'      0%, 100% { transform: translate(0,0) rotate(0deg); }\n' +
'      33% { transform: translate(2%,-2%) rotate(1deg); }\n' +
'      66% { transform: translate(-1%,1%) rotate(-0.5deg); }\n' +
'    }\n' +
'    .container { max-width: 640px; margin: 0 auto; padding: 40px 20px; }\n' +
'    .header { text-align: center; margin-bottom: 40px; }\n' +
'    .logo { font-size: 64px; margin-bottom: 16px; animation: pulse 3s ease-in-out infinite; }\n' +
'    @keyframes pulse { 0%,100%{transform:scale(1);} 50%{transform:scale(1.05);} }\n' +
'    .header h1 {\n' +
'      font-size: 28px; font-weight: 800;\n' +
'      background: linear-gradient(135deg, #da2f68, #f89e00);\n' +
'      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;\n' +
'      margin-bottom: 8px;\n' +
'    }\n' +
'    .header p { color: var(--text-secondary); font-size: 15px; line-height: 1.6; }\n' +
'    .badge-row { display:flex; justify-content:center; gap:8px; margin-top:16px; flex-wrap:wrap; }\n' +
'    .badge {\n' +
'      display:inline-flex; align-items:center; gap:4px; padding:4px 12px;\n' +
'      border-radius:20px; font-size:12px; font-weight:600;\n' +
'      border:1px solid var(--border); background:var(--bg-card); color:var(--text-secondary);\n' +
'    }\n' +
'    .badge.ios { border-color: rgba(34,197,94,0.3); color: var(--success); }\n' +
'    .badge.sources { border-color: rgba(248,158,0,0.3); color: var(--accent-2); }\n' +
'    .card {\n' +
'      background: var(--bg-card); border: 1px solid var(--border);\n' +
'      border-radius: var(--radius); padding: 24px; margin-bottom: 20px;\n' +
'      backdrop-filter: blur(20px); transition: all 0.3s ease;\n' +
'    }\n' +
'    .card:hover { background: var(--bg-card-hover); border-color: rgba(255,255,255,0.12); }\n' +
'    .card-title { font-size:16px; font-weight:700; margin-bottom:16px; display:flex; align-items:center; gap:8px; }\n' +
'    .card-title .icon { font-size: 20px; }\n' +
'    .field { margin-bottom: 16px; }\n' +
'    .field:last-child { margin-bottom: 0; }\n' +
'    .field label { display:block; font-size:13px; font-weight:600; color:var(--text-secondary); margin-bottom:6px; }\n' +
'    .field select, .field input {\n' +
'      width:100%; padding:12px 16px; background:rgba(255,255,255,0.04);\n' +
'      border:1px solid var(--border); border-radius:var(--radius-sm);\n' +
'      color:var(--text-primary); font-size:14px; font-family:inherit; outline:none;\n' +
'      transition: all 0.2s ease;\n' +
'    }\n' +
'    .field select:focus, .field input:focus { border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-glow); }\n' +
'    .field select option { background:#1a1a2e; color:var(--text-primary); }\n' +
'    .toggle-group { display:flex; gap:8px; margin-top:8px; }\n' +
'    .toggle-btn {\n' +
'      flex:1; padding:8px 12px; background:rgba(255,255,255,0.04);\n' +
'      border:1px solid var(--border); border-radius:var(--radius-sm);\n' +
'      color:var(--text-secondary); font-size:13px; font-family:inherit; cursor:pointer;\n' +
'      transition: all 0.2s ease; text-align:center;\n' +
'    }\n' +
'    .toggle-btn.active { background:rgba(34,197,94,0.15); border-color:var(--success); color:var(--success); }\n' +
'    .toggle-btn:hover:not(.active) { border-color:var(--accent); color:var(--accent); }\n' +
'    .field .hint { font-size:11px; color:var(--text-muted); margin-top:4px; line-height:1.4; }\n' +
'    .field .hint a { color:var(--accent-2); text-decoration:none; }\n' +
'    .field .hint a:hover { text-decoration:underline; }\n' +
'    .provider {\n' +
'      display:flex; align-items:center; justify-content:space-between;\n' +
'      padding:12px 16px; background:rgba(255,255,255,0.02);\n' +
'      border:1px solid var(--border); border-radius:var(--radius-sm); margin-bottom:10px;\n' +
'    }\n' +
'    .provider-info { display:flex; align-items:center; gap:10px; }\n' +
'    .provider-name { font-size:14px; font-weight:600; }\n' +
'    .provider-tag { font-size:10px; padding:2px 8px; border-radius:10px; font-weight:600; text-transform:uppercase; }\n' +
'    .provider-tag.free { background:rgba(34,197,94,0.15); color:var(--success); }\n' +
'    .provider-tag.key { background:rgba(248,158,0,0.15); color:var(--accent-2); }\n' +
'    .install-btn {\n' +
'      width:100%; padding:16px; background:linear-gradient(135deg,#da2f68,#b91c50);\n' +
'      border:none; border-radius:var(--radius-sm); color:white;\n' +
'      font-size:16px; font-weight:700; font-family:inherit; cursor:pointer;\n' +
'      transition:all 0.3s ease; position:relative; overflow:hidden;\n' +
'    }\n' +
'    .install-btn:hover { transform:translateY(-2px); box-shadow:0 8px 30px var(--accent-glow); }\n' +
'    .install-btn:active { transform:translateY(0); }\n' +
'    .install-btn::after {\n' +
'      content:""; position:absolute; top:0; left:-100%; width:100%; height:100%;\n' +
'      background:linear-gradient(90deg,transparent,rgba(255,255,255,0.1),transparent); transition:0.5s;\n' +
'    }\n' +
'    .install-btn:hover::after { left:100%; }\n' +
'    .copy-btn {\n' +
'      width:100%; padding:12px; background:transparent; border:1px solid var(--border);\n' +
'      border-radius:var(--radius-sm); color:var(--text-secondary); font-size:13px;\n' +
'      font-family:inherit; cursor:pointer; margin-top:10px; transition:all 0.2s ease;\n' +
'    }\n' +
'    .copy-btn:hover { border-color:var(--accent); color:var(--accent); }\n' +
'    .auth-method {\n' +
'      border:1px solid rgba(59,130,246,0.55); background:rgba(59,130,246,0.08);\n' +
'      border-radius:var(--radius-sm); padding:14px 16px; margin-bottom:16px;\n' +
'    }\n' +
'    .auth-method-title { font-size:14px; font-weight:700; display:flex; align-items:center; gap:8px; }\n' +
'    .auth-method-title input { accent-color:var(--info); }\n' +
'    .auth-method-desc { font-size:12px; color:var(--text-secondary); margin-top:6px; line-height:1.45; }\n' +
'    .tmdb-grid { display:grid; grid-template-columns:1fr minmax(180px,220px); gap:16px; align-items:stretch; }\n' +
'    .password-wrap { position:relative; }\n' +
'    .password-wrap input { padding-right:64px; }\n' +
'    .password-wrap .lock-icon { position:absolute; right:36px; top:50%; transform:translateY(-50%); font-size:14px; pointer-events:none; }\n' +
'    .eye-btn {\n' +
'      position:absolute; right:8px; top:50%; transform:translateY(-50%);\n' +
'      background:none; border:none; cursor:pointer; color:var(--text-secondary); font-size:16px; line-height:1;\n' +
'    }\n' +
'    .eye-btn:hover { color:var(--text-primary); }\n' +
'    .ping-panel {\n' +
'      background:var(--info-soft); border:1px solid rgba(59,130,246,0.3);\n' +
'      border-radius:var(--radius-sm); padding:16px; display:flex; flex-direction:column; justify-content:space-between; gap:12px;\n' +
'    }\n' +
'    .ping-panel p { font-size:11px; font-weight:700; letter-spacing:0.04em; color:#93c5fd; line-height:1.45; text-transform:uppercase; }\n' +
'    .ping-btn {\n' +
'      width:100%; padding:10px 12px; background:var(--info); border:none; border-radius:8px;\n' +
'      color:white; font-weight:700; font-family:inherit; cursor:pointer; font-size:13px;\n' +
'      transition: all 0.2s ease;\n' +
'    }\n' +
'    .ping-btn:hover { filter:brightness(1.08); transform: translateY(-1px); }\n' +
'    .ping-btn:active { transform: translateY(0); }\n' +
'    .ping-btn:disabled { opacity:0.6; cursor:wait; transform: none; }\n' +
'    #osPingStatus { font-size:13px; line-height:1.4; min-height:1.4em; font-weight:600; }\n' +
'    #osPingDetails { font-size:12px; line-height:1.5; }\n' +
'    #osPingDetails strong { color: var(--text-primary); }\n' +
 +
'    .steps { display:flex; flex-direction:column; gap:12px; }\n' +
'    .step { display:flex; gap:12px; align-items:flex-start; }\n' +
'    .step-num {\n' +
'      flex-shrink:0; width:28px; height:28px;\n' +
'      background:linear-gradient(135deg,var(--accent),var(--accent-2));\n' +
'      border-radius:50%; display:flex; align-items:center; justify-content:center;\n' +
'      font-size:13px; font-weight:700;\n' +
'    }\n' +
'    .step-text { font-size:13px; color:var(--text-secondary); line-height:1.5; padding-top:4px; }\n' +
'    .footer { text-align:center; margin-top:40px; color:var(--text-muted); font-size:12px; }\n' +
'    .footer a { color:var(--text-secondary); text-decoration:none; }\n' +
'    @media (max-width:480px) { .container{padding:24px 16px;} .header h1{font-size:24px;} .logo{font-size:48px;} }\n' +
'  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <div class="container">\n' +
'    <div class="header">\n' +
'      <div class="logo">\xF0\x9F\x87\xBB\xF0\x9F\x87\xB3</div>\n' +
'      <h1>VietSub Proxy</h1>\n' +
'      <p>Addon ph\u1EE5 \u0111\u1EC7 cho Stremio \u2014 OpenSubtitles.com, \u0111a ID format, x\u1EED l\u00FD server-side, t\u01B0\u01A1ng th\u00EDch 100% iOS</p>\n' +
'      <div class="badge-row">\n' +
'        <span class="badge ios">\u2705 iOS Compatible</span>\n' +
'        <span class="badge sources">\uD83D\uDD0C OpenSubtitles</span>\n' +
'        <span class="badge">\uD83D\uDCE1 Proxy Server</span>\n' +
'      </div>\n' +
'    </div>\n' +
'    <div class="card">\n' +
'      <div class="card-title"><span class="icon">\uD83C\uDF10</span> Ng\u00F4n ng\u1EEF</div>\n' +
'      <div class="field">\n' +
'        <label>Ch\u1ECDn ng\u00F4n ng\u1EEF ph\u1EE5 \u0111\u1EC1</label>\n' +
'        <select id="lang">\n' +
           langOptions + '\n' +
'        </select>\n' +
'      </div>\n' +
'    </div>\n' +
'    <div class="card">\n' +
'      <div class="card-title"><span class="icon">\uD83D\uDCC4</span> OpenSubtitles (V3)</div>\n' +
'      <div class="field">\n' +
'        <label>API Key (tùy chọn)</label>\n' +
'        <input type="text" id="opensubsKey" placeholder="Nhập API key để có kết quả tốt hơn">\n' +
'        <div class="hint">Dùng Stremio V3 proxy mặc định (không cần auth). API key tùy chọn để có thêm kết quả từ official API. Tạo key tại <a href="https://www.opensubtitles.com/consumers" target="_blank">opensubtitles.com/consumers</a></div>\n' +
'      </div>\n' +
'    </div>\n' +
'    <div class="card">\n' +
'      <div class="card-title"><span class="icon">\uD83D\uDD0C</span> Ngu\u1ED3n ph\u1EE5 \u0111\u1EC1</div>\n' +
'      <div class="provider" style="flex-direction:column;align-items:stretch;">\n' +
'        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">\n' +
'          <div class="provider-info">\n' +
'            <span>\uD83D\uDCE6</span>\n' +
'            <span class="provider-name">OpenSubtitles</span>\n' +
'            <span class="provider-tag free">M\u1EB7c \u0111\u1ECBnh</span>\n' +
'          </div>\n' +
'          <span style="color:var(--success);font-size:14px;">\u2713 Lu\u00F4n b\u1EADt</span>\n' +
'        </div>\n' +
'        <div class="hint" style="margin:0">Dùng Auth OpenSubtitles.com phía trên. Không cần dán API key.</div>\n' +
'      </div>\n' +
 +
'    </div>\n' +
'    <div class="card">\n' +
'      <div class="card-title"><span class="icon">\u2699\uFE0F</span> C\u00E1ch ho\u1EA1t \u0111\u1ED9ng</div>\n' +
'      <div class="steps">\n' +
'        <div class="step"><div class="step-num">1</div><div class="step-text">Khi b\u1EA1n xem phim, Stremio g\u1EEDi ID phim \u0111\u1EBFn server addon</div></div>\n' +
'        <div class="step"><div class="step-num">2</div><div class="step-text">Server t\u1EA3i ph\u1EE5 \u0111\u1EC7 t\u1EEB OpenSubtitles.com</div></div>\n' +
'        <div class="step"><div class="step-num">3</div><div class="step-text">Server x\u1EED l\u00FD: gi\u1EA3i n\u00E9n \u2192 chuy\u1EC3n encoding UTF-8 \u2192 strip \u0111\u1ECBnh d\u1EA1ng l\u1ED7i \u2192 t\u1EA1o file .srt s\u1EA1ch</div></div>\n' +
'        <div class="step"><div class="step-num">4</div><div class="step-text">iOS nh\u1EADn file s\u1EA1ch qua domain addon \u2192 hi\u1EC3n th\u1ECB m\u01B0\u1EE3t m\u00E0, kh\u00F4ng l\u1ED7i Invalid \u2705</div></div>\n' +
'      </div>\n' +
'    </div>\n' +
'    <div class="card">\n' +
'      <div class="card-title"><span class="icon">\uD83D\uDE80</span> C\u00E0i \u0111\u1EB7t</div>\n' +
'      <button class="install-btn" onclick="installAddon()">\u26A1 C\u00E0i v\u00E0o Stremio</button>\n' +
'      <button class="copy-btn" onclick="copyLink()">\uD83D\uDCCB Copy link manifest</button>\n' +
'      <div id="manifestUrl" style="margin-top:10px;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;font-size:11px;color:var(--text-muted);word-break:break-all;display:none;"></div>\n' +
'    </div>\n' +
'    <div class="footer">\n' +
'      <p>VietSub Proxy v' + manifest.version + ' \u2014 Made with \u2764\uFE0F for Vietnamese Stremio users</p>\n' +
'      <p style="margin-top:4px;">Powered by OpenSubtitles</p>\n' +
'    </div>\n' +
'  </div>\n' +
'  <script>\n' +
'    var osToken = "";\n' +
'    function buildManifestUrl() {\n' +
'      var lang = document.getElementById("lang").value;\n' +
'      var opensubsKey = document.getElementById("opensubsKey").value.trim();\n' +
'      var config = {};\n' +
'      var langSelect = document.getElementById("lang");\n' +
'      var langText = langSelect.options[langSelect.selectedIndex].text;\n' +
'      config.lang = langText + " [" + lang + "]";\n' +
'      if (opensubsKey) config.opensubsKey = opensubsKey;\n' +
'      var configStr = encodeURIComponent(JSON.stringify(config));\n' +
'      var baseUrl = window.location.origin;\n' +
'      return baseUrl + "/" + configStr + "/manifest.json";\n' +
'    }\n' +
 +
'    function installAddon() {\n' +
'      var manifestUrl = buildManifestUrl();\n' +
'      var stremioUrl = manifestUrl.replace(/^https?:\\/\\//, "stremio://");\n' +
'      window.location.href = stremioUrl;\n' +
'    }\n' +
'    function copyLink() {\n' +
'      var manifestUrl = buildManifestUrl();\n' +
'      var urlDisplay = document.getElementById("manifestUrl");\n' +
'      urlDisplay.textContent = manifestUrl;\n' +
'      urlDisplay.style.display = "block";\n' +
'      navigator.clipboard.writeText(manifestUrl).then(function() {\n' +
'        var btn = document.querySelector(".copy-btn");\n' +
'        btn.textContent = "\\u2705 \\u0110\\u00E3 copy!";\n' +
'        setTimeout(function() { btn.textContent = "\\uD83D\\uDCCB Copy link manifest"; }, 2000);\n' +
'      }).catch(function() {\n' +
'        var range = document.createRange();\n' +
'        range.selectNode(urlDisplay);\n' +
'        window.getSelection().removeAllRanges();\n' +
'        window.getSelection().addRange(range);\n' +
'      });\n' +
'    }\n' +
'  </script>\n' +
'</body>\n' +
'</html>';
}

// ============================================================================
// START SERVER
// ============================================================================
if (require.main === module) {
  app.listen(PORT, HOST, function() {
    console.log('');
    console.log('  \uD83C\uDDFB\uD83C\uDDF3 VietSub Proxy Addon is running!');
    console.log('  ────────────────────────────────────');
    console.log('  Configure:  http://localhost:' + PORT + '/configure');
    console.log('  Manifest:   http://localhost:' + PORT + '/manifest.json');
    console.log('  Health:     http://localhost:' + PORT + '/health');
    console.log('');
  });
}

// Export for Vercel serverless
module.exports = app;