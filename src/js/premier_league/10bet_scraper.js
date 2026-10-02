import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { saveScrapeResult } from '../database.js';

const url = 'https://www.10bet.co.za/sports/football/england-premier-league/';
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

  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-testid="widget.events.line.row"]')]
      .some((row) => {
        const teams = row.querySelector('[data-testid="line.row.participants"]');
        const selections = [...row.querySelectorAll('[data-testid="odds.line.selection"]')];
        return teams?.children.length === 2 && selections.slice(0, 3).every((selection, index) =>
          selection.children[0]?.textContent?.trim() === ['1', 'X', '2'][index] &&
          /^\d+(?:\.\d+)?$/.test(selection.children[1]?.textContent?.trim() ?? ''),
        );
      }),
    { timeout: 45_000 },
  );

  const events = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="widget.events.line.row"]')].flatMap((row) => {
      const participants = row.querySelector('[data-testid="line.row.participants"]');
      const teams = [...(participants?.children ?? [])]
        .map((participant) => participant.textContent?.trim())
        .filter(Boolean);
      const startTime = row
        .querySelector('[data-testid="event.phase.date"]')
        ?.textContent?.trim();
      const selections = [...row.querySelectorAll('[data-testid="odds.line.selection"]')]
        .slice(0, 3)
        .map((selection) => [...selection.children].map((child) => child.textContent?.trim()));

      if (
        teams.length !== 2 ||
        !startTime ||
        selections.length !== 3 ||
        selections.some((selection, index) =>
          selection[0] !== ['1', 'X', '2'][index] ||
          !/^\d+(?:\.\d+)?$/.test(selection[1] ?? ''),
        )
      ) {
        return [];
      }

      const eventId = `10bet-${[...teams, startTime]
        .join('-')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}`;

      return [{
        eventId,
        homeTeam: teams[0],
        awayTeam: teams[1],
        startTime,
        odds: {
          home: Number(selections[0][1]),
          draw: Number(selections[1][1]),
          away: Number(selections[2][1]),
        },
        url: window.location.href,
      }];
    }),
  );

  if (events.length === 0) {
    throw new Error(`No priced ${competitionName} events were found.`);
  }

  const result = {
    bookmaker: '10Bet',
    bookmakerSlug: '10bet',
    sport: 'Soccer',
    country: 'England',
    competition: competitionName,
    scrapedAt: new Date().toISOString(),
    sourceUrl: page.url(),
    events,
  };

  await writeFile('10bet_odds.json', `${JSON.stringify(result, null, 2)}\n`);
  const savedToDatabase = await saveScrapeResult(result);
  console.log(JSON.stringify(result, null, 2));
  console.error(`Saved ${events.length} events to 10bet_odds.json`);
  if (savedToDatabase) {
    console.error(`Saved ${events.length} odds snapshots to MySQL`);
  }
} finally {
  await browser.close();
}