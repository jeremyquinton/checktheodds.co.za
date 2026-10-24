import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { saveScrapeResult } from './database.js';

const url = 'https://play.sunbet.co.za/#sports-hub/football/england/premier_league';
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
    () => document.querySelectorAll('.KambiBC-standalone-match-card-base').length >= 10,
    { timeout: 45_000 },
  );

  await new Promise((resolve) => setTimeout(resolve, 2000));

  const events = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.KambiBC-standalone-match-card-base')];

    return cards.map((card) => {
      const link = card.closest('a.KambiBC-card-link');
      const href = link?.getAttribute('href') ?? '';

      const participantNames = [...card.querySelectorAll('.KambiBC-standalone-match-card-body-scoreboard__participant-name')]
        .map((node) => (node.textContent || '').trim())
        .filter(Boolean);

      const homeTeam = participantNames[0] ?? null;
      const awayTeam = participantNames[1] ?? null;

      const startDate = (card.querySelector('.KambiBC-standalone-match-card-header-right-prematch-day')?.textContent || '').trim();
      const startTime = (card.querySelector('.KambiBC-standalone-match-card-header-right-prematch-time')?.textContent || '').trim();

      const odds = { home: null, draw: null, away: null };
      const buttons = [...card.querySelectorAll('.KambiBC-standalone-match-card-outcome-button')];

      for (const button of buttons) {
        const buttonText = (button.textContent || '').replace(/\s+/g, ' ').trim();
        const outcomeMatch = buttonText.match(/^(.*?)(\d+\.\d+)$/);

        if (!outcomeMatch) {
          continue;
        }

        const outcomeLabel = outcomeMatch[1].trim();
        const price = Number(outcomeMatch[2]);

        if (!Number.isFinite(price)) {
          continue;
        }

        if (outcomeLabel === 'Draw') {
          odds.draw = price;
        } else if (homeTeam && outcomeLabel === homeTeam) {
          odds.home = price;
        } else if (awayTeam && outcomeLabel === awayTeam) {
          odds.away = price;
        }
      }

      return {
        eventId: href.match(/\/event\/([^/?#]+)/)?.[1] ?? null,
        homeTeam,
        awayTeam,
        startTime: startDate && startTime ? `${startDate} ${startTime}` : null,
        odds,
        url: href ? new URL(href, 'https://play.sunbet.co.za').href : null,
      };
    });
  });

  if (events.length === 0) {
    throw new Error(`No ${competitionName} events were found.`);
  }

  const result = {
    bookmaker: 'SunBet',
    bookmakerSlug: 'sunbet',
    sport: 'Soccer',
    country: 'England',
    competition: competitionName,
    scrapedAt: new Date().toISOString(),
    sourceUrl: page.url(),
    events,
  };

  await writeFile('sunbet_odds.json', `${JSON.stringify(result, null, 2)}\n`);
  const savedToDatabase = await saveScrapeResult(result);
  console.log(JSON.stringify(result, null, 2));
  console.error(`Saved ${events.length} events to sunbet_odds.json`);
  if (savedToDatabase) {
    console.error(`Saved ${events.length} odds snapshots to MySQL`);
  }
} finally {
  await browser.close();
}
