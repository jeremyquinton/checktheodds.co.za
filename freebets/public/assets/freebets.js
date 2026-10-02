const offerList = document.querySelector('#offer-list');
const offerCards = [...document.querySelectorAll('[data-offer-card]')];
const filterButtons = [...document.querySelectorAll('[data-filter]')];
const searchInput = document.querySelector('#offer-search');
const sortSelect = document.querySelector('#offer-sort');
const offerCount = document.querySelector('#offer-count');
const emptyState = document.querySelector('#offer-empty');

let activeCategory = 'all';

function updateOffers() {
  const query = searchInput.value.trim().toLowerCase();
  const visibleCards = offerCards.filter((card) => {
    const matchesCategory = activeCategory === 'all' || card.dataset.category === activeCategory;
    const matchesSearch = card.dataset.search.includes(query);
    return matchesCategory && matchesSearch;
  });

  const sortMode = sortSelect.value;
  visibleCards.sort((left, right) => {
    if (sortMode === 'bookmaker') {
      return left.dataset.bookmaker.localeCompare(right.dataset.bookmaker);
    }
    const difference = Number(left.dataset.bonus) - Number(right.dataset.bonus);
    return sortMode === 'bonus-asc' ? difference : -difference;
  });

  for (const card of offerCards) card.hidden = true;
  for (const card of visibleCards) {
    card.hidden = false;
    offerList.append(card);
  }

  offerCount.textContent = `${visibleCards.length} example offer${visibleCards.length === 1 ? '' : 's'}`;
  emptyState.hidden = visibleCards.length !== 0;
}

for (const button of filterButtons) {
  button.addEventListener('click', () => {
    activeCategory = button.dataset.filter;
    for (const filterButton of filterButtons) {
      const active = filterButton === button;
      filterButton.classList.toggle('is-active', active);
      filterButton.setAttribute('aria-pressed', String(active));
    }
    updateOffers();
  });
}

searchInput.addEventListener('input', updateOffers);
sortSelect.addEventListener('change', updateOffers);
updateOffers();