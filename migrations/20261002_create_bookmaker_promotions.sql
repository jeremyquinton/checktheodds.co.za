USE checktheodds;

CREATE TABLE IF NOT EXISTS bookmaker_promotions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bookmaker_slug VARCHAR(64) NOT NULL,
  offer_key VARCHAR(180) NOT NULL,
  product_category VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  subtitle VARCHAR(255) NULL,
  body_text TEXT NULL,
  steps JSON NOT NULL,
  details JSON NOT NULL,
  image_url VARCHAR(2048) NULL,
  action_label VARCHAR(80) NULL,
  action_url VARCHAR(2048) NOT NULL,
  source_url VARCHAR(2048) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  scraped_at DATETIME(3) NOT NULL,
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bookmaker_promotions_offer (bookmaker_slug, offer_key),
  KEY ix_bookmaker_promotions_active (bookmaker_slug, is_active)
) ENGINE=InnoDB;