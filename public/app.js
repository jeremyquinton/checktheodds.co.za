const comparison = document.querySelector('#comparison');
const fixtureSelect = document.querySelector('#fixture-select');
const refreshButton = document.querySelector('#refresh-button');
const previousButton = document.querySelector('#previous-fixture');
const nextButton = document.querySelector('#next-fixture');
const nextTenButton = document.querySelector('#next-ten-button');
const allFixturesButton = document.querySelector('#all-fixtures-button');
const fixtureCount = document.querySelector('#fixture-count');
const updatedAt = document.querySelector('#updated-at');

const bookmakerColors = {
  'betfair-sa': '#f2a900',
  betway: '#17191c',
  hollywoodbets: '#6f2c91',
  'virgin-bet': '#d71920',
  play: '#00695c',
  supabets: '#166534',
  yesplay: '#ef4135',
};

const bookmakerLogos = new Set([
  'betfair-sa',
  'betway',
  'hollywoodbets',
  'play',
  'supabets',
  'virgin-bet',
  'yesplay',
]);

let fixtures = [];
let visibleFixtures = [];
let selectedIndex = 0;
let showAllFixtures = false;
let injuryScrapedAt = null;
let injurySourceUpdatedAt = null;
let formRequestVersion = 0;

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function renderStatus(title, message) {
  const panel = createElement('div', 'status-panel');
  panel.append(createElement('strong', null, title));
  if (message) panel.append(createElement('p', null, message));
  comparison.replaceChildren(panel);
}

function formatPrice(price) {
  return Number(price).toFixed(2);
}

function getKickoffTimestamp(fixture) {
  const timestamps = (fixture.startTimes ?? [])
    .filter((startTime) => /^\d{4}-\d{2}-\d{2}T/.test(startTime))
    .map((startTime) => Date.parse(startTime))
    .filter(Number.isFinite);

  return timestamps.length ? Math.min(...timestamps) : Number.POSITIVE_INFINITY;
}

function renderInjuries(fixture) {
  const panel = createElement('section', 'injury-panel');
  const heading = createElement('div', 'injury-panel-heading');
  const capturedAt = injuryScrapedAt
    ? new Date(injuryScrapedAt).toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
    : 'No injury snapshot recorded';
  const sourceNote = injurySourceUpdatedAt
    ? ` · Source updated ${injurySourceUpdatedAt}`
    : '';

  heading.append(
    createElement('h2', null, 'Team injuries'),
    createElement('p', 'injury-captured', `Captured ${capturedAt}${sourceNote}`),
  );

  const columns = createElement('div', 'injury-columns');
  for (const [team, injuries] of [
    [fixture.homeTeam, fixture.homeInjuries ?? []],
    [fixture.awayTeam, fixture.awayInjuries ?? []],
  ]) {
    const teamSection = createElement('section', 'injury-team');
    teamSection.append(createElement('h3', null, team));

    if (!injuryScrapedAt || injuries.length === 0) {
      const emptyMessage = !injuryScrapedAt
        ? 'Injury data is not available yet.'
        : 'No reported injuries.';
      teamSection.append(createElement('p', 'injury-empty', emptyMessage));
    } else {
      const list = createElement('ul', 'injury-list');
      for (const injury of injuries) {
        const item = createElement('li', 'injury-item');
        const details = createElement('div', 'injury-details');
        details.append(
          createElement('strong', null, injury.player),
          createElement('span', null, injury.injury),
        );

        if (injury.latestUrl) {
          const sourceLink = createElement('a', 'injury-source', 'Club update');
          sourceLink.href = injury.latestUrl;
          sourceLink.target = '_blank';
          sourceLink.rel = 'noopener noreferrer';
          item.append(details, sourceLink);
        } else {
          item.append(details);
        }

        list.append(item);
      }
      teamSection.append(list);
    }

    columns.append(teamSection);
  }

  panel.append(heading, columns);
  return panel;
}

function formatFormDate(value) {
  return new Date(value).toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatXg(xg, xga) {
  const expectedGoals = xg == null ? 'n/a' : Number(xg).toFixed(2);
  const expectedGoalsAgainst = xga == null ? 'n/a' : Number(xga).toFixed(2);
  return `xG ${expectedGoals} · xGA ${expectedGoalsAgainst}`;
}

function formatRecord(record) {
  return `${record.wins}-${record.draws}-${record.losses}`;
}

function renderFormPlaceholder(message) {
  const panel = createElement('section', 'form-panel');
  panel.setAttribute('aria-live', 'polite');
  panel.append(
    createElement('h2', null, 'Recent form & head-to-head'),
    createElement('p', 'form-message', message),
  );
  return panel;
}

function renderHeadToHead(matches) {
  const section = createElement('section', 'head-to-head-section');
  section.append(createElement('h3', null, 'Head-to-head'));

  if (matches.length === 0) {
    section.append(createElement('p', 'form-message', 'No previous Premier League meetings in these seasons.'));
    return section;
  }

  const list = createElement('ol', 'head-to-head-list');
  for (const match of matches) {
    const row = createElement('li', 'head-to-head-row');
    const main = createElement('div', 'head-to-head-main');
    main.append(
      createElement('time', null, formatFormDate(match.date)),
      createElement('strong', null, `${match.homeTeam} ${match.homeGoals} - ${match.awayGoals} ${match.awayTeam}`),
    );
    row.append(main, createElement('span', 'form-match-metrics', formatXg(match.homeXg, match.awayXg)));
    list.append(row);
  }

  section.append(list);
  return section;
}

function renderTeamForm(team) {
  const section = createElement('section', 'team-form-section');
  const heading = createElement('div', 'team-form-heading');
  const headingText = createElement('div', null);
  headingText.append(
    createElement('h3', null, team.name),
    createElement(
      'p',
      'team-form-records',
      `Current H ${formatRecord(team.records.current.Home)} · A ${formatRecord(team.records.current.Away)}  |  Previous H ${formatRecord(team.records.previous.Home)} · A ${formatRecord(team.records.previous.Away)}`,
    ),
  );
  heading.append(headingText, createElement('span', 'team-form-count', 'Last 10'));
  section.append(heading);

  if (team.matches.length === 0) {
    section.append(createElement('p', 'form-message', 'No completed league matches found.'));
    return section;
  }

  const list = createElement('ol', 'recent-form-list');
  for (const match of team.matches) {
    const row = createElement('li', `recent-form-row result-${match.result.toLowerCase()}`);
    const main = createElement('div', 'recent-form-main');
    const venue = match.venue === 'Home' ? 'H' : 'A';
    main.append(
      createElement('time', null, formatFormDate(match.date)),
      createElement('span', 'recent-form-opponent', `${venue} vs ${match.opponent}`),
      createElement('strong', 'recent-form-score', `${match.goals}-${match.opponentGoals}`),
      createElement('span', 'form-result', match.result),
    );
    row.append(main, createElement('span', 'form-match-metrics', formatXg(match.xg, match.xga)));
    list.append(row);
  }

  section.append(list);
  return section;
}

function renderFixtureForm(data) {
  const panel = createElement('section', 'form-panel');
  panel.setAttribute('aria-live', 'polite');
  const heading = createElement('div', 'form-panel-heading');
  heading.append(
    createElement('h2', null, 'Recent form & head-to-head'),
    createElement('p', null, `Before ${formatFormDate(data.fixture.kickoff)}`),
  );

  const columns = createElement('div', 'team-form-columns');
  columns.append(renderTeamForm(data.home), renderTeamForm(data.away));
  panel.append(heading, renderHeadToHead(data.headToHead), columns);
  return panel;
}

async function loadFixtureForm(fixture, placeholder, requestVersion) {
  const query = new URLSearchParams({
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
  });

  try {
    const response = await fetch(`/api/fixture-form?${query}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Could not load fixture form.');
    if (requestVersion !== formRequestVersion) return;
    placeholder.replaceWith(renderFixtureForm(data));
  } catch (error) {
    if (requestVersion !== formRequestVersion) return;
    placeholder.replaceWith(renderFormPlaceholder(error.message));
  }
}

function renderFixture() {
  const fixture = visibleFixtures[selectedIndex];
  if (!fixture) {
    const hasFixtures = fixtures.length > 0;
    renderStatus(
      hasFixtures ? 'No upcoming fixtures found' : 'No Premier League odds found',
      hasFixtures
        ? 'Choose All Fixtures to review the available markets.'
        : 'Run the scrapers to populate MySQL, then refresh this page.',
    );
    fixtureSelect.replaceChildren();
    previousButton.disabled = true;
    nextButton.disabled = true;
    return;
  }

  const scroll = createElement('div', 'market-scroll');
  const grid = createElement('div', 'market-grid');
  grid.style.setProperty('--bookmaker-count', fixture.bookmakers.length);

  const heading = createElement('div', 'fixture-heading');
  heading.append(
    createElement('strong', null, `${fixture.homeTeam} v ${fixture.awayTeam}`),
    createElement('span', null, fixture.startTime || 'Start time unavailable'),
  );
  grid.append(heading);

  for (const bookmaker of fixture.bookmakers) {
    const header = createElement('div', 'bookmaker-head');
    header.style.setProperty('--bookmaker-color', bookmakerColors[bookmaker.slug] ?? '#30343a');
    const mark = createElement('span', 'bookmaker-mark');

    if (bookmakerLogos.has(bookmaker.slug)) {
      const logo = createElement('img', 'bookmaker-logo');
      logo.src = `/logos/${bookmaker.slug}`;
      logo.alt = bookmaker.name;
      logo.addEventListener('error', () => {
        mark.classList.add('logo-fallback');
        mark.replaceChildren(bookmaker.name);
      }, { once: true });
      mark.append(logo);
    } else {
      mark.classList.add('logo-fallback');
      mark.textContent = bookmaker.name;
    }

    header.append(
      mark,
      createElement('small', null, 'Full market'),
    );
    grid.append(header);
  }

  const outcomes = [
    ['home', fixture.homeTeam],
    ['away', fixture.awayTeam],
    ['draw', 'Draw'],
  ];

  for (const [outcome, label] of outcomes) {
    grid.append(createElement('div', 'outcome-label', label));

    for (const bookmaker of fixture.bookmakers) {
      const cell = createElement('div', 'price-cell');
      const price = createElement('a', `price ${bookmaker.movement[outcome]}`, formatPrice(bookmaker.odds[outcome]));
      price.href = bookmaker.url;
      price.target = '_blank';
      price.rel = 'noopener noreferrer';
      price.title = `${bookmaker.name}: ${label} at ${formatPrice(bookmaker.odds[outcome])}`;
      if (bookmaker.odds[outcome] === fixture.bestOdds[outcome]) {
        price.classList.add('best');
        price.title += ' (best odds)';
      }
      cell.append(price);
      grid.append(cell);
    }
  }

  const formPlaceholder = renderFormPlaceholder('Loading recent form...');
  scroll.append(grid, formPlaceholder, renderInjuries(fixture));
  comparison.replaceChildren(scroll);
  const requestVersion = ++formRequestVersion;
  loadFixtureForm(fixture, formPlaceholder, requestVersion);
  fixtureSelect.value = String(selectedIndex);
  previousButton.disabled = selectedIndex === 0;
  nextButton.disabled = selectedIndex === visibleFixtures.length - 1;

  const timestamps = fixture.bookmakers.map((bookmaker) => new Date(bookmaker.scrapedAt).getTime());
  updatedAt.textContent = `Updated ${new Date(Math.max(...timestamps)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function updateFixtureView(includeAll = showAllFixtures) {
  const selectedFixtureId = visibleFixtures[selectedIndex]?.id;
  showAllFixtures = includeAll;

  const chronologicalFixtures = [...fixtures].sort(
    (left, right) => getKickoffTimestamp(left) - getKickoffTimestamp(right),
  );
  const upcomingFixtures = chronologicalFixtures.filter(
    (fixture) => getKickoffTimestamp(fixture) >= Date.now(),
  );
  visibleFixtures = showAllFixtures
    ? chronologicalFixtures
    : upcomingFixtures.slice(0, 10);

  const previousSelection = visibleFixtures.findIndex(
    (fixture) => fixture.id === selectedFixtureId,
  );
  selectedIndex = previousSelection >= 0 ? previousSelection : 0;
  nextTenButton.setAttribute('aria-pressed', String(!showAllFixtures));
  allFixturesButton.setAttribute('aria-pressed', String(showAllFixtures));
  fixtureCount.textContent = showAllFixtures
    ? `${visibleFixtures.length} fixtures`
    : `Next ${visibleFixtures.length} of ${fixtures.length}`;

  populateFixtureSelect();
  renderFixture();
}

function populateFixtureSelect() {
  fixtureSelect.replaceChildren(...visibleFixtures.map((fixture, index) => {
    const option = createElement('option', null, `${fixture.homeTeam} v ${fixture.awayTeam}`);
    option.value = String(index);
    return option;
  }));
}

async function loadFixtures() {
  refreshButton.disabled = true;

  try {
    const response = await fetch('/api/fixtures');
    if (!response.ok) throw new Error('API request failed');
    const data = await response.json();
    fixtures = data.fixtures;
    injuryScrapedAt = data.injuryScrapedAt;
    injurySourceUpdatedAt = data.injurySourceUpdatedAt;
    updateFixtureView();
  } catch (_error) {
    renderStatus('Could not load the odds', 'Check that MySQL is running and your MYSQL_* connection values are correct.');
  } finally {
    refreshButton.disabled = false;
  }
}

fixtureSelect.addEventListener('change', () => {
  selectedIndex = Number(fixtureSelect.value);
  renderFixture();
});

previousButton.addEventListener('click', () => {
  if (selectedIndex > 0) selectedIndex -= 1;
  renderFixture();
});

nextButton.addEventListener('click', () => {
  if (selectedIndex < visibleFixtures.length - 1) selectedIndex += 1;
  renderFixture();
});

nextTenButton.addEventListener('click', () => updateFixtureView(false));
allFixturesButton.addEventListener('click', () => updateFixtureView(true));

refreshButton.addEventListener('click', loadFixtures);

loadFixtures();