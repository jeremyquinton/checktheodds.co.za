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

CREATE TABLE IF NOT EXISTS premier_league_teams (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_premier_league_teams_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS premier_league_team_injuries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scraped_at DATETIME(3) NOT NULL,
  source_updated_at VARCHAR(128) NULL,
  source_url VARCHAR(2048) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_premier_league_team_injuries_scraped_at (scraped_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS premier_league_player_injuries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  injury_scrape_id BIGINT UNSIGNED NOT NULL,
  team_id BIGINT UNSIGNED NOT NULL,
  player_name VARCHAR(128) NOT NULL,
  injury VARCHAR(255) NOT NULL,
  latest_url VARCHAR(2048) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_premier_league_player_injuries_scrape_player (
    injury_scrape_id, team_id, player_name
  ),
  KEY ix_premier_league_player_injuries_team_player (team_id, player_name),
  CONSTRAINT fk_premier_league_player_injuries_scrape
    FOREIGN KEY (injury_scrape_id) REFERENCES premier_league_team_injuries (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_premier_league_player_injuries_team
    FOREIGN KEY (team_id) REFERENCES premier_league_teams (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS premier_league_matches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  external_match_id VARCHAR(32) NOT NULL,
  season SMALLINT UNSIGNED NOT NULL,
  matchweek TINYINT UNSIGNED NOT NULL,
  kickoff DATETIME NULL,
  kickoff_timezone VARCHAR(64) NULL,
  phase VARCHAR(32) NULL,
  period VARCHAR(32) NULL,
  result_type VARCHAR(64) NULL,
  ground VARCHAR(255) NULL,
  attendance INT UNSIGNED NULL,
  home_team_id BIGINT UNSIGNED NOT NULL,
  away_team_id BIGINT UNSIGNED NOT NULL,
  home_score SMALLINT UNSIGNED NULL,
  away_score SMALLINT UNSIGNED NULL,
  home_half_time_score SMALLINT UNSIGNED NULL,
  away_half_time_score SMALLINT UNSIGNED NULL,
  home_red_cards TINYINT UNSIGNED NULL,
  away_red_cards TINYINT UNSIGNED NULL,
  scraped_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pl_matches_external_id (external_match_id),
  KEY ix_pl_matches_season_week (season, matchweek),
  KEY ix_pl_matches_home_kickoff (home_team_id, kickoff),
  KEY ix_pl_matches_away_kickoff (away_team_id, kickoff),
  CONSTRAINT fk_pl_matches_home_team
    FOREIGN KEY (home_team_id) REFERENCES premier_league_teams (id),
  CONSTRAINT fk_pl_matches_away_team
    FOREIGN KEY (away_team_id) REFERENCES premier_league_teams (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS premier_league_odds_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  premier_league_match_id BIGINT UNSIGNED NOT NULL,
  bookmaker_id BIGINT UNSIGNED NOT NULL,
  bookmaker_event_id VARCHAR(128) NOT NULL,
  scraped_at DATETIME(3) NOT NULL,
  home_odds DECIMAL(10, 3) NULL,
  draw_odds DECIMAL(10, 3) NULL,
  away_odds DECIMAL(10, 3) NULL,
  market_url VARCHAR(2048) NULL,
  source_url VARCHAR(2048) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pl_odds_match_bookmaker_scraped (
    premier_league_match_id, bookmaker_id, scraped_at
  ),
  KEY ix_pl_odds_bookmaker_scraped (bookmaker_id, scraped_at),
  CONSTRAINT fk_pl_odds_match
    FOREIGN KEY (premier_league_match_id) REFERENCES premier_league_matches (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_pl_odds_bookmaker
    FOREIGN KEY (bookmaker_id) REFERENCES bookmakers (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS free_bet_offers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(120) NOT NULL,
  bookmaker_name VARCHAR(128) NOT NULL,
  category VARCHAR(32) NOT NULL,
  headline VARCHAR(255) NOT NULL,
  description VARCHAR(500) NOT NULL,
  bonus_amount DECIMAL(10, 2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ZAR',
  minimum_deposit VARCHAR(80) NOT NULL,
  wagering_requirements VARCHAR(120) NOT NULL,
  qualifying_odds DECIMAL(8, 2) NULL,
  valid_for VARCHAR(80) NOT NULL,
  offer_url VARCHAR(2048) NOT NULL,
  terms_text TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_example TINYINT(1) NOT NULL DEFAULT 1,
  verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_free_bet_offers_slug (slug),
  KEY ix_free_bet_offers_active_category (is_active, category),
  KEY ix_free_bet_offers_bonus_amount (bonus_amount)
) ENGINE=InnoDB;

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

CREATE TABLE IF NOT EXISTS free_bet_email_subscribers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(254) NOT NULL,
  consented_at DATETIME(3) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_free_bet_email_subscribers_email (email)
) ENGINE=InnoDB;

INSERT IGNORE INTO free_bet_offers (
  slug, bookmaker_name, category, headline, description, bonus_amount, currency,
  minimum_deposit, wagering_requirements, qualifying_odds, valid_for, offer_url,
  terms_text, is_active, is_example
) VALUES
  (
    'hollywoodbets-free-bet', 'Hollywoodbets', 'free-bets', 'R250 in free bets',
    'Example welcome offer for new customers.', 250, 'ZAR', 'R100', '3x bonus',
    1.80, '7 days', 'https://www.hollywoodbets.net/',
    'Illustrative terms only; verify the live offer with the bookmaker.\nExample eligibility: new customers aged 18+ in South Africa.\nExample qualifying minimum odds: 1.80.',
    1, 1
  ),
  (
    'betway-deposit-match', 'Betway', 'deposit-match', 'Up to R1,000 deposit match',
    'Example welcome offer for new customers.', 1000, 'ZAR', 'R100', '5x bonus',
    1.50, '14 days', 'https://www.betway.co.za/',
    'Illustrative terms only; verify the live offer with the bookmaker.\nExample deposit-match cap: R1,000.\nExample qualifying minimum odds: 1.50.',
    1, 1
  ),
  (
    'play-free-bet', 'Play.co.za', 'free-bets', 'R100 in free bets',
    'Example free-bet offer for new customers.', 100, 'ZAR', 'R50', '3x bonus',
    1.80, '7 days', 'https://www.play.co.za/',
    'Illustrative terms only; verify the live offer with the bookmaker.\nExample eligibility: new customers aged 18+ in South Africa.\nExample qualifying minimum odds: 1.80.',
    1, 1
  ),
  (
    'supabets-no-deposit', 'Supabets', 'no-deposit', 'R50 no-deposit bonus',
    'Example no-deposit offer for eligible customers.', 50, 'ZAR', 'No deposit', '10x bonus',
    2.00, '3 days', 'https://www.supabets.co.za/',
    'Illustrative terms only; verify the live offer with the bookmaker.\nExample eligibility: one offer per verified customer.\nExample qualifying minimum odds: 2.00.',
    1, 1
  );