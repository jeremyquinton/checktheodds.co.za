import mysql from 'mysql2/promise';

export function getConnectionConfig() {
  if (process.env.MYSQL_URL) {
    return process.env.MYSQL_URL;
  }

  return {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'checktheodds',
  };
}

async function upsertLookup(connection, table, values) {
  const columns = Object.keys(values);
  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns
    .filter((column) => column !== 'slug' && column !== 'sport' && column !== 'country')
    .map((column) => `${column} = VALUES(${column})`)
    .concat('id = LAST_INSERT_ID(id)')
    .join(', ');

  const [result] = await connection.execute(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ` +
      `ON DUPLICATE KEY UPDATE ${updates}`,
    Object.values(values),
  );

  return result.insertId;
}

export async function saveScrapeResult(result) {
  if (process.env.SAVE_TO_DB === 'false') {
    return false;
  }

  const connection = await mysql.createConnection(getConnectionConfig());

  try {
    await connection.beginTransaction();

    const bookmakerId = await upsertLookup(connection, 'bookmakers', {
      slug: result.bookmakerSlug,
      name: result.bookmaker,
    });
    const competitionId = await upsertLookup(connection, 'competitions', {
      sport: result.sport,
      country: result.country,
      name: result.competition,
    });
    const scrapedAt = new Date(result.scrapedAt);

    for (const event of result.events) {
      const [matchResult] = await connection.execute(
        `INSERT INTO matches (
          bookmaker_id, competition_id, external_event_id, home_team, away_team,
          start_time_raw, market_url, source_url, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          home_team = VALUES(home_team),
          away_team = VALUES(away_team),
          start_time_raw = VALUES(start_time_raw),
          market_url = VALUES(market_url),
          source_url = VALUES(source_url),
          last_seen_at = VALUES(last_seen_at),
          id = LAST_INSERT_ID(id)`,
        [
          bookmakerId,
          competitionId,
          event.eventId,
          event.homeTeam,
          event.awayTeam,
          event.startTime,
          event.url ?? null,
          result.sourceUrl,
          scrapedAt,
          scrapedAt,
        ],
      );

      await connection.execute(
        `INSERT INTO odds_snapshots (
          match_id, scraped_at, home_odds, draw_odds, away_odds
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          matchResult.insertId,
          scrapedAt,
          event.odds.home,
          event.odds.draw,
          event.odds.away,
        ],
      );
    }

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

export async function saveInjuryScrapeResult(result) {
  if (process.env.SAVE_TO_DB === 'false') {
    return false;
  }

  const connection = await mysql.createConnection(getConnectionConfig());

  try {
    await connection.beginTransaction();
    const scrapedAt = new Date(result.scrapedAt);

    const [scrapeResult] = await connection.execute(
      `INSERT INTO premier_league_team_injuries (scraped_at, source_updated_at, source_url)
       VALUES (?, ?, ?)`,
      [scrapedAt, result.sourceUpdatedAt, result.sourceUrl],
    );

    for (const injury of result.injuries) {
      const teamId = await upsertLookup(connection, 'premier_league_teams', {
        name: injury.team,
      });

      await connection.execute(
        `INSERT INTO premier_league_player_injuries (
          injury_scrape_id, team_id, player_name, injury, latest_url
        ) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          injury = VALUES(injury),
          latest_url = VALUES(latest_url),
          id = LAST_INSERT_ID(id)`,
        [
          scrapeResult.insertId,
          teamId,
          injury.player,
          injury.injury,
          injury.latestUrl,
        ],
      );
    }

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}