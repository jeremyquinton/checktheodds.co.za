import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { saveScrapeResult } from '../database.js';

const url = 'https://www.virginbet.co.za/sports/soccer/popular/SBTC1_1/';
const competitionName = 'Premier League';
const headless = process.env.HEADLESS !== 'false';

function normalizeStartTime(value, scrapedAt) {
  if (typeof value !== 'string') {
    return null;
  }

  const absoluteDate = value.match(/\b\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}\b/);
  if (absoluteDate) {
    return absoluteDate[0];
  }

  const relativeDate = value.match(/^(Today|Tomorrow),?\s+(\d{1,2}):(\d{2})$/i);
  if (!relativeDate) {
    return null;
  }

  const dateParts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Johannesburg',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(scrapedAt).map(({ type, value: part }) => [type, part]),
  );
  const eventDate = new Date(Date.UTC(
    Number(dateParts.year),
    Number(dateParts.month) - 1,
    Number(dateParts.day) + Number(relativeDate[1].toLowerCase() === 'tomorrow'),
  ));
  const pad = (part) => String(part).padStart(2, '0');

  return `${eventDate.getUTCFullYear()}-${pad(eventDate.getUTCMonth() + 1)}-${pad(eventDate.getUTCDate())} ${pad(relativeDate[2])}:${relativeDate[3]}`;
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
      [...document.querySelectorAll('div')].find(
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

  await page.waitForSelector(
    '[id^="SBTE_"] a[href*="/england-premier-league/"]',
    { timeout: 30_000 },
  );

  const scrapedEvents = await page.evaluate(() => {
    const eventCards = [...document.querySelectorAll('[id^="SBTE_"]')];

    return eventCards.flatMap((eventCard) => {
      const eventLink = eventCard.querySelector(
        'a[href*="/england-premier-league/"]',
      );
      if (!eventLink) {
        return [];
      }

      const teamNames = [...eventCard.querySelectorAll('img[src*="/team-kit-"]')]
        .map((image) => {
          const teamRow = image.parentElement;
          return [...(teamRow?.children ?? [])]
            .find(
              (child) =>
                child.tagName === 'DIV' &&
                child.textContent?.trim() &&
                !/^\d+$/.test(child.textContent.trim()),
            )
            ?.textContent?.trim();
        })
        .filter(Boolean);

      const prices = [...eventCard.querySelectorAll('button')]
        .map((button) => Number(button.textContent?.trim()))
        .filter(Number.isFinite)
        .slice(0, 3);

      const eventContainer = eventCard.parentElement;
      const startTime = [...(eventContainer?.querySelectorAll('span') ?? [])]
        .map((span) => span.textContent?.trim())
        .find((text) =>
          /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(text ?? '') ||
          /^(Today|Tomorrow),?\s+\d{1,2}:\d{2}$/i.test(text ?? ''));

      const broadcast = [...(eventContainer?.querySelectorAll('span') ?? [])]
        .map((span) => span.textContent?.trim())
        .find((text) => text && text !== startTime && !/^\d+(\.\d+)?$/.test(text));

      return [{
        eventId: eventCard.id,
        homeTeam: teamNames[0] ?? null,
        awayTeam: teamNames[1] ?? null,
        startTime: startTime ?? null,
        broadcast: broadcast ?? null,
        odds: {
          home: prices[0] ?? null,
          draw: prices[1] ?? null,
          away: prices[2] ?? null,
        },
        url: new URL(eventLink.getAttribute('href'), window.location.origin).href,
      }];
    });
  });
  const scrapedAt = new Date();
  const events = scrapedEvents.flatMap((event) => {
    const startTime = normalizeStartTime(event.startTime, scrapedAt);
    return startTime ? [{ ...event, startTime }] : [];
  });

  if (events.length === 0) {
    throw new Error(`No ${competitionName} events were found.`);
  }

  const result = {
    bookmaker: 'Virgin Bet',
    bookmakerSlug: 'virgin-bet',
    sport: 'Soccer',
    country: 'England',
    competition: competitionName,
    scrapedAt: scrapedAt.toISOString(),
    sourceUrl: page.url(),
    events,
  };

  await writeFile('odds.json', `${JSON.stringify(result, null, 2)}\n`);
  const savedToDatabase = await saveScrapeResult(result);
  console.log(JSON.stringify(result, null, 2));
  console.error(`Saved ${events.length} events to odds.json`);
  if (savedToDatabase) {
    console.error(`Saved ${events.length} odds snapshots to MySQL`);
  }
} finally {
  await browser.close();
}