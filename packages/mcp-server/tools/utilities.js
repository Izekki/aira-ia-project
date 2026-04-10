/**
 * Utility tools
 *
 * util.time()              – local date/time                         LOW
 * util.weather(location?)  – current weather via Open-Meteo (free,
 *                            no API key required)                   LOW
 *
 * Open-Meteo: https://open-meteo.com  (CC BY 4.0, free, keyless)
 * Geocoding:  https://geocoding-api.open-meteo.com (also free)
 */

const https = require('https');

/**
 * Fetch JSON from a URL using the built-in https module (no extra deps).
 * @param {string} url
 * @returns {Promise<any>}
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(new Error('Failed to parse JSON response: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out.'));
    });
  });
}

/**
 * Return local date and time information.
 * @returns {{ iso: string, locale: string, timezone: string, timestamp: number }}
 */
async function utilTime() {
  const now = new Date();
  return {
    iso: now.toISOString(),
    locale: now.toLocaleString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timestamp: now.getTime(),
  };
}

/**
 * Fetch current weather for a location using Open-Meteo (keyless, free).
 *
 * If no location is provided, returns a helpful stub message instead of
 * failing, so the caller is informed how to supply coordinates.
 *
 * @param {{ location?: string, lat?: number, lon?: number }} params
 */
async function utilWeather({ location, lat, lon } = {}) {
  // If explicit coordinates are given, use them directly.
  let resolvedLat = lat;
  let resolvedLon = lon;
  let resolvedName = location;

  // Try geocoding if only a location name is provided.
  if (!resolvedLat && location) {
    try {
      const geoUrl =
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
      const geo = await fetchJson(geoUrl);
      if (geo.results && geo.results.length > 0) {
        resolvedLat = geo.results[0].latitude;
        resolvedLon = geo.results[0].longitude;
        resolvedName = geo.results[0].name + (geo.results[0].country ? `, ${geo.results[0].country}` : '');
      }
    } catch (geoErr) {
      return {
        error: true,
        message: `Could not geocode location "${location}": ${geoErr.message}. Try passing lat/lon directly.`,
        stub: true,
      };
    }
  }

  if (!resolvedLat || !resolvedLon) {
    return {
      error: false,
      stub: true,
      message:
        'No location provided. Pass location="City Name" or lat/lon coordinates. ' +
        'Weather is powered by Open-Meteo (free, no API key required).',
    };
  }

  try {
    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${resolvedLat}&longitude=${resolvedLon}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code` +
      `&temperature_unit=celsius&wind_speed_unit=kmh&timezone=auto`;

    const data = await fetchJson(weatherUrl);
    const current = data.current || {};

    return {
      location: resolvedName || `${resolvedLat},${resolvedLon}`,
      temperature_c: current.temperature_2m,
      humidity_pct: current.relative_humidity_2m,
      wind_speed_kmh: current.wind_speed_10m,
      weather_code: current.weather_code,
      time: current.time,
      source: 'Open-Meteo (https://open-meteo.com)',
    };
  } catch (err) {
    return {
      error: true,
      message: `Weather fetch failed: ${err.message}`,
      stub: true,
    };
  }
}

module.exports = { utilTime, utilWeather };
