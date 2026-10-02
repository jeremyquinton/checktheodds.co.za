import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { saveScrapeResult } from '../database.js';

const url = 'https://new.supabets.co.za/sports';
const competitionName = 'Premier League';
const competitionId = '990625';
const oddsGroupId = '1433';
const marketId = '79117';
const headless = process.env.HEADLESS !== 'false';

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

  const sportsFrame = await page.waitForFrame(
    (frame) => frame.url().includes('/spa/sport/soccer/'),
    { timeout: 30_000 },
  );
  const competitionSelector = 'a[href$="/spa/sport/soccer/england/premier-league"]';
  await sportsFrame.waitForSelector(competitionSelector, { timeout: 30_000 });
  await sportsFrame.locator(competitionSelector).click();

  await sportsFrame.waitForFunction(
    () => window.location.pathname.endsWith('/soccer/england/premier-league'),
    { timeout: 30_000 },
  );

  const events = await sportsFrame.evaluate(async ({ leagueId, groupId, oddsMarketId }) => {
    const apiBase = 'https://apib2c.supabets.co.za/api/frontend';
    const initialResponse = await fetch(
      `${apiBase}/matches/1/section/leagues?n=1&league=${leagueId}` +
      `&oddsGroupId=${groupId}`,
    );
    if (!initialResponse.ok) {
      throw new Error(`Supabets matches API returned HTTP ${initialResponse.status}.`);
    }

    const initial = await initialResponse.json();
    const groups = await Promise.all(initial.events.map(async (eventGroup) => {
      if (eventGroup.matches) {
        return { matches: eventGroup.matches, odds: initial.odds };
      }

      const response = await fetch(
        `${apiBase}/matches/1/section/leagues/group/${eventGroup.id}` +
        `?m=${oddsMarketId}&league=${leagueId}&oddsGroupId=${groupId}`,
      );
      if (!response.ok) {
        return { matches: [], odds: {} };
      }
      return response.json();
    }));

    const readPrice = (odds, matchId, outcomeId) => {
      const handicapPrices = odds?.[matchId]?.[oddsMarketId]?.[outcomeId];
      const price = handicapPrices && Object.values(handicapPrices)[0]?.value;
      return Number(price);
    };
    const market = initial.markets.find((item) => String(item.id) === oddsMarketId);
    const outcomeIds = Object.fromEntries(
      (market?.options ?? []).map((option) => [option.name, String(option.id)]),
    );

    return groups.flatMap((group) => group.matches.flatMap((match) => {
      const prices = [
        readPrice(group.odds, match.id, outcomeIds['1']),
        readPrice(group.odds, match.id, outcomeIds.X),
        readPrice(group.odds, match.id, outcomeIds['2']),
      ];

      if (match.participants?.length !== 2 || !prices.every(Number.isFinite)) {
        return [];
      }

      return [{
        eventId: String(match.id),
        homeTeam: match.participants[0].name,
        awayTeam: match.participants[1].name,
        startTime: match.start,
        odds: {
          home: prices[0],
          draw: prices[1],
          away: prices[2],
        },
        url: new URL(`/${match.slug}`, window.location.origin).href,
      }];
    }));
  }, {
    leagueId: competitionId,
    groupId: oddsGroupId,
    oddsMarketId: marketId,
  });

  if (events.length === 0) {
    throw new Error(`No priced ${competitionName} events were found.`);
  }

  const result = {
    bookmaker: 'Supabets',
    bookmakerSlug: 'supabets',
    sport: 'Soccer',
    country: 'England',
    competition: competitionName,
    scrapedAt: new Date().toISOString(),
    sourceUrl: sportsFrame.url(),
    events,
  };

  await writeFile('supabets_odds.json', `${JSON.stringify(result, null, 2)}\n`);
  const savedToDatabase = await saveScrapeResult(result);
  console.log(JSON.stringify(result, null, 2));
  console.error(`Saved ${events.length} events to supabets_odds.json`);
  if (savedToDatabase) {
    console.error(`Saved ${events.length} odds snapshots to MySQL`);
  }
} finally {
  await browser.close();
}