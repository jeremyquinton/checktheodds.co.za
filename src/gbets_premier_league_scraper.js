import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { saveScrapeResult } from './database.js';

const leagueUrl = 'https://www.gbets.co.za/sports/match/topLeague/Soccer/England/538';
const competitionName = 'Premier League';
const headless = process.env.HEADLESS === 'true';

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildStableEventId(homeTeam, awayTeam, dateText, timeText) {
  const base = [dateText, timeText, homeTeam, awayTeam].filter(Boolean).join('-');
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'gbets-match';
}

const browser = await puppeteer.launch({
  headless,
  defaultViewport: { width: 1440, height: 1200 },
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  );

  await page.goto(leagueUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });

  await page.waitForFunction(
    () => document.querySelectorAll('.sportsbook-game-list-wrapper__games a[data-testid="game"]').length >= 1 || document.querySelectorAll('ul.multi-column-content').length >= 1 || document.querySelectorAll('.xOddButton__coef').length >= 3,
    { timeout: 60_000 },
  );

  await new Promise((resolve) => setTimeout(resolve, 2000));

  const events = await page.evaluate(() => {
    const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const buildStableEventId = (homeTeam, awayTeam, dateText, timeText) => {
      const base = [dateText, timeText, homeTeam, awayTeam].filter(Boolean).join('-');
      return base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'gbets-match';
    };

    const parseFixtureCard = (gameLink, groupDate) => {
      const teamNames = [...gameLink.querySelectorAll('.comp__team-name')]
        .map((node) => normalizeText(node.textContent))
        .filter(Boolean)
        .slice(0, 2);

      const oddsValues = [...gameLink.querySelectorAll('.xOddButton__coef')]
        .map((node) => Number(normalizeText(node.textContent)))
        .filter((value) => Number.isFinite(value))
        .slice(0, 3);

      const timeText = normalizeText(
        gameLink.querySelector('.col_time span')?.textContent
          || gameLink.querySelector('.col_time')?.textContent,
      );

      const href = gameLink.getAttribute('href') || '';
      const hrefId = href.split('/').filter(Boolean).pop();

      if (teamNames.length < 2 || oddsValues.length < 3) {
        return null;
      }

      const homeTeam = teamNames[0];
      const awayTeam = teamNames[1];
      const startTime = timeText ? [groupDate, timeText].filter(Boolean).join(' ') : groupDate;

      return {
        eventId: hrefId || buildStableEventId(homeTeam, awayTeam, groupDate, timeText),
        homeTeam,
        awayTeam,
        startTime,
        odds: {
          home: oddsValues[0],
          draw: oddsValues[1],
          away: oddsValues[2],
        },
        url: `${window.location.origin}${href || ''}`,
      };
    };

    const dayGroups = [...document.querySelectorAll('.sportsbook-game-list-wrapper__games .v3-event-collapse, .sportsbook-game-list-wrapper__games .style__Wrapper-sc-15ajotn-0.v3-event-collapse')];
    const directGames = [...document.querySelectorAll('.sportsbook-game-list-wrapper__games a[data-testid="game"]')];

    if (directGames.length > 0) {
      return directGames
        .map((gameLink) => {
          const group = gameLink.closest('.v3-event-collapse');
          const groupDate = normalizeText(
            group?.querySelector('[data-testid="event-title"] .sportsbook-game__name')?.textContent,
          );
          return parseFixtureCard(gameLink, groupDate);
        })
        .filter(Boolean);
    }

    const legacyRows = [...document.querySelectorAll('ul.multi-column-content')];
    const legacyEvents = legacyRows.map((row) => {
      const teamNodes = [...row.querySelectorAll('.multi-column-single-team p')]
        .map((node) => normalizeText(node.textContent))
        .filter(Boolean);

      if (teamNodes.length < 2) return null;

      const dateContainer = row.closest('.competition-bc')?.querySelector('time.c-title-bc');
      const dateText = normalizeText(dateContainer?.textContent);
      const timeText = normalizeText(row.querySelector('.multi-column-time-icon time')?.textContent);

      const winnerOdds = [...row.querySelectorAll('li:nth-of-type(2) .market-odd-bc')]
        .map((node) => Number(normalizeText(node.textContent)))
        .filter((value) => Number.isFinite(value));

      if (winnerOdds.length < 3) return null;

      const homeTeam = teamNodes[0];
      const awayTeam = teamNodes[1];
      const startTime = [dateText, timeText].filter(Boolean).join(' ');

      return {
        eventId: buildStableEventId(homeTeam, awayTeam, dateText, timeText),
        homeTeam,
        awayTeam,
        startTime,
        odds: {
          home: winnerOdds[0],
          draw: winnerOdds[1],
          away: winnerOdds[2],
        },
        url: window.location.href,
      };
    }).filter(Boolean);

    if (legacyEvents.length > 0) {
      return legacyEvents;
    }

    return dayGroups.flatMap((group) => {
      const groupDate = normalizeText(group.querySelector('[data-testid="event-title"] .sportsbook-game__name')?.textContent);
      const gameLinks = [...group.querySelectorAll('a[data-testid="game"]')];

      return gameLinks
        .map((gameLink) => parseFixtureCard(gameLink, groupDate))
        .filter(Boolean);
    });
  });

  if (events.length === 0) {
    throw new Error(`No ${competitionName} events were found on the GBets page.`);
  }

  const result = {
    bookmaker: 'GBets',
    bookmakerSlug: 'gbets',
    sport: 'Soccer',
    country: 'England',
    competition: competitionName,
    scrapedAt: new Date().toISOString(),
    sourceUrl: page.url(),
    events,
  };

  await writeFile('gbets_odds.json', `${JSON.stringify(result, null, 2)}\n`);
  const savedToDatabase = await saveScrapeResult(result);

  console.log(JSON.stringify(result, null, 2));
  console.error(`Saved ${events.length} events to gbets_odds.json`);
  if (savedToDatabase) {
    console.error(`Saved ${events.length} odds snapshots to MySQL`);
  }
} finally {
  await browser.close();
}
