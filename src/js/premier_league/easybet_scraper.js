import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { saveScrapeResult } from '../database.js';

const url = 'https://easybet.co.za/sports/match/football/england/premier-league';
const competitionName = 'Premier League';
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

  const sportsbookFrame = await page.waitForFrame(
    (frame) => frame.url().includes('sportsbook.adv.bet'),
    { timeout: 30_000 },
  );

  await sportsbookFrame.waitForFunction(
    () => [...document.querySelectorAll('.event-item-container')].some((eventCard) => {
      const prices = [...eventCard.querySelectorAll('*')]
        .filter((element) => element.children.length === 0)
        .map((element) => element.textContent?.trim())
        .filter((text) => /^\d+\.\d{2}$/.test(text ?? ''));

      return prices.length >= 3;
    }),
    { timeout: 45_000 },
  );

  const events = await sportsbookFrame.evaluate(() =>
    [...document.querySelectorAll('.event-item-container')].flatMap((eventCard) => {
      const eventLink = eventCard.querySelector(
        'a[href*="/match/football/england/premier-league/"]',
      );
      const href = eventLink?.getAttribute('href');
      const eventId = href?.match(/-(\d+)(?:[/?#]|$)/)?.[1];
      const teams = [...eventCard.querySelectorAll('.event-info__teams [title]')]
        .map((element) => element.getAttribute('title')?.trim())
        .filter(Boolean);
      const startTime = eventCard
        .querySelector('.event-info')
        ?.innerText.match(/\b\d{1,2}\s+[A-Za-z]{3},\s+\d{2}:\d{2}\b/)?.[0];
      const prices = [...eventCard.querySelectorAll('*')]
        .filter((element) => element.children.length === 0)
        .map((element) => element.textContent?.trim())
        .filter((text) => /^\d+\.\d{2}$/.test(text ?? ''))
        .map(Number)
        .slice(0, 3);

      if (!href || !eventId || teams.length !== 2 || !startTime ||
          prices.length !== 3 || !prices.every(Number.isFinite)) {
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
    bookmaker: 'Easybet',
    bookmakerSlug: 'easybet',
    sport: 'Soccer',
    country: 'England',
    competition: competitionName,
    scrapedAt: new Date().toISOString(),
    sourceUrl: page.url(),
    events,
  };

  await writeFile('easybet_odds.json', `${JSON.stringify(result, null, 2)}\n`);
  const savedToDatabase = await saveScrapeResult(result);
  console.log(JSON.stringify(result, null, 2));
  console.error(`Saved ${events.length} events to easybet_odds.json`);
  if (savedToDatabase) {
    console.error(`Saved ${events.length} odds snapshots to MySQL`);
  }
} finally {
  await browser.close();
}