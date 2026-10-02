<?php

declare(strict_types=1);

namespace CheckTheOdds\FreeBets\Database;

use PDO;
use RuntimeException;

final class ConnectionFactory
{
    public static function create(): PDO
    {
        $host = getenv('MYSQL_HOST') ?: '127.0.0.1';
        $port = (int) (getenv('MYSQL_PORT') ?: 3306);
        $database = getenv('MYSQL_DATABASE') ?: 'checktheodds';
        $username = getenv('MYSQL_USER') ?: 'root';
        $password = getenv('MYSQL_PASSWORD') ?: '';
        $mysqlUrl = getenv('MYSQL_URL');

        if ($mysqlUrl !== false && $mysqlUrl !== '') {
            $parts = parse_url($mysqlUrl);
            if ($parts === false || ($parts['scheme'] ?? '') !== 'mysql') {
                throw new RuntimeException('MYSQL_URL must use the mysql:// scheme.');
            }

            $host = $parts['host'] ?? $host;
            $port = (int) ($parts['port'] ?? $port);
            $database = ltrim($parts['path'] ?? '', '/') ?: $database;
            $username = isset($parts['user']) ? rawurldecode($parts['user']) : $username;
            $password = isset($parts['pass']) ? rawurldecode($parts['pass']) : $password;
        }

        return new PDO(
            sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $host, $port, $database),
            $username,
            $password,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ],
        );
    }
}