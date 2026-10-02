<?php

declare(strict_types=1);

use CheckTheOdds\FreeBets\Controller\FreeBetsController;
use CheckTheOdds\FreeBets\Repository\OfferRepository;
use Slim\Factory\AppFactory;
use Twig\Environment;
use Twig\Loader\FilesystemLoader;

require dirname(__DIR__, 2) . '/vendor/autoload.php';

$app = AppFactory::create();
$loader = new FilesystemLoader(dirname(__DIR__) . '/templates');
$views = new Environment($loader, [
    'autoescape' => 'html',
    'cache' => false,
]);
$controller = new FreeBetsController(
    $views,
    new OfferRepository(),
    getenv('ODDS_APP_URL') ?: 'http://localhost:3000',
);

$app->get('/', [$controller, 'index']);
$app->get('/free-bets', [$controller, 'index']);
$app->addRoutingMiddleware();
$app->addErrorMiddleware(
    filter_var(getenv('APP_DEBUG') ?: 'false', FILTER_VALIDATE_BOOLEAN),
    true,
    true,
);

$app->run();