# Check the Odds

Puppeteer scrapers for Premier League odds from Virgin Bet, Betway, Play.co.za,
Hollywoodbets, Betfair South Africa, YesPlay, and Supabets.

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
```

Run every scraper sequentially:

```sh
npm run scrape:all
```

Each scraper prints JSON and writes it to `odds.json`, `betway_odds.json`, or
the bookmaker-specific odds file. Events include their IDs, teams, start times,
available event URLs, and decimal home/draw/away odds.

The Betfair scraper records the best available back price for each `1/X/2`
selection. Lay prices are not included in the comparison.

## MySQL

Create the database and tables:

```sh
mysql -u root -p < schema.sql
```

Configure the connection with `MYSQL_URL`, or export the individual values from
`.env.example`: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and
`MYSQL_DATABASE`. Environment files are not loaded automatically.

Each scraper upserts its bookmaker, competition, and matches, then adds a new
row to `odds_snapshots` for every event. To run without a database temporarily:

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
