require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const { waitForDb, getPool } = require('./db');
const { initializeDb } = require('./initDb');
const { scrapeListing, detectSource } = require('./scraper');
const { saveImagesLocally } = require('./imageStore');

const app = express();
const port = Number(process.env.PORT || 3000);
const DEFAULT_ORS_API_KEY = process.env.ORS_API_KEY || '';
const ROUTE_CACHE_VERSION = 3;

const STATUS_OPTIONS = ['Nowe', 'Do kontaktu', 'W trakcie', 'Do sprawdzenia', 'Odrzucone', 'Nieaktualne'];
const DEFAULT_STATUS_FILTERS = STATUS_OPTIONS.filter((s) => s !== 'Odrzucone');

const PROGRESS_FIELDS = ['reviewed_detailed', 'contacted', 'checked_offer', 'to_view_live'];
const PROGRESS_OPTIONS = [
  { field: 'reviewed_detailed', label: 'Przejrzane dokładnie', icon: '👁' },
  { field: 'contacted',         label: 'Kontakt wykonany',      icon: '☎' },
  { field: 'checked_offer',     label: 'Ogłoszenie sprawdzone', icon: '✓' },
  { field: 'to_view_live',      label: 'Do obejrzenia na żywo', icon: '🚗' },
];

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(process.env.IMAGE_DIR || path.join(process.cwd(), 'data/images')));

function toIntOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function toDecimalOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const cleaned = String(value).replace(',', '.');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function toBoolean(value) {
  if (value === true || value === 'true' || value === '1' || value === 1 || value === 'on') return 1;
  return 0;
}

function wantsJson(req) {
  const accept = String(req.get('accept') || '').toLowerCase();
  const requestedWith = String(req.get('x-requested-with') || '').toLowerCase();
  return accept.includes('application/json') || requestedWith === 'xmlhttprequest';
}

function normalizeUrl(value) {
  return String(value || '').trim();
}

function isDuplicateConfirmed(value) {
  return value === '1' || value === 1 || value === true || value === 'true';
}

function normalizeSearchText(value) {
  return String(value || '')
    .replace(/[ĄąĆćĘęŁłŃńÓóŚśŹźŻż]/g, (char) => ({
      'Ą': 'A',
      'ą': 'a',
      'Ć': 'C',
      'ć': 'c',
      'Ę': 'E',
      'ę': 'e',
      'Ł': 'L',
      'ł': 'l',
      'Ń': 'N',
      'ń': 'n',
      'Ó': 'O',
      'ó': 'o',
      'Ś': 'S',
      'ś': 's',
      'Ź': 'Z',
      'ź': 'z',
      'Ż': 'Z',
      'ż': 'z'
    }[char] || char))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tokenizeSearchText(value) {
  return normalizeSearchText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !new Set(['polska', 'poland']).has(token));
}

function splitLocationParts(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeLocationKey(value) {
  return normalizeSearchText(value).replace(/\s+/g, ' ').trim();
}

function buildGeocodeQueries(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return [];
  }

  const queries = new Set([normalized]);
  const hasCountry = /\b(polska|poland)\b/i.test(normalized);
  const parts = normalized.split(',').map((part) => part.trim()).filter(Boolean);

  if (!hasCountry) {
    queries.add(`${normalized}, Polska`);
  }

  if (parts.length >= 2 && !/\b(polska|poland)\b/i.test(parts[1])) {
    const swapped = [parts[1], parts[0], ...parts.slice(2)].join(', ');
    queries.add(swapped);
    if (!hasCountry) {
      queries.add(`${swapped}, Polska`);
    }
  }

  return [...queries];
}

function extractPostalCode(text) {
  const match = String(text || '').match(/\b\d{2}-\d{3}\b/);
  return match ? match[0] : null;
}

function extractLocalityHint(text, postalCode) {
  const parts = splitLocationParts(String(text || '').replace(/[()]/g, ' '));
  const stopwords = new Set(['polska', 'poland']);

  const normalizeWord = (word) => normalizeSearchText(word).trim();
  const wordsFromPart = (part) => (
    String(part || '')
      .replace(postalCode || '', ' ')
      .match(/[A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż-]+/g) || []
  )
    .map((word) => normalizeWord(word))
    .filter((word) => word && !stopwords.has(word));

  const partWithPostal = parts.find((part) => postalCode && part.includes(postalCode));
  if (partWithPostal) {
    const words = wordsFromPart(partWithPostal);
    const localityFromPostalPart = words.find((word) => word.length >= 3);
    if (localityFromPostalPart) {
      return localityFromPostalPart;
    }
  }

  for (const part of parts) {
    if (/\d/.test(part)) {
      continue;
    }
    const words = wordsFromPart(part);
    const locality = words.find((word) => word.length >= 3);
    if (locality) {
      return locality;
    }
  }

  return null;
}

function buildPostalAwareQueries(text) {
  const postalCode = extractPostalCode(text);
  if (!postalCode) {
    return [];
  }

  const localityHint = extractLocalityHint(text, postalCode);
  const queries = new Set();

  if (localityHint) {
    const titleLocality = localityHint.charAt(0).toUpperCase() + localityHint.slice(1);
    queries.add(`${postalCode} ${titleLocality}, Polska`);
    queries.add(`${titleLocality}, ${postalCode}, Polska`);
    queries.add(`${postalCode} ${titleLocality}`);
  } else {
    queries.add(`${postalCode}, Polska`);
  }

  return [...queries];
}

function countTokenMatches(tokens, values) {
  const haystack = new Set(values.flatMap((value) => tokenizeSearchText(value)));
  return tokens.reduce((score, token) => score + (haystack.has(token) ? 1 : 0), 0);
}

function calculateScoreForCandidate(queryText, feature, focusCoords, candidateCoords) {
  const properties = feature?.properties || {};
  const queryTokens = tokenizeSearchText(queryText);
  const locationParts = splitLocationParts(queryText);
  const generalTokenScore = countTokenMatches(queryTokens, [
    properties.label,
    properties.name,
    properties.locality,
    properties.localadmin,
    properties.county,
    properties.region,
    properties.neighbourhood
  ]);

  let structuredScore = 0;
  if (locationParts.length >= 2) {
    const cityTokens = tokenizeSearchText(locationParts[0]);
    const districtTokens = tokenizeSearchText(locationParts[1]);
    const cityMatches = countTokenMatches(cityTokens, [
      properties.locality,
      properties.localadmin,
      properties.county,
      properties.label
    ]);
    const districtMatches = countTokenMatches(districtTokens, [
      properties.neighbourhood,
      properties.name,
      properties.label
    ]);

    structuredScore += cityMatches * 10;
    structuredScore += districtMatches * 10;

    if (cityMatches > 0 && districtMatches > 0) {
      structuredScore += 50;
    }

    if (properties.layer === 'neighbourhood' && cityMatches > 0 && districtMatches > 0) {
      structuredScore += 25;
    }
  }

  let distancePenalty = 0;
  if (Array.isArray(focusCoords) && focusCoords.length >= 2 && Array.isArray(candidateCoords) && candidateCoords.length >= 2) {
    const dx = Number(focusCoords[0]) - Number(candidateCoords[0]);
    const dy = Number(focusCoords[1]) - Number(candidateCoords[1]);
    distancePenalty = Math.sqrt((dx ** 2) + (dy ** 2));
  }

  return {
    tokenScore: generalTokenScore + structuredScore,
    distancePenalty
  };
}

async function findLatestListingByUrl(sourceUrl) {
  const normalizedUrl = normalizeUrl(sourceUrl);
  if (!normalizedUrl) {
    return null;
  }

  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT id, title, created_at
     FROM listings
     WHERE source_url = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [normalizedUrl]
  );

  return rows[0] || null;
}

async function getCachedRoute(pool, origin, destination) {
  const originKey = normalizeLocationKey(origin);
  const destinationKey = normalizeLocationKey(destination);
  if (!originKey || !destinationKey) {
    return null;
  }

  const [rows] = await pool.query(
    `SELECT distance_km, duration_min
     FROM route_cache
     WHERE origin_key = ? AND destination_key = ? AND cache_version = ?
     LIMIT 1`,
    [originKey, destinationKey, ROUTE_CACHE_VERSION]
  );

  return rows[0] || null;
}

async function saveCachedRoute(pool, origin, destination, metrics) {
  const normalizedOrigin = String(origin || '').trim();
  const normalizedDestination = String(destination || '').trim();
  const originKey = normalizeLocationKey(normalizedOrigin);
  const destinationKey = normalizeLocationKey(normalizedDestination);

  if (!originKey || !destinationKey) {
    return;
  }

  await pool.query(
    `INSERT INTO route_cache (
      origin, destination, origin_key, destination_key, distance_km, duration_min, cache_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      origin = VALUES(origin),
      destination = VALUES(destination),
      distance_km = VALUES(distance_km),
      duration_min = VALUES(duration_min),
      cache_version = VALUES(cache_version),
      updated_at = CURRENT_TIMESTAMP`,
    [
      normalizedOrigin,
      normalizedDestination,
      originKey,
      destinationKey,
      metrics.distanceKm,
      metrics.durationMin,
      ROUTE_CACHE_VERSION
    ]
  );
}

async function setListingRoute(pool, listingId, origin, metrics) {
  await pool.query(
    `UPDATE listings
     SET route_origin = ?,
         route_distance_km = ?,
         route_duration_min = ?,
         route_cache_version = ?,
         route_calculated_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [origin, metrics.distanceKm, metrics.durationMin, ROUTE_CACHE_VERSION, listingId]
  );
}

async function applyCachedRouteToListing(pool, listingId, origin, destination) {
  const normalizedOrigin = String(origin || '').trim();
  const normalizedDestination = String(destination || '').trim();
  if (!normalizedOrigin || !normalizedDestination) {
    return false;
  }

  const cachedRoute = await getCachedRoute(pool, normalizedOrigin, normalizedDestination);
  if (!cachedRoute) {
    return false;
  }

  await setListingRoute(pool, listingId, normalizedOrigin, {
    distanceKm: Number(cachedRoute.distance_km),
    durationMin: Number(cachedRoute.duration_min)
  });

  return true;
}

function normalizeStatusFilters(rawStatus) {
  const statuses = Array.isArray(rawStatus) ? rawStatus : rawStatus ? [rawStatus] : [];
  const filtered = statuses.filter((status) => STATUS_OPTIONS.includes(status));

  if (!filtered.length) {
    return [...DEFAULT_STATUS_FILTERS];
  }

  return [...new Set(filtered)];
}

function normalizeProgressFilters(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.filter((f) => PROGRESS_FIELDS.includes(f));
}

async function listListings(statusFilters = STATUS_OPTIONS, searchQuery = '', sortBy = 'created_at', sortDir = 'desc', origin = '', progressInclude = [], progressExclude = []) {
  const pool = getPool();
  let query = 'SELECT * FROM listings';
  const params = [];
  const whereClauses = [];

  const normalizedSearch = String(searchQuery || '').trim();
  const normalizedSortDir = String(sortDir || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const sortColumnMap = {
    created_at: 'created_at',
    title: 'title',
    price: 'price',
    mileage: 'mileage',
    location: 'location',
    phone: 'phone',
    production_year: 'production_year',
    route_distance_km: 'route_distance_km',
    status: 'status',
    personal_rating: 'personal_rating',
    history_rating: 'history_rating',
    reviewed_detailed: 'reviewed_detailed'
  };
  const normalizedSortBy = sortColumnMap[String(sortBy || '').trim()] || 'created_at';

  if (Array.isArray(statusFilters) && statusFilters.length > 0 && statusFilters.length < STATUS_OPTIONS.length) {
    whereClauses.push(`status IN (${statusFilters.map(() => '?').join(',')})`);
    params.push(...statusFilters);
  }

  for (const field of (progressInclude || [])) {
    if (PROGRESS_FIELDS.includes(field)) whereClauses.push(`${field} = 1`);
  }
  for (const field of (progressExclude || [])) {
    if (PROGRESS_FIELDS.includes(field)) whereClauses.push(`${field} = 0`);
  }

  if (normalizedSearch) {
    const like = `%${normalizedSearch}%`;
    whereClauses.push('(title LIKE ? OR source_url LIKE ? OR location LIKE ?)');
    params.push(like, like, like);
  }

  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  query += ` ORDER BY ${normalizedSortBy} ${normalizedSortDir}, id DESC`;

  const [listings] = await pool.query(query, params);

  for (const listing of listings) {
    const [images] = await pool.query(
      'SELECT id, original_url, local_path, sort_order FROM listing_images WHERE listing_id = ? ORDER BY sort_order ASC',
      [listing.id]
    );
    listing.images = images;
  }

  const normalizedOrigin = String(origin || '').trim();
  if (normalizedOrigin && listings.length) {
    const originKey = normalizeLocationKey(normalizedOrigin);
    const destinationKeyToListingIndexes = new Map();

    listings.forEach((listing, index) => {
      const destination = String(listing.location || '').trim();
      const destinationKey = normalizeLocationKey(destination);
      if (!destinationKey) {
        return;
      }

      if (!destinationKeyToListingIndexes.has(destinationKey)) {
        destinationKeyToListingIndexes.set(destinationKey, []);
      }
      destinationKeyToListingIndexes.get(destinationKey).push(index);
    });

    const destinationKeys = [...destinationKeyToListingIndexes.keys()];
    if (originKey && destinationKeys.length) {
      const placeholders = destinationKeys.map(() => '?').join(',');
      const [cachedRows] = await pool.query(
        `SELECT destination_key, distance_km, duration_min
         FROM route_cache
         WHERE origin_key = ? AND destination_key IN (${placeholders})`,
        [originKey, ...destinationKeys]
      );

      for (const row of cachedRows) {
        const indexes = destinationKeyToListingIndexes.get(row.destination_key) || [];
        for (const listingIndex of indexes) {
          listings[listingIndex].route_origin = normalizedOrigin;
          listings[listingIndex].route_distance_km = Number(row.distance_km);
          listings[listingIndex].route_duration_min = Number(row.duration_min);
          listings[listingIndex].route_cache_version = ROUTE_CACHE_VERSION;
        }
      }
    }
  }

  return listings;
}

app.get('/', async (req, res) => {
  try {
    const selectedStatuses = normalizeStatusFilters(req.query.status);
    const progressInclude = normalizeProgressFilters(req.query.progress_include);
    const progressExclude = normalizeProgressFilters(req.query.progress_exclude);
    const q = String(req.query.q || '').trim();
    const origin = String(req.query.origin || '').trim();
    const sortBy = String(req.query.sort_by || 'created_at');
    const sortDir = String(req.query.sort_dir || 'desc');
    const listings = await listListings(selectedStatuses, q, sortBy, sortDir, origin, progressInclude, progressExclude);
    res.render('index', {
      listings,
      selectedStatuses,
      progressInclude,
      progressExclude,
      progressOptions: PROGRESS_OPTIONS,
      q,
      origin,
      sortBy,
      sortDir,
      routeCacheVersion: ROUTE_CACHE_VERSION,
      orsApiKeyConfigured: Boolean(DEFAULT_ORS_API_KEY),
      statusOptions: STATUS_OPTIONS,
      message: req.query.message || null,
      error: req.query.error || null
    });
  } catch (error) {
    res.status(500).send(`Błąd ładowania danych: ${error.message}`);
  }
});

app.get('/compare', async (req, res) => {
  try {
    const idsRaw = req.query.ids;
    if (!idsRaw) {
      return res.redirect('/?error=Nie%20wybrano%20og%C5%82osze%C5%84%20do%20por%C3%B3wnania');
    }

    const ids = String(idsRaw)
      .split(',')
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(0, 8);

    if (!ids.length) {
      return res.redirect('/?error=Nieprawid%C5%82owe%20ID%20do%20por%C3%B3wnania');
    }

    const pool = getPool();
    const placeholders = ids.map(() => '?').join(',');
    const [listings] = await pool.query(
      `SELECT * FROM listings WHERE id IN (${placeholders}) ORDER BY FIELD(id, ${placeholders})`,
      [...ids, ...ids]
    );

    for (const listing of listings) {
      const [images] = await pool.query(
        'SELECT original_url, local_path FROM listing_images WHERE listing_id = ? ORDER BY sort_order ASC LIMIT 1',
        [listing.id]
      );
      listing.mainImage = images[0] || null;
    }

    res.render('compare', { listings });
  } catch (error) {
    res.status(500).send(`Błąd porównania: ${error.message}`);
  }
});

app.get('/print', async (req, res) => {
  try {
    const idsRaw = req.query.ids;
    if (!idsRaw) {
      return res.redirect('/?error=Nie%20wybrano%20og%C5%82osze%C5%84%20do%20wydruku');
    }

    const ids = String(idsRaw)
      .split(',')
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(0, 20);

    if (!ids.length) {
      return res.redirect('/?error=Nieprawid%C5%82owe%20ID%20do%20wydruku');
    }

    const pool = getPool();
    const placeholders = ids.map(() => '?').join(',');
    const [listings] = await pool.query(
      `SELECT * FROM listings WHERE id IN (${placeholders}) ORDER BY FIELD(id, ${placeholders})`,
      [...ids, ...ids]
    );

    for (const listing of listings) {
      const [images] = await pool.query(
        'SELECT original_url, local_path FROM listing_images WHERE listing_id = ? ORDER BY sort_order ASC LIMIT 3',
        [listing.id]
      );
      listing.images = images;
      listing.mainImage = images[0] || null;
    }

    res.render('print', { listings });
  } catch (error) {
    res.status(500).send(`Błąd wydruku: ${error.message}`);
  }
});

app.get('/api/listings/check-url', async (req, res) => {
  const sourceUrl = normalizeUrl(req.query.source_url);
  if (!sourceUrl) {
    return res.json({ exists: false });
  }

  try {
    const existing = await findLatestListingByUrl(sourceUrl);
    if (!existing) {
      return res.json({ exists: false });
    }

    return res.json({
      exists: true,
      listing: {
        id: existing.id,
        title: existing.title,
        createdAt: existing.created_at
      }
    });
  } catch {
    return res.status(500).json({ exists: false, error: 'check_failed' });
  }
});

async function geocodeWithOrs(text, apiKey, focusCoords = null) {
  const queries = [...new Set([...buildPostalAwareQueries(text), ...buildGeocodeQueries(text)])];
  const candidates = [];

  for (const queryText of queries) {
    const response = await axios.get('https://api.openrouteservice.org/geocode/search', {
      params: {
        api_key: apiKey,
        text: queryText,
        size: 5,
        'boundary.country': 'PL',
        ...(Array.isArray(focusCoords) && focusCoords.length >= 2
          ? {
              'focus.point.lon': focusCoords[0],
              'focus.point.lat': focusCoords[1]
            }
          : {})
      },
      timeout: 15000
    });

    for (const feature of response.data?.features || []) {
      const coords = feature?.geometry?.coordinates;
      const label = feature?.properties?.label || '';
      if (!Array.isArray(coords) || coords.length < 2 || !label) {
        continue;
      }

      const score = calculateScoreForCandidate(text, feature, focusCoords, coords);
      candidates.push({ coords, label, ...score });
    }
  }

  candidates.sort((a, b) => {
    if (b.tokenScore !== a.tokenScore) {
      return b.tokenScore - a.tokenScore;
    }
    return a.distancePenalty - b.distancePenalty;
  });

  const bestMatch = candidates[0];
  if (!bestMatch || bestMatch.tokenScore <= 0) {
    throw new Error('Nie znaleziono lokalizacji');
  }

  return bestMatch.coords;
}

async function calculateRouteMetrics(origin, destination, apiKey) {
  const originCoords = await geocodeWithOrs(origin, apiKey);
  const destinationCoords = await geocodeWithOrs(destination, apiKey, originCoords);

  const directionsResponse = await axios.post(
    'https://api.openrouteservice.org/v2/directions/driving-car/json',
    { coordinates: [originCoords, destinationCoords] },
    {
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    }
  );

  const summary = directionsResponse.data?.routes?.[0]?.summary;
  const distanceMeters = Number(summary?.distance);
  const durationSeconds = Number(summary?.duration);

  if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) {
    throw new Error('Nie udało się obliczyć trasy');
  }

  return {
    distanceKm: Number((distanceMeters / 1000).toFixed(1)),
    durationMin: Math.max(1, Math.round(durationSeconds / 60))
  };
}

app.post('/api/listings/:id/route-metrics', async (req, res) => {
  const id = Number(req.params.id);
  const origin = String(req.body.origin || '').trim();
  const apiKey = String(DEFAULT_ORS_API_KEY || '').trim();

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid_listing_id' });
  }

  if (!origin) {
    return res.status(400).json({ error: 'missing_origin' });
  }

  if (!apiKey) {
    return res.status(400).json({ error: 'missing_api_key' });
  }

  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, location
       FROM listings
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    const listing = rows[0];
    if (!listing) {
      return res.status(404).json({ error: 'listing_not_found' });
    }

    const destination = String(listing.location || '').trim();
    if (!destination) {
      return res.status(400).json({ error: 'missing_destination' });
    }

    const cachedRoute = await getCachedRoute(pool, origin, destination);
    if (cachedRoute) {
      await setListingRoute(pool, id, origin, {
        distanceKm: Number(cachedRoute.distance_km),
        durationMin: Number(cachedRoute.duration_min)
      });

      return res.json({
        distanceKm: Number(cachedRoute.distance_km),
        durationMin: Number(cachedRoute.duration_min),
        cached: true
      });
    }

    const metrics = await calculateRouteMetrics(origin, destination, apiKey);
    await saveCachedRoute(pool, origin, destination, metrics);
    await setListingRoute(pool, id, origin, metrics);

    return res.json({ ...metrics, cached: false });
  } catch (error) {
    return res.status(502).json({
      error: 'route_calculation_failed',
      message: error.message
    });
  }
});

app.post('/import', async (req, res) => {
  const sourceUrl = normalizeUrl(req.body.source_url);
  const currentOrigin = String(req.body.current_origin || '').trim();
  const originQuery = currentOrigin ? `&origin=${encodeURIComponent(currentOrigin)}` : '';
  const duplicateConfirmed = isDuplicateConfirmed(req.body.confirm_duplicate);

  if (!sourceUrl) {
    return res.redirect('/?error=Podaj%20URL%20og%C5%82oszenia');
  }

  try {
    const existingByInputUrl = await findLatestListingByUrl(sourceUrl);
    if (existingByInputUrl && !duplicateConfirmed) {
      return res.redirect(`/?error=To%20og%C5%82oszenie%20ju%C5%BC%20zosta%C5%82o%20dodane.%20Potwierd%C5%BA%20duplikat%2C%20aby%20doda%C4%87%20ponownie.${originQuery}`);
    }

    const scraped = await scrapeListing(sourceUrl);
    const existingByScrapedUrl = await findLatestListingByUrl(scraped.sourceUrl);
    if (existingByScrapedUrl && !duplicateConfirmed) {
      return res.redirect(`/?error=To%20og%C5%82oszenie%20ju%C5%BC%20zosta%C5%82o%20dodane.%20Potwierd%C5%BA%20duplikat%2C%20aby%20doda%C4%87%20ponownie.${originQuery}`);
    }

    const pool = getPool();

    const [insertResult] = await pool.query(
      `INSERT INTO listings (
        source, source_url, title, price, currency, mileage, description, location, phone,
        production_year, import_year, history_rating, personal_rating, status,
        history_note, personal_comment, ai_rating, ai_comment, fuel_type, gearbox, engine_capacity, power_hp,
        body_type, drive_type, color
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scraped.source,
        scraped.sourceUrl,
        scraped.title,
        scraped.price,
        scraped.currency,
        scraped.mileage,
        scraped.description,
        scraped.location,
        scraped.phone,
        scraped.productionYear,
        scraped.importYear,
        scraped.historyRating,
        scraped.personalRating,
        scraped.status,
        scraped.historyNote,
        scraped.personalComment,
        null,
        null,
        scraped.fuelType,
        scraped.gearbox,
        scraped.engineCapacity,
        scraped.powerHp,
        scraped.bodyType,
        scraped.driveType,
        scraped.color
      ]
    );

    const listingId = insertResult.insertId;

    await applyCachedRouteToListing(pool, listingId, currentOrigin, scraped.location);

    const savedImages = await saveImagesLocally(listingId, scraped.imageUrls);

    for (const image of savedImages) {
      await pool.query(
        'INSERT INTO listing_images (listing_id, original_url, local_path, sort_order) VALUES (?, ?, ?, ?)',
        [listingId, image.originalUrl, image.localPath, image.sortOrder]
      );
    }

    await pool.query(
      'INSERT INTO fetch_attempts (listing_id, source_url, source, success, error_message) VALUES (?, ?, ?, ?, ?)',
      [listingId, sourceUrl, scraped.source, true, null]
    );

    return res.redirect(`/?message=Og%C5%82oszenie%20zaimportowane${originQuery}`);
  } catch (error) {
    const source = detectSource(sourceUrl);

    try {
      const pool = getPool();
      await pool.query(
        'INSERT INTO fetch_attempts (listing_id, source_url, source, success, error_message) VALUES (?, ?, ?, ?, ?)',
        [null, sourceUrl, source, false, error.message.slice(0, 2000)]
      );
    } catch {
      // ignore secondary errors
    }

    return res.redirect(`/?error=Nie%20uda%C5%82o%20si%C4%99%20zaimportowa%C4%87%20og%C5%82oszenia%20-%20uzupe%C5%82nij%20r%C4%99cznie${originQuery}`);
  }
});

app.post('/listings', async (req, res) => {
  try {
    const sourceUrl = normalizeUrl(req.body.source_url);
    const reportUrl = normalizeUrl(req.body.report_url);
    const currentOrigin = String(req.body.current_origin || '').trim();
    const originQuery = currentOrigin ? `&origin=${encodeURIComponent(currentOrigin)}` : '';
    const duplicateConfirmed = isDuplicateConfirmed(req.body.confirm_duplicate);

    if (sourceUrl) {
      const existing = await findLatestListingByUrl(sourceUrl);
      if (existing && !duplicateConfirmed) {
        return res.redirect(`/?error=Ten%20URL%20ju%C5%BC%20istnieje.%20Potwierd%C5%BA%20duplikat%2C%20aby%20doda%C4%87%20ponownie.${originQuery}`);
      }
    }

    const pool = getPool();

    const status = STATUS_OPTIONS.includes(req.body.status) ? req.body.status : 'Nowe';

    const [insertResult] = await pool.query(
      `INSERT INTO listings (
        source, source_url, report_url, title, price, currency, mileage, description, location, phone,
        production_year, import_year, history_rating, personal_rating, status, history_note,
        personal_comment, ai_rating, ai_comment, fuel_type, gearbox, engine_capacity, power_hp, body_type, drive_type, color
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      [
        req.body.source || 'manual',
        sourceUrl || `manual://${Date.now()}`,
        reportUrl || null,
        req.body.title || null,
        toDecimalOrNull(req.body.price),
        req.body.currency || 'PLN',
        toIntOrNull(req.body.mileage),
        req.body.description || null,
        req.body.location || null,
        req.body.phone || null,
        toIntOrNull(req.body.production_year),
        toIntOrNull(req.body.import_year),
        toIntOrNull(req.body.history_rating),
        toIntOrNull(req.body.personal_rating),
        status,
        req.body.history_note || null,
        req.body.personal_comment || null,
        toIntOrNull(req.body.ai_rating),
        req.body.ai_comment || null,
        req.body.fuel_type || null,
        req.body.gearbox || null,
        req.body.engine_capacity || null,
        toIntOrNull(req.body.power_hp),
        req.body.body_type || null,
        req.body.drive_type || null,
        req.body.color || null
      ]
    );

    await applyCachedRouteToListing(pool, insertResult.insertId, currentOrigin, req.body.location || null);

    return res.redirect(`/?message=Dodano%20auto%20r%C4%99cznie${originQuery}`);
  } catch (error) {
    return res.redirect('/?error=Nie%20uda%C5%82o%20si%C4%99%20doda%C4%87%20auta');
  }
});

app.post('/listings/:id/update', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.redirect('/?error=Nieprawid%C5%82owe%20ID');
  }

  const status = STATUS_OPTIONS.includes(req.body.status) ? req.body.status : null;

  try {
    const pool = getPool();
    await pool.query(
      `UPDATE listings SET
        status = COALESCE(?, status),
        personal_rating = ?,
        history_rating = ?,
        personal_comment = ?,
        history_note = ?,
        ai_rating = ?,
        ai_comment = ?,
        report_url = ?,
        phone = ?,
        import_year = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        status,
        toIntOrNull(req.body.personal_rating),
        toIntOrNull(req.body.history_rating),
        req.body.personal_comment || null,
        req.body.history_note || null,
        toIntOrNull(req.body.ai_rating),
        req.body.ai_comment || null,
        normalizeUrl(req.body.report_url) || null,
        req.body.phone || null,
        toIntOrNull(req.body.import_year),
        id
      ]
    );

    return res.redirect('/?message=Zaktualizowano%20og%C5%82oszenie');
  } catch {
    return res.redirect('/?error=Nie%20uda%C5%82o%20si%C4%99%20zaktualizowa%C4%87%20og%C5%82oszenia');
  }
});

app.post('/listings/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const status = STATUS_OPTIONS.includes(req.body.status) ? req.body.status : null;

  if (!Number.isInteger(id) || !status) {
    return res.redirect('/?error=Nieprawid%C5%82owa%20zmiana%20statusu');
  }

  try {
    const pool = getPool();
    await pool.query('UPDATE listings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, id]);
    return res.redirect('/?message=Status%20zaktualizowany');
  } catch {
    return res.redirect('/?error=Nie%20uda%C5%82o%20si%C4%99%20zmieni%C4%87%20statusu');
  }
});

app.post('/listings/:id/rating', async (req, res) => {
  const id = Number(req.params.id);
  const field = req.body.field;
  const value = Number(req.body.value);
  const allowedFields = new Set(['personal_rating', 'history_rating', 'ai_rating']);

  if (!Number.isInteger(id) || !allowedFields.has(field) || !Number.isInteger(value) || value < 1 || value > 5) {
    if (wantsJson(req)) {
      return res.status(400).json({ error: 'invalid_rating' });
    }
    return res.redirect('/?error=Nieprawid%C5%82owa%20ocena');
  }

  try {
    const pool = getPool();
    await pool.query(`UPDATE listings SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [value, id]);
    if (wantsJson(req)) {
      return res.json({ ok: true, id, field, value });
    }
    return res.redirect('/?message=Ocena%20zapisana');
  } catch {
    if (wantsJson(req)) {
      return res.status(500).json({ error: 'rating_update_failed' });
    }
    return res.redirect('/?error=Nie%20uda%C5%82o%20si%C4%99%20zapisa%C4%87%20oceny');
  }
});

app.post('/listings/:id/flag', async (req, res) => {
  const id = Number(req.params.id);
  const field = req.body.field;
  const allowedFields = new Set(['reviewed_detailed', 'contacted', 'checked_offer', 'to_view_live']);

  if (!Number.isInteger(id) || !allowedFields.has(field)) {
    if (wantsJson(req)) {
      return res.status(400).json({ error: 'invalid_flag_action' });
    }
    return res.redirect('/?error=Nieprawid%C5%82owa%20akcja');
  }

  try {
    const nextValue = toBoolean(req.body.value);
    const pool = getPool();
    await pool.query(`UPDATE listings SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [nextValue, id]);
    if (wantsJson(req)) {
      return res.json({ ok: true, id, field, value: nextValue });
    }
    return res.redirect('/?message=Zapisano%20status%20akcji');
  } catch {
    if (wantsJson(req)) {
      return res.status(500).json({ error: 'flag_update_failed' });
    }
    return res.redirect('/?error=Nie%20uda%C5%82o%20si%C4%99%20zapisa%C4%87%20akcji');
  }
});

app.post('/listings/:id/reject', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    if (wantsJson(req)) {
      return res.status(400).json({ error: 'invalid_id' });
    }
    return res.redirect('/?error=Nieprawid%C5%82owe%20ID');
  }

  try {
    const pool = getPool();
    await pool.query('UPDATE listings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['Odrzucone', id]);
    if (wantsJson(req)) {
      return res.json({ ok: true, id, status: 'Odrzucone' });
    }
    return res.redirect('/?message=Og%C5%82oszenie%20odrzucone');
  } catch {
    if (wantsJson(req)) {
      return res.status(500).json({ error: 'reject_failed' });
    }
    return res.redirect('/?error=Nie%20uda%C5%82o%20si%C4%99%20odrzuci%C4%87%20og%C5%82oszenia');
  }
});

app.post('/listings/:id/delete', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    if (wantsJson(req)) {
      return res.status(400).json({ error: 'invalid_id' });
    }
    return res.redirect('/?error=Nieprawid%C5%82owe%20ID');
  }

  try {
    const pool = getPool();
    await pool.query('DELETE FROM listings WHERE id = ?', [id]);
    if (wantsJson(req)) {
      return res.json({ ok: true, id });
    }
    return res.redirect('/?message=Og%C5%82oszenie%20usuni%C4%99te');
  } catch {
    if (wantsJson(req)) {
      return res.status(500).json({ error: 'delete_failed' });
    }
    return res.redirect('/?error=Nie%20uda%C5%82o%20si%C4%99%20usun%C4%85%C4%87%20og%C5%82oszenia');
  }
});

async function startServer() {
  try {
    await waitForDb();
    await initializeDb();

    app.listen(port, () => {
      console.log(`Serwer działa na porcie ${port}`);
    });
  } catch (error) {
    console.error('Błąd startu aplikacji:', error);
    process.exit(1);
  }
}

startServer();
