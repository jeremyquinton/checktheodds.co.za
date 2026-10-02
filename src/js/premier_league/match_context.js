import mysql from 'mysql2/promise';
import { getConnectionConfig } from '../database.js';

function parseArguments(argumentsList) {
  const options = { matchId: null, formLimit: 15 };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--match-id') {
      options.matchId = argumentsList[++index] ?? null;
    } else if (argument.startsWith('--match-id=')) {
      options.matchId = argument.slice('--match-id='.length);
    } else if (argument === '--form-limit') {
      options.formLimit = Number(argumentsList[++index]);
    } else if (argument.startsWith('--form-limit=')) {
      options.formLimit = Number(argument.slice('--form-limit='.length));
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (!options.matchId) {
    throw new Error('Usage: npm run fixture:context -- --match-id=<external_match_id> [--form-limit=10..15]');
  }
  if (!Number.isInteger(options.formLimit) || options.formLimit < 10 || options.formLimit > 15) {
    throw new Error('--form-limit must be an integer from 10 to 15.');
  }

  return options;
}

function numberOrNull(value) {
  return value == null ? null : Number(value);
}

function summarizeForm(matches) {
  const summary = {
    played: matches.length,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    averageGoalsFor: null,
    averageGoalsAgainst: null,
    xgMatches: 0,
    averageXg: null,
    averageXga: null,
  };
  let xgTotal = 0;
  let xgaTotal = 0;

  for (const match of matches) {
    const resultKey = { W: 'wins', D: 'draws', L: 'losses' }[match.result];
    summary[resultKey] += 1;
    summary.goalsFor += match.goalsFor;
    summary.goalsAgainst += match.goalsAgainst;
    if (match.xg != null && match.xga != null) {
      summary.xgMatches += 1;
      xgTotal += match.xg;
      xgaTotal += match.xga;
    }
  }

  if (matches.length > 0) {
    summary.averageGoalsFor = Number((summary.goalsFor / matches.length).toFixed(2));
    summary.averageGoalsAgainst = Number((summary.goalsAgainst / matches.length).toFixed(2));
  }
  if (summary.xgMatches > 0) {
    summary.averageXg = Number((xgTotal / summary.xgMatches).toFixed(2));
    summary.averageXga = Number((xgaTotal / summary.xgMatches).toFixed(2));
  }

  return summary;
}

function makeVenueRecords() {
  return {
    home: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
    away: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
  };
}

function addVenueRecord(records, row) {
  const venue = row.venue.toLowerCase();
  const record = records[venue];
  record.played += 1;
  record[row.result.toLowerCase() + 's'] += 1;
  record.goalsFor += Number(row.goals_for);
  record.goalsAgainst += Number(row.goals_against);
}

function finalizeVenueRecords(records) {
  for (const record of Object.values(records)) {
    record.averageGoalsFor = record.played
      ? Number((record.goalsFor / record.played).toFixed(2))
      : null;
    record.averageGoalsAgainst = record.played
      ? Number((record.goalsAgainst / record.played).toFixed(2))
      : null;
  }
  return records;
}

async function buildMatchContext(connection, matchId, formLimit) {
  const [fixtures] = await connection.execute(
    `SELECT
      matches.id,
      matches.external_match_id,
      matches.season,
      matches.matchweek,
      DATE_FORMAT(matches.kickoff, '%Y-%m-%d %H:%i:%s') AS kickoff_local,
      matches.kickoff_timezone,
      matches.period,
      matches.ground,
      matches.attendance,
      matches.home_team_id,
      matches.away_team_id,
      matches.home_score,
      matches.away_score,
      home_team.name AS home_team,
      away_team.name AS away_team
    FROM premier_league_matches matches
    JOIN premier_league_teams home_team ON home_team.id = matches.home_team_id
    JOIN premier_league_teams away_team ON away_team.id = matches.away_team_id
    WHERE matches.external_match_id = ?
    LIMIT 1`,
    [matchId],
  );
  const fixture = fixtures[0];
  if (!fixture) {
    throw new Error(`No premier_league_matches row found for external match ID ${matchId}.`);
  }

  const [formRows] = await connection.execute(
    `WITH appearances AS (
      SELECT
        matches.id AS match_id,
        matches.external_match_id,
        matches.season,
        matches.matchweek,
        DATE_FORMAT(matches.kickoff, '%Y-%m-%d %H:%i:%s') AS kickoff,
        matches.home_team_id AS team_id,
        matches.away_team_id AS opponent_id,
        home_team.name AS team_name,
        away_team.name AS opponent,
        'Home' AS venue,
        matches.home_score AS goals,
        matches.away_score AS opponent_goals,
        CASE
          WHEN matches.home_score = matches.away_score THEN 'D'
          WHEN matches.home_score > matches.away_score THEN 'W'
          ELSE 'L'
        END AS result
      FROM premier_league_matches matches
      JOIN premier_league_teams home_team ON home_team.id = matches.home_team_id
      JOIN premier_league_teams away_team ON away_team.id = matches.away_team_id
      WHERE matches.home_team_id IN (?, ?)
        AND matches.kickoff < ?
        AND matches.home_score IS NOT NULL
        AND matches.away_score IS NOT NULL

      UNION ALL

      SELECT
        matches.id,
        matches.external_match_id,
        matches.season,
        matches.matchweek,
        DATE_FORMAT(matches.kickoff, '%Y-%m-%d %H:%i:%s'),
        matches.away_team_id,
        matches.home_team_id,
        away_team.name,
        home_team.name,
        'Away',
        matches.away_score,
        matches.home_score,
        CASE
          WHEN matches.home_score = matches.away_score THEN 'D'
          WHEN matches.away_score > matches.home_score THEN 'W'
          ELSE 'L'
        END
      FROM premier_league_matches matches
      JOIN premier_league_teams home_team ON home_team.id = matches.home_team_id
      JOIN premier_league_teams away_team ON away_team.id = matches.away_team_id
      WHERE matches.away_team_id IN (?, ?)
        AND matches.kickoff < ?
        AND matches.home_score IS NOT NULL
        AND matches.away_score IS NOT NULL
    ), ranked_appearances AS (
      SELECT
        appearances.*,
        ROW_NUMBER() OVER (
          PARTITION BY team_id
          ORDER BY kickoff DESC, match_id DESC
        ) AS recent_rank
      FROM appearances
    )
    SELECT
      ranked_appearances.*,
      CAST(JSON_UNQUOTE(JSON_EXTRACT(team_stats.stats, '$.expectedGoals')) AS DECIMAL(8, 3)) AS xg,
      CAST(JSON_UNQUOTE(JSON_EXTRACT(opponent_stats.stats, '$.expectedGoals')) AS DECIMAL(8, 3)) AS xga
    FROM ranked_appearances
    LEFT JOIN premier_league_match_team_stats team_stats
      ON team_stats.premier_league_match_id = ranked_appearances.match_id
      AND team_stats.team_id = ranked_appearances.team_id
    LEFT JOIN premier_league_match_team_stats opponent_stats
      ON opponent_stats.premier_league_match_id = ranked_appearances.match_id
      AND opponent_stats.team_id = ranked_appearances.opponent_id
    WHERE recent_rank <= ?
    ORDER BY team_id, kickoff DESC, match_id DESC`,
    [
      fixture.home_team_id,
      fixture.away_team_id,
      fixture.kickoff_local,
      fixture.home_team_id,
      fixture.away_team_id,
      fixture.kickoff_local,
      formLimit,
    ],
  );

  const [venueRows] = await connection.execute(
    `WITH appearances AS (
      SELECT
        matches.season,
        matches.home_team_id AS team_id,
        'Home' AS venue,
        matches.home_score AS goals_for,
        matches.away_score AS goals_against,
        CASE
          WHEN matches.home_score = matches.away_score THEN 'D'
          WHEN matches.home_score > matches.away_score THEN 'W'
          ELSE 'L'
        END AS result
      FROM premier_league_matches matches
      WHERE matches.home_team_id IN (?, ?)
        AND matches.season BETWEEN ? AND ?
        AND matches.kickoff < ?
        AND matches.home_score IS NOT NULL
        AND matches.away_score IS NOT NULL

      UNION ALL

      SELECT
        matches.season,
        matches.away_team_id,
        'Away',
        matches.away_score,
        matches.home_score,
        CASE
          WHEN matches.home_score = matches.away_score THEN 'D'
          WHEN matches.away_score > matches.home_score THEN 'W'
          ELSE 'L'
        END
      FROM premier_league_matches matches
      WHERE matches.away_team_id IN (?, ?)
        AND matches.season BETWEEN ? AND ?
        AND matches.kickoff < ?
        AND matches.home_score IS NOT NULL
        AND matches.away_score IS NOT NULL
    )
    SELECT
      team_id,
      season,
      venue,
      COUNT(*) AS played,
      SUM(result = 'W') AS wins,
      SUM(result = 'D') AS draws,
      SUM(result = 'L') AS losses,
      SUM(goals_for) AS goals_for,
      SUM(goals_against) AS goals_against
    FROM appearances
    GROUP BY team_id, season, venue`,
    [
      fixture.home_team_id,
      fixture.away_team_id,
      fixture.season - 1,
      fixture.season,
      fixture.kickoff_local,
      fixture.home_team_id,
      fixture.away_team_id,
      fixture.season - 1,
      fixture.season,
      fixture.kickoff_local,
    ],
  );

  const [headToHeadRows] = await connection.execute(
    `SELECT
      matches.external_match_id,
      matches.season,
      matches.matchweek,
      DATE_FORMAT(matches.kickoff, '%Y-%m-%d %H:%i:%s') AS kickoff,
      home_team.name AS home_team,
      away_team.name AS away_team,
      matches.home_score,
      matches.away_score,
      CAST(JSON_UNQUOTE(JSON_EXTRACT(home_stats.stats, '$.expectedGoals')) AS DECIMAL(8, 3)) AS home_xg,
      CAST(JSON_UNQUOTE(JSON_EXTRACT(away_stats.stats, '$.expectedGoals')) AS DECIMAL(8, 3)) AS away_xg
    FROM premier_league_matches matches
    JOIN premier_league_teams home_team ON home_team.id = matches.home_team_id
    JOIN premier_league_teams away_team ON away_team.id = matches.away_team_id
    LEFT JOIN premier_league_match_team_stats home_stats
      ON home_stats.premier_league_match_id = matches.id
      AND home_stats.team_id = matches.home_team_id
    LEFT JOIN premier_league_match_team_stats away_stats
      ON away_stats.premier_league_match_id = matches.id
      AND away_stats.team_id = matches.away_team_id
    WHERE matches.kickoff < ?
      AND matches.home_score IS NOT NULL
      AND matches.away_score IS NOT NULL
      AND ((matches.home_team_id = ? AND matches.away_team_id = ?)
        OR (matches.home_team_id = ? AND matches.away_team_id = ?))
    ORDER BY matches.kickoff DESC
    LIMIT 5`,
    [
      fixture.kickoff_local,
      fixture.home_team_id,
      fixture.away_team_id,
      fixture.away_team_id,
      fixture.home_team_id,
    ],
  );

  const venueRecord = () => ({
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    averageGoalsFor: null,
    averageGoalsAgainst: null,
  });
  const teamRecords = new Map([
    [fixture.home_team_id, { currentSeason: { home: venueRecord(), away: venueRecord() }, previousSeason: { home: venueRecord(), away: venueRecord() } }],
    [fixture.away_team_id, { currentSeason: { home: venueRecord(), away: venueRecord() }, previousSeason: { home: venueRecord(), away: venueRecord() } }],
  ]);

  for (const row of venueRows) {
    const records = teamRecords.get(row.team_id);
    const seasonKey = Number(row.season) === Number(fixture.season) ? 'currentSeason' : 'previousSeason';
    const record = records[seasonKey][row.venue.toLowerCase()];
    record.played = Number(row.played);
    record.wins = Number(row.wins);
    record.draws = Number(row.draws);
    record.losses = Number(row.losses);
    record.goalsFor = Number(row.goals_for);
    record.goalsAgainst = Number(row.goals_against);
    record.averageGoalsFor = record.played ? Number((record.goalsFor / record.played).toFixed(2)) : null;
    record.averageGoalsAgainst = record.played ? Number((record.goalsAgainst / record.played).toFixed(2)) : null;
  }

  const recentMatchesFor = (teamId) => formRows
    .filter((match) => match.team_id === teamId)
    .map((match) => ({
      matchId: match.external_match_id,
      date: match.kickoff,
      season: Number(match.season),
      matchweek: Number(match.matchweek),
      competition: 'Premier League',
      opponent: match.opponent,
      venue: match.venue,
      goalsFor: Number(match.goals),
      goalsAgainst: Number(match.opponent_goals),
      result: match.result,
      xg: numberOrNull(match.xg),
      xga: numberOrNull(match.xga),
    }));
  const homeRecentMatches = recentMatchesFor(fixture.home_team_id);
  const awayRecentMatches = recentMatchesFor(fixture.away_team_id);
  const [injuryScrapes] = await connection.query(
    `SELECT id, scraped_at, source_updated_at, source_url
     FROM premier_league_team_injuries
     ORDER BY scraped_at DESC, id DESC
     LIMIT 1`,
  );
  const injuryScrape = injuryScrapes[0] ?? null;
  let injuries = [];

  if (injuryScrape) {
    const [injuryRows] = await connection.execute(
      `SELECT team_id, player_name, injury, latest_url
       FROM premier_league_player_injuries
       WHERE injury_scrape_id = ? AND team_id IN (?, ?)
       ORDER BY team_id, player_name`,
      [injuryScrape.id, fixture.home_team_id, fixture.away_team_id],
    );
    injuries = injuryRows.map((row) => ({
      team: Number(row.team_id) === Number(fixture.home_team_id) ? fixture.home_team : fixture.away_team,
      player: row.player_name,
      injury: row.injury,
      sourceUrl: row.latest_url,
    }));
  }

  const [nextFixtures] = await connection.execute(
    `WITH team_fixtures AS (
      SELECT
        matches.home_team_id AS team_id,
        matches.home_team_id,
        matches.away_team_id,
        matches.external_match_id,
        matches.season,
        matches.matchweek,
        matches.kickoff,
        home_team.name AS home_team,
        away_team.name AS away_team,
        'Home' AS venue
      FROM premier_league_matches matches
      JOIN premier_league_teams home_team ON home_team.id = matches.home_team_id
      JOIN premier_league_teams away_team ON away_team.id = matches.away_team_id
      WHERE matches.home_team_id IN (?, ?)
        AND matches.kickoff > ?
        AND matches.period = 'PreMatch'

      UNION ALL

      SELECT
        matches.away_team_id,
        matches.home_team_id,
        matches.away_team_id,
        matches.external_match_id,
        matches.season,
        matches.matchweek,
        matches.kickoff,
        home_team.name,
        away_team.name,
        'Away'
      FROM premier_league_matches matches
      JOIN premier_league_teams home_team ON home_team.id = matches.home_team_id
      JOIN premier_league_teams away_team ON away_team.id = matches.away_team_id
      WHERE matches.away_team_id IN (?, ?)
        AND matches.kickoff > ?
        AND matches.period = 'PreMatch'
    ), ranked_fixtures AS (
      SELECT
        team_fixtures.*,
        ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY kickoff, external_match_id) AS fixture_rank
      FROM team_fixtures
    )
    SELECT team_id,home_team_id,away_team_id,external_match_id,season,matchweek,kickoff,home_team,away_team,venue
    FROM ranked_fixtures
    WHERE fixture_rank <= 5
    ORDER BY team_id,kickoff`,
    [
      fixture.home_team_id,
      fixture.away_team_id,
      fixture.kickoff_local,
      fixture.home_team_id,
      fixture.away_team_id,
      fixture.kickoff_local,
    ],
  );
  const upcomingFor = (teamId) => nextFixtures
    .filter((nextFixture) => Number(nextFixture.team_id) === Number(teamId))
    .map((nextFixture) => ({
      matchId: nextFixture.external_match_id,
      date: nextFixture.kickoff,
      season: Number(nextFixture.season),
      matchweek: Number(nextFixture.matchweek),
      competition: 'Premier League',
      opponent: Number(nextFixture.team_id) === Number(nextFixture.home_team_id)
        ? nextFixture.away_team
        : nextFixture.home_team,
      venue: nextFixture.venue,
    }));

  const [oddsRows] = await connection.execute(
    `WITH ranked_odds AS (
      SELECT
        odds.*,
        bookmakers.name AS bookmaker,
        bookmakers.slug AS bookmaker_slug,
        ROW_NUMBER() OVER (
          PARTITION BY odds.bookmaker_id
          ORDER BY odds.scraped_at DESC
        ) AS position
      FROM premier_league_odds_snapshots odds
      JOIN bookmakers ON bookmakers.id = odds.bookmaker_id
      WHERE odds.premier_league_match_id = ?
    )
    SELECT bookmaker,bookmaker_slug,scraped_at,home_odds,draw_odds,away_odds,market_url
    FROM ranked_odds
    WHERE position = 1
    ORDER BY bookmaker`,
    [fixture.id],
  );

  const h2h = headToHeadRows.map((match) => ({
    matchId: match.external_match_id,
    date: match.kickoff,
    season: Number(match.season),
    matchweek: Number(match.matchweek),
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    homeGoals: Number(match.home_score),
    awayGoals: Number(match.away_score),
    homeXg: numberOrNull(match.home_xg),
    awayXg: numberOrNull(match.away_xg),
  }));

  return {
    generatedAt: new Date().toISOString(),
    dataScope: {
      results: 'Premier League only',
      statsProvider: 'Premier League API v3',
      formLimit,
      homeAwayRecords: 'Current fixture season to date and previous season',
    },
    fixture: {
      matchId: fixture.external_match_id,
      season: Number(fixture.season),
      matchweek: Number(fixture.matchweek),
      competition: 'Premier League',
      kickoff: fixture.kickoff_local,
      timezone: fixture.kickoff_timezone,
      period: fixture.period,
      venue: fixture.ground,
      attendance: fixture.attendance == null ? null : Number(fixture.attendance),
      homeTeam: fixture.home_team,
      awayTeam: fixture.away_team,
      score: fixture.home_score == null || fixture.away_score == null
        ? null
        : { home: Number(fixture.home_score), away: Number(fixture.away_score) },
    },
    teams: [
      {
        name: fixture.home_team,
        recentForm: homeRecentMatches,
        summary: summarizeForm(homeRecentMatches),
        venueRecords: teamRecords.get(fixture.home_team_id),
        previousMatch: homeRecentMatches[0] ?? null,
        upcomingPremierLeagueFixtures: upcomingFor(fixture.home_team_id),
        injuries: injuries.filter((injury) => injury.team === fixture.home_team),
        suspensions: { available: false, items: null },
        likelyStartingLineup: { available: false, players: null },
      },
      {
        name: fixture.away_team,
        recentForm: awayRecentMatches,
        summary: summarizeForm(awayRecentMatches),
        venueRecords: teamRecords.get(fixture.away_team_id),
        previousMatch: awayRecentMatches[0] ?? null,
        upcomingPremierLeagueFixtures: upcomingFor(fixture.away_team_id),
        injuries: injuries.filter((injury) => injury.team === fixture.away_team),
        suspensions: { available: false, items: null },
        likelyStartingLineup: { available: false, players: null },
      },
    ],
    headToHead: h2h,
    teamNews: {
      capturedAt: injuryScrape?.scraped_at ?? null,
      sourceUpdatedAt: injuryScrape?.source_updated_at ?? null,
      sourceUrl: injuryScrape?.source_url ?? null,
      injuriesByTeam: [
        { team: fixture.home_team, injuries: injuries.filter((injury) => injury.team === fixture.home_team) },
        { team: fixture.away_team, injuries: injuries.filter((injury) => injury.team === fixture.away_team) },
      ],
      suspensionsAvailable: false,
      startingLineupsAvailable: false,
    },
    restAndSchedule: {
      upcomingPremierLeagueFixturesOnly: true,
      otherCompetitionsAvailable: false,
    },
    bookmakerOdds: {
      matchResult: oddsRows.map((odds) => ({
        bookmaker: odds.bookmaker,
        bookmakerSlug: odds.bookmaker_slug,
        capturedAt: odds.scraped_at,
        home: numberOrNull(odds.home_odds),
        draw: numberOrNull(odds.draw_odds),
        away: numberOrNull(odds.away_odds),
        marketUrl: odds.market_url,
      })),
      overUnder25: { available: false, prices: null },
    },
    availability: {
      expectedGoalsAvailable: formRows.some((match) => match.xg != null && match.xga != null),
      injurySnapshotAvailable: injuryScrape !== null,
      suspensionsAvailable: false,
      startingLineupsAvailable: false,
      otherCompetitionsAvailable: false,
      overUnderOddsAvailable: false,
    },
  };
}

async function main() {
  const argumentsList = process.argv.slice(2);
  let matchId = null;
  let formLimit = 15;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--match-id') matchId = argumentsList[++index] ?? null;
    else if (argument.startsWith('--match-id=')) matchId = argument.slice('--match-id='.length);
    else if (argument === '--form-limit') formLimit = Number(argumentsList[++index]);
    else if (argument.startsWith('--form-limit=')) formLimit = Number(argument.slice('--form-limit='.length));
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!matchId) throw new Error('Usage: npm run fixture:context -- --match-id=<external_match_id> [--form-limit=10..15]');
  if (!Number.isInteger(formLimit) || formLimit < 10 || formLimit > 15) {
    throw new Error('--form-limit must be an integer from 10 to 15.');
  }

  const connection = await mysql.createConnection(getConnectionConfig());
  try {
    const context = await buildMatchContext(connection, matchId, formLimit);
    process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  process.stderr.write(`Unable to build match context: ${error.message}\n`);
  process.exitCode = 1;
});