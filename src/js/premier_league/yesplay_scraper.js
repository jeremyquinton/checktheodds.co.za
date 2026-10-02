import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { saveScrapeResult } from '../database.js';

const url = 'https://yesplay.bet/sports/prematch/soccer/england-premier-league-17';
const competitionName = 'Premier League';
const headless = process.env.HEADLESS === 'true';

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

  await page.waitForSelector(
    '.scp-sports-event-row a[href^="/sports/events/"]',
    { timeout: 30_000 },
  );
  await page.waitForSelector(
    '.scp-sports-event-row .outcome-type-1 .odds',
    { timeout: 30_000 },
  );

  const events = await page.evaluate(() =>
    [...document.querySelectorAll('.scp-sports-event-row')].flatMap((eventRow) => {
      const eventLink = eventRow.querySelector('a[href^="/sports/events/"]');
      const href = eventLink?.getAttribute('href');
      const eventId = href?.match(/-(\d+)$/)?.[1];
      const teams = [...(eventLink?.querySelectorAll('span[itemprop="name"]') ?? [])]
        .map((element) => element.textContent?.trim())
        .filter(Boolean);
      const startTime = eventLink
        ?.querySelector('meta[itemprop="startDate"]')
        ?.getAttribute('content');
      const getPrice = (outcomeType) => Number(
        eventRow.querySelector(`.outcome-type-${outcomeType} .odds`)
          ?.textContent?.trim(),
      );
      const prices = [getPrice(1), getPrice(2), getPrice(3)];

      if (!href || !eventId || teams.length !== 2 || !startTime ||
          !prices.every(Number.isFinite)) {
        return [];
      }

      return [{
        eventId,
        homeTeam: teams[0],
        awayTeam: teams[1],
        startTime,
        odds: {
          home: prices[0],
          draw: prices[1],
          away: prices[2],
        },
        url: new URL(href, window.location.origin).href,
      }];
    }),
  );

  if (events.length === 0) {
    throw new Error(`No priced ${competitionName} events were found.`);
  }

  const result = {
    bookmaker: 'YesPlay',
    bookmakerSlug: 'yesplay',
    sport: 'Soccer',
    country: 'England',
    competition: competitionName,
    scrapedAt: new Date().toISOString(),
    sourceUrl: page.url(),
    events,
  };

  await writeFile('yesplay_odds.json', `${JSON.stringify(result, null, 2)}\n`);
  const savedToDatabase = await saveScrapeResult(result);
  console.log(JSON.stringify(result, null, 2));
  console.error(`Saved ${events.length} events to yesplay_odds.json`);
  if (savedToDatabase) {
    console.error(`Saved ${events.length} odds snapshots to MySQL`);
  }
} finally {
  await browser.close();
}