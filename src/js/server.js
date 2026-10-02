import express from 'express';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  getConnectionConfig,
  normalizePremierLeagueTeamName as normalizeTeam,
} from './database.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const projectDirectory = join(dirname(fileURLToPath(import.meta.url)), '../..');
const publicDirectory = join(projectDirectory, 'public');
const bookmakerLogos = new Map([
  ['betfair-sa', 'betfair.jpg'],
  ['betway', 'betway.png'],
  ['hollywoodbets', 'hollywood_bets.png'],
  ['play', 'play.png'],
  ['supabets', 'supabets.png'],
  ['virgin-bet', 'virgin_bets.png'],
  ['yesplay', 'yes_play.png'],
]);

function getMovement(current, previous) {
  if (previous == null || current === previous) return 'unchanged';
  return current > previous ? 'drifting' : 'shortening';
}

function groupFixtures(rows, injuriesByTeam) {
  const fixtures = new Map();

  for (const row of rows) {
    const key = `${normalizeTeam(row.home_team)}::${normalizeTeam(row.away_team)}`;
    const fixture = fixtures.get(key) ?? {
      id: key,
      competition: row.competition,
      country: row.country,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      startTimes: [],
      bookmakers: [],
    };

    if (row.start_time_raw && !fixture.startTimes.includes(row.start_time_raw)) {
      fixture.startTimes.push(row.start_time_raw);
    }

    const home = Number(row.home_odds);
    const draw = Number(row.draw_odds);
    const away = Number(row.away_odds);
    const bookmaker = {
      slug: row.bookmaker_slug,
      name: row.bookmaker,
      url: row.market_url,
      scrapedAt: row.scraped_at,
      odds: { home, draw, away },
      movement: {
        home: getMovement(home, row.previous_home_odds == null ? null : Number(row.previous_home_odds)),
        draw: getMovement(draw, row.previous_draw_odds == null ? null : Number(row.previous_draw_odds)),
        away: getMovement(away, row.previous_away_odds == null ? null : Number(row.previous_away_odds)),
      },
    };
    const existingBookmakerIndex = fixture.bookmakers.findIndex(
      (item) => item.slug === bookmaker.slug,
    );
    if (existingBookmakerIndex === -1) {
      fixture.bookmakers.push(bookmaker);
    } else if (
      new Date(bookmaker.scrapedAt).getTime() >=
      new Date(fixture.bookmakers[existingBookmakerIndex].scrapedAt).getTime()
    ) {
      fixture.bookmakers[existingBookmakerIndex] = bookmaker;
    }

    fixtures.set(key, fixture);
  }

  return [...fixtures.values()]
    .map((fixture) => ({
      ...fixture,
      startTime: [...fixture.startTimes].sort((left, right) => left.length - right.length)[0] ?? null,
      bestOdds: {
        home: Math.max(...fixture.bookmakers.map((bookmaker) => bookmaker.odds.home)),
        draw: Math.max(...fixture.bookmakers.map((bookmaker) => bookmaker.odds.draw)),
        away: Math.max(...fixture.bookmakers.map((bookmaker) => bookmaker.odds.away)),
      },
      homeInjuries: injuriesByTeam.get(normalizeTeam(fixture.homeTeam)) ?? [],
      awayInjuries: injuriesByTeam.get(normalizeTeam(fixture.awayTeam)) ?? [],
    }))
    .sort((left, right) =>
      right.bookmakers.length - left.bookmakers.length ||
      left.homeTeam.localeCompare(right.homeTeam),
    );
}

app.get('/api/fixtures', async (_request, response, next) => {
  let connection;

  try {
    connection = await mysql.createConnection(getConnectionConfig());
    const [rows] = await connection.query(`
      WITH ranked_odds AS (
        SELECT
          odds.*,
          ROW_NUMBER() OVER (
            PARTITION BY odds.premier_league_match_id, odds.bookmaker_id
            ORDER BY odds.scraped_at DESC
          ) AS position,
          LAG(odds.home_odds) OVER (
            PARTITION BY odds.premier_league_match_id, odds.bookmaker_id
            ORDER BY odds.scraped_at
          ) AS previous_home_odds,
          LAG(odds.draw_odds) OVER (
            PARTITION BY odds.premier_league_match_id, odds.bookmaker_id
            ORDER BY odds.scraped_at
          ) AS previous_draw_odds,
          LAG(odds.away_odds) OVER (
            PARTITION BY odds.premier_league_match_id, odds.bookmaker_id
            ORDER BY odds.scraped_at
          ) AS previous_away_odds
        FROM premier_league_odds_snapshots odds
      )
      SELECT
        bookmakers.slug AS bookmaker_slug,
        bookmakers.name AS bookmaker,
        'Premier League' AS competition,
        'England' AS country,
        home_team.name AS home_team,
        away_team.name AS away_team,
        DATE_FORMAT(matches.kickoff, '%d/%m %H:%i') AS start_time_raw,
        ranked_odds.market_url,
        ranked_odds.scraped_at,
        ranked_odds.home_odds,
        ranked_odds.draw_odds,
        ranked_odds.away_odds,
        ranked_odds.previous_home_odds,
        ranked_odds.previous_draw_odds,
        ranked_odds.previous_away_odds
      FROM ranked_odds
      JOIN premier_league_matches matches
        ON matches.id = ranked_odds.premier_league_match_id
      JOIN premier_league_teams home_team ON home_team.id = matches.home_team_id
      JOIN premier_league_teams away_team ON away_team.id = matches.away_team_id
      JOIN bookmakers ON bookmakers.id = ranked_odds.bookmaker_id
      WHERE ranked_odds.position = 1
    `);

    const [scrapes] = await connection.query(`
      SELECT id, scraped_at, source_updated_at
      FROM premier_league_team_injuries
      ORDER BY scraped_at DESC, id DESC
      LIMIT 1
    `);
    const latestInjuryScrape = scrapes[0] ?? null;
    const injuriesByTeam = new Map();

    if (latestInjuryScrape) {
      const [injuryRows] = await connection.execute(
        `SELECT
          premier_league_teams.name AS team,
          premier_league_player_injuries.player_name,
          premier_league_player_injuries.injury,
          premier_league_player_injuries.latest_url
        FROM premier_league_player_injuries
        JOIN premier_league_teams ON premier_league_teams.id = premier_league_player_injuries.team_id
        WHERE premier_league_player_injuries.injury_scrape_id = ?
        ORDER BY premier_league_teams.name, premier_league_player_injuries.player_name`,
        [latestInjuryScrape.id],
      );

      for (const row of injuryRows) {
        const key = normalizeTeam(row.team);
        const teamInjuries = injuriesByTeam.get(key) ?? [];
        teamInjuries.push({
          player: row.player_name,
          injury: row.injury,
          latestUrl: row.latest_url,
        });
        injuriesByTeam.set(key, teamInjuries);
      }
    }

    response.json({
      fixtures: groupFixtures(rows, injuriesByTeam),
      injuryScrapedAt: latestInjuryScrape?.scraped_at ?? null,
      injurySourceUpdatedAt: latestInjuryScrape?.source_updated_at ?? null,
    });
  } catch (error) {
    next(error);
  } finally {
    await connection?.end();
  }
});

app.get('/api/fixture-form', async (request, response, next) => {
  const homeName = request.query.homeTeam;
  const awayName = request.query.awayTeam;
  if (typeof homeName !== 'string' || typeof awayName !== 'string') {
    response.status(400).json({ error: 'Provide homeTeam and awayTeam query parameters.' });
    return;
  }

  let connection;
  try {
    connection = await mysql.createConnection(getConnectionConfig());
    const [teams] = await connection.query('SELECT id, name FROM premier_league_teams');
    const teamsByName = new Map(
      teams.map((team) => [normalizeTeam(team.name), team]),
    );
    const homeTeam = teamsByName.get(normalizeTeam(homeName));
    const awayTeam = teamsByName.get(normalizeTeam(awayName));

    if (!homeTeam || !awayTeam) {
      response.status(404).json({ error: 'One or both teams were not found.' });
      return;
    }

    const [fixtures] = await connection.execute(
      `SELECT id, external_match_id, season, kickoff
       FROM premier_league_matches
       WHERE home_team_id = ?
         AND away_team_id = ?
         AND period = 'PreMatch'
         AND DATE(kickoff) >= UTC_DATE()
         AND season = (
           SELECT MAX(season)
           FROM premier_league_matches
           WHERE period = 'PreMatch'
         )
       ORDER BY kickoff
       LIMIT 1`,
      [homeTeam.id, awayTeam.id],
    );
    const fixture = fixtures[0];

    if (!fixture) {
      response.status(404).json({ error: 'No upcoming canonical fixture was found for these teams.' });
      return;
    }

    const [formRows] = await connection.execute(
      `WITH team_appearances AS (
        SELECT
          matches.id AS match_id,
          matches.external_match_id,
          matches.season,
          matches.matchweek,
          matches.kickoff,
          matches.home_team_id AS team_id,
          matches.away_team_id AS opponent_id,
          home_team.name AS team_name,
          away_team.name AS opponent_name,
          'Home' AS venue,
          matches.home_score AS team_goals,
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
          AND matches.season BETWEEN ? AND ?
          AND matches.kickoff < ?
          AND matches.home_score IS NOT NULL
          AND matches.away_score IS NOT NULL

        UNION ALL

        SELECT
          matches.id,
          matches.external_match_id,
          matches.season,
          matches.matchweek,
          matches.kickoff,
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
          AND matches.season BETWEEN ? AND ?
          AND matches.kickoff < ?
          AND matches.home_score IS NOT NULL
          AND matches.away_score IS NOT NULL
      ), ranked_appearances AS (
        SELECT
          team_appearances.*,
          ROW_NUMBER() OVER (
            PARTITION BY team_id
            ORDER BY kickoff DESC, match_id DESC
          ) AS recent_rank
        FROM team_appearances
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
      WHERE recent_rank <= 10
      ORDER BY team_id, kickoff DESC, match_id DESC`,
      [
        homeTeam.id,
        awayTeam.id,
        fixture.season - 1,
        fixture.season,
        fixture.kickoff,
        homeTeam.id,
        awayTeam.id,
        fixture.season - 1,
        fixture.season,
        fixture.kickoff,
      ],
    );

    const [recordRows] = await connection.execute(
      `WITH team_appearances AS (
        SELECT
          matches.season,
          matches.home_team_id AS team_id,
          'Home' AS venue,
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
        SUM(result = 'W') AS wins,
        SUM(result = 'D') AS draws,
        SUM(result = 'L') AS losses
      FROM team_appearances
      GROUP BY team_id, season, venue`,
      [
        homeTeam.id,
        awayTeam.id,
        fixture.season - 1,
        fixture.season,
        fixture.kickoff,
        homeTeam.id,
        awayTeam.id,
        fixture.season - 1,
        fixture.season,
        fixture.kickoff,
      ],
    );

    const [headToHead] = await connection.execute(
      `SELECT
        matches.external_match_id,
        matches.season,
        matches.matchweek,
        matches.kickoff,
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
        fixture.kickoff,
        homeTeam.id,
        awayTeam.id,
        awayTeam.id,
        homeTeam.id,
      ],
    );

    const emptyRecord = () => ({ wins: 0, draws: 0, losses: 0 });
    const records = new Map([
      [homeTeam.id, { current: { Home: emptyRecord(), Away: emptyRecord() }, previous: { Home: emptyRecord(), Away: emptyRecord() } }],
      [awayTeam.id, { current: { Home: emptyRecord(), Away: emptyRecord() }, previous: { Home: emptyRecord(), Away: emptyRecord() } }],
    ]);
    for (const record of recordRows) {
      const teamRecords = records.get(record.team_id);
      const seasonKey = Number(record.season) === Number(fixture.season) ? 'current' : 'previous';
      teamRecords[seasonKey][record.venue] = {
        wins: Number(record.wins),
        draws: Number(record.draws),
        losses: Number(record.losses),
      };
    }

    const formFor = (team) => ({
      name: team.name,
      records: records.get(team.id),
      matches: formRows
        .filter((row) => row.team_id === team.id)
        .map((row) => ({
          date: row.kickoff,
          season: row.season,
          matchweek: row.matchweek,
          opponent: row.opponent_name,
          venue: row.venue,
          goals: Number(row.team_goals),
          opponentGoals: Number(row.opponent_goals),
          result: row.result,
          xg: row.xg == null ? null : Number(row.xg),
          xga: row.xga == null ? null : Number(row.xga),
        })),
    });

    response.json({
      fixture: {
        externalMatchId: fixture.external_match_id,
        season: Number(fixture.season),
        kickoff: fixture.kickoff,
        homeTeam: homeTeam.name,
        awayTeam: awayTeam.name,
      },
      home: formFor(homeTeam),
      away: formFor(awayTeam),
      headToHead: headToHead.map((match) => ({
        matchId: match.external_match_id,
        date: match.kickoff,
        season: Number(match.season),
        matchweek: match.matchweek,
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        homeGoals: Number(match.home_score),
        awayGoals: Number(match.away_score),
        homeXg: match.home_xg == null ? null : Number(match.home_xg),
        awayXg: match.away_xg == null ? null : Number(match.away_xg),
      })),
    });
  } catch (error) {
    next(error);
  } finally {
    await connection?.end();
  }
});

app.get('/logos/:bookmaker', (request, response, next) => {
  const filename = bookmakerLogos.get(request.params.bookmaker);
  if (!filename) {
    response.sendStatus(404);
    return;
  }

  response.sendFile(join(projectDirectory, filename), (error) => {
    if (error) next(error);
  });
});

app.use(express.static(publicDirectory));

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'Unable to load odds from MySQL.' });
});

app.listen(port, () => {
  console.log(`Odds comparison UI available at http://localhost:${port}`);
});