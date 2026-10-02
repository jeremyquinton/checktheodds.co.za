<?php

declare(strict_types=1);

namespace CheckTheOdds\FreeBets\Repository;

use PDO;

final class PromotionRepository
{
    public function __construct(private PDO $connection)
    {
    }

    public function active(): array
    {
        $statement = $this->connection->query(
            'SELECT * FROM bookmaker_promotions WHERE is_active = 1 ORDER BY bookmaker_slug, product_category, title'
        );

        return array_map(static function (array $promotion): array {
            $promotion['steps'] = json_decode($promotion['steps'], true) ?: [];
            $promotion['details'] = json_decode($promotion['details'], true) ?: [];
            return $promotion;
        }, $statement->fetchAll());
    }
}