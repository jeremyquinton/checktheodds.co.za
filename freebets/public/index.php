<?php

declare(strict_types=1);

use CheckTheOdds\FreeBets\Controller\FreeBetsController;
use CheckTheOdds\FreeBets\Controller\AdminController;
use CheckTheOdds\FreeBets\Database\ConnectionFactory;
use CheckTheOdds\FreeBets\Repository\OfferRepository;
use CheckTheOdds\FreeBets\Repository\PromotionRepository;
use CheckTheOdds\FreeBets\Repository\SubscriberRepository;
use Slim\Factory\AppFactory;
use Slim\Routing\RouteCollectorProxy;
use Twig\Environment;
use Twig\Loader\FilesystemLoader;

require dirname(__DIR__, 2) . '/vendor/autoload.php';

session_name('bethunter_freebets');
session_set_cookie_params([
    'httponly' => true,
    'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'samesite' => 'Lax',
    'path' => '/',
]);
session_start();

$app = AppFactory::create();
$app->addBodyParsingMiddleware();
$loader = new FilesystemLoader(dirname(__DIR__) . '/templates');
$views = new Environment($loader, [
    'autoescape' => 'html',
    'cache' => false,
]);
$connection = ConnectionFactory::create();
$offers = new OfferRepository($connection);
$promotions = new PromotionRepository($connection);
$subscribers = new SubscriberRepository($connection);
$controller = new FreeBetsController(
    $views,
    $offers,
    $promotions,
    $subscribers,
    getenv('ODDS_APP_URL') ?: 'http://localhost:3000',
);
$admin = new AdminController($views, $offers);

$app->get('/', [$controller, 'index']);
$app->get('/free-bets', [$controller, 'index']);
$app->post('/newsletter/subscribe', [$controller, 'subscribe']);
$app->get('/admin/login', [$admin, 'loginPage']);
$app->post('/admin/login', [$admin, 'login']);

$requireAdmin = static function ($request, $handler) use ($app) {
    if (!($_SESSION['freebets_admin'] ?? false)) {
        return $app->getResponseFactory()->createResponse(302)
            ->withHeader('Location', '/admin/login');
    }

    return $handler->handle($request);
};

$app->group('/admin', static function (RouteCollectorProxy $group) use ($admin): void {
    $group->get('/offers', [$admin, 'index']);
    $group->get('/offers/new', [$admin, 'newOffer']);
    $group->get('/offers/{id:[0-9]+}/edit', [$admin, 'edit']);
    $group->post('/offers/save', [$admin, 'save']);
    $group->post('/offers/{id:[0-9]+}/delete', [$admin, 'delete']);
    $group->post('/logout', [$admin, 'logout']);
})->add($requireAdmin);

$app->addRoutingMiddleware();
$app->addErrorMiddleware(
    filter_var(getenv('APP_DEBUG') ?: 'false', FILTER_VALIDATE_BOOLEAN),
    true,
    true,
);

$app->run();