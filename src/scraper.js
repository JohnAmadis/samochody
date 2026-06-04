const axios = require('axios');

if (typeof global.File === 'undefined') {
  global.File = class File {};
}

const cheerio = require('cheerio');

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function stripHtml(value) {
  if (!value) return null;
  return String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

function detectSource(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('otomoto')) return 'otomoto';
    if (hostname.includes('autoplac')) return 'autoplac';
    return 'other';
  } catch {
    return 'other';
  }
}

function normalizeNumber(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/[^\d.,]/g, '').replace(/\s+/g, '');
  if (!cleaned) return null;
  const normalized = cleaned.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function extractByRegex(text, regex) {
  const match = text.match(regex);
  return match?.[1] ? match[1].trim() : null;
}

function formatPolishPhone(digits) {
  if (!digits || digits.length !== 9) return null;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 7)} ${digits.slice(7, 9)}`;
}

function normalizePhoneCandidate(value) {
  if (value === undefined || value === null) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('48') && digits.length === 11) {
    digits = digits.slice(2);
  }

  if (!/^\d{9}$/.test(digits)) return null;
  return formatPolishPhone(digits);
}

function collectPhonesFromObject(input, onlyPhoneLikeKeys = false) {
  const results = new Set();
  const visited = new Set();
  const phoneKeyRegex = /(phone|telefon|tel|kontakt|contact)/i;

  function walk(value, parentKey = '') {
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string' || typeof value === 'number') {
        if (!onlyPhoneLikeKeys || phoneKeyRegex.test(parentKey)) {
          const normalized = normalizePhoneCandidate(value);
          if (normalized) results.add(normalized);
        }
      }
      return;
    }

    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, parentKey));
      return;
    }

    Object.entries(value).forEach(([key, nestedValue]) => {
      if ((typeof nestedValue === 'string' || typeof nestedValue === 'number') && phoneKeyRegex.test(key)) {
        const normalized = normalizePhoneCandidate(nestedValue);
        if (normalized) results.add(normalized);
      }
      walk(nestedValue, key);
    });
  }

  walk(input);
  return Array.from(results);
}

function parseJsonLd($) {
  const scripts = $('script[type="application/ld+json"]');
  const jsonObjects = [];

  scripts.each((_, element) => {
    const raw = $(element).contents().text();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        jsonObjects.push(...parsed);
      } else if (parsed['@graph'] && Array.isArray(parsed['@graph'])) {
        jsonObjects.push(...parsed['@graph']);
      } else {
        jsonObjects.push(parsed);
      }
    } catch {
      // ignore invalid json-ld
    }
  });

  return jsonObjects;
}

function parseNextData($) {
  const raw = $('#__NEXT_DATA__').first().contents().text();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function detailValue(details = [], key) {
  const found = details.find((item) => item?.key === key);
  return found?.value || null;
}

function parameterLabel(parametersDict = {}, key) {
  const values = parametersDict?.[key]?.values;
  if (!Array.isArray(values) || !values.length) return null;
  return values[0]?.label || values[0]?.value || null;
}

function extractOtomotoData(nextData, url) {
  const advert = nextData?.props?.pageProps?.advert;
  if (!advert) return null;

  const details = Array.isArray(advert.details) ? advert.details : [];
  const parametersDict = advert.parametersDict || {};
  const photos = Array.isArray(advert?.images?.photos) ? advert.images.photos : [];

  const mileageRaw = parameterLabel(parametersDict, 'mileage') || detailValue(details, 'mileage');
  const productionYearRaw = parameterLabel(parametersDict, 'year') || detailValue(details, 'year');
  const enginePowerRaw = parameterLabel(parametersDict, 'engine_power') || detailValue(details, 'engine_power');
  const phoneFromAdvert = collectPhonesFromObject(advert, true)[0] || null;
  const phoneFromPageProps = collectPhonesFromObject(nextData?.props?.pageProps, true)[0] || null;

  return {
    source: 'otomoto',
    sourceUrl: url,
    title: advert.title || null,
    price: normalizeNumber(advert?.price?.value),
    currency: advert?.price?.currency || 'PLN',
    mileage: normalizeNumber(mileageRaw),
    description: stripHtml(advert.description),
    location:
      advert?.seller?.location?.shortAddress ||
      advert?.seller?.location?.address ||
      advert?.seller?.location?.city ||
      null,
    phone: phoneFromAdvert || phoneFromPageProps,
    productionYear: normalizeNumber(productionYearRaw),
    importYear: null,
    historyRating: null,
    personalRating: null,
    status: 'Nowe',
    historyNote: parameterLabel(parametersDict, 'country_origin') || detailValue(details, 'country_origin') || null,
    personalComment: null,
    fuelType: parameterLabel(parametersDict, 'fuel_type') || detailValue(details, 'fuel_type'),
    gearbox: parameterLabel(parametersDict, 'gearbox') || detailValue(details, 'gearbox'),
    engineCapacity: parameterLabel(parametersDict, 'engine_capacity') || detailValue(details, 'engine_capacity'),
    powerHp: normalizeNumber(enginePowerRaw),
    bodyType: parameterLabel(parametersDict, 'body_type') || detailValue(details, 'body_type'),
    driveType: parameterLabel(parametersDict, 'transmission') || detailValue(details, 'transmission'),
    color: parameterLabel(parametersDict, 'color') || detailValue(details, 'color'),
    imageUrls: photos.map((item) => item?.url).filter((item) => typeof item === 'string' && item.startsWith('http'))
  };
}

function collectImages($, jsonLdObjects, preferredImageUrls = []) {
  const urls = new Set();

  preferredImageUrls.forEach((url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      urls.add(url);
    }
  });

  for (const item of jsonLdObjects) {
    const images = item?.image;
    if (Array.isArray(images)) {
      images.forEach((img) => typeof img === 'string' && urls.add(img));
    } else if (typeof images === 'string') {
      urls.add(images);
    }
  }

  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage) urls.add(ogImage);

  $('img').each((_, element) => {
    const src = $(element).attr('src') || $(element).attr('data-src');
    if (src && /^https?:\/\//i.test(src)) {
      urls.add(src);
    }
  });

  return Array.from(urls).slice(0, 10);
}

function parseListingData(url, html) {
  const $ = cheerio.load(html);
  const source = detectSource(url);
  const jsonLdObjects = parseJsonLd($);
  const nextData = parseNextData($);
  const otomotoData = source === 'otomoto' ? extractOtomotoData(nextData, url) : null;

  const pageText = $('body').text().replace(/\s+/g, ' ');
  const title =
    otomotoData?.title ||
    $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text().trim() ||
    $('title').text().trim() ||
    null;

  let description =
    otomotoData?.description ||
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    null;

  let price = otomotoData?.price ?? null;
  let currency = otomotoData?.currency || 'PLN';
  let mileage = otomotoData?.mileage ?? null;
  let productionYear = otomotoData?.productionYear ?? null;
  let phone = otomotoData?.phone ?? null;
  let location = otomotoData?.location ?? null;

  for (const obj of jsonLdObjects) {
    if (!description && obj?.description) description = obj.description;
    if (!price && obj?.offers?.price) {
      price = normalizeNumber(obj.offers.price);
      currency = obj.offers.priceCurrency || 'PLN';
    }
    if (!mileage && obj?.mileageFromOdometer?.value) {
      mileage = normalizeNumber(obj.mileageFromOdometer.value);
    }
    if (!productionYear && obj?.productionDate) {
      const year = Number(String(obj.productionDate).slice(0, 4));
      if (Number.isInteger(year)) productionYear = year;
    }
    if (!location && obj?.itemOffered?.location?.addressLocality) {
      location = obj.itemOffered.location.addressLocality;
    }
    if (!phone && obj?.telephone) {
      phone = String(obj.telephone);
    }
  }

  if (!price) {
    const rawPrice = extractByRegex(pageText, /(?:cena|price)\s*[:\-]?\s*([\d\s.,]+\s?(?:zł|pln|eur)?)/i);
    price = normalizeNumber(rawPrice);
    if (/eur/i.test(rawPrice || '')) currency = 'EUR';
  }

  if (!mileage) {
    mileage = normalizeNumber(extractByRegex(pageText, /(?:przebieg|mileage)\s*[:\-]?\s*([\d\s.,]+)/i));
  }

  if (!productionYear) {
    const maybeYear = Number(extractByRegex(pageText, /(?:rok produkcji|rocznik|year)\s*[:\-]?\s*(19\d{2}|20\d{2})/i));
    if (Number.isInteger(maybeYear)) productionYear = maybeYear;
  }

  if (!location) {
    location = extractByRegex(pageText, /(?:lokalizacja|miejscowość|location)\s*[:\-]?\s*([A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż\- ]{2,60})/i);
  }

  if (!phone) {
    const strictPhoneRegex = /((?:\+48\s*)?(?:\d{2}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}|\d{3}[\s\-]?\d{3}[\s\-]?\d{3}))/;
    const labelledPhoneRegex = new RegExp(`(?:telefon|tel\\.?|kontakt)\\s*[:\\-]?\\s*${strictPhoneRegex.source}`, 'i');
    const rawPhone = extractByRegex(pageText, labelledPhoneRegex) || extractByRegex(pageText, strictPhoneRegex);
    phone = normalizePhoneCandidate(rawPhone);
  }

  const fuelType =
    otomotoData?.fuelType ||
    extractByRegex(pageText, /(?:paliwo|fuel)\s*[:\-]?\s*([A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż ]{3,30})/i);
  const gearbox =
    otomotoData?.gearbox ||
    extractByRegex(pageText, /(?:skrzynia biegów|gearbox|transmisja)\s*[:\-]?\s*([A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż ]{3,30})/i);
  const engineCapacity =
    otomotoData?.engineCapacity ||
    extractByRegex(pageText, /(?:pojemność|engine capacity)\s*[:\-]?\s*([\d.,]+\s?(?:cm3|cm³|l))/i);
  const powerHp =
    otomotoData?.powerHp ||
    normalizeNumber(extractByRegex(pageText, /(?:moc|power)\s*[:\-]?\s*([\d\s.,]{2,5})\s?(?:km|hp)/i));
  const bodyType =
    otomotoData?.bodyType ||
    extractByRegex(pageText, /(?:nadwozie|body type)\s*[:\-]?\s*([A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż ]{3,30})/i);
  const driveType =
    otomotoData?.driveType ||
    extractByRegex(pageText, /(?:napęd|drive)\s*[:\-]?\s*([A-Za-z0-9ĄąĆćĘęŁłŃńÓóŚśŹźŻż\- ]{2,30})/i);
  const color =
    otomotoData?.color ||
    extractByRegex(pageText, /(?:kolor|color)\s*[:\-]?\s*([A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż ]{3,30})/i);

  return {
    source,
    sourceUrl: url,
    title,
    price,
    currency,
    mileage,
    description,
    location,
    phone,
    productionYear,
    importYear: null,
    historyRating: null,
    personalRating: null,
    status: 'Nowe',
    historyNote: otomotoData?.historyNote || null,
    personalComment: null,
    fuelType,
    gearbox,
    engineCapacity,
    powerHp: powerHp ? Math.round(powerHp) : null,
    bodyType,
    driveType,
    color,
    imageUrls: collectImages($, jsonLdObjects, otomotoData?.imageUrls || [])
  };
}

async function scrapeListing(url) {
  const response = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    timeout: 20000,
    maxRedirects: 5
  });

  return parseListingData(url, response.data);
}

module.exports = {
  detectSource,
  scrapeListing,
  parseListingData
};
