const comparison = document.querySelector('#comparison');
const fixtureSelect = document.querySelector('#fixture-select');
const refreshButton = document.querySelector('#refresh-button');
const previousButton = document.querySelector('#previous-fixture');
const nextButton = document.querySelector('#next-fixture');
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
let selectedIndex = 0;

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

function renderFixture() {
  const fixture = fixtures[selectedIndex];
  if (!fixture) {
    renderStatus('No Premier League odds found', 'Run the scrapers to populate MySQL, then refresh this page.');
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

  scroll.append(grid);
  comparison.replaceChildren(scroll);
  fixtureSelect.value = String(selectedIndex);
  previousButton.disabled = selectedIndex === 0;
  nextButton.disabled = selectedIndex === fixtures.length - 1;

  const timestamps = fixture.bookmakers.map((bookmaker) => new Date(bookmaker.scrapedAt).getTime());
  updatedAt.textContent = `Updated ${new Date(Math.max(...timestamps)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function populateFixtureSelect() {
  fixtureSelect.replaceChildren(...fixtures.map((fixture, index) => {
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
    selectedIndex = Math.min(selectedIndex, Math.max(fixtures.length - 1, 0));
    populateFixtureSelect();
    renderFixture();
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
  if (selectedIndex < fixtures.length - 1) selectedIndex += 1;
  renderFixture();
});

refreshButton.addEventListener('click', loadFixtures);

loadFixtures();