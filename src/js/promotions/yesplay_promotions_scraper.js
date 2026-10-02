import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { savePromotionScrapeResult } from '../promotion_database.js';

const sourceUrl = 'https://yesplay.bet/promotions';
const headless = process.env.HEADLESS !== 'false';
const dryRun = process.argv.includes('--dry-run');

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
    throw new Error(
      `YesPlay returned HTTP ${response.status()}. No promotions were saved. ` +
      'If the site blocks the automated browser, open the page normally and retry when access is available.',
    );
  }

  await page.waitForSelector('.scp-promotion-base', { timeout: 30_000 });
  const promotions = await page.evaluate(() => {
    const text = (element) => element?.innerText?.trim() ?? '';
    const slugPart = (value) => value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    return [...document.querySelectorAll('.scp-promotion-base')].map((card) => {
      const productCategory = text(card.querySelector('.scp-promotion-base__logo__product'));
      const title = text(card.querySelector('.scp-promotion-base__logo__title'));
      const subtitle = text(card.querySelector('.scp-promotion-base__logo__description')) || null;
      const steps = [...card.querySelectorAll('.scp-promotion-base__content li')]
        .map((item) => text(item))
        .filter(Boolean);
      const bodyText = text(card.querySelector('.scp-promotion-base__content'))
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !steps.includes(line))
        .join(' ');
      const detailBlocks = [...card.querySelectorAll('.scp-promotion-base__footer__block')]
        .filter((block) => !block.querySelector('.scp-promotion-base__footer__block__action'))
        .map((block) => {
          const lines = (block.innerText ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
          const label = text(block.querySelector('.scp-promotion-base__footer__block__title')) ||
            text(block.querySelector('.title')) || lines[0] || '';
          const value = text(block.querySelector('.value')) ||
            text(block.querySelector('.scp-promotion-base__footer__block__description')) ||
            lines.slice(1).join(' ');
          return { label, value };
        })
        .filter((detail) => detail.label || detail.value);

      return {
        offerKey: `yesplay-${slugPart(productCategory)}-${slugPart(title)}`,
        productCategory,
        title,
        subtitle,
        bodyText,
        steps,
        details: detailBlocks,
        imageUrl: card.querySelector('.scp-promotion-base__logo img')?.src ?? null,
        actionLabel: text(card.querySelector('.scp-promotion-base__footer__block__action')) || null,
        actionUrl: new URL('/sign-in', window.location.origin).href,
      };
    }).filter((promotion) => promotion.title && promotion.offerKey);
  });

  if (promotions.length === 0) {
    throw new Error('No YesPlay promotions were found. No promotions were saved.');
  }

  const result = {
    bookmaker: 'YesPlay',
    bookmakerSlug: 'yesplay',
    sourceUrl,
    scrapedAt: new Date().toISOString(),
    promotions,
  };

  await writeFile('yesplay_promotions.json', `${JSON.stringify(result, null, 2)}\n`);
  const savedToDatabase = dryRun ? false : await savePromotionScrapeResult(result);
  console.log(JSON.stringify(result, null, 2));
  console.error(`Saved ${promotions.length} promotions to yesplay_promotions.json`);
  if (savedToDatabase) {
    console.error(`Synced ${promotions.length} active YesPlay promotions to MySQL`);
  }
} finally {
  await browser.close();
}