/**
 * Browser tools
 *
 * browser.open(url)                – open a URL in the default browser   MEDIUM
 * browser.search(query, engine?)   – perform a search in the browser     MEDIUM
 *
 * Uses the Node.js `open` package (v8, CJS-compatible) to trigger the OS
 * default browser.  No additional browser drivers are required.
 * Playwright integration is noted in docs/mcp-agent.md as a future upgrade.
 *
 * URL validation is strict – only http/https are permitted (no file:// etc).
 */

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * Validate and normalise a URL string.
 * @param {string} rawUrl
 * @returns {URL}
 */
function parseUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: "${rawUrl}".`);
  }
  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
    throw new Error(`URL protocol "${url.protocol}" is not allowed. Only http/https URLs are permitted.`);
  }
  return url;
}

/**
 * Search engine URL templates.
 */
const SEARCH_ENGINES = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  youtube: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  duckduckgo: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  bing: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  spotify: (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}`,
};

/**
 * Detect the best engine based on query keywords.
 * @param {string} query
 * @param {string} engine
 * @returns {string}
 */
function detectEngine(query, engine) {
  if (engine && SEARCH_ENGINES[engine.toLowerCase()]) {
    return engine.toLowerCase();
  }
  const lower = query.toLowerCase();
  if (lower.includes('youtube') || lower.includes('video')) return 'youtube';
  if (lower.includes('spotify') || lower.includes('cancion') || lower.includes('music') || lower.includes('song')) {
    return 'spotify';
  }
  return 'google';
}

/**
 * Lazy-load the `open` ESM-compatible package.
 * Wrapped so we can handle both old CJS and new ESM versions.
 */
async function openUrl(url) {
  const { default: openPkg } = await import('open');
  await openPkg(url);
}

/**
 * Open a URL in the default browser.
 * @param {{ url: string }} params
 */
async function browserOpen({ url } = {}) {
  if (!url) throw new Error('browser.open requires a url argument.');
  const parsed = parseUrl(url);
  await openUrl(parsed.href);
  return { url: parsed.href, opened: true };
}

/**
 * Perform a search query via a search engine in the default browser.
 * @param {{ query: string, engine?: string }} params
 */
async function browserSearch({ query, engine } = {}) {
  if (!query) throw new Error('browser.search requires a query argument.');
  const selectedEngine = detectEngine(query, engine);
  const urlTemplate = SEARCH_ENGINES[selectedEngine];
  const url = urlTemplate(query);
  await openUrl(url);
  return { query, engine: selectedEngine, url, opened: true };
}

module.exports = { browserOpen, browserSearch, SEARCH_ENGINES };
