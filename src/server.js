import express from 'express';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getConnectionConfig } from './database.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const projectDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
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

const teamAliases = new Map([
  ['brighton and hove albion', 'brighton'],
  ['brighton hove albion', 'brighton'],
  ['coventry', 'coventry city'],
  ['hull', 'hull city'],
  ['ipswich', 'ipswich town'],
  ['leeds', 'leeds united'],
  ['liverpool fc', 'liverpool'],
  ['man city', 'manchester city'],
  ['man utd', 'manchester united'],
  ['newcastle', 'newcastle united'],
  ['nottingham', 'nottingham forest'],
  ['nottm forest', 'nottingham forest'],
  ['sunderland afc', 'sunderland'],
  ['tottenham hotspur', 'tottenham'],
]);

function normalizeTeam(name) {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+fc$/, '')
    .trim();
  return teamAliases.get(normalized) ?? normalized;
}

function getMovement(current, previous) {
  if (previous == null || current === previous) return 'unchanged';
  return current > previous ? 'drifting' : 'shortening';
}

function groupFixtures(rows) {
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
    fixture.bookmakers.push({
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
    });

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
          ROW_NUMBER() OVER (PARTITION BY odds.match_id ORDER BY odds.scraped_at DESC) AS position,
          LAG(odds.home_odds) OVER (PARTITION BY odds.match_id ORDER BY odds.scraped_at) AS previous_home_odds,
          LAG(odds.draw_odds) OVER (PARTITION BY odds.match_id ORDER BY odds.scraped_at) AS previous_draw_odds,
          LAG(odds.away_odds) OVER (PARTITION BY odds.match_id ORDER BY odds.scraped_at) AS previous_away_odds
        FROM odds_snapshots odds
      )
      SELECT
        bookmakers.slug AS bookmaker_slug,
        bookmakers.name AS bookmaker,
        competitions.name AS competition,
        competitions.country,
        matches.home_team,
        matches.away_team,
        matches.start_time_raw,
        matches.market_url,
        ranked_odds.scraped_at,
        ranked_odds.home_odds,
        ranked_odds.draw_odds,
        ranked_odds.away_odds,
        ranked_odds.previous_home_odds,
        ranked_odds.previous_draw_odds,
        ranked_odds.previous_away_odds
      FROM ranked_odds
      JOIN matches ON matches.id = ranked_odds.match_id
      JOIN bookmakers ON bookmakers.id = matches.bookmaker_id
      JOIN competitions ON competitions.id = matches.competition_id
      WHERE ranked_odds.position = 1
        AND competitions.sport = 'Soccer'
        AND competitions.country = 'England'
        AND competitions.name = 'Premier League'
      ORDER BY matches.home_team, bookmakers.name
    `);

    response.json({ fixtures: groupFixtures(rows) });
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