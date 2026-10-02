<?php

declare(strict_types=1);

namespace CheckTheOdds\FreeBets\Repository;

final class OfferRepository
{
    public function all(): array
    {
        return [
            [
                'id' => 'hollywoodbets-free-bet',
                'bookmaker' => 'Hollywoodbets',
                'logo' => '/assets/logos/hollywood_bets.png',
                'category' => 'free-bets',
                'categoryLabel' => 'Free bets',
                'headline' => 'R250 in free bets',
                'description' => 'Example welcome offer for new customers.',
                'bonusAmount' => 250,
                'minimumDeposit' => 'R100',
                'wagering' => '3x bonus',
                'qualifyingOdds' => '1.80',
                'validFor' => '7 days',
                'url' => 'https://www.hollywoodbets.net/',
                'terms' => [
                    'Illustrative terms only; verify the live offer with the bookmaker.',
                    'Example eligibility: new customers aged 18+ in South Africa.',
                    'Example qualifying minimum odds: 1.80.',
                ],
            ],
            [
                'id' => 'betway-deposit-match',
                'bookmaker' => 'Betway',
                'logo' => '/assets/logos/betway.png',
                'category' => 'deposit-match',
                'categoryLabel' => 'Deposit match',
                'headline' => 'Up to R1,000 deposit match',
                'description' => 'Example welcome offer for new customers.',
                'bonusAmount' => 1000,
                'minimumDeposit' => 'R100',
                'wagering' => '5x bonus',
                'qualifyingOdds' => '1.50',
                'validFor' => '14 days',
                'url' => 'https://www.betway.co.za/',
                'terms' => [
                    'Illustrative terms only; verify the live offer with the bookmaker.',
                    'Example deposit-match cap: R1,000.',
                    'Example qualifying minimum odds: 1.50.',
                ],
            ],
            [
                'id' => 'play-free-bet',
                'bookmaker' => 'Play.co.za',
                'logo' => '/assets/logos/play.png',
                'category' => 'free-bets',
                'categoryLabel' => 'Free bets',
                'headline' => 'R100 in free bets',
                'description' => 'Example free-bet offer for new customers.',
                'bonusAmount' => 100,
                'minimumDeposit' => 'R50',
                'wagering' => '3x bonus',
                'qualifyingOdds' => '1.80',
                'validFor' => '7 days',
                'url' => 'https://www.play.co.za/',
                'terms' => [
                    'Illustrative terms only; verify the live offer with the bookmaker.',
                    'Example eligibility: new customers aged 18+ in South Africa.',
                    'Example qualifying minimum odds: 1.80.',
                ],
            ],
            [
                'id' => 'supabets-no-deposit',
                'bookmaker' => 'Supabets',
                'logo' => '/assets/logos/supabets.png',
                'category' => 'no-deposit',
                'categoryLabel' => 'No deposit',
                'headline' => 'R50 no-deposit bonus',
                'description' => 'Example no-deposit offer for eligible customers.',
                'bonusAmount' => 50,
                'minimumDeposit' => 'No deposit',
                'wagering' => '10x bonus',
                'qualifyingOdds' => '2.00',
                'validFor' => '3 days',
                'url' => 'https://www.supabets.co.za/',
                'terms' => [
                    'Illustrative terms only; verify the live offer with the bookmaker.',
                    'Example eligibility: one offer per verified customer.',
                    'Example qualifying minimum odds: 2.00.',
                ],
            ],
        ];
    }
}