<?php

declare(strict_types=1);

namespace CheckTheOdds\FreeBets\Repository;

use PDO;

final class SubscriberRepository
{
    public function __construct(private PDO $connection)
    {
    }

    public function subscribe(string $email): void
    {
        $statement = $this->connection->prepare(
            'INSERT INTO free_bet_email_subscribers (email, consented_at, is_active)
             VALUES (?, CURRENT_TIMESTAMP(3), 1)
             ON DUPLICATE KEY UPDATE
                consented_at = CURRENT_TIMESTAMP(3),
                is_active = 1'
        );
        $statement->execute([$email]);
    }
}