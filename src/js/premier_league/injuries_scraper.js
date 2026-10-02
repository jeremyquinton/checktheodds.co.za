import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { saveInjuryScrapeResult } from '../database.js';

const url = 'https://www.premierleague.com/en/latest-player-injuries';
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
    () => {
      const articles = [...document.querySelectorAll('.injury-news__article')];
      const rows = articles.flatMap((article) =>
        [...article.querySelectorAll('.injury-news__table tbody tr')]);

      return articles.length >= 20 && rows.length > 0 && rows.every((row) =>
        row.querySelector('th, td')?.textContent?.trim() &&
        row.querySelector('th, td')?.textContent?.trim() !== '-') &&
        articles.every((article) =>
        article.querySelector('.injury-news__team-name')?.textContent?.trim() &&
        article.querySelector('.injury-news__table tbody'));
    },
    { timeout: 45_000 },
  );

  const result = await page.evaluate(() => {
    const sourceUpdatedAt = document.body.innerText
      .match(/Last updated:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
    const injuries = [...document.querySelectorAll('.injury-news__article')]
      .flatMap((article) => {
        const team = article
          .querySelector('.injury-news__team-name')
          ?.textContent?.trim();
        if (!team) {
          return [];
        }

        return [...article.querySelectorAll('.injury-news__table tbody tr')]
          .flatMap((row) => {
            const cells = [...row.querySelectorAll('th, td')];
            const player = cells[0]?.textContent?.trim();
            const injuryType = cells[1]?.textContent?.trim();

            if (!player || player === '-') {
              return [];
            }

            return [{
              team,
              player,
              injury: injuryType && injuryType !== '-'
                ? injuryType
                : 'Not specified',
              latestUrl: cells[2]?.querySelector('a[href]')?.href ?? null,
            }];
          });
      });

    return {
      scrapedAt: new Date().toISOString(),
      sourceUpdatedAt,
      sourceUrl: window.location.href,
      injuries,
    };
  });

  await writeFile(
    'premier_league_injuries.json',
    `${JSON.stringify(result, null, 2)}\n`,
  );
  const savedToDatabase = await saveInjuryScrapeResult(result);
  console.log(JSON.stringify({
    scrapedAt: result.scrapedAt,
    sourceUpdatedAt: result.sourceUpdatedAt,
    injuryCount: result.injuries.length,
    teams: [...new Set(result.injuries.map((injury) => injury.team))].length,
    savedToDatabase,
    outputFile: 'premier_league_injuries.json',
  }, null, 2));
} finally {
  await browser.close();
}