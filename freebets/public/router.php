<?php

declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$publicRoot = realpath(__DIR__);
$requestedFile = realpath(__DIR__ . DIRECTORY_SEPARATOR . ltrim($path, '/'));

if (
    $path !== '/' &&
    $publicRoot !== false &&
    $requestedFile !== false &&
    str_starts_with($requestedFile, $publicRoot . DIRECTORY_SEPARATOR) &&
    is_file($requestedFile)
) {
    return false;
}

require __DIR__ . '/index.php';