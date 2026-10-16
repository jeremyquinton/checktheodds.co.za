import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { savePromotionScrapeResult } from '../promotion_database.js';

const sourceUrl = 'https://www.virginbet.co.za/promotions/';
const headless = process.env.HEADLESS !== 'false';
const dryRun = process.argv.includes('--dry-run');
const minimumGroupCount = 5;
const minimumPromotionCount = 10;

function slugify(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const browser = await puppeteer.launch({
  headless,
  defaultViewport: { width: 1440, height: 1000 },
});

try {
  const page = await browser.newPage();
  const response = await page.goto(sourceUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });

  if ((response?.status() ?? 200) >= 400) {
    throw new Error(`Virgin Bet returned HTTP ${response.status()}. No promotions were saved.`);
  }

  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Accept')
      ?.click();
  });

  const promotionsFrame = await page.waitForFrame(
    (frame) => frame.url().includes('/pages/promotions'),
    { timeout: 30_000 },
  );

  await promotionsFrame.waitForFunction(() => {
    const groups = [...document.querySelectorAll('.Promo')];
    const cards = groups.flatMap((group) => [...group.querySelectorAll('.card-inner')]);

    return groups.length > 0 && cards.length > 0 && cards.every((card) =>
      card.querySelector('.content img[src]') &&
      card.querySelector('.footer .desc')?.innerText?.trim());
  }, { timeout: 30_000 });

  const scraped = await promotionsFrame.evaluate(() => {
    const slugify = (value) => value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const groups = [...document.querySelectorAll('.Promo')];
    const cards = groups.flatMap((group) => {
      const productCategory = group.querySelector('.header .title')
        ?.textContent?.trim();
      return [...group.querySelectorAll('.card-inner')].map((card) => {
        const description = card.querySelector('.footer .desc')?.innerText?.trim() ?? '';
        const lines = description.split('\n').map((line) => line.trim()).filter(Boolean);
        const firstLine = lines[0] ?? '';
        const isHeading = firstLine.length <= 80 && lines.length > 1 &&
          (firstLine === firstLine.toLocaleUpperCase() ||
            (/^[A-Z0-9][A-Za-z0-9'’&+ -]*$/.test(firstLine) && !/[.!?]$/.test(firstLine)));
        const image = card.querySelector('.content img');
        const imageUrl = image?.currentSrc || image?.src || null;
        const assetName = imageUrl ? new URL(imageUrl).pathname.split('/').pop() : '';
        const title = isHeading ? firstLine.replace(/\*+$/, '').trim() : productCategory;
        const bodyText = lines.slice(isHeading ? 1 : 0).join(' ');

        return {
          productCategory,
          title,
          bodyText,
          imageUrl,
          assetName,
          complete: Boolean(productCategory && title && imageUrl && description),
        };
      });
    });

    return { groupCount: groups.length, cardCount: cards.length, cards };
  });

  if (
    scraped.groupCount < minimumGroupCount ||
    scraped.cardCount < minimumPromotionCount ||
    scraped.cards.some((card) => !card.complete)
  ) {
    throw new Error(
      `Virgin Bet promotions were incomplete (${scraped.groupCount} groups, ${scraped.cards.filter((card) => card.complete).length}/${scraped.cardCount} complete cards). No promotions were saved.`,
    );
  }

  const scrapedAt = new Date().toISOString();
  const promotions = scraped.cards.map((card) => ({
    offerKey: `virginbet-${slugify(card.productCategory)}-${slugify(card.assetName)}`,
    productCategory: card.productCategory,
    title: card.title,
    subtitle: null,
    bodyText: card.bodyText || null,
    steps: [],
    details: [],
    imageUrl: card.imageUrl,
    actionLabel: 'View offer',
    actionUrl: sourceUrl,
  }));

  const result = {
    bookmaker: 'Virgin Bet',
    bookmakerSlug: 'virgin-bet',
    sourceUrl,
    scrapedAt,
    promotions,
  };

  if (!dryRun) {
    await writeFile('virgin_bet_promotions.json', `${JSON.stringify(result, null, 2)}\n`);
  }
  const savedToDatabase = dryRun ? false : await savePromotionScrapeResult(result);
  console.log(JSON.stringify({ ...result, groupCount: scraped.groupCount }, null, 2));
  console.error(`${dryRun ? 'Previewed' : 'Saved'} ${promotions.length} Virgin Bet promotions${dryRun ? ' (dry run)' : ' to virgin_bet_promotions.json'}`);
  if (savedToDatabase) {
    console.error(`Synced ${promotions.length} Virgin Bet promotions to MySQL`);
  }
} finally {
  await browser.close();
}
