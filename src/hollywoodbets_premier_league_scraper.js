import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { saveScrapeResult } from './database.js';

const url = 'https://www.hollywoodbets.net/betting/1/soccer/all';
const competitionName = 'Premier League';
const tournamentId = '3092452';
const leagueUrl =
  `https://www.hollywoodbets.net/betting/1/soccer/all/248/england/` +
  `${tournamentId}/premier-league`;
const headless = process.env.HEADLESS !== 'false';

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const browser = await puppeteer.launch({
  headless,
  defaultViewport: { width: 1440, height: 1000 },
});

try {
  const page = await browser.newPage();
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });

  const competitionHandle = await page.waitForFunction(
    (label) =>
      [...document.querySelectorAll('p')].find(
        (element) => element.textContent?.trim() === label,
      ),
    { timeout: 30_000 },
    competitionName,
  );

  const competitionElement = competitionHandle.asElement();
  if (!competitionElement) {
    throw new Error(`Found "${competitionName}", but it is not an HTML element.`);
  }

  await competitionElement.scrollIntoView();
  await competitionElement.click();

  try {
    await page.waitForFunction(
      (id) => window.location.pathname.includes(`/${id}/premier-league`),
      { timeout: 5_000 },
      tournamentId,
    );
  } catch {
    await page.goto(leagueUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
  }

  await page.waitForFunction(
    (id) =>
      window.location.pathname.includes(`/${id}/premier-league`) &&
      document.querySelector('.event-name'),
    { timeout: 30_000 },
    tournamentId,
  );

  const apiUrl =
    `https://sport-events-api.hollywoodbets.net/api/events/eps/sports/1/` +
    `categories/248/tournaments/${tournamentId}/events?withBetTypeId=15&lang=en`;
  const rawEvents = await page.evaluate(async (endpoint) => {
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`Hollywoodbets events API returned HTTP ${response.status}.`);
    }

    const data = await response.json();
    return data.events;
  }, apiUrl);

  const events = rawEvents.flatMap((event) => {
    if (event.isOutright) {
      return [];
    }

    const teams = event.name.split(/\s+vs\s+/i);
    const fullTimeMarket = event.betTypes.find((betType) => betType.id === 15);
    const prices = Object.fromEntries(
      (fullTimeMarket?.markets ?? []).map((market) => [
        market.number,
        Number(market.odds) + 1,
      ]),
    );

    if (teams.length !== 2 || ![prices[1], prices[2], prices[3]].every(Number.isFinite)) {
      return [];
    }

    return [{
      eventId: String(event.id),
      homeTeam: teams[0].trim(),
      awayTeam: teams[1].trim(),
      startTime: event.startTime,
      odds: {
        home: prices[1],
        draw: prices[2],
        away: prices[3],
      },
      url: `${leagueUrl}/${event.id}/${slugify(event.name)}`,
    }];
  });

  if (events.length === 0) {
    throw new Error(`No ${competitionName} events were found.`);
  }

  const result = {
    bookmaker: 'Hollywoodbets',
    bookmakerSlug: 'hollywoodbets',
    sport: 'Soccer',
    country: 'England',
    competition: competitionName,
    scrapedAt: new Date().toISOString(),
    sourceUrl: page.url(),
    events,
  };

  await writeFile('hollywoodbets_odds.json', `${JSON.stringify(result, null, 2)}\n`);
  const savedToDatabase = await saveScrapeResult(result);
  console.log(JSON.stringify(result, null, 2));
  console.error(`Saved ${events.length} events to hollywoodbets_odds.json`);
  if (savedToDatabase) {
    console.error(`Saved ${events.length} odds snapshots to MySQL`);
  }
} finally {
  await browser.close();
}