<?php

declare(strict_types=1);

namespace CheckTheOdds\FreeBets\Repository;

use InvalidArgumentException;
use PDO;

final class OfferRepository
{
    private const CATEGORIES = ['free-bets', 'no-deposit', 'deposit-match'];

    public function __construct(private PDO $connection)
    {
    }

    public function active(): array
    {
        return $this->fetch('WHERE is_active = 1');
    }

    public function all(): array
    {
        return $this->fetch('');
    }

    public function find(int $id): ?array
    {
        $statement = $this->connection->prepare('SELECT * FROM free_bet_offers WHERE id = ?');
        $statement->execute([$id]);
        $offer = $statement->fetch();

        return $offer === false ? null : $this->format($offer);
    }

    public function save(array $input, ?int $id = null): int
    {
        $offer = $this->validate($input);
        if ($id === null) {
            $statement = $this->connection->prepare(
                'INSERT INTO free_bet_offers (
                    slug, bookmaker_name, category, headline, description, bonus_amount,
                    currency, minimum_deposit, wagering_requirements, qualifying_odds,
                    valid_for, offer_url, terms_text, is_active, is_example, verified_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $statement->execute(array_values($offer));
            return (int) $this->connection->lastInsertId();
        }

        $statement = $this->connection->prepare(
            'UPDATE free_bet_offers SET
                slug = ?, bookmaker_name = ?, category = ?, headline = ?, description = ?,
                bonus_amount = ?, currency = ?, minimum_deposit = ?, wagering_requirements = ?,
                qualifying_odds = ?, valid_for = ?, offer_url = ?, terms_text = ?,
                is_active = ?, is_example = ?, verified_at = ?
             WHERE id = ?'
        );
        $statement->execute([...array_values($offer), $id]);
        return $id;
    }

    public function delete(int $id): void
    {
        $statement = $this->connection->prepare('DELETE FROM free_bet_offers WHERE id = ?');
        $statement->execute([$id]);
    }

    private function fetch(string $where): array
    {
        $statement = $this->connection->query(
            'SELECT * FROM free_bet_offers ' . $where . ' ORDER BY bonus_amount DESC, bookmaker_name'
        );
        return array_map(fn(array $offer): array => $this->format($offer), $statement->fetchAll());
    }

    private function format(array $offer): array
    {
        $offer['bookmaker'] = $offer['bookmaker_name'];
        $offer['url'] = $offer['offer_url'];
        $offer['bonusAmount'] = $offer['bonus_amount'] === null ? 0 : (float) $offer['bonus_amount'];
        $offer['qualifyingOdds'] = $offer['qualifying_odds'] === null ? null : number_format((float) $offer['qualifying_odds'], 2);
        $offer['minimumDeposit'] = $offer['minimum_deposit'];
        $offer['wagering'] = $offer['wagering_requirements'];
        $offer['validFor'] = $offer['valid_for'];
        $offer['categoryLabel'] = match ($offer['category']) {
            'free-bets' => 'Free bets',
            'no-deposit' => 'No deposit',
            'deposit-match' => 'Deposit match',
            default => 'Offer',
        };
        $offer['logo'] = '/assets/logos/' . match (strtolower($offer['bookmaker_name'])) {
            'hollywoodbets' => 'hollywood_bets.png',
            'betway' => 'betway.png',
            'play.co.za' => 'play.png',
            'supabets' => 'supabets.png',
            default => null,
        };
        $offer['terms'] = array_values(array_filter(array_map('trim', preg_split('/\R/', $offer['terms_text']) ?: [])));
        $offer['isExample'] = (bool) $offer['is_example'];
        $offer['verifiedAt'] = $offer['verified_at'];
        return $offer;
    }

    private function validate(array $input): array
    {
        $slug = strtolower(trim((string) ($input['slug'] ?? '')));
        $bookmaker = trim((string) ($input['bookmaker_name'] ?? ''));
        $category = (string) ($input['category'] ?? '');
        $headline = trim((string) ($input['headline'] ?? ''));
        $description = trim((string) ($input['description'] ?? ''));
        $url = trim((string) ($input['offer_url'] ?? ''));
        $bonusInput = trim((string) ($input['bonus_amount'] ?? ''));
        $oddsInput = trim((string) ($input['qualifying_odds'] ?? ''));

        if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $slug)) {
            throw new InvalidArgumentException('Offer slug must use lowercase letters, numbers, and hyphens.');
        }
        if ($bookmaker === '' || $headline === '' || $description === '') {
            throw new InvalidArgumentException('Bookmaker, headline, and description are required.');
        }
        if (!in_array($category, self::CATEGORIES, true)) {
            throw new InvalidArgumentException('Choose a valid offer category.');
        }
        if (!filter_var($url, FILTER_VALIDATE_URL) || parse_url($url, PHP_URL_SCHEME) !== 'https') {
            throw new InvalidArgumentException('Offer URL must be a valid HTTPS URL.');
        }
        if ($bonusInput !== '' && (!is_numeric($bonusInput) || (float) $bonusInput < 0)) {
            throw new InvalidArgumentException('Bonus amount must be zero or greater.');
        }
        if ($oddsInput !== '' && (!is_numeric($oddsInput) || (float) $oddsInput < 1)) {
            throw new InvalidArgumentException('Qualifying odds must be at least 1.00.');
        }

        return [
            $slug,
            $bookmaker,
            $category,
            $headline,
            $description,
            $bonusInput === '' ? null : $bonusInput,
            strtoupper(trim((string) ($input['currency'] ?? 'ZAR'))),
            trim((string) ($input['minimum_deposit'] ?? '')),
            trim((string) ($input['wagering_requirements'] ?? '')),
            $oddsInput === '' ? null : $oddsInput,
            trim((string) ($input['valid_for'] ?? '')),
            $url,
            trim((string) ($input['terms_text'] ?? '')),
            isset($input['is_active']) ? 1 : 0,
            isset($input['is_example']) ? 1 : 0,
            isset($input['is_example']) ? null : date('Y-m-d H:i:s.v'),
        ];
    }
}