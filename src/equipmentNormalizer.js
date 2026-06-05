'use strict';

// Kanoniczne nazwy wyposażenia (zawsze małe litery).
// Scraper i serwer mapują na te nazwy – typy ze skrobaczy
// są najpierw normalizowane do małych liter, potem dopasowywane
// do listy Levenshtein-em (próg ≥ 0.80).
const EQUIPMENT_CANONICAL = [
  // bezpieczeństwo aktywne
  'abs', 'esp', 'asr', 'ebd', 'tcs', 'esc',
  // poduszki
  'poduszki powietrzne',
  'poduszka powietrzna kierowcy',
  'poduszka powietrzna pasażera',
  'boczne poduszki powietrzne',
  'kurtyny powietrzne',
  // klimatyzacja
  'klimatyzacja',
  'klimatyzacja automatyczna',
  'klimatyzacja manualna',
  'dwustrefowa klimatyzacja',
  'trójstrefowa klimatyzacja',
  // multimedia / łączność
  'nawigacja',
  'gps',
  'bluetooth',
  'radio',
  'cd',
  'mp3',
  'aux',
  'usb',
  'android auto',
  'apple carplay',
  'head-up display',
  'bezprzewodowe ładowanie',
  // komfort jazdy
  'tempomat',
  'adaptacyjny tempomat',
  'start-stop',
  'asystent pasa',
  'czujnik deszczu',
  'czujnik zmierzchu',
  'automatyczne światła',
  'hamowanie awaryjne',
  'czujnik martwego pola',
  'hill hold',
  // parkowanie / kamera
  'czujniki parkowania',
  'czujniki parkowania tylne',
  'czujniki parkowania przednie',
  'kamera cofania',
  'kamera 360',
  // szyby / lusterka
  'elektryczne szyby',
  'elektryczne lusterka',
  'podgrzewane lusterka',
  'podgrzewana szyba',
  'podgrzewana przednia szyba',
  // fotele / wnętrze
  'podgrzewane fotele',
  'podgrzewane tylne fotele',
  'podgrzewana kierownica',
  'elektrycznie regulowane fotele',
  'skórzana tapicerka',
  'alcantara',
  'komputer pokładowy',
  // karoseria / dach
  'dach panoramiczny',
  'szyberdach',
  'elektryczna klapa bagażnika',
  'hak holowniczy',
  // felgi / oświetlenie
  'felgi aluminiowe',
  'felgi stalowe',
  'xenon',
  'bi-xenon',
  'reflektory led',
  'światła led',
  // dostęp / zabezpieczenia
  'keyless entry',
  'keyless go',
  'immobilizer',
  'alarm',
  'centralny zamek',
  // opony / ciśnienie
  'tpms',
];

// Prostszy, ale wystarczający algorytm podobieństwa Levenshteina (O(n*m)).
function levenshteinSimilarity(a, b) {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (!la || !lb) return 0;
  const maxLen = Math.max(la, lb);
  const dp = Array.from({ length: la + 1 }, (_, i) =>
    Array.from({ length: lb + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return 1 - dp[la][lb] / maxLen;
}

/**
 * Normalizuje jeden wpis wyposażenia:
 * 1. Sprowadza do małych liter.
 * 2. Szuka dokładnego dopasowania na liście kanonicznej.
 * 3. Jeśli brak – szuka fuzzy (próg ≥ 0.80).
 * 4. Jeśli brak – zwraca znormalizowany napis (małe litery).
 * Zwraca null dla wartości boolowskich / zbyt krótkich / zbyt długich.
 */
function canonicalizeEquipmentItem(rawItem) {
  if (!rawItem) return null;
  const normalized = String(rawItem)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (!normalized || normalized.length < 2 || normalized.length > 120) return null;
  if (/^(tak|nie|yes|no|true|false|brak|-+)$/.test(normalized)) return null;

  // Dokładne trafienie
  if (EQUIPMENT_CANONICAL.includes(normalized)) return normalized;

  // Fuzzy – szukamy najlepszego kandydata
  let bestSim = 0;
  let bestCanonical = null;
  for (const canonical of EQUIPMENT_CANONICAL) {
    const sim = levenshteinSimilarity(normalized, canonical);
    if (sim > bestSim) {
      bestSim = sim;
      bestCanonical = canonical;
    }
  }

  if (bestSim >= 0.8) return bestCanonical;
  return normalized;
}

/**
 * Przeszukuje tekst opisu ogłoszenia w poszukiwaniu znanych (kanoniczych)
 * nazw wyposażenia. Dopasowanie uwzględnia polskie znaki diakrytyczne jako
 * część słowa, więc np. „abs" nie trafi w „absorpcja".
 * Zwraca tablicę kanoniczych nazw wyposażenia znalezionych w opisie.
 */
function extractEquipmentFromDescription(description) {
  if (!description) return [];
  const text = String(description).toLowerCase();
  const found = [];
  // Polska definicja „znaku słownego" – obejmuje litery z ogonkami i cyfry.
  const W = '[a-ząćęłńóśźż0-9_]';
  for (const canonical of EQUIPMENT_CANONICAL) {
    const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<!${W})${escaped}(?!${W})`, 'i');
    if (pattern.test(text)) {
      found.push(canonical);
    }
  }
  return found;
}

/**
 * Zwraca unikalną, znormalizowaną tablicę nazw wyposażenia
 * (deduplikacja po kanonicznej nazwie lowercase).
 */
function uniqueEquipment(items) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const canonical = canonicalizeEquipmentItem(item);
    if (!canonical) continue;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(canonical);
  }
  return result.sort((a, b) => a.localeCompare(b, 'pl', { sensitivity: 'base' }));
}

module.exports = { EQUIPMENT_CANONICAL, canonicalizeEquipmentItem, uniqueEquipment, extractEquipmentFromDescription };
