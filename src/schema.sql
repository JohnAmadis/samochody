CREATE TABLE IF NOT EXISTS listings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source VARCHAR(50) NOT NULL,
  source_url VARCHAR(700) NOT NULL,
  report_url VARCHAR(700) NULL,
  title VARCHAR(255) NULL,
  price DECIMAL(12,2) NULL,
  currency VARCHAR(10) DEFAULT 'PLN',
  mileage INT NULL,
  description TEXT NULL,
  location VARCHAR(255) NULL,
  phone VARCHAR(50) NULL,
  production_year SMALLINT NULL,
  import_year SMALLINT NULL,
  history_rating TINYINT NULL,
  personal_rating TINYINT NULL,
  status ENUM('Nowe','Do kontaktu','W trakcie','Do sprawdzenia','Odrzucone','Nieaktualne') DEFAULT 'Nowe',
  reviewed_detailed BOOLEAN NOT NULL DEFAULT FALSE,
  contacted BOOLEAN NOT NULL DEFAULT FALSE,
  checked_offer BOOLEAN NOT NULL DEFAULT FALSE,
  to_view_live BOOLEAN NOT NULL DEFAULT FALSE,
  history_note TEXT NULL,
  personal_comment TEXT NULL,
  ai_rating TINYINT NULL,
  ai_comment TEXT NULL,
  fuel_type VARCHAR(50) NULL,
  gearbox VARCHAR(50) NULL,
  engine_capacity VARCHAR(50) NULL,
  power_hp INT NULL,
  body_type VARCHAR(50) NULL,
  drive_type VARCHAR(50) NULL,
  color VARCHAR(50) NULL,
  equipment TEXT NULL,
  vin VARCHAR(17) NULL,
  route_origin VARCHAR(255) NULL,
  route_distance_km DECIMAL(8,1) NULL,
  route_duration_min INT NULL,
  route_cache_version INT NULL,
  route_calculated_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_vin (vin)
);

CREATE TABLE IF NOT EXISTS listing_images (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  listing_id BIGINT NOT NULL,
  original_url VARCHAR(1024) NOT NULL,
  local_path VARCHAR(1024) NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_listing_images_listing FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fetch_attempts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  listing_id BIGINT NULL,
  source_url VARCHAR(1024) NOT NULL,
  source VARCHAR(50) NOT NULL,
  success BOOLEAN DEFAULT FALSE,
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fetch_listing FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS route_cache (
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
);
