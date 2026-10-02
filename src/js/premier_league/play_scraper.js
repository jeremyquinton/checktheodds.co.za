import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { saveScrapeResult } from '../database.js';

const url = 'https://play.co.za/sport/Soccer';
const competitionName = 'Premier League';
const competitionId = '538';
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

  const competitionHandle = await page.waitForFunction(
    (id) =>
      document.querySelector(`.competitionItem[data-competition-id="${id}"]`) ??
      document.querySelector(`[data-comp-id="${id}"]`),
    { timeout: 30_000 },
    competitionId,
  );

  const competitionElement = competitionHandle.asElement();
  if (!competitionElement) {
    throw new Error(`Could not find the visible ${competitionName} control.`);
  }

  await competitionElement.evaluate((element) => element.click());

  await page.waitForFunction(
    (id) =>
      window.location.pathname.endsWith(`/match/Soccer/England/${id}`) &&
      document.querySelector('.competitionGroup.expanded .gameRow'),
    { timeout: 30_000 },
    competitionId,
  );

  const events = await page.evaluate((label) => {
    const competition = [...document.querySelectorAll('.competitionGroup')]
      .find((group) => {
        const heading = group.querySelector('.competitionHeaderName');
        const region = group.querySelector('.competitionHeader > span:first-child');
        return heading?.textContent?.trim() === label &&
          region?.textContent?.trim() === 'England';
      });

    if (!competition) {
      return [];
    }

    return [...competition.querySelectorAll('.gameRow')].map((gameRow) => {
      const lines = gameRow.innerText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const date = lines.find((line) => /^\d{2}\/\d{2}$/.test(line));
      const time = lines.find((line) => /^\d{2}:\d{2}$/.test(line));

      const prices = Object.fromEntries(
        [...gameRow.querySelectorAll('.oddsBtn[data-event-name][data-price]')]
          .map((button) => [button.dataset.eventName, Number(button.dataset.price)]),
      );

      return {
        eventId: gameRow.dataset.gameId ?? null,
        homeTeam: gameRow.dataset.team1 ?? null,
        awayTeam: gameRow.dataset.team2 ?? null,
        startTime: date && time ? `${date} ${time}` : null,
        odds: {
          home: Number.isFinite(prices.W1) ? prices.W1 : null,
          draw: Number.isFinite(prices.Draw) ? prices.Draw : null,
          away: Number.isFinite(prices.W2) ? prices.W2 : null,
        },
        url: gameRow.dataset.gameId
          ? new URL(`/match/Soccer/${gameRow.dataset.gameId}`, window.location.origin).href
          : null,
      };
    });
  }, competitionName);

  if (events.length === 0) {
    throw new Error(`No ${competitionName} events were found.`);
  }

  const result = {
    bookmaker: 'Play.co.za',
    bookmakerSlug: 'play',
    sport: 'Soccer',
    country: 'England',
    competition: competitionName,
    scrapedAt: new Date().toISOString(),
    sourceUrl: page.url(),
    events,
  };

  await writeFile('play_odds.json', `${JSON.stringify(result, null, 2)}\n`);
  const savedToDatabase = await saveScrapeResult(result);
  console.log(JSON.stringify(result, null, 2));
  console.error(`Saved ${events.length} events to play_odds.json`);
  if (savedToDatabase) {
    console.error(`Saved ${events.length} odds snapshots to MySQL`);
  }
} finally {
  await browser.close();
}