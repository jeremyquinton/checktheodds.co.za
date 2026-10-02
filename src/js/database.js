import mysql from 'mysql2/promise';

const premierLeagueTeamAliases = new Map([
  ['brighton', 'brighton and hove albion'],
  ['brighton hove albion', 'brighton and hove albion'],
  ['coventry', 'coventry city'],
  ['hull', 'hull city'],
  ['ipswich', 'ipswich town'],
  ['leeds', 'leeds united'],
  ['man city', 'manchester city'],
  ['man utd', 'manchester united'],
  ['manchester utd', 'manchester united'],
  ['newcastle', 'newcastle united'],
  ['nottingham', 'nottingham forest'],
  ['nott m forest', 'nottingham forest'],
  ['nottm forest', 'nottingham forest'],
  ['spurs', 'tottenham hotspur'],
  ['tottenham', 'tottenham hotspur'],
  ['west ham', 'west ham united'],
  ['wolves', 'wolverhampton wanderers'],
]);

export function normalizePremierLeagueTeamName(name) {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:afc|fc)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return premierLeagueTeamAliases.get(normalized) ?? normalized;
}

function fixtureKey(homeTeam, awayTeam) {
  return `${normalizePremierLeagueTeamName(homeTeam)}::${normalizePremierLeagueTeamName(awayTeam)}`;
}

const kickoffToleranceMs = 3 * 60 * 60 * 1000;
const monthNumbers = new Map([
  ['jan', 1], ['january', 1],
  ['feb', 2], ['february', 2],
  ['mar', 3], ['march', 3],
  ['apr', 4], ['april', 4],
  ['may', 5],
  ['jun', 6], ['june', 6],
  ['jul', 7], ['july', 7],
  ['aug', 8], ['august', 8],
  ['sep', 9], ['september', 9],
  ['oct', 10], ['october', 10],
  ['nov', 11], ['november', 11],
  ['dec', 12], ['december', 12],
]);

function makeUtcTimestamp(year, month, day, hour, minute, second = 0) {
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return timestamp;
}

function parseCanonicalKickoff(kickoff) {
  const match = kickoff?.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return match
    ? makeUtcTimestamp(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0))
    : null;
}

function parseBookmakerKickoff(kickoff, canonicalTimestamp) {
  if (typeof kickoff !== 'string' || kickoff.trim() === '') return null;
  const value = kickoff.trim();

  if (/^\d{4}-\d{2}-\d{2}T/.test(value) && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  const yearFirst = value.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (yearFirst) {
    return makeUtcTimestamp(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]), Number(yearFirst[4]), Number(yearFirst[5]), Number(yearFirst[6] ?? 0));
  }

  const numericDate = value.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s+(\d{1,2}):(\d{2})\b/);
  const namedDate = value.match(/\b(\d{1,2})\s+([A-Za-z]+)\s*(?:-|,)?\s*(\d{1,2}):(\d{2})\b/);
  let day;
  let month;
  let year;
  let hour;
  let minute;

  if (numericDate) {
    day = Number(numericDate[1]);
    month = Number(numericDate[2]);
    year = numericDate[3] ? Number(numericDate[3]) : null;
    hour = Number(numericDate[4]);
    minute = Number(numericDate[5]);
    if (year !== null && year < 100) year += 2000;
  } else if (namedDate) {
    day = Number(namedDate[1]);
    month = monthNumbers.get(namedDate[2].toLowerCase());
    year = null;
    hour = Number(namedDate[3]);
    minute = Number(namedDate[4]);
  } else {
    return null;
  }

  if (!month) return null;
  if (year !== null) return makeUtcTimestamp(year, month, day, hour, minute);

  const canonicalYear = new Date(canonicalTimestamp).getUTCFullYear();
  return [canonicalYear - 1, canonicalYear, canonicalYear + 1]
    .map(candidateYear => makeUtcTimestamp(candidateYear, month, day, hour, minute))
    .filter(Number.isFinite)
    .sort((left, right) => Math.abs(left - canonicalTimestamp) - Math.abs(right - canonicalTimestamp))[0] ?? null;
}

function matchEventsToFixtures(events, fixtures) {
  const fixturesByTeams = new Map();
  for (const fixture of fixtures) {
    const key = fixtureKey(fixture.home_team, fixture.away_team);
    const candidates = fixturesByTeams.get(key) ?? [];
    candidates.push(fixture);
    fixturesByTeams.set(key, candidates);
  }

  const mappedEvents = [];
  const unmatchedEvents = [];
  for (const event of events) {
    const candidates = fixturesByTeams.get(fixtureKey(event.homeTeam, event.awayTeam)) ?? [];
    const kickoffMatches = candidates.flatMap((fixture) => {
      const canonicalTimestamp = parseCanonicalKickoff(fixture.kickoff_local);
      const bookmakerTimestamp = parseBookmakerKickoff(event.startTime ?? event.kickoff, canonicalTimestamp);
      if (canonicalTimestamp === null || bookmakerTimestamp === null) return [];
      return [{
        fixture,
        differenceMs: Math.abs(canonicalTimestamp - bookmakerTimestamp),
      }];
    });
    const exactCandidates = kickoffMatches.filter(candidate => candidate.differenceMs <= kickoffToleranceMs);

    if (exactCandidates.length === 1) {
      mappedEvents.push({ ...event, premierLeagueMatchId: exactCandidates[0].fixture.premier_league_match_id });
      continue;
    }

    const nearest = kickoffMatches
      .sort((left, right) => left.differenceMs - right.differenceMs)
      .slice(0, 3)
      .map(({ fixture, differenceMs }) => ({
        externalMatchId: fixture.external_match_id,
        kickoff: fixture.kickoff_local,
        differenceMinutes: Math.round(differenceMs / 60_000),
      }));
    unmatchedEvents.push({
      event,
      reason: candidates.length === 0
        ? 'no upcoming fixture with this home/away team pair'
        : exactCandidates.length > 1
          ? 'multiple fixtures fell within the kickoff tolerance'
          : kickoffMatches.length === 0
            ? 'bookmaker or canonical kickoff could not be parsed'
            : 'kickoff was outside the three-hour tolerance',
      candidates: nearest,
    });
  }

  return { mappedEvents, unmatchedEvents };
}

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
    const [fixtures] = await connection.query(`
      WITH current_season AS (
        SELECT MAX(season) AS season
        FROM premier_league_matches
        WHERE period = 'PreMatch'
      ), upcoming_matchweeks AS (
        SELECT matches.matchweek, MIN(matches.kickoff) AS first_kickoff
        FROM premier_league_matches matches
        JOIN current_season ON current_season.season = matches.season
        WHERE matches.period = 'PreMatch'
          AND DATE(matches.kickoff) >= UTC_DATE()
        GROUP BY matches.matchweek
        ORDER BY first_kickoff
        LIMIT 2
      )
      SELECT
        matches.id AS premier_league_match_id,
        matches.external_match_id,
        DATE_FORMAT(matches.kickoff, '%Y-%m-%d %H:%i:%s') AS kickoff_local,
        home_team.name AS home_team,
        away_team.name AS away_team
      FROM premier_league_matches matches
      JOIN upcoming_matchweeks ON upcoming_matchweeks.matchweek = matches.matchweek
      JOIN premier_league_teams home_team ON home_team.id = matches.home_team_id
      JOIN premier_league_teams away_team ON away_team.id = matches.away_team_id
      JOIN current_season ON current_season.season = matches.season
      WHERE matches.period = 'PreMatch'
        AND DATE(matches.kickoff) >= UTC_DATE()
      ORDER BY matches.kickoff, matches.id
    `);
    const { mappedEvents, unmatchedEvents } = matchEventsToFixtures(result.events, fixtures);

    for (const { event, reason, candidates } of unmatchedEvents) {
      console.error(JSON.stringify({
        type: 'unmatched_premier_league_fixture',
        bookmaker: result.bookmaker,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        bookmakerKickoff: event.startTime ?? event.kickoff ?? null,
        reason,
        candidates,
      }));
    }
    if (mappedEvents.length === 0) {
      throw new Error(`No ${result.bookmaker} events matched the next two Premier League matchweeks.`);
    }

    const scrapedAt = new Date(result.scrapedAt);

    for (const event of mappedEvents) {
      await connection.execute(
        `INSERT INTO premier_league_odds_snapshots (
          premier_league_match_id, bookmaker_id, bookmaker_event_id, scraped_at,
          home_odds, draw_odds, away_odds, market_url, source_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          bookmaker_event_id = VALUES(bookmaker_event_id),
          home_odds = VALUES(home_odds),
          draw_odds = VALUES(draw_odds),
          away_odds = VALUES(away_odds),
          market_url = VALUES(market_url),
          source_url = VALUES(source_url)`,
        [
          event.premierLeagueMatchId,
          bookmakerId,
          event.eventId,
          scrapedAt,
          event.odds.home,
          event.odds.draw,
          event.odds.away,
          event.url ?? null,
          result.sourceUrl,
        ],
      );
    }

    if (unmatchedEvents.length > 0) {
      console.error(`Mapped ${mappedEvents.length} of ${result.events.length} ${result.bookmaker} events.`);
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