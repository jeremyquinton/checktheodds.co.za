<?php

declare(strict_types=1);

namespace CheckTheOdds\FreeBets\Controller;

use CheckTheOdds\FreeBets\Repository\OfferRepository;
use InvalidArgumentException;
use PDOException;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Twig\Environment;
use Throwable;

final class AdminController
{
    public function __construct(
        private Environment $views,
        private OfferRepository $offers,
    ) {
    }

    public function loginPage(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        if ($_SESSION['freebets_admin'] ?? false) {
            return $this->redirect($response, '/admin/offers');
        }

        return $this->render($response, 'admin/login.twig', [
            'csrf' => $this->csrfToken(),
            'error' => null,
            'configured' => (bool) (getenv('FREEBETS_ADMIN_PASSWORD_HASH') ?: ''),
        ]);
    }

    public function login(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $body = $this->body($request);
        if (!$this->validCsrf($body)) {
            return $this->render($response->withStatus(400), 'admin/login.twig', [
                'csrf' => $this->csrfToken(),
                'error' => 'The form expired. Please try again.',
                'configured' => (bool) (getenv('FREEBETS_ADMIN_PASSWORD_HASH') ?: ''),
            ]);
        }

        $passwordHash = getenv('FREEBETS_ADMIN_PASSWORD_HASH') ?: '';
        if ($passwordHash === '') {
            return $this->render($response->withStatus(503), 'admin/login.twig', [
                'csrf' => $this->csrfToken(),
                'error' => 'Admin access is not configured on this server.',
                'configured' => false,
            ]);
        }

        if (password_verify((string) ($body['password'] ?? ''), $passwordHash)) {
            session_regenerate_id(true);
            $_SESSION['freebets_admin'] = true;
            return $this->redirect($response, '/admin/offers');
        }

        return $this->render($response->withStatus(401), 'admin/login.twig', [
            'csrf' => $this->csrfToken(),
            'error' => 'Password not recognized.',
            'configured' => true,
        ]);
    }

    public function index(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return $this->render($response, 'admin/offers.twig', [
            'offers' => $this->offers->all(),
            'csrf' => $this->csrfToken(),
        ]);
    }

    public function newOffer(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return $this->render($response, 'admin/offer-form.twig', [
            'offer' => $this->emptyOffer(),
            'csrf' => $this->csrfToken(),
            'error' => null,
        ]);
    }

    public function edit(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $offer = $this->offers->find((int) $args['id']);
        if ($offer === null) {
            return $this->render($response->withStatus(404), 'admin/message.twig', [
                'title' => 'Offer not found',
                'message' => 'That offer no longer exists.',
            ]);
        }

        return $this->render($response, 'admin/offer-form.twig', [
            'offer' => $offer,
            'csrf' => $this->csrfToken(),
            'error' => null,
        ]);
    }

    public function save(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $body = $this->body($request);
        if (!$this->validCsrf($body)) {
            return $this->render($response->withStatus(400), 'admin/offer-form.twig', [
                'offer' => $body,
                'csrf' => $this->csrfToken(),
                'error' => 'The form expired. Please try again.',
            ]);
        }

        $id = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
        try {
            $this->offers->save($body, $id === false ? null : $id);
            return $this->redirect($response, '/admin/offers');
        } catch (InvalidArgumentException $error) {
            return $this->render($response->withStatus(422), 'admin/offer-form.twig', [
                'offer' => $body,
                'csrf' => $this->csrfToken(),
                'error' => $error->getMessage(),
            ]);
        } catch (PDOException $error) {
            return $this->render($response->withStatus(422), 'admin/offer-form.twig', [
                'offer' => $body,
                'csrf' => $this->csrfToken(),
                'error' => 'The offer could not be saved. Check that its slug is unique.',
            ]);
        } catch (Throwable $error) {
            error_log($error->getMessage());
            return $this->render($response->withStatus(500), 'admin/offer-form.twig', [
                'offer' => $body,
                'csrf' => $this->csrfToken(),
                'error' => 'The offer could not be saved.',
            ]);
        }
    }

    public function delete(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $body = $this->body($request);
        if (!$this->validCsrf($body)) {
            return $response->withStatus(400);
        }

        $this->offers->delete((int) $args['id']);
        return $this->redirect($response, '/admin/offers');
    }

    public function logout(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        if (!$this->validCsrf($this->body($request))) {
            return $response->withStatus(400);
        }

        unset($_SESSION['freebets_admin']);
        session_regenerate_id(true);
        return $this->redirect($response, '/admin/login');
    }

    private function emptyOffer(): array
    {
        return [
            'id' => null,
            'slug' => '',
            'bookmaker_name' => '',
            'category' => 'free-bets',
            'headline' => '',
            'description' => '',
            'bonus_amount' => '',
            'currency' => 'ZAR',
            'minimum_deposit' => '',
            'wagering_requirements' => '',
            'qualifying_odds' => '',
            'valid_for' => '',
            'offer_url' => '',
            'terms_text' => '',
            'is_active' => true,
            'is_example' => true,
        ];
    }

    private function body(ServerRequestInterface $request): array
    {
        $body = $request->getParsedBody();
        return is_array($body) ? $body : [];
    }

    private function csrfToken(): string
    {
        if (!isset($_SESSION['freebets_csrf'])) {
            $_SESSION['freebets_csrf'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['freebets_csrf'];
    }

    private function validCsrf(array $body): bool
    {
        return isset($body['_csrf'], $_SESSION['freebets_csrf']) &&
            is_string($body['_csrf']) &&
            hash_equals($_SESSION['freebets_csrf'], $body['_csrf']);
    }

    private function render(ResponseInterface $response, string $template, array $data): ResponseInterface
    {
        $data['authenticated'] = (bool) ($_SESSION['freebets_admin'] ?? false);
        $response->getBody()->write($this->views->render($template, $data));
        return $response->withHeader('Content-Type', 'text/html; charset=utf-8');
    }

    private function redirect(ResponseInterface $response, string $location): ResponseInterface
    {
        return $response->withStatus(303)->withHeader('Location', $location);
    }
}