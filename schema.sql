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

CREATE TABLE IF NOT EXISTS premier_league_match_team_stats (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  premier_league_match_id BIGINT UNSIGNED NOT NULL,
  team_id BIGINT UNSIGNED NOT NULL,
  side ENUM('Home', 'Away') NOT NULL,
  stats JSON NOT NULL,
  scraped_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pl_match_team_stats_side (premier_league_match_id, side),
  KEY ix_pl_match_team_stats_team (team_id, scraped_at),
  CONSTRAINT fk_pl_match_team_stats_match
    FOREIGN KEY (premier_league_match_id) REFERENCES premier_league_matches (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_pl_match_team_stats_team
    FOREIGN KEY (team_id) REFERENCES premier_league_teams (id)
) ENGINE=InnoDB;