# Check the Odds

Puppeteer scrapers for Premier League odds from Virgin Bet, Betway, Play.co.za,
Hollywoodbets, Betfair South Africa, YesPlay, Supabets, and Easybet.

## Run

```sh
npm install
npm start
```

`npm start` scrapes Virgin Bet. The bookmaker-specific commands are:

```sh
npm run scrape:virgin-bet
npm run scrape:betway
npm run scrape:play
npm run scrape:hollywoodbets
npm run scrape:betfair-sa
npm run scrape:yesplay
npm run scrape:supabets
npm run scrape:easybet
npm run scrape:injuries
npm run scrape:results
npm run scrape:match-stats
```

Shared Node modules are in `src/js/`, with Premier League scrapers in
`src/js/premier_league/`. PHP CLI scrapers are in `src/php/premier_league/`.

Run every scraper sequentially:

```sh
npm run scrape:all
```

Each scraper prints JSON and writes it to `odds.json`, `betway_odds.json`, or
the bookmaker-specific odds file, including `easybet_odds.json`. Events include
their IDs, teams, start times, available event URLs, and decimal home/draw/away
odds.

The Premier League injuries scraper writes `premier_league_injuries.json` and
stores a timestamped snapshot in `premier_league_team_injuries` with team-linked player rows
in `premier_league_player_injuries`. Team records are stored in `premier_league_teams` so they
can be linked to fixtures and other Premier League data.

The PHP results scraper uses Guzzle and stores match results in
`premier_league_matches`, linked to `premier_league_teams` for home and away
clubs. Install PHP dependencies and apply the schema before running it:

```sh
composer install
mysql -u root -p < schema.sql
npm run scrape:results
```

Rebuild the latest ten seasons (2017–2026 today) or update only the current
season:

```sh
npm run rebuild:results
npm run update:results
```

Rebuild covers matchweeks 1–38 and follows the API pagination cursors. Update
re-fetches all current-season matchweeks and upserts by match ID, so a `PreMatch`
fixture gains its scores and `FullTime` period after the API reports a result.
For example, the current data has results through matchweek 5, while matchweek 6
is stored as `PreMatch` with null scores. To load one season or preview a run
without writing to MySQL:

```sh
npm run scrape:results -- --season=2025
npm run scrape:results -- --season=2025 --dry-run
```

The match-stats scraper reads stored `external_match_id` values and saves each
match's home and away metric objects as JSON in
`premier_league_match_team_stats`. By default it only fetches matches without
stats yet and skips `PreMatch` fixtures until they have been played. Run it
after the results scraper, or target one stored match:

```sh
npm run scrape:match-stats
npm run scrape:match-stats -- --match-id=2561895
npm run scrape:match-stats -- --season=2025 --dry-run
```

Use `--refresh` to fetch again for already stored matches. Match `2645209` from
the example URL is not currently in the imported 2016–2025 results; load its
season into `premier_league_matches` before requesting its stats.

For a fixture, `fixture_team_form.sql` returns each team's latest 15 prior
Premier League matches, xG/xGA where match stats are available, and current- and
previous-season home/away W-D-L records. Set `@fixture_external_match_id` to the
fixture's `external_match_id`; set `@form_match_count` to 10–15 as needed.

All JavaScript bookmaker scrapers map events to `premier_league_matches` using
normalized home/away team names from the next two upcoming matchweeks. Shared
aliases cover bookmaker short names such as `Coventry` and `Man Utd`. The
bookmaker kickoff must also be within three hours of the canonical kickoff to
allow for timezone differences. Unmatched or ambiguous events are logged with
the reason and nearest fixture candidates. Odds are stored in
`premier_league_odds_snapshots`. Betfair records the best available back price for each `1/X/2`
selection; lay prices are not included.

## MySQL

Create the database and tables:

```sh
mysql -u root -p < schema.sql
```

For an existing database moving off the legacy odds tables, apply the schema,
then run the one-time migration. It clears existing odds snapshots and drops
`matches` and `odds_snapshots` while preserving canonical results, stats, and
team data. Rebuild bookmaker odds afterward:

```sh
mysql -u root -p checktheodds < migrations/20261002_drop_legacy_odds_tables.sql
npm run scrape:all
```

For an existing database that still has a `teams` table, run the one-time
rename before applying the updated schema:

```sh
mysql -u root -p checktheodds < migrations/20261002_rename_teams_to_premier_league_teams.sql
mysql -u root -p < schema.sql
```

If your database still has the old `injury_scrapes` snapshot table, apply its
one-time rename as well:

```sh
mysql -u root -p checktheodds < migrations/20261002_rename_injury_scrapes_to_premier_league_team_injuries.sql
```

If it still has a `player_injuries` table, apply the child-table rename too:

```sh
mysql -u root -p checktheodds < migrations/20261002_rename_player_injuries_to_premier_league_player_injuries.sql
```

Configure the connection with `MYSQL_URL`, or export the individual values from
`.env.example`: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and
`MYSQL_DATABASE`. Environment files are not loaded automatically.

JavaScript bookmaker scrapers match upcoming events to
`premier_league_matches` and add snapshots to `premier_league_odds_snapshots`.
The PHP results scraper maintains canonical fixtures. To run a bookmaker
scraper without database writes temporarily:

```sh
SAVE_TO_DB=false npm run scrape:betway
```

Puppeteer runs headlessly by default. To watch the browser interaction:

```sh
HEADLESS=false npm start
```

The Play.co.za scraper runs with a visible browser by default because the site
returns HTTP 403 to Puppeteer's headless browser.

The YesPlay scraper also runs with a visible browser by default because
Cloudflare blocks its headless browser requests.# checktheodds.co.za
