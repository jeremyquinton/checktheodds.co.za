SET @fixture_external_match_id = '2562265';
SET @form_match_count = 15;

WITH fixture_match AS (
  SELECT
    id,
    external_match_id,
    season,
    kickoff,
    home_team_id,
    away_team_id
  FROM premier_league_matches
  WHERE external_match_id = CONVERT(@fixture_external_match_id USING utf8mb4)
    COLLATE utf8mb4_unicode_ci
),
fixture_teams AS (
  SELECT
    id AS fixture_match_id,
    external_match_id AS fixture_external_match_id,
    season AS fixture_season,
    kickoff AS fixture_kickoff,
    home_team_id AS fixture_team_id,
    'Home' AS fixture_team_side
  FROM fixture_match

  UNION ALL

  SELECT
    id,
    external_match_id,
    season,
    kickoff,
    away_team_id,
    'Away'
  FROM fixture_match
),
team_history AS (
  SELECT
    fixture_teams.fixture_match_id,
    fixture_teams.fixture_external_match_id,
    fixture_teams.fixture_season,
    fixture_teams.fixture_team_id,
    fixture_teams.fixture_team_side,
    form_team.name AS fixture_team,
    history.id AS history_match_id,
    history.external_match_id AS history_external_match_id,
    history.season AS history_season,
    history.matchweek,
    history.kickoff,
    'Premier League' AS competition,
    home_team.name AS home_team,
    away_team.name AS away_team,
    history.home_score AS home_goals,
    history.away_score AS away_goals,
    CAST(JSON_UNQUOTE(JSON_EXTRACT(home_stats.stats, '$.expectedGoals')) AS DECIMAL(8, 3)) AS home_xg,
    CAST(JSON_UNQUOTE(JSON_EXTRACT(away_stats.stats, '$.expectedGoals')) AS DECIMAL(8, 3)) AS away_xg,
    CASE
      WHEN history.home_team_id = fixture_teams.fixture_team_id THEN 'Home'
      ELSE 'Away'
    END AS team_venue,
    CASE
      WHEN history.home_score = history.away_score THEN 'D'
      WHEN history.home_team_id = fixture_teams.fixture_team_id
        AND history.home_score > history.away_score THEN 'W'
      WHEN history.away_team_id = fixture_teams.fixture_team_id
        AND history.away_score > history.home_score THEN 'W'
      ELSE 'L'
    END AS team_result,
    CASE
      WHEN history.home_team_id = fixture_teams.fixture_team_id THEN history.home_score
      ELSE history.away_score
    END AS team_goals,
    CASE
      WHEN history.home_team_id = fixture_teams.fixture_team_id THEN history.away_score
      ELSE history.home_score
    END AS opponent_goals,
    CASE
      WHEN history.home_team_id = fixture_teams.fixture_team_id THEN home_stats.stats
      ELSE away_stats.stats
    END AS team_stats_json,
    CASE
      WHEN history.home_team_id = fixture_teams.fixture_team_id THEN away_stats.stats
      ELSE home_stats.stats
    END AS opponent_stats_json
  FROM fixture_teams
  JOIN premier_league_teams AS form_team
    ON form_team.id = fixture_teams.fixture_team_id
  JOIN premier_league_matches AS history
    ON (history.home_team_id = fixture_teams.fixture_team_id
      OR history.away_team_id = fixture_teams.fixture_team_id)
    AND history.season BETWEEN fixture_teams.fixture_season - 1 AND fixture_teams.fixture_season
    AND history.kickoff < fixture_teams.fixture_kickoff
    AND history.home_score IS NOT NULL
    AND history.away_score IS NOT NULL
  JOIN premier_league_teams AS home_team
    ON home_team.id = history.home_team_id
  JOIN premier_league_teams AS away_team
    ON away_team.id = history.away_team_id
  LEFT JOIN premier_league_match_team_stats AS home_stats
    ON home_stats.premier_league_match_id = history.id
    AND home_stats.side = 'Home'
  LEFT JOIN premier_league_match_team_stats AS away_stats
    ON away_stats.premier_league_match_id = history.id
    AND away_stats.side = 'Away'
),
ranked_history AS (
  SELECT
    team_history.*,
    ROW_NUMBER() OVER (
      PARTITION BY fixture_team_id
      ORDER BY kickoff DESC, history_match_id DESC
    ) AS recent_match_rank
  FROM team_history
),
season_venue_records AS (
  SELECT
    fixture_team_id,
    fixture_season,
    CONCAT(
      COALESCE(SUM(CASE WHEN history_season = fixture_season AND team_venue = 'Home' AND team_result = 'W' THEN 1 ELSE 0 END), 0), '-',
      COALESCE(SUM(CASE WHEN history_season = fixture_season AND team_venue = 'Home' AND team_result = 'D' THEN 1 ELSE 0 END), 0), '-',
      COALESCE(SUM(CASE WHEN history_season = fixture_season AND team_venue = 'Home' AND team_result = 'L' THEN 1 ELSE 0 END), 0)
    ) AS current_season_home_record,
    CONCAT(
      COALESCE(SUM(CASE WHEN history_season = fixture_season AND team_venue = 'Away' AND team_result = 'W' THEN 1 ELSE 0 END), 0), '-',
      COALESCE(SUM(CASE WHEN history_season = fixture_season AND team_venue = 'Away' AND team_result = 'D' THEN 1 ELSE 0 END), 0), '-',
      COALESCE(SUM(CASE WHEN history_season = fixture_season AND team_venue = 'Away' AND team_result = 'L' THEN 1 ELSE 0 END), 0)
    ) AS current_season_away_record,
    CONCAT(
      COALESCE(SUM(CASE WHEN history_season = fixture_season - 1 AND team_venue = 'Home' AND team_result = 'W' THEN 1 ELSE 0 END), 0), '-',
      COALESCE(SUM(CASE WHEN history_season = fixture_season - 1 AND team_venue = 'Home' AND team_result = 'D' THEN 1 ELSE 0 END), 0), '-',
      COALESCE(SUM(CASE WHEN history_season = fixture_season - 1 AND team_venue = 'Home' AND team_result = 'L' THEN 1 ELSE 0 END), 0)
    ) AS previous_season_home_record,
    CONCAT(
      COALESCE(SUM(CASE WHEN history_season = fixture_season - 1 AND team_venue = 'Away' AND team_result = 'W' THEN 1 ELSE 0 END), 0), '-',
      COALESCE(SUM(CASE WHEN history_season = fixture_season - 1 AND team_venue = 'Away' AND team_result = 'D' THEN 1 ELSE 0 END), 0), '-',
      COALESCE(SUM(CASE WHEN history_season = fixture_season - 1 AND team_venue = 'Away' AND team_result = 'L' THEN 1 ELSE 0 END), 0)
    ) AS previous_season_away_record
  FROM team_history
  GROUP BY fixture_team_id, fixture_season
)
SELECT
  ranked_history.fixture_external_match_id,
  ranked_history.fixture_team,
  ranked_history.fixture_team_side,
  ranked_history.recent_match_rank,
  ranked_history.history_external_match_id,
  ranked_history.history_season,
  ranked_history.matchweek,
  ranked_history.kickoff AS date,
  ranked_history.competition,
  ranked_history.home_team,
  ranked_history.away_team,
  ranked_history.home_goals,
  ranked_history.away_goals,
  ranked_history.home_xg,
  ranked_history.away_xg,
  ranked_history.team_venue,
  ranked_history.team_result,
  ranked_history.team_goals,
  ranked_history.opponent_goals,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(ranked_history.team_stats_json, '$.expectedGoals')) AS DECIMAL(8, 3)) AS team_xg,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(ranked_history.opponent_stats_json, '$.expectedGoals')) AS DECIMAL(8, 3)) AS team_xga,
  season_venue_records.current_season_home_record,
  season_venue_records.current_season_away_record,
  season_venue_records.previous_season_home_record,
  season_venue_records.previous_season_away_record
FROM ranked_history
JOIN season_venue_records
  ON season_venue_records.fixture_team_id = ranked_history.fixture_team_id
  AND season_venue_records.fixture_season = ranked_history.fixture_season
WHERE ranked_history.recent_match_rank <= @form_match_count
ORDER BY ranked_history.fixture_team_side, ranked_history.recent_match_rank;