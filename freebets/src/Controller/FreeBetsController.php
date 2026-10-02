<?php

declare(strict_types=1);

namespace CheckTheOdds\FreeBets\Controller;

use CheckTheOdds\FreeBets\Repository\OfferRepository;
use CheckTheOdds\FreeBets\Repository\PromotionRepository;
use CheckTheOdds\FreeBets\Repository\SubscriberRepository;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Twig\Environment;

final class FreeBetsController
{
    public function __construct(
        private Environment $views,
        private OfferRepository $offers,
        private PromotionRepository $promotions,
        private SubscriberRepository $subscribers,
        private string $oddsAppUrl,
    ) {
    }

    public function index(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $offers = $this->offers->active();
        $previewOnly = $offers !== [] && count(array_filter(
            $offers,
            static fn(array $offer): bool => $offer['isExample'],
        )) === count($offers);
        $newsletterStatus = $request->getQueryParams()['newsletter'] ?? '';
        if (!in_array($newsletterStatus, ['subscribed', 'invalid'], true)) {
            $newsletterStatus = '';
        }

        $response->getBody()->write($this->views->render('free-bets/index.twig', [
            'offers' => $offers,
            'promotions' => $this->promotions->active(),
            'previewOnly' => $previewOnly,
            'oddsAppUrl' => $this->oddsAppUrl,
            'newsletterStatus' => $newsletterStatus,
        ]));

        return $response->withHeader('Content-Type', 'text/html; charset=utf-8');
    }

    public function subscribe(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $body = $request->getParsedBody();
        $email = trim((string) (is_array($body) ? ($body['email'] ?? '') : ''));
        $consented = is_array($body) && ($body['consent'] ?? '') === '1';
        $status = 'invalid';

        if ($consented && strlen($email) <= 254 && filter_var($email, FILTER_VALIDATE_EMAIL) !== false) {
            $this->subscribers->subscribe($email);
            $status = 'subscribed';
        }

        return $response
            ->withHeader('Location', '/free-bets?newsletter=' . $status)
            ->withStatus(303);
    }
}