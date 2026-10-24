import puppeteer from 'puppeteer';

const TARGET_URL = process.env.SANPARKS_URL || 'https://www.sanparks.org/reservations/overnight-activity-details/396/1/2026-11-01';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5 * 60 * 1000);
const EMAIL_TO = process.env.EMAIL_TO || 'you@example.com';
const HEADLESS = process.env.HEADLESS !== 'false';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function logStep(message) {
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] ${message}`);
}

function normalizeText(value) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function parseAvailabilityNumber(value) {
  if (!value) return null;

  const match = String(value).match(/\d+/);
  if (!match) return null;

  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

async function sendAlertEmail(details) {
  console.log('----- MOCK EMAIL -----');
  console.log(`To: ${details.to}`);
  console.log(`Subject: ${details.subject}`);
  console.log(details.body);
  console.log('----------------------');
}

async function isCloudflareChallenge(page) {
  return page.evaluate(() => {
    const bodyText = document.body?.innerText || '';
    return /Just a moment|Enable JavaScript and cookies|Cloudflare/i.test(bodyText);
  });
}

async function findAvailableDays(page) {
  return page.evaluate(() => {
    const normalizeText = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
    const parseAvailabilityNumber = (value) => {
      if (!value) return null;
      const match = String(value).match(/\d+/);
      if (!match) return null;
      const number = Number(match[0]);
      return Number.isFinite(number) ? number : null;
    };

    const candidateElements = [
      ...document.querySelectorAll('td, th, button, li, div, span, a'),
    ].filter((element) => {
      const text = (element.textContent || '').trim();
      if (!text) return false;

      const hasNumber = /\d/.test(text);
      if (!hasNumber) return false;

      const selector = element.className || '';
      const label = (element.getAttribute('aria-label') || '').toLowerCase();
      const title = (element.getAttribute('title') || '').toLowerCase();

      return (
        selector.toString().toLowerCase().includes('day') ||
        selector.toString().toLowerCase().includes('date') ||
        selector.toString().toLowerCase().includes('available') ||
        label.includes('available') ||
        title.includes('available') ||
        title.includes('date') ||
        label.includes('date')
      );
    });

    const results = [];

    for (const element of candidateElements) {
      const rawText = normalizeText(element.textContent || '');
      const ariaLabel = normalizeText(element.getAttribute('aria-label'));
      const title = normalizeText(element.getAttribute('title'));
      const combined = `${rawText} ${ariaLabel} ${title}`;

      const number = parseAvailabilityNumber(combined);
      if (number === null || number === 0) continue;

      const label = rawText || ariaLabel || title || 'unknown';
      const dateMatch = label.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b[A-Za-z]+\s+\d{1,2}\b/);

      results.push({
        label: dateMatch ? dateMatch[0] : label,
        availability: number,
        text: label,
      });
    }

    return results.filter((entry, index, list) => {
      return list.findIndex((candidate) => candidate.label === entry.label && candidate.availability === entry.availability) === index;
    });
  });
}

async function checkAvailability() {
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1440, height: 1600 },
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
    });

    logStep(`Opening ${TARGET_URL}`);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });

    await sleep(5000);

    const challengeDetected = await isCloudflareChallenge(page);
    if (challengeDetected) {
      logStep('Cloudflare challenge or bot protection detected. The page is not yet ready for scraping.');
      return { availableDays: [], challengeDetected: true };
    }

    const availableDays = await findAvailableDays(page);

    return {
      availableDays,
      challengeDetected: false,
      currentUrl: page.url(),
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  logStep('Starting SANParks availability monitor');
  logStep(`Monitoring: ${TARGET_URL}`);

  while (true) {
    try {
      const result = await checkAvailability();

      if (result.challengeDetected) {
        logStep('Waiting before retrying so the challenge can clear or the site can be reached again.');
      } else if (result.availableDays.length > 0) {
        const available = result.availableDays
          .map((day) => `${day.label}: ${day.availability}`)
          .join(', ');

        const details = {
          to: EMAIL_TO,
          subject: 'SANParks booking availability alert',
          body: `A SANParks booking has become available for ${TARGET_URL}.\n\nAvailable days: ${available}\n\nCurrent URL: ${result.currentUrl}`,
        };

        await sendAlertEmail(details);
        logStep('Alert sent. Exiting monitor.');
        return;
      } else {
        logStep(`No non-zero availability found. Next check in ${Math.round(POLL_INTERVAL_MS / 1000)}s.`);
      }
    } catch (error) {
      console.error('Error while checking SANParks availability:', error);
      logStep('Retrying in a few minutes.');
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main();
