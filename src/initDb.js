const fs = require('fs/promises');
const path = require('path');
const { getPool } = require('./db');

async function runSchema() {
  const pool = getPool();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = await fs.readFile(schemaPath, 'utf8');

  const statements = schemaSql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await pool.query(statement);
  }
}

async function ensureRouteCacheTable() {
  const pool = getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS route_cache (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      origin VARCHAR(255) NOT NULL,
      destination VARCHAR(255) NOT NULL,
      origin_key VARCHAR(255) NOT NULL,
      destination_key VARCHAR(255) NOT NULL,
      distance_km DECIMAL(8,1) NOT NULL,
      duration_min INT NOT NULL,
      cache_version INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_route_cache (origin_key, destination_key)
    )`
  );

  const [cacheVersionCol] = await pool.query('SHOW COLUMNS FROM route_cache LIKE ?', ['cache_version']);
  if (!Array.isArray(cacheVersionCol) || cacheVersionCol.length === 0) {
    await pool.query('ALTER TABLE route_cache ADD COLUMN cache_version INT NOT NULL DEFAULT 1 AFTER duration_min');
  }
}

async function ensureListingColumn(columnName, definitionSql) {
  const pool = getPool();
  const [rows] = await pool.query('SHOW COLUMNS FROM listings LIKE ?', [columnName]);
  if (Array.isArray(rows) && rows.length > 0) {
    return;
  }

  await pool.query(`ALTER TABLE listings ADD COLUMN ${columnName} ${definitionSql}`);
}

async function ensureSourceUrlIsNotUnique() {
  const pool = getPool();
  const [indexes] = await pool.query('SHOW INDEX FROM listings WHERE Column_name = ?', ['source_url']);

  const uniqueIndexNames = [...new Set(
    indexes
      .filter((indexRow) => Number(indexRow.Non_unique) === 0 && indexRow.Key_name !== 'PRIMARY')
      .map((indexRow) => indexRow.Key_name)
  )];

  for (const indexName of uniqueIndexNames) {
    if (/^[A-Za-z0-9_]+$/.test(indexName)) {
      await pool.query(`ALTER TABLE listings DROP INDEX ${indexName}`);
    }
  }
}

async function ensureUniqueVinIndex() {
  const pool = getPool();
  const [indexes] = await pool.query('SHOW INDEX FROM listings WHERE Key_name = ?', ['unique_vin']);
  if (Array.isArray(indexes) && indexes.length > 0) {
    return;
  }

  await pool.query('ALTER TABLE listings ADD UNIQUE KEY unique_vin (vin)');
}

async function runMigrations() {
  await ensureListingColumn('report_url', 'VARCHAR(700) NULL AFTER source_url');
  await ensureListingColumn('reviewed_detailed', 'BOOLEAN NOT NULL DEFAULT FALSE AFTER status');
  await ensureListingColumn('contacted', 'BOOLEAN NOT NULL DEFAULT FALSE AFTER reviewed_detailed');
  await ensureListingColumn('checked_offer', 'BOOLEAN NOT NULL DEFAULT FALSE AFTER contacted');
  await ensureListingColumn('to_view_live', 'BOOLEAN NOT NULL DEFAULT FALSE AFTER checked_offer');
  await ensureListingColumn('route_origin', 'VARCHAR(255) NULL AFTER color');
  await ensureListingColumn('route_distance_km', 'DECIMAL(8,1) NULL AFTER route_origin');
  await ensureListingColumn('route_duration_min', 'INT NULL AFTER route_distance_km');
  await ensureListingColumn('route_cache_version', 'INT NULL AFTER route_duration_min');
  await ensureListingColumn('route_calculated_at', 'TIMESTAMP NULL AFTER route_duration_min');
  await ensureListingColumn('ai_rating', 'TINYINT NULL AFTER personal_comment');
  await ensureListingColumn('ai_comment', 'TEXT NULL AFTER ai_rating');
  await ensureListingColumn('vin', 'VARCHAR(17) NULL AFTER color');
  await ensureRouteCacheTable();
  await ensureSourceUrlIsNotUnique();
  await ensureUniqueVinIndex();
}

async function runSeed() {
  const pool = getPool();
  const [rows] = await pool.query('SELECT COUNT(*) AS total FROM listings');

  if (rows[0].total > 0) {
    return;
  }

  await pool.query(
    `INSERT INTO listings (
      source, source_url, title, price, currency, mileage, description, location,
      phone, production_year, import_year, history_rating, personal_rating, status,
      history_note, personal_comment, fuel_type, gearbox, engine_capacity, power_hp,
      body_type, drive_type, color
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'manual',
      'https://przyklad.local/oferta/demo-1',
      'Skoda Octavia 2.0 TDI',
      48900,
      'PLN',
      189000,
      'Zadbany egzemplarz, udokumentowany serwis, bezwypadkowy.',
      'Kraków',
      '600123456',
      2016,
      2019,
      4,
      4,
      'Do kontaktu',
      'Książka serwisowa + raport VIN OK',
      'Warto obejrzeć, dobra relacja cena/jakość.',
      'Diesel',
      'Manualna',
      '2.0',
      150,
      'Kombi',
      'FWD',
      'Srebrny'
    ]
  );
}

async function initializeDb() {
  await runSchema();
  await runMigrations();
  await runSeed();
}

module.exports = {
  initializeDb
};
