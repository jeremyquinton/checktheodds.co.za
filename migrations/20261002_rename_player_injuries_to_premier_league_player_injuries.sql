RENAME TABLE player_injuries TO premier_league_player_injuries;

ALTER TABLE premier_league_player_injuries
  DROP FOREIGN KEY fk_player_injuries_scrape,
  DROP FOREIGN KEY fk_player_injuries_team,
  RENAME INDEX uq_player_injuries_scrape_player
    TO uq_premier_league_player_injuries_scrape_player,
  RENAME INDEX ix_player_injuries_team_player
    TO ix_premier_league_player_injuries_team_player,
  ADD CONSTRAINT fk_premier_league_player_injuries_scrape
    FOREIGN KEY (injury_scrape_id)
    REFERENCES premier_league_team_injuries (id)
    ON DELETE CASCADE,
  ADD CONSTRAINT fk_premier_league_player_injuries_team
    FOREIGN KEY (team_id)
    REFERENCES premier_league_teams (id);