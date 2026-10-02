<?php

declare(strict_types=1);

namespace CheckTheOdds\FreeBets\Controller;

use CheckTheOdds\FreeBets\Repository\OfferRepository;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Twig\Environment;

final class FreeBetsController
{
    public function __construct(
        private Environment $views,
        private OfferRepository $offers,
        private string $oddsAppUrl,
    ) {
    }

    public function index(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $response->getBody()->write($this->views->render('free-bets/index.twig', [
            'offers' => $this->offers->all(),
            'oddsAppUrl' => $this->oddsAppUrl,
        ]));

        return $response->withHeader('Content-Type', 'text/html; charset=utf-8');
    }
}