import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import { savePromotionScrapeResult } from '../promotion_database.js';

const sourceUrl = 'https://www.betway.co.za/promotions';
const apiUrl = 'https://api.betwayafrica.com/api/v2/Promotion/promotions/ZA?cultureCode=&isLive=true&promotionPageType=Standard&forceFetch=false';
const mediaOrigin = 'https://media.betwayafrica.com';
const headless = process.env.HEADLESS !== 'false';
const dryRun = process.argv.includes('--dry-run');
const minimumPromotionCount = 15;

function normalizeTitle(value) {
  return value
    .replace(/^mn[_-]+/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const browser = await puppeteer.launch({
  headless,
  defaultViewport: { width: 1440, height: 1000 },
});

try {
  const page = await browser.newPage();
  const pageResponse = await page.goto(sourceUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });

  if ((pageResponse?.status() ?? 200) >= 400) {
    throw new Error(`Betway returned HTTP ${pageResponse.status()}. No promotions were saved.`);
  }

  const promotions = await page.evaluate(async ({ endpoint, mediaBase, fallbackUrl }) => {
    const response = await fetch(endpoint, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Betway promotions API returned HTTP ${response.status}.`);
    }

    const items = await response.json();
    if (!Array.isArray(items)) {
      throw new Error('Betway promotions API returned an unexpected payload.');
    }

    const textFromHtml = (html) => {
      const documentFragment = new DOMParser().parseFromString(html ?? '', 'text/html');
      return documentFragment.body.innerText.replace(/\s+/g, ' ').trim();
    };
    const normalizeTitle = (value) => value
      .replace(/^mn[_-]+/i, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return items.flatMap((item) => {
      const region = item.regionData;
      if (!region?.isLive || !Number.isInteger(Number(item.promotionsId))) {
        return [];
      }

      const content = region.promotionContent ?? {};
      const callsToAction = region.promotionCtas ?? [];
      const callToAction = callsToAction.find((cta) => cta.loggedIn === false) ??
        callsToAction.find((cta) => cta.IsDefaultCta) ??
        callsToAction[0] ??
        null;
      const verticals = String(item.vertical ?? '')
        .split(/[;,]/)
        .map((vertical) => vertical.trim().toLowerCase());
      const productCategory = item.verticalCategory?.trim() ||
        (verticals.includes('casino') ? 'Casino' :
          verticals.includes('sports') ? 'Sport' :
            verticals.includes('features') ? 'Features' : 'Other');
      const title = normalizeTitle(
        content.promotionContentTitle?.trim() || item.promotionName || callToAction?.name || '',
      );
      const bodyText = textFromHtml(
        content.promotionContent || content.promotionOverviewContent || content.howToParticipate,
      );
      const steps = (region.promotionSteps ?? [])
        .flatMap((step) => step.stepActions ?? [])
        .map((step) => textFromHtml(step.stepBodyText))
        .filter(Boolean);
      const imagePath = content.bannerImageURL?.trim();
      const imageUrl = imagePath
        ? new URL(imagePath, mediaBase).href
        : null;
      const actionValue = callToAction?.actionValue?.trim();
      const actionUrl = actionValue
        ? new URL(actionValue, window.location.origin).href
        : fallbackUrl;
      const endDate = item.endDate?.slice(0, 10);
      const details = endDate
        ? [{ label: 'Valid until', value: endDate }]
        : [];

      return [{
        offerKey: `betway-${item.promotionsId}`,
        productCategory,
        title,
        subtitle: textFromHtml(content.promotionOverviewTitle || content.promotionOptInHeading) || null,
        bodyText: bodyText || null,
        steps,
        details,
        imageUrl,
        actionLabel: callToAction?.ctaText?.trim() || 'View offer',
        actionUrl,
        complete: Boolean(title && (bodyText || steps.length)),
      }];
    });
  }, { endpoint: apiUrl, mediaBase: mediaOrigin, fallbackUrl: sourceUrl });

  if (promotions.length < minimumPromotionCount || promotions.some((promotion) => !promotion.complete)) {
    throw new Error(
      `Betway promotions were incomplete (${promotions.filter((promotion) => promotion.complete).length}/${promotions.length} complete; expected at least ${minimumPromotionCount}). No promotions were saved.`,
    );
  }

  const normalizedPromotions = promotions.map(({ complete, ...promotion }) => promotion);
  const result = {
    bookmaker: 'Betway',
    bookmakerSlug: 'betway',
    sourceUrl,
    scrapedAt: new Date().toISOString(),
    promotions: normalizedPromotions,
  };

  if (!dryRun) {
    await writeFile('betway_promotions.json', `${JSON.stringify(result, null, 2)}\n`);
  }
  const savedToDatabase = dryRun ? false : await savePromotionScrapeResult(result);
  console.log(JSON.stringify(result, null, 2));
  console.error(`${dryRun ? 'Previewed' : 'Saved'} ${normalizedPromotions.length} Betway promotions${dryRun ? ' (dry run)' : ' to betway_promotions.json'}`);
  if (savedToDatabase) {
    console.error(`Synced ${normalizedPromotions.length} active Betway promotions to MySQL`);
  }
} finally {
  await browser.close();
}
