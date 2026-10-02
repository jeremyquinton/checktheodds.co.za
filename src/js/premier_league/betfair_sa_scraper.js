import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { saveScrapeResult } from '../database.js';

const url = 'https://betfairsa.co.za/?route=%2Fcustomer%2Fsport%2F1%2F';
const competitionName = 'English Premier League';
const competitionId = '10932509';
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

  const exchangeFrame = await page.waitForFrame(
    (frame) => frame.url().startsWith('https://exchange.betfairsa.co.za/'),
    { timeout: 30_000 },
  );

  const competitionSelector =
    `a[data-sport-id="${competitionId}"], ` +
    `a[href="/customer/sport/1/competition/${competitionId}"]`;
  await exchangeFrame.waitForSelector(competitionSelector, { timeout: 30_000 });
  await exchangeFrame.locator(competitionSelector).click();

  await exchangeFrame.waitForSelector(
    '[role="row"][data-event-id][data-market-prices="true"]',
    { timeout: 30_000 },
  );
  await exchangeFrame.waitForSelector(
    '[role="row"][data-event-id] .biab_back-cell .biab_bet-odds',
    { timeout: 30_000 },
  );

  const events = await exchangeFrame.evaluate(() => {
    const eventDates = new Map();
    let currentDate = null;

    for (const item of document.querySelectorAll('#biab_navigationItems > li')) {
      if (item.classList.contains('biab_date-item')) {
        currentDate = item.textContent?.trim() ?? null;
        continue;
      }

      const eventId = item.getAttribute('data-navigation-id');
      if (currentDate && eventId && /^\d+$/.test(eventId)) {
        eventDates.set(eventId, currentDate);
      }
    }

    return [...document.querySelectorAll(
      '[role="row"][data-event-id][data-market-prices="true"]',
    )].flatMap((row) => {
      const eventId = row.dataset.eventId;
      const teams = [...row.querySelectorAll('[data-auto="runner_name"]')]
        .map((element) => element.textContent?.trim())
        .filter(Boolean);
      const prices = [...row.querySelectorAll('.biab_back-cell .biab_bet-odds')]
        .map((element) => Number(element.textContent?.trim()));
      const time = row.querySelector('[data-type="time"]')?.textContent?.trim();

        if (!eventId || teams.length !== 2 || !time || prices.length < 3 ||
          !prices.slice(0, 3).every(Number.isFinite)) {
        return [];
      }

      const route = `/customer/sport/1/event/${eventId}/`;
      return [{
        eventId,
        homeTeam: teams[0],
        awayTeam: teams[1],
        startTime: `${eventDates.get(eventId) ?? ''} ${time}`.trim(),
        odds: {
          home: prices[0],
          draw: prices[1],
          away: prices[2],
        },
        url: `https://betfairsa.co.za/?route=${encodeURIComponent(route)}`,
      }];
    });
  });

  if (events.length === 0) {
    throw new Error(`No priced ${competitionName} events were found.`);
  }

  const result = {
    bookmaker: 'Betfair South Africa',
    bookmakerSlug: 'betfair-sa',
    sport: 'Soccer',
    country: 'England',
    competition: 'Premier League',
    scrapedAt: new Date().toISOString(),
    sourceUrl: page.url(),
    events,
  };

  await writeFile('betfair_sa_odds.json', `${JSON.stringify(result, null, 2)}\n`);
  const savedToDatabase = await saveScrapeResult(result);
  console.log(JSON.stringify(result, null, 2));
  console.error(`Saved ${events.length} events to betfair_sa_odds.json`);
  if (savedToDatabase) {
    console.error(`Saved ${events.length} odds snapshots to MySQL`);
  }
} finally {
  await browser.close();
}