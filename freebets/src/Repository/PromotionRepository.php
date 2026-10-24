<?php

declare(strict_types=1);

namespace CheckTheOdds\FreeBets\Repository;

use InvalidArgumentException;
use PDO;

final class PromotionRepository
{
    public function __construct(private PDO $connection)
    {
    }

    public function active(): array
    {
        $statement = $this->connection->query(
            'SELECT
                promotion.bookmaker_slug,
                curation.display_category AS product_category,
                COALESCE(NULLIF(curation.display_title, \'\'), promotion.title) AS title,
                COALESCE(curation.display_subtitle, promotion.subtitle) AS subtitle,
                COALESCE(curation.display_body_text, promotion.body_text) AS body_text,
                promotion.steps,
                promotion.details,
                COALESCE(NULLIF(curation.display_image_url, \'\'), promotion.image_url) AS image_url,
                COALESCE(NULLIF(curation.display_action_label, \'\'), promotion.action_label) AS action_label,
                COALESCE(NULLIF(curation.display_action_url, \'\'), promotion.action_url) AS action_url,
                promotion.source_url,
                promotion.scraped_at,
                curation.tags AS display_tags
             FROM bookmaker_promotions promotion
             JOIN bookmaker_promotion_curation curation
               ON curation.promotion_id = promotion.id
             WHERE promotion.is_active = 1 AND curation.is_published = 1
             ORDER BY curation.display_order, promotion.bookmaker_slug,
                      curation.display_category, title'
        );

        return array_map(fn(array $promotion): array => $this->format($promotion), $statement->fetchAll());
    }

    public function allForAdmin(): array
    {
        $statement = $this->connection->query(
            'SELECT
                promotion.*,
                curation.display_category,
                curation.tags AS display_tags,
                curation.display_title,
                curation.display_subtitle,
                curation.display_body_text,
                curation.display_image_url,
                curation.display_action_label,
                curation.display_action_url,
                curation.display_order,
                curation.is_published
             FROM bookmaker_promotions promotion
             LEFT JOIN bookmaker_promotion_curation curation
               ON curation.promotion_id = promotion.id
             ORDER BY promotion.bookmaker_slug, promotion.is_active DESC,
                      curation.display_order, promotion.product_category, promotion.title'
        );

        return array_map(fn(array $promotion): array => $this->formatForAdmin($promotion), $statement->fetchAll());
    }

    public function findForAdmin(int $id): ?array
    {
        $statement = $this->connection->prepare(
            'SELECT
                promotion.*,
                curation.display_category,
                curation.tags AS display_tags,
                curation.display_title,
                curation.display_subtitle,
                curation.display_body_text,
                curation.display_image_url,
                curation.display_action_label,
                curation.display_action_url,
                curation.display_order,
                curation.is_published
             FROM bookmaker_promotions promotion
             LEFT JOIN bookmaker_promotion_curation curation
               ON curation.promotion_id = promotion.id
             WHERE promotion.id = ?'
        );
        $statement->execute([$id]);
        $promotion = $statement->fetch();

        return $promotion === false ? null : $this->formatForAdmin($promotion);
    }

    public function saveCuration(int $id, array $input): void
    {
        $displayCategory = trim((string) ($input['display_category'] ?? ''));
        if ($displayCategory === '' || mb_strlen($displayCategory) > 128) {
            throw new InvalidArgumentException('Enter a display category of 1 to 128 characters.');
        }

        $tags = preg_split('/[,\r\n]+/', (string) ($input['tags'] ?? '')) ?: [];
        $tags = array_values(array_unique(array_filter(array_map('trim', $tags))));
        if (count($tags) > 30 || count(array_filter(
            $tags,
            static fn(string $tag): bool => mb_strlen($tag) > 60,
        )) > 0) {
            throw new InvalidArgumentException('Use at most 30 tags, each no longer than 60 characters.');
        }

        $displayTitle = $this->optionalText($input['display_title'] ?? '', 255, 'Display title');
        $displaySubtitle = $this->optionalText($input['display_subtitle'] ?? '', 255, 'Display subtitle');
        $displayBodyText = $this->optionalText($input['display_body_text'] ?? '', 20_000, 'Display description');
        $displayActionLabel = $this->optionalText($input['display_action_label'] ?? '', 80, 'Action label');
        $displayImageUrl = $this->optionalHttpsUrl($input['display_image_url'] ?? '', 'Image URL');
        $displayActionUrl = $this->optionalHttpsUrl($input['display_action_url'] ?? '', 'Action URL');
        $displayOrder = filter_var($input['display_order'] ?? 0, FILTER_VALIDATE_INT);
        if ($displayOrder === false || $displayOrder < -10_000 || $displayOrder > 10_000) {
            throw new InvalidArgumentException('Display order must be an integer between -10000 and 10000.');
        }

        $statement = $this->connection->prepare(
            'INSERT INTO bookmaker_promotion_curation (
                promotion_id, display_category, tags, display_title, display_subtitle,
                display_body_text, display_image_url, display_action_label,
                display_action_url, display_order, is_published
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                display_category = VALUES(display_category),
                tags = VALUES(tags),
                display_title = VALUES(display_title),
                display_subtitle = VALUES(display_subtitle),
                display_body_text = VALUES(display_body_text),
                display_image_url = VALUES(display_image_url),
                display_action_label = VALUES(display_action_label),
                display_action_url = VALUES(display_action_url),
                display_order = VALUES(display_order),
                is_published = VALUES(is_published)'
        );
        $statement->execute([
            $id,
            $displayCategory,
            json_encode($tags, JSON_THROW_ON_ERROR),
            $displayTitle,
            $displaySubtitle,
            $displayBodyText,
            $displayImageUrl,
            $displayActionLabel,
            $displayActionUrl,
            $displayOrder,
            isset($input['is_published']) ? 1 : 0,
        ]);
    }

    private function format(array $promotion): array
    {
        $promotion['steps'] = json_decode($promotion['steps'], true) ?: [];
        $promotion['details'] = json_decode($promotion['details'], true) ?: [];
        $promotion['tags'] = json_decode($promotion['display_tags'] ?? '[]', true) ?: [];
        $promotion['bookmaker_name'] = $this->bookmakerName($promotion['bookmaker_slug']);
        return $promotion;
    }

    private function formatForAdmin(array $promotion): array
    {
        $promotion['source_steps'] = json_decode($promotion['steps'], true) ?: [];
        $promotion['source_details'] = json_decode($promotion['details'], true) ?: [];
        $promotion['tags_array'] = json_decode($promotion['display_tags'] ?? '[]', true) ?: [];
        $promotion['tags_input'] = implode(', ', $promotion['tags_array']);
        $promotion['bookmaker_name'] = $this->bookmakerName($promotion['bookmaker_slug']);
        $promotion['source_is_active'] = (bool) $promotion['is_active'];
        $promotion['is_published'] = (bool) ($promotion['is_published'] ?? false);
        $promotion['display_order'] = (int) ($promotion['display_order'] ?? 0);
        $promotion['display_category'] = $promotion['display_category'] ?: $promotion['product_category'];
        $promotion['display_title'] ??= '';
        $promotion['display_subtitle'] ??= '';
        $promotion['display_body_text'] ??= '';
        $promotion['display_image_url'] ??= '';
        $promotion['display_action_label'] ??= '';
        $promotion['display_action_url'] ??= '';
        return $promotion;
    }

    private function bookmakerName(string $slug): string
    {
        return match ($slug) {
            'virgin-bet' => 'Virgin Bet',
            'yesplay' => 'YesPlay',
            'easybet' => 'Easybet',
            'betfair-sa' => 'Betfair South Africa',
            'hollywoodbets' => 'Hollywoodbets',
            default => ucwords(str_replace('-', ' ', $slug)),
        };
    }

    private function optionalText(mixed $value, int $maxLength, string $label): ?string
    {
        $text = trim((string) $value);
        if (mb_strlen($text) > $maxLength) {
            throw new InvalidArgumentException($label . ' is too long.');
        }
        return $text === '' ? null : $text;
    }

    private function optionalHttpsUrl(mixed $value, string $label): ?string
    {
        $url = trim((string) $value);
        if ($url === '') {
            return null;
        }
        if (!filter_var($url, FILTER_VALIDATE_URL) || parse_url($url, PHP_URL_SCHEME) !== 'https') {
            throw new InvalidArgumentException($label . ' must be a valid HTTPS URL.');
        }
        return $url;
    }
}