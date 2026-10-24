import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { saveScrapeResult } from './database.js';

const leagueUrl = 'https://betfred.co.za/sports/match/football/england/premier-league';
const leagueNavigatorUrl = 'https://betfred.co.za/sports';
const competitionName = 'Premier League';
const headless = process.env.HEADLESS !== 'false';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getDomSummary() {
  return {
    currentUrl: window.location.href,
    title: document.title,
    eventListCount: document.querySelectorAll('.event-list-container').length,
    eventItemCount: document.querySelectorAll('.event-item-container').length,
    eventTeamsCount: document.querySelectorAll('.event-info__teams').length,
    eventTimeCount: document.querySelectorAll('.event-info__time').length,
    bidOptionCount: document.querySelectorAll('.bid-option').length,
    optionOddsCurrentCount: document.querySelectorAll('.option-odds-current').length,
    hasPremierLeagueText: /premier league/i.test(document.body.innerText || ''),
    premierLeagueNavLinks: [...document.querySelectorAll('a[href]')]
      .map((link) => ({
        text: (link.textContent || '').trim(),
        href: (link.href || '').trim(),
      }))
      .filter((link) => /premier league|football|match/i.test(`${link.text} ${link.href}`))
      .slice(0, 12),
  };
}

function parseBetfredEventsFromDom(rootDocument) {
  const rows = [...rootDocument.querySelectorAll('.event-list-container .event-item-container')];
  const uniqueRows = [];
  const seen = new Set();

  for (const row of rows) {
    const key = row.getAttribute('data-v-c88ebd03') || row.outerHTML.slice(0, 220);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueRows.push(row);
    }
  }

  return uniqueRows.map((row) => {
    const link = row.querySelector('a[href]');
    const href = link?.href || '';
    const teamNodes = [...row.querySelectorAll('.event-info__teams span')]
      .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const homeTeam = teamNodes[0] ?? null;
    const awayTeam = teamNodes[1] ?? null;
    const startTime = row.querySelector('.event-info__time')?.textContent?.replace(/\s+/g, ' ').trim() || null;
    const oddsDigits = [...row.querySelectorAll('.bid-option .option-odds-current div, .bid-option .option-value .option-odds-current div')]
      .map((node) => {
        const value = (node.textContent || '').replace(/\s+/g, ' ').trim();
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      })
      .filter((value) => value !== null)
      .slice(0, 3);

    if (oddsDigits.length < 3 || !homeTeam || !awayTeam) {
      return null;
    }

    const odds = {
      home: oddsDigits[0],
      draw: oddsDigits[1],
      away: oddsDigits[2],
    };

    const suffixMatch = href.match(/-(\d+)(?:[/?#]|$)/);
    const eventCodeText = row.querySelector('.event-info__event-code')?.textContent || '';
    const eventCodeMatch = eventCodeText.match(/(\d+)\s*\|/);
    const eventId = suffixMatch?.[1] || eventCodeMatch?.[1] || null;

    return {
      eventId: eventId ? Number(eventId) : null,
      homeTeam,
      awayTeam,
      startTime,
      odds,
      url: href || null,
    };
  }).filter((event) => event && event.homeTeam && event.awayTeam && event.odds.home && event.odds.draw && event.odds.away);
}

async function clickBestMatch(page, selectors) {
  for (const selector of selectors) {
    const candidate = await page.$(selector);
    if (!candidate) continue;
    await candidate.click();
    await wait(2000);
    return true;
  }

  return false;
}

async function navigateToPremierLeague(page) {
  const directCandidates = [leagueUrl, leagueNavigatorUrl, 'https://betfred.co.za/'];

  for (const url of directCandidates) {
    try {
      console.log(`BetFred: loading ${url}`);
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await wait(2500);

      const realRows = await page.evaluate(() => document.querySelectorAll('.event-list-container .event-item-container').length);
      if (realRows >= 3) {
        console.log(`BetFred: found ${realRows} events on ${page.url()}`);
        return true;
      }

      const summary = await page.evaluate(getDomSummary);
      console.warn(`BetFred: DOM summary for ${url}: ${JSON.stringify(summary)}`);
    } catch (error) {
      console.warn(`BetFred: failed to load ${url}: ${error.message}`);
    }
  }

  console.log('BetFred: falling back to the site navigation links');
  await page.goto('https://betfred.co.za/', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  const clickPremierLeagueLink = async () => {
    const clicked = await page.evaluate(() => {
      const anchors = [...document.querySelectorAll('a[href]')];
      const match = anchors.find((anchor) => {
        const href = (anchor.href || '').toLowerCase();
        const text = (anchor.textContent || '').trim().toLowerCase();
        return href.includes('/sports/match/football/england/premier-league')
          || (href.includes('/sports/match/football') && /premier league/i.test(text));
      });

      if (!match) return false;
      match.click();
      return true;
    });

    if (!clicked) return false;
    await wait(5000);
    return true;
  };

  const navigated = await clickPremierLeagueLink();
  if (!navigated) {
    console.warn('BetFred: no Premier League navigation link matched the known DOM contract');
    const summary = await page.evaluate(getDomSummary);
    console.warn(`BetFred: fallback summary: ${JSON.stringify(summary)}`);
    return false;
  }

  const finalRowCount = await page.evaluate(() => document.querySelectorAll('.event-list-container .event-item-container').length);
  console.log(`BetFred: row count after navigation = ${finalRowCount}`);
  return finalRowCount >= 3;
}

const browser = await puppeteer.launch({
  headless,
  defaultViewport: { width: 1440, height: 1200 },
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
  ],
});

try {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  );

  console.log('BetFred: starting navigation');
  const navigated = await navigateToPremierLeague(page);
  if (!navigated) {
    const summary = await page.evaluate(getDomSummary);
    console.error(`BetFred: could not reach the BetFred Premier League match list. Last known page state: ${JSON.stringify(summary)}`);
    process.exitCode = 1;
    return;
  }

  await wait(3000);

  await page.waitForSelector('.event-list-container .event-item-container, .event-item-container', {
    timeout: 60_000,
  });

  await page.waitForFunction(
    () => document.querySelectorAll('.event-list-container .event-item-container').length >= 3,
    { timeout: 45_000 },
  );

  const domDebug = await page.evaluate(() => {
    const selectors = [
      '.event-list-container',
      '.event-item-container',
      '.event-info__teams',
      '.event-info__time',
      '.bid-option',
      '.option-odds-current',
    ];

    const counts = Object.fromEntries(selectors.map((selector) => [selector, document.querySelectorAll(selector).length]));
    const sampleRow = document.querySelector('.event-item-container')?.outerHTML?.slice(0, 1200) || null;

    return { counts, sampleRow };
  });

  console.warn('BetFred DOM debug snapshot:', JSON.stringify(domDebug, null, 2));

  const events = await page.evaluate(() => parseBetfredEventsFromDom(document));

  if (events.length === 0) {
    console.warn('BetFred DOM debug summary:', JSON.stringify(domDebug, null, 2));
    throw new Error(`No ${competitionName} events were found in the BetFred match list.`);
  }

  const result = {
    bookmaker: 'Betfred',
    bookmakerSlug: 'betfred',
    sport: 'Soccer',
    country: 'England',
    competition: competitionName,
    scrapedAt: new Date().toISOString(),
    sourceUrl: page.url(),
    events,
  };

  await writeFile('betfred_odds.json', `${JSON.stringify(result, null, 2)}\n`);
  const savedToDatabase = await saveScrapeResult(result);

  console.log(JSON.stringify(result, null, 2));
  console.error(`Saved ${events.length} events to betfred_odds.json`);
  if (savedToDatabase) {
    console.error(`Saved ${events.length} odds snapshots to MySQL`);
  }
} finally {
  await browser.close();
}
