import mysql from 'mysql2/promise';
import { getConnectionConfig } from './database.js';

export async function savePromotionScrapeResult(result) {
  if (process.env.SAVE_TO_DB === 'false') {
    return false;
  }
  if (!Array.isArray(result.promotions) || result.promotions.length === 0) {
    throw new Error('Refusing to sync an empty promotion scrape.');
  }

  const connection = await mysql.createConnection(getConnectionConfig());

  try {
    await connection.beginTransaction();
    for (const promotion of result.promotions) {
      await connection.execute(
        `INSERT INTO bookmaker_promotions (
          bookmaker_slug, offer_key, product_category, title, subtitle, body_text,
          steps, details, image_url, action_label, action_url, source_url,
          is_active, scraped_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON DUPLICATE KEY UPDATE
          product_category = VALUES(product_category),
          title = VALUES(title),
          subtitle = VALUES(subtitle),
          body_text = VALUES(body_text),
          steps = VALUES(steps),
          details = VALUES(details),
          image_url = VALUES(image_url),
          action_label = VALUES(action_label),
          action_url = VALUES(action_url),
          source_url = VALUES(source_url),
          is_active = 1,
          scraped_at = VALUES(scraped_at),
          last_seen_at = VALUES(last_seen_at)`,
        [
          result.bookmakerSlug,
          promotion.offerKey,
          promotion.productCategory,
          promotion.title,
          promotion.subtitle,
          promotion.bodyText,
          JSON.stringify(promotion.steps),
          JSON.stringify(promotion.details),
          promotion.imageUrl,
          promotion.actionLabel,
          promotion.actionUrl,
          result.sourceUrl,
          new Date(result.scrapedAt),
          new Date(result.scrapedAt),
        ],
      );
    }

    const offerKeys = result.promotions.map(promotion => promotion.offerKey);
    await connection.execute(
      `UPDATE bookmaker_promotions
       SET is_active = 0
       WHERE bookmaker_slug = ? AND offer_key NOT IN (${offerKeys.map(() => '?').join(', ')})`,
      [result.bookmakerSlug, ...offerKeys],
    );

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}