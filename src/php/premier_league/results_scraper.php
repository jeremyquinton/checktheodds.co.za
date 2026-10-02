<?php

declare(strict_types=1);

require dirname(__DIR__, 3) . '/vendor/autoload.php';

use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;

const API_BASE_URI = 'https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v2/';
const COMPETITION_ID = 8;
const SEASONS_TO_REBUILD = 10;
const LAST_MATCHWEEK = 38;
const PAGE_SIZE = 20;

function createConnection(): PDO
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

function fetchMatchweek(Client $client, int $season, int $matchweek, int $delayMs): array
{
    $matches = [];
    $cursor = null;
    $seenCursors = [];

    do {
        $query = [
            'competition' => COMPETITION_ID,
            'season' => $season,
            'matchweek' => $matchweek,
            '_limit' => PAGE_SIZE,
        ];
        if ($cursor !== null) {
            $query['_next'] = $cursor;
        }

        $attempt = 0;
        while (true) {
            try {
                $response = $client->get('matches', ['query' => $query]);
                break;
            } catch (GuzzleException $error) {
                $attempt++;
                if ($attempt >= 3) {
                    throw $error;
                }
                usleep(500_000 * $attempt);
            }
        }

        $payload = json_decode(
            (string) $response->getBody(),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );
        if (!is_array($payload) || !is_array($payload['data'] ?? null)) {
            throw new RuntimeException(
                sprintf('Unexpected API response for season %d matchweek %d.', $season, $matchweek),
            );
        }

        array_push($matches, ...$payload['data']);
        $nextCursor = $payload['pagination']['_next'] ?? null;
        if ($nextCursor !== null) {
            if (!is_string($nextCursor) || $nextCursor === '' || isset($seenCursors[$nextCursor])) {
                throw new RuntimeException(
                    sprintf('Invalid pagination cursor for season %d matchweek %d.', $season, $matchweek),
                );
            }
            $seenCursors[$nextCursor] = true;
        }
        $cursor = $nextCursor;

        if ($delayMs > 0 && $cursor !== null) {
            usleep($delayMs * 1000);
        }
    } while ($cursor !== null);

    return $matches;
}

function nullableInt(mixed $value): ?int
{
    return is_numeric($value) ? (int) $value : null;
}

function currentPremierLeagueSeason(): int
{
    $today = new DateTimeImmutable('now', new DateTimeZone('Europe/London'));
    $year = (int) $today->format('Y');

    return (int) $today->format('n') >= 8 ? $year : $year - 1;
}

function saveMatchweek(PDO $connection, array $matches, int $season, int $matchweek, string $scrapedAt): void
{
    $upsertTeam = $connection->prepare(
        'INSERT INTO premier_league_teams (name) VALUES (:name) '
        . 'ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)',
    );
    $upsertMatch = $connection->prepare(
        'INSERT INTO premier_league_matches (
            external_match_id, season, matchweek, kickoff, kickoff_timezone,
            phase, period, result_type, ground, attendance,
            home_team_id, away_team_id, home_score, away_score,
            home_half_time_score, away_half_time_score,
            home_red_cards, away_red_cards, scraped_at
        ) VALUES (
            :match_id, :season, :matchweek, :kickoff, :kickoff_timezone,
            :phase, :period, :result_type, :ground, :attendance,
            :home_team_id, :away_team_id, :home_score, :away_score,
            :home_half_time_score, :away_half_time_score,
            :home_red_cards, :away_red_cards, :scraped_at
        ) ON DUPLICATE KEY UPDATE
            season = VALUES(season),
            matchweek = VALUES(matchweek),
            kickoff = VALUES(kickoff),
            kickoff_timezone = VALUES(kickoff_timezone),
            phase = VALUES(phase),
            period = VALUES(period),
            result_type = VALUES(result_type),
            ground = VALUES(ground),
            attendance = VALUES(attendance),
            home_team_id = VALUES(home_team_id),
            away_team_id = VALUES(away_team_id),
            home_score = VALUES(home_score),
            away_score = VALUES(away_score),
            home_half_time_score = VALUES(home_half_time_score),
            away_half_time_score = VALUES(away_half_time_score),
            home_red_cards = VALUES(home_red_cards),
            away_red_cards = VALUES(away_red_cards),
            scraped_at = VALUES(scraped_at)',
    );

    $connection->beginTransaction();
    try {
        foreach ($matches as $match) {
            $homeTeam = $match['homeTeam'] ?? null;
            $awayTeam = $match['awayTeam'] ?? null;
            $matchId = $match['matchId'] ?? null;
            if (!is_array($homeTeam) || !is_array($awayTeam) ||
                empty($homeTeam['name']) || empty($awayTeam['name']) || empty($matchId)) {
                throw new RuntimeException(
                    sprintf('Incomplete match data in season %d matchweek %d.', $season, $matchweek),
                );
            }

            $upsertTeam->execute(['name' => $homeTeam['name']]);
            $homeTeamId = (int) $connection->lastInsertId();
            $upsertTeam->execute(['name' => $awayTeam['name']]);
            $awayTeamId = (int) $connection->lastInsertId();

            $upsertMatch->execute([
                'match_id' => (string) $matchId,
                'season' => $season,
                'matchweek' => $matchweek,
                'kickoff' => $match['kickoff'] ?: null,
                'kickoff_timezone' => $match['kickoffTimezoneString'] ?? null,
                'phase' => $match['phase'] ?? null,
                'period' => $match['period'] ?? null,
                'result_type' => $match['resultType'] ?? null,
                'ground' => $match['ground'] ?? null,
                'attendance' => nullableInt($match['attendance'] ?? null),
                'home_team_id' => $homeTeamId,
                'away_team_id' => $awayTeamId,
                'home_score' => nullableInt($homeTeam['score'] ?? null),
                'away_score' => nullableInt($awayTeam['score'] ?? null),
                'home_half_time_score' => nullableInt($homeTeam['halfTimeScore'] ?? null),
                'away_half_time_score' => nullableInt($awayTeam['halfTimeScore'] ?? null),
                'home_red_cards' => nullableInt($homeTeam['redCards'] ?? null),
                'away_red_cards' => nullableInt($awayTeam['redCards'] ?? null),
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
}

function main(): void
{
    $options = getopt('', ['mode:', 'from:', 'to:', 'season:', 'dry-run', 'delay-ms:']);
    $mode = $options['mode'] ?? 'rebuild';
    if (!in_array($mode, ['rebuild', 'update'], true)) {
        throw new RuntimeException('Mode must be either rebuild or update.');
    }

    $hasSingleSeason = isset($options['season']);
    $hasSeasonRange = isset($options['from']) || isset($options['to']);
    if ($mode === 'update' && ($hasSingleSeason || $hasSeasonRange)) {
        throw new RuntimeException('Update mode always uses the current Premier League season.');
    }
    if ($hasSingleSeason && (isset($options['from']) || isset($options['to']))) {
        throw new RuntimeException('Use --season by itself, or use --from and --to.');
    }

    $currentSeason = currentPremierLeagueSeason();
    if ($mode === 'update') {
        $firstSeason = $currentSeason;
        $lastSeason = $currentSeason;
    } elseif ($hasSingleSeason) {
        $firstSeason = (int) $options['season'];
        $lastSeason = $firstSeason;
    } else {
        $firstSeason = (int) ($options['from'] ?? $currentSeason - SEASONS_TO_REBUILD + 1);
        $lastSeason = (int) ($options['to'] ?? $currentSeason);
    }
    $delayMs = max(0, (int) ($options['delay-ms'] ?? (getenv('PREMIER_LEAGUE_API_DELAY_MS') ?: 100)));
    $dryRun = array_key_exists('dry-run', $options);

    if ($firstSeason < 1992 || $lastSeason < $firstSeason) {
        throw new RuntimeException('Season range must start at 1992 or later and end no earlier than it starts.');
    }

    $client = new Client([
        'base_uri' => API_BASE_URI,
        'connect_timeout' => 15,
        'timeout' => 45,
        'headers' => [
            'Accept' => 'application/json',
            'User-Agent' => 'CheckTheOdds historical results scraper/1.0',
        ],
    ]);
    $connection = $dryRun ? null : createConnection();
    $scrapedAt = (new DateTimeImmutable())->format('Y-m-d H:i:s.v');
    $totalMatches = 0;

    printf(
        "Mode: %s; loading Premier League seasons %d–%d%s\n",
        $mode,
        $firstSeason,
        $lastSeason,
        $dryRun ? ' (dry run; database unchanged)' : '',
    );

    for ($season = $firstSeason; $season <= $lastSeason; $season++) {
        $seasonMatches = 0;
        for ($matchweek = 1; $matchweek <= LAST_MATCHWEEK; $matchweek++) {
            $matches = fetchMatchweek($client, $season, $matchweek, $delayMs);
            if (!$dryRun && $connection instanceof PDO) {
                saveMatchweek($connection, $matches, $season, $matchweek, $scrapedAt);
            }
            $seasonMatches += count($matches);
        }

        $totalMatches += $seasonMatches;
        printf("Season %d: %d matches across %d matchweeks\n", $season, $seasonMatches, LAST_MATCHWEEK);
    }

    printf("Complete: %d matches across %d seasons%s\n", $totalMatches, $lastSeason - $firstSeason + 1, $dryRun ? ' (not saved)' : ' saved');
    $connection = null;
}

try {
    main();
} catch (Throwable $error) {
    fwrite(STDERR, sprintf("Results scrape failed: %s\n", $error->getMessage()));
    exit(1);
}