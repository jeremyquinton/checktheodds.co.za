import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { saveScrapeResult } from './database.js';

const url = 'https://www.supersportbet.com/en-za/sports/football/england/premier-league/matches';
const competitionName = 'Premier League';
const headless = process.env.HEADLESS === 'true';

const browser = await puppeteer.launch({
  headless,
  defaultViewport: { width: 1440, height: 1200 },
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();

  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });

  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="matches"].bg-background-paper').length >= 5,
    { timeout: 45_000 },
  );

  await new Promise((resolve) => setTimeout(resolve, 2000));

  const events = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="matches"].bg-background-paper')];

    return rows.map((row) => {
      const link = row.querySelector('a[href]');
      const href = link?.getAttribute('href') ?? '';
      const absoluteUrl = href ? new URL(href, 'https://www.supersportbet.com').href : null;

      const teamNodes = [...row.querySelectorAll('a p, [data-testid="prematch-content-styles"] p')]
        .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);

      const homeTeam = teamNodes[0] ?? null;
      const awayTeam = teamNodes[1] ?? null;

      const timeNode = row.querySelector('[data-testid="match-stats-area"] p, [data-testid="typography-smallText--inherit"]');
      const startTime = timeNode ? (timeNode.textContent || '').trim() : null;

      const oddsButtons = [...row.querySelectorAll('button[data-testid="shared-selections-odd-button"]')]
        .map((button) => {
          const rawValue = (button.textContent || '').replace(/\s+/g, ' ').trim();
          const match = rawValue.match(/(\d+\.\d+)/);
          const parsed = match ? Number(match[1]) : null;
          return Number.isFinite(parsed) ? parsed : null;
        })
        .filter((value) => value !== null);

      const odds = { home: null, draw: null, away: null };

      if (oddsButtons.length >= 3) {
        odds.home = oddsButtons[0];
        odds.draw = oddsButtons[1];
        odds.away = oddsButtons[2];
      }

      return {
        eventId: href.match(/\/((?:\d+))\/[^/]+$/)?.[1] ?? null,
        homeTeam,
        awayTeam,
        startTime,
        odds,
        url: absoluteUrl,
      };
    }).filter((event) => event.homeTeam && event.awayTeam && event.odds.home !== null && event.odds.draw !== null && event.odds.away !== null);
  });

  if (events.length === 0) {
    throw new Error(`No ${competitionName} events were found.`);
  }

  const result = {
    bookmaker: 'SuperSport Bet',
    bookmakerSlug: 'supersportbet',
    sport: 'Soccer',
    country: 'England',
    competition: competitionName,
    scrapedAt: new Date().toISOString(),
    sourceUrl: page.url(),
    events,
  };

  await writeFile('supersportbet_odds.json', `${JSON.stringify(result, null, 2)}\n`);
  const savedToDatabase = await saveScrapeResult(result);

  console.log(JSON.stringify(result, null, 2));
  console.error(`Saved ${events.length} events to supersportbet_odds.json`);
  if (savedToDatabase) {
    console.error(`Saved ${events.length} odds snapshots to MySQL`);
  }
} finally {
  await browser.close();
}
