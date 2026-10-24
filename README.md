# Check the Odds

Puppeteer scrapers for Premier League odds from Virgin Bet, Betway, Play.co.za,
Hollywoodbets, Betfair South Africa, YesPlay, Supabets, Easybet, SportyBet,
Sportingbet, Betfred, PantherBet, ZARbet, and SuperSportBet.

## Run

```sh
composer install
npm install
npm run serve
```

The odds comparison UI is served by PHP at `http://127.0.0.1:3000`. PHP must have
PDO MySQL enabled; the page and its JSON routes use the same `MYSQL_*` variables
or `MYSQL_URL` as the scrapers. The PHP page renders current odds on first load,
and the existing browser script handles fixture navigation and odds formatting.

The bookmaker-specific scraper commands are:

```sh
npm run scrape:virgin-bet
npm run scrape:betway
npm run scrape:play
npm run scrape:hollywoodbets
npm run scrape:betfair-sa
npm run scrape:yesplay
npm run scrape:yesplay-promotions
npm run scrape:virgin-bet-promotions
npm run scrape:betway-promotions
<<<<<<< Updated upstream
npm run scrape:play-promotions
=======
npm run scrape:hollywoodbets-promotions
>>>>>>> Stashed changes
npm run scrape:supabets
npm run scrape:easybet
npm run scrape:sportybet
npm run scrape:sportingbet
npm run scrape:betfred
npm run scrape:pantherbet
npm run scrape:zarbet
npm run scrape:supersportbet
npm run scrape:injuries
npm run scrape:results
npm run scrape:match-stats
```

`npm start` remains an alias for the Virgin Bet scraper. New bookmaker odds are
loaded from the `bookmakers` table, so adding a scraper does not require adding
another UI-specific bookmaker entry.

Run the separate Slim-based Bethunter free-bets app and compile its Tailwind stylesheet:

```sh
npm run freebets:css
npm run freebets:serve
```

Open `http://127.0.0.1:8080`. The PHP entry point is
`freebets/public/index.php`; the built-in server uses
`freebets/public/router.php`. Offers are stored in `free_bet_offers` and can be
managed at `http://127.0.0.1:8080/admin/login`. Seeded offers are illustrative,
not live promotions. New offers default to illustrative until an admin marks
them as verified.

Imported bookmaker promotions are curated separately at
`http://127.0.0.1:8080/admin/promotions`. Apply
`migrations/20261016_add_bookmaker_promotion_curation.sql` after creating
`bookmaker_promotions`. Scraped offers appear as drafts; edit their display
category, tags, text, image, action, and order before publishing. Scrapers update
source fields without replacing curation. The public page shows only offers that
are both active at the source and published by an admin.
The admin promotions list and review page link to each scraped source page and
the original action/claim destination. These links open in a new tab; the original
claim link remains available even when you override the public button destination.

Set up the admin password with a PHP-generated password hash; never put the
plaintext password in configuration:

```sh
read -s "ADMIN_PASSWORD?Admin password: "
export ADMIN_PASSWORD
export FREEBETS_ADMIN_PASSWORD_HASH="$(php -r 'echo password_hash(getenv("ADMIN_PASSWORD"), PASSWORD_DEFAULT);')"
unset ADMIN_PASSWORD
npm run freebets:serve
```

Configure MySQL with the existing `MYSQL_*` variables or `MYSQL_URL`, then apply
`schema.sql` to create the offer table and its clearly marked example rows.
Environment files are not loaded automatically.

The YesPlay promotions scraper reads the full public promotion catalog, writes
`yesplay_promotions.json`, and syncs current cards to `bookmaker_promotions`.
Apply `migrations/20261002_create_bookmaker_promotions.sql` before syncing. Use
`npm run scrape:yesplay-promotions -- --dry-run` to write JSON without changing
the database. Failed or empty scrapes leave the existing active promotions
untouched; the free-bet comparison table remains separate until offers are
reviewed and labeled.

The Virgin Bet promotions scraper reads the promotions iframe, imports its offer
copy and official image URLs, and is previewable with
`npm run scrape:virgin-bet-promotions -- --dry-run`. A normal run writes
`virgin_bet_promotions.json` and syncs source offers; imported Virgin Bet offers
remain unpublished until reviewed in the admin. Confirm the rights for source
creative before publishing it on the public page.

The Betway promotions scraper reads Betway's structured live promotions feed,
including descriptions, banner paths, categories, and CTAs. Preview it with
`npm run scrape:betway-promotions -- --dry-run`; a normal run writes
`betway_promotions.json` and syncs source offers. It refuses to sync a response
with fewer than 15 complete promotions to avoid deactivating offers after a
partial feed response.

<<<<<<< Updated upstream
The Play.co.za promotions scraper reads the rendered promotion cards, including
their source IDs, category labels, copy, and artwork. It uses a visible browser
by default because Play blocks the headless request; set `HEADLESS=true` only if
the site allows it in your environment. Preview with
`npm run scrape:play-promotions -- --dry-run`; a normal run writes
`play_promotions.json` and syncs source offers.

Node scraper modules are in `src/js/`, with Premier League scrapers in
`src/js/premier_league/`. The main odds UI and its data routes are in `public/`
and `src/php/premier_league/`; PHP CLI scrapers are in `src/php/premier_league/`.
=======
The Hollywoodbets promotions scraper reads the public CMS feed used by
`https://www.hollywoodbets.net/promotions`, including all pages of results.
Preview it with `npm run scrape:hollywoodbets-promotions -- --dry-run`; a normal
run writes `hollywoodbets_promotions.json` and syncs active offers to MySQL.
It imports source descriptions, categories (or `Other` when unclassified),
official image URLs, South African validity dates, and action/claim destinations.
New offers remain drafts in the admin until reviewed and published.
Failed, partial, duplicate, or incomplete responses, or fewer than 15 active
offers, leave existing database promotions untouched. Dry runs write neither
JSON files nor database rows. Run its regression tests with
`node --test src/js/promotions/hollywoodbets_promotions_scraper.test.js`.

Shared Node modules are in `src/js/`, with Premier League scrapers in
`src/js/premier_league/`. PHP CLI scrapers are in `src/php/premier_league/`.
>>>>>>> Stashed changes

Run every scraper sequentially:

```sh
npm run scrape:all
```

Each scraper prints JSON and writes it to `odds.json`, `betway_odds.json`, or
the bookmaker-specific odds file, including `easybet_odds.json`,
`sportybet_odds.json`, `sportingbet_odds.json`, `betfred_odds.json`, and
`pantherbet_odds.json`, `zarbet_odds.json`, and `supersportbet_odds.json`. Events include
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

To export an AI-ready JSON context for a canonical fixture ID:

```sh
npm run fixture:context -- --match-id=2645252 --form-limit=15
```

The command supports `PreMatch` fixtures; the score remains `null` until results
are available. For clean JSON output to pass to another tool or model:

```sh
npm run --silent fixture:context -- --match-id=2645252 --form-limit=15 > match-context.json
```

The JSON includes the fixture, recent Premier League form, season venue records,
H2H, available xG/xGA, injuries with per-player source links and snapshot/source
update timestamps, upcoming Premier League fixtures, and latest 1X2 bookmaker
odds. Suspensions, lineups, other competitions, and over/under prices are marked
unavailable because they are not in the current database.

Export every stored fixture in the next scheduled Premier League matchweek,
including its full context and best available stored 1X2 prices:

```sh
npm run --silent matchweek:context > matchweek-context.json
```

Auto-selection uses the earliest `PreMatch` fixture dated today (UTC) or later
in the latest stored season. It exports that entire matchweek, including any
completed, postponed, or rescheduled fixtures in it. To select a particular
week, use the season's start year:

```sh
npm run --silent fixture:context -- --matchweek=8 --season=2026 --form-limit=15 > matchweek-context.json
```

The top-level `bestOdds` table gives the highest decimal home/draw/away price
for each fixture, with all tied bookmakers, market links and capture timestamps.
`fixtures` contains the full contexts and each fixture's `bookmakerOdds.bestOdds`.
Only the latest snapshot per bookmaker is compared; missing or invalid prices
produce `null`, and fixtures without odds are retained. Best odds mean highest
price, not a prediction or value-bet recommendation. Prices can be stale, so
verify them with the bookmaker. Injury and odds snapshots are current rather
than historical as-of-kickoff data; this is not a leakage-free backtesting export.
This reads the existing database and does not run scrapers or call an LLM.

Run the focused context tests with `npm run test:context`.

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
