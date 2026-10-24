import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMatchweekContext, parseArguments, selectBestOdds } from './match_context.js';

test('parses match IDs, automatic weeks and explicit season/week selection', () => {
  assert.equal(parseArguments(['--match-id=123']).matchId, '123');
  assert.equal(parseArguments(['--matchweek']).matchweek, 'auto');
  assert.equal(parseArguments(['--matchweek=auto']).matchweek, 'auto');
  assert.deepEqual(parseArguments(['--matchweek', '8', '--season', '2026', '--form-limit=10']), {
    matchId: null, matchweek: 8, season: 2026, formLimit: 10,
  });
});

test('rejects ambiguous selectors and invalid ranges', () => {
  for (const args of [
    [], ['--matchweek', '--match-id=123'], ['--matchweek=0'], ['--matchweek=39'],
    ['--matchweek=1.5'], ['--matchweek=unknown'], ['--matchweek', '--season=26'],
    ['--match-id=123', '--season=2026'], ['--matchweek', '--form-limit=9'], ['--unknown'],
  ]) {
    assert.throws(() => parseArguments(args));
  }
});

test('selects each outcome independently and preserves ties and provenance', () => {
  const prices = [
    { bookmaker: 'A', bookmakerSlug: 'a', home: 2.5, draw: 3.2, away: 4, capturedAt: '2026-10-17', marketUrl: 'https://example.com/a' },
    { bookmaker: 'B', bookmakerSlug: 'b', home: 2.5, draw: 3.6, away: 3.8, capturedAt: '2026-10-16', marketUrl: 'https://example.com/b' },
  ];
  const best = selectBestOdds(prices);
  assert.equal(best.home.decimalOdds, 2.5);
  assert.deepEqual(best.home.bookmakers.map((bookmaker) => bookmaker.name), ['A', 'B']);
  assert.equal(best.draw.decimalOdds, 3.6);
  assert.equal(best.away.decimalOdds, 4);
  assert.equal(best.draw.bookmakers[0].capturedAt, prices[1].capturedAt);
  assert.equal(best.draw.bookmakers[0].marketUrl, prices[1].marketUrl);
});

test('does not turn missing or invalid prices into best odds', () => {
  assert.deepEqual(selectBestOdds([]), { home: null, draw: null, away: null });
  assert.deepEqual(selectBestOdds([
    { home: null, draw: NaN, away: Infinity },
    { home: 0, draw: -1, away: 1 },
  ]), { home: null, draw: null, away: null });
});

function fixtureRows(matchId, odds = []) {
  return [
    [{
      id: Number(matchId), external_match_id: matchId, season: 2026, matchweek: 8,
      kickoff_local: '2026-10-17 15:00:00', kickoff_timezone: 'Europe/London',
      period: 'PreMatch', home_team_id: 1, away_team_id: 2,
      home_team: 'Everton', away_team: 'Chelsea', home_score: null, away_score: null,
    }],
    [], [], [], [], odds,
  ];
}

function queuedConnection(results) {
  const calls = [];
  return {
    calls,
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      assert.ok(results.length, 'Unexpected database call');
      return [results.shift()];
    },
    async query() { return [[]]; },
  };
}

test('auto exports the entire week with full contexts, prices and fixtures without odds', async () => {
  const matches = [
    { external_match_id: '101', season: 2026, matchweek: 8 },
    { external_match_id: '102', season: 2026, matchweek: 8 },
  ];
  const connection = queuedConnection([
    [{ season: 2026, matchweek: 8 }], matches,
    ...fixtureRows('101', [{ bookmaker: 'A', bookmaker_slug: 'a', home_odds: '2.500', draw_odds: null, away_odds: '3.000' }]),
    ...fixtureRows('102'),
  ]);
  const result = await buildMatchweekContext(connection);
  assert.equal(result.season, 2026);
  assert.equal(result.matchweek, 8);
  assert.equal(result.fixtureCount, 2);
  assert.equal(result.fixtures[0].teams.length, 2);
  assert.equal(result.fixtures[0].fixture.score, null);
  assert.equal(result.bestOdds[0].home.decimalOdds, 2.5);
  assert.equal(result.bestOdds[0].draw, null);
  assert.equal(result.bestOdds[1].home, null);
  assert.equal(result.fixtures[1].availability.injurySnapshotAvailable, false);
  assert.deepEqual(connection.calls[1].parameters, [2026, 8]);
  assert.doesNotMatch(connection.calls[1].sql, /period\s*=/);
  const oddsQuery = connection.calls.find((call) => call.sql.includes('ranked_odds'));
  assert.match(oddsQuery.sql, /PARTITION BY odds.bookmaker_id/);
  assert.match(oddsQuery.sql, /ORDER BY odds.scraped_at DESC/);
  assert.match(oddsQuery.sql, /WHERE position = 1/);
});

test('explicit week respects season and reports missing fixtures', async () => {
  const connection = queuedConnection([[]]);
  await assert.rejects(buildMatchweekContext(connection, { season: 2025, matchweek: 12 }), /No fixtures found/);
  assert.deepEqual(connection.calls[0].parameters, [2025, 12]);
});

test('auto selection reports missing upcoming fixtures', async () => {
  await assert.rejects(buildMatchweekContext(queuedConnection([[]])), /No upcoming matchweek/);
});