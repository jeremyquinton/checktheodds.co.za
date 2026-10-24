import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { savePromotionScrapeResult } from '../promotion_database.js';

const sourceUrl = 'https://www.hollywoodbets.net/promotions';
const apiUrl = 'https://content-cms-api.hollywoodbets.net/api/v1/platform-promotions?platform=premium-south-africa-en-za';
const minimumPromotionCount = 15;

export async function fetchPromotionItems() {
  const items = [];
  let expectedTotal;
  let expectedPageCount;

  for (let page = 1; ; page++) {
    const url = new URL(apiUrl);
    url.searchParams.set('pagination[page]', String(page));
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Hollywoodbets promotions API returned HTTP ${response.status}. No promotions were saved.`);
    }

    const payload = await response.json();
    const pagination = payload?.meta?.pagination;
    if (
      !Array.isArray(payload?.data) ||
      !Number.isInteger(pagination?.total) || pagination.total < 1 ||
      !Number.isInteger(pagination?.pageCount) || pagination.pageCount < 1 ||
      pagination.page !== page || payload.data.length === 0
    ) {
      throw new Error('Hollywoodbets promotions API returned an incomplete payload or invalid pagination. No promotions were saved.');
    }
    expectedTotal ??= pagination.total;
    expectedPageCount ??= pagination.pageCount;
    if (pagination.total !== expectedTotal || pagination.pageCount !== expectedPageCount) {
      throw new Error('Hollywoodbets promotions changed during pagination. Retry the scrape. No promotions were saved.');
    }
    items.push(...payload.data);
    if (items.length > expectedTotal) {
      throw new Error('Hollywoodbets promotions API returned too many records. No promotions were saved.');
    }
    if (page === expectedPageCount) {
      break;
    }
  }

  if (items.length !== expectedTotal) {
    throw new Error(`Hollywoodbets promotions were incomplete (${items.length}/${expectedTotal} records). No promotions were saved.`);
  }
  return items;
}

function httpsUrl(value, label) {
  const url = new URL(value, sourceUrl);
  if (typeof value !== 'string' || !value.trim() || url.protocol !== 'https:') {
    throw new Error(`Hollywoodbets returned an invalid ${label}. No promotions were saved.`);
  }
  return url.href;
}

export function buildPromotions(items) {
  const seenIds = new Set();
  const promotions = [];

  for (const item of items) {
    const attributes = item?.attributes;
    if (
      !Number.isInteger(item?.id) || item.id < 1 ||
      typeof attributes?.active !== 'boolean' || seenIds.has(item.id)
    ) {
      throw new Error('Hollywoodbets returned an invalid or duplicate promotion. No promotions were saved.');
    }
    seenIds.add(item.id);
    if (!attributes.active) {
      continue;
    }

    const title = attributes.title?.trim();
    const bodyText = attributes.description?.trim();
    if (!title || !bodyText) {
      throw new Error(`Hollywoodbets promotion ${item.id} is missing its title or description. No promotions were saved.`);
    }
    const details = [];
    for (const [field, label] of [['startDate', 'Valid from'], ['endDate', 'Valid until']]) {
      if (attributes[field] == null) {
        continue;
      }
      const date = new Date(attributes[field]);
      if (Number.isNaN(date.getTime())) {
        throw new Error(`Hollywoodbets promotion ${item.id} has an invalid ${field}. No promotions were saved.`);
      }
      details.push({
        label,
        value: date.toLocaleDateString('en-ZA', {
          timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric',
        }),
      });
    }
    promotions.push({
      offerKey: `hollywoodbets-${item.id}`,
      productCategory: attributes.category?.data?.attributes?.name?.trim() || 'Other',
      title,
      subtitle: null,
      bodyText,
      steps: [],
      details,
      imageUrl: httpsUrl(attributes.image?.data?.attributes?.url, 'image URL'),
      actionLabel: attributes.showPlayNowButton ? 'Play now' : 'View offer',
      actionUrl: httpsUrl(
        attributes.showPlayNowButton ? attributes.playNowButtonUrl : attributes.url,
        'action URL',
      ),
    });
  }

  if (promotions.length < minimumPromotionCount) {
    throw new Error(
      `Hollywoodbets promotions were incomplete (${promotions.length} active; expected at least ${minimumPromotionCount}). No promotions were saved.`,
    );
  }
  return promotions;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const result = {
    bookmaker: 'Hollywoodbets',
    bookmakerSlug: 'hollywoodbets',
    sourceUrl,
    scrapedAt: new Date().toISOString(),
    promotions: buildPromotions(await fetchPromotionItems()),
  };

  if (!dryRun) {
    await writeFile('hollywoodbets_promotions.json', `${JSON.stringify(result, null, 2)}\n`);
  }
  const savedToDatabase = dryRun ? false : await savePromotionScrapeResult(result);
  console.log(JSON.stringify(result, null, 2));
  console.error(`${dryRun ? 'Previewed' : 'Saved'} ${result.promotions.length} Hollywoodbets promotions${dryRun ? ' (dry run)' : ' to hollywoodbets_promotions.json'}`);
  if (savedToDatabase) {
    console.error(`Synced ${result.promotions.length} active Hollywoodbets promotions to MySQL`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
