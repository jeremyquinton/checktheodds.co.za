<?php

declare(strict_types=1);

require dirname(__DIR__, 3) . '/vendor/autoload.php';

use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;
use GuzzleHttp\Exception\RequestException;

const MATCH_STATS_API_BASE_URI = 'https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v3/';

function createStatsConnection(): PDO
{
    $mysqlUrl = getenv('MYSQL_URL');
    $host = getenv('MYSQL_HOST') ?: '127.0.0.1';
    $port = (int) (getenv('MYSQL_PORT') ?: 3306);
    $database = getenv('MYSQL_DATABASE') ?: 'checktheodds';
    $username = getenv('MYSQL_USER') ?: 'root';
    $password = getenv('MYSQL_PASSWORD') ?: '';

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

    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        $host,
        $port,
        $database,
    );

    return new PDO($dsn, $username, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function fetchMatchStats(Client $client, string $externalMatchId): ?array
{
    for ($attempt = 1; $attempt <= 3; $attempt++) {
        try {
            $response = $client->get(sprintf('matches/%s/stats', rawurlencode($externalMatchId)));
            $payload = json_decode(
                (string) $response->getBody(),
                true,
                512,
                JSON_THROW_ON_ERROR,
            );
            if (!is_array($payload)) {
                throw new RuntimeException(sprintf('Unexpected stats response for match %s.', $externalMatchId));
            }
            if ($payload === []) {
                return null;
            }

            $statsBySide = [];
            foreach ($payload as $teamStats) {
                if (!is_array($teamStats)) {
                    continue;
                }

                $side = $teamStats['side'] ?? null;
                if (!in_array($side, ['Home', 'Away'], true) || !is_array($teamStats['stats'] ?? null)) {
                    continue;
                }
                $statsBySide[$side] = $teamStats['stats'];
            }

            if (!isset($statsBySide['Home'], $statsBySide['Away'])) {
                throw new RuntimeException(sprintf('Stats response for match %s did not include both teams.', $externalMatchId));
            }

            return $statsBySide;
        } catch (GuzzleException $error) {
            if ($error instanceof RequestException && $error->getResponse()?->getStatusCode() === 404) {
                return null;
            }
            if ($attempt === 3) {
                throw $error;
            }
            usleep(500_000 * $attempt);
        }
    }

    return null;
}

function saveMatchStats(PDO $connection, array $match, array $statsBySide, string $scrapedAt): int
{
    $statement = $connection->prepare(
        'INSERT INTO premier_league_match_team_stats (
            premier_league_match_id, team_id, side, stats, scraped_at
        ) VALUES (:match_id, :team_id, :side, :stats, :scraped_at)
        ON DUPLICATE KEY UPDATE
            team_id = VALUES(team_id),
            stats = VALUES(stats),
            scraped_at = VALUES(scraped_at)',
    );

    $connection->beginTransaction();
    try {
        foreach (['Home', 'Away'] as $side) {
            $teamId = $side === 'Home' ? $match['home_team_id'] : $match['away_team_id'];
            $statement->execute([
                'match_id' => $match['id'],
                'team_id' => $teamId,
                'side' => $side,
                'stats' => json_encode($statsBySide[$side], JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION),
                'scraped_at' => $scrapedAt,
            ]);
        }

        $connection->commit();
    } catch (Throwable $error) {
        if ($connection->inTransaction()) {
            $connection->rollBack();
        }
        throw $error;
    }

    return 2;
}

function selectMatches(PDO $connection, array $options): array
{
    $matchId = $options['match-id'] ?? null;
    $hasSeason = isset($options['season']);
    $hasRange = isset($options['from']) || isset($options['to']);
    if ($matchId !== null && ($hasSeason || $hasRange)) {
        throw new RuntimeException('Use --match-id by itself, or filter by season/range.');
    }
    if ($hasSeason && $hasRange) {
        throw new RuntimeException('Use --season by itself, or use --from and --to.');
    }

    $conditions = [];
    $parameters = [];
    if ($matchId !== null) {
        $conditions[] = 'matches.external_match_id = :match_id';
        $parameters['match_id'] = (string) $matchId;
    } elseif ($hasSeason) {
        $conditions[] = 'matches.season = :season';
        $parameters['season'] = (int) $options['season'];
    } elseif ($hasRange) {
        $firstSeason = (int) ($options['from'] ?? $options['to']);
        $lastSeason = (int) ($options['to'] ?? $options['from']);
        if ($firstSeason > $lastSeason) {
            throw new RuntimeException('The --from season must be no later than --to.');
        }
        $conditions[] = 'matches.season BETWEEN :first_season AND :last_season';
        $parameters['first_season'] = $firstSeason;
        $parameters['last_season'] = $lastSeason;
    }

    if (!array_key_exists('refresh', $options) && $matchId === null) {
        $conditions[] = 'NOT EXISTS (
            SELECT 1 FROM premier_league_match_team_stats existing_stats
            WHERE existing_stats.premier_league_match_id = matches.id
        )';
    }

    $where = $conditions ? 'WHERE ' . implode(' AND ', $conditions) : '';
    $statement = $connection->prepare(
        'SELECT matches.id, matches.external_match_id, matches.season, matches.matchweek,
            matches.period,
                matches.home_team_id, matches.away_team_id
         FROM premier_league_matches matches '
        . $where . '
         ORDER BY matches.kickoff, matches.external_match_id',
    );
    $statement->execute($parameters);
    $matches = $statement->fetchAll();

    if ($matchId !== null && $matches === []) {
        throw new RuntimeException(sprintf(
            'Match %s is not in premier_league_matches. Import its season results first.',
            $matchId,
        ));
    }

    return $matches;
}

function main(): int
{
    $options = getopt('', ['match-id:', 'season:', 'from:', 'to:', 'refresh', 'dry-run', 'delay-ms:']);
    $delayMs = max(0, (int) ($options['delay-ms'] ?? (getenv('PREMIER_LEAGUE_API_DELAY_MS') ?: 100)));
    $dryRun = array_key_exists('dry-run', $options);
    $connection = createStatsConnection();
    $matches = selectMatches($connection, $options);
    $client = new Client([
        'base_uri' => MATCH_STATS_API_BASE_URI,
        'connect_timeout' => 15,
        'timeout' => 45,
        'headers' => [
            'Accept' => 'application/json',
            'User-Agent' => 'CheckTheOdds match stats scraper/1.0',
        ],
    ]);
    $scrapedAt = (new DateTimeImmutable())->format('Y-m-d H:i:s.v');
    $savedMatches = 0;
    $savedTeamStats = 0;
    $missingStats = 0;
    $failedMatches = 0;

    printf(
        "Processing %d stored matches%s\n",
        count($matches),
        $dryRun ? ' (dry run; database unchanged)' : '',
    );

    foreach ($matches as $index => $match) {
        try {
            if (($match['period'] ?? null) === 'PreMatch') {
                $missingStats++;
                printf("Pre-match fixture %s has no stats yet; skipped\n", $match['external_match_id']);
                continue;
            }

            $statsBySide = fetchMatchStats($client, (string) $match['external_match_id']);
            if ($statsBySide === null) {
                $missingStats++;
                printf("No team stats for match %s; skipped\n", $match['external_match_id']);
            } else {
                if (!$dryRun) {
                    $savedTeamStats += saveMatchStats($connection, $match, $statsBySide, $scrapedAt);
                } else {
                    $savedTeamStats += 2;
                }
                $savedMatches++;
            }
        } catch (Throwable $error) {
            if ($error instanceof PDOException) {
                throw $error;
            }
            $failedMatches++;
            fwrite(STDERR, sprintf("Match %s failed: %s\n", $match['external_match_id'], $error->getMessage()));
        }

        if ($delayMs > 0) {
            usleep($delayMs * 1000);
        }
        if (($index + 1) % 50 === 0) {
            printf("Processed %d of %d matches\n", $index + 1, count($matches));
        }
    }

    printf(
        "Complete: %d matches with stats, %d team stat records%s, %d without stats, %d failed\n",
        $savedMatches,
        $savedTeamStats,
        $dryRun ? ' would be written' : ' saved',
        $missingStats,
        $failedMatches,
    );

    return $failedMatches > 0 ? 1 : 0;
}

try {
    exit(main());
} catch (Throwable $error) {
    fwrite(STDERR, sprintf("Match stats scrape failed: %s\n", $error->getMessage()));
    exit(1);
}