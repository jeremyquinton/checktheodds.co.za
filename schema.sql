CREATE DATABASE IF NOT EXISTS checktheodds
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE checktheodds;

CREATE TABLE IF NOT EXISTS bookmakers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bookmakers_slug (slug)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS competitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sport VARCHAR(64) NOT NULL,
  country VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_competitions_identity (sport, country, name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS matches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bookmaker_id BIGINT UNSIGNED NOT NULL,
  competition_id BIGINT UNSIGNED NOT NULL,
  external_event_id VARCHAR(128) NOT NULL,
  home_team VARCHAR(128) NOT NULL,
  away_team VARCHAR(128) NOT NULL,
  start_time_raw VARCHAR(64) NULL,
  market_url VARCHAR(2048) NULL,
  source_url VARCHAR(2048) NOT NULL,
  first_seen_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_matches_bookmaker_event (bookmaker_id, external_event_id),
  KEY ix_matches_competition (competition_id),
  CONSTRAINT fk_matches_bookmaker
    FOREIGN KEY (bookmaker_id) REFERENCES bookmakers (id),
  CONSTRAINT fk_matches_competition
    FOREIGN KEY (competition_id) REFERENCES competitions (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS odds_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  match_id BIGINT UNSIGNED NOT NULL,
  scraped_at DATETIME(3) NOT NULL,
  home_odds DECIMAL(10, 3) NULL,
  draw_odds DECIMAL(10, 3) NULL,
  away_odds DECIMAL(10, 3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_odds_match_scrape (match_id, scraped_at),
  KEY ix_odds_scraped_at (scraped_at),
  CONSTRAINT fk_odds_match
    FOREIGN KEY (match_id) REFERENCES matches (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;