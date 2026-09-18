import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { saveScrapeResult } from './database.js';

const url = 'https://www.betway.co.za/sport/soccer/highlights';
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

  const competitionHandle = await page.waitForFunction(
    (label) =>
      [...document.querySelectorAll('strong')].find(
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

  await page.waitForFunction(
    () =>
      window.location.search.includes('selectedLeagues=england_premier-league') &&
      document.querySelector(
        'a[href*="/event/soccer/england/premier-league/"][href*="eventId="]',
      ),
    { timeout: 30_000 },
  );

  const events = await page.evaluate(() => {
    const eventLinks = [...document.querySelectorAll(
      'a[href*="/event/soccer/england/premier-league/"][href*="eventId="]',
    )].filter((link) => link.querySelectorAll('strong').length === 2);

    const eventsById = new Map();

    for (const eventLink of eventLinks) {
      const eventUrl = new URL(eventLink.getAttribute('href'), window.location.origin);
      const eventId = eventUrl.searchParams.get('eventId');
      if (!eventId || eventsById.has(eventId)) {
        continue;
      }

      const eventCard = eventLink.parentElement;
      const teams = [...eventLink.querySelectorAll('strong')]
        .map((team) => team.textContent?.trim())
        .filter(Boolean);

      const oddsContainer = [...(eventCard?.children ?? [])].find((child) => {
        const numericValues = [...child.querySelectorAll('*')]
          .filter((element) => element.children.length === 0)
          .map((element) => element.textContent?.trim())
          .filter((text) => /^\d+\.\d+$/.test(text ?? ''));

        return numericValues.length >= 3;
      });

      const prices = [...(oddsContainer?.querySelectorAll('*') ?? [])]
        .filter((element) => element.children.length === 0)
        .map((element) => element.textContent?.trim())
        .filter((text) => /^\d+\.\d+$/.test(text ?? ''))
        .map(Number)
        .slice(0, 3);

      const eventText = eventCard?.innerText ?? '';
      const startTime = eventText.match(
        /\b\d{1,2}\s+[A-Za-z]{3}\s+-\s+\d{2}:\d{2}\b/,
      )?.[0];

      eventsById.set(eventId, {
        eventId,
        homeTeam: teams[0] ?? null,
        awayTeam: teams[1] ?? null,
        startTime: startTime ?? null,
        odds: {
          home: prices[0] ?? null,
          draw: prices[1] ?? null,
          away: prices[2] ?? null,
        },
        url: eventUrl.href,
      });
    }

    return [...eventsById.values()];
  });

  if (events.length === 0) {
    throw new Error(`No ${competitionName} events were found.`);
  }

  const result = {
    bookmaker: 'Betway',
    bookmakerSlug: 'betway',
    sport: 'Soccer',
    country: 'England',
    competition: competitionName,
    scrapedAt: new Date().toISOString(),
    sourceUrl: page.url(),
    events,
  };

  await writeFile('betway_odds.json', `${JSON.stringify(result, null, 2)}\n`);
  const savedToDatabase = await saveScrapeResult(result);
  console.log(JSON.stringify(result, null, 2));
  console.error(`Saved ${events.length} events to betway_odds.json`);
  if (savedToDatabase) {
    console.error(`Saved ${events.length} odds snapshots to MySQL`);
  }
} finally {
  await browser.close();
}