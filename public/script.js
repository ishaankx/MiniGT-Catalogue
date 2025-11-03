// public/script.js (updated for search)
const categoryButton = document.getElementById('category-button');
const selectedCategoryEl = document.getElementById('selected-category');
const categoryDropdown = document.getElementById('category-dropdown');
const categoryList = document.getElementById('category-list');
const categoryFilter = document.getElementById('category-filter');
const searchInput = document.getElementById('search-input');
const controls = document.querySelector('.controls'); // <-- 1. ADD THIS

const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const statusButtons = document.querySelectorAll('.status-btn');

let categoriesCache = [];
let itemsCache = [];
let currentCategory = 'all';
let currentStatus = 'released';
let currentSearchQuery = '';
let renderDebounceTimer;

// === LAZY LOADING & UNLOADING LOGIC ===
const lazyLoadCard = (entry) => {
  const card = entry.target;
  const img = card.querySelector('img');
  if (img && img.dataset.src && !img.classList.contains('loaded')) {
    img.onerror = () => {
      if (img.src.includes('/images/placeholder.jpg')) return;
      const fallbackUrl = img.dataset.fallbackUrl;
      if (img.src.startsWith(window.location.origin + '/images') || img.src.startsWith('/images')) {
        if (fallbackUrl) {
          img.src = `/img-proxy?url=${encodeURIComponent(fallbackUrl)}`;
          img.removeAttribute('data-fallback-url');
          return;
        }
      } else if (img.src.includes('/img-proxy')) {
        img.src = '/images/placeholder.jpg';
        return;
      }
      img.src = '/images/placeholder.jpg';
    };
    img.onload = () => {
      img.classList.add('loaded');
    }
    img.src = img.dataset.src;
  }
};
const unloadCard = (entry) => {
    const card = entry.target;
    const img = card.querySelector('img');
    if (img && img.classList.contains('loaded')) {
      img.classList.remove('loaded');
      img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
    }
};
const onIntersection = (entries, observer) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      lazyLoadCard(entry);
    } else {
      unloadCard(entry);
    }
  });
};
const cardObserver = new IntersectionObserver(onIntersection, {
  rootMargin: '2000px 0px 200px 0px',
});
// === END LAZY LOADING LOGIC ===


// fetch categories and populate dropdown (unchanged)
async function fetchCategories() {
  try {
    const res = await fetch('/api/categories');
    const cats = await res.json();
    const unique = Array.from(new Set(['all', ...cats]));
    categoriesCache = unique;
    populateCategoryList(unique);
  } catch (err) {
    console.error('Failed to load categories', err);
  }
}

// populate dropdown (unchanged)
function populateCategoryList(cats) {
  categoryList.innerHTML = '';
  cats.forEach(cat => {
    const li = document.createElement('li');
    li.textContent = (cat === 'all') ? 'All' : cat;
    li.dataset.value = cat;
    li.addEventListener('click', () => {
      selectCategory(cat);
      closeDropdown(); // This will call closeDropdown(true) by default
    });
    categoryList.appendChild(li);
  });
}

// dropdown helpers
function openDropdown() {
  categoryDropdown.hidden = false;
  categoryDropdown.setAttribute('aria-hidden', 'false');
  categoryButton.setAttribute('aria-expanded', 'true');
  categoryFilter.focus();
  setActiveListItem(currentCategory);
}

// vvv 2. MODIFY THIS FUNCTION vvv
function closeDropdown(returnFocus = true) { // Add parameter
  categoryDropdown.hidden = true;
  categoryDropdown.setAttribute('aria-hidden', 'true');
  categoryButton.setAttribute('aria-expanded', 'false');
  
  if (returnFocus) { // Check parameter
    categoryButton.focus();
  }
  
  // Reset filter
  categoryFilter.value = '';
  populateCategoryList(categoriesCache);
  setActiveListItem(currentCategory);
}
// ^^^ END MODIFICATION ^^^

function toggleDropdown() {
  if (categoryDropdown.hidden || categoryDropdown.getAttribute('aria-hidden') === 'true') openDropdown();
  else closeDropdown();
}
function setActiveListItem(value) {
  const items = categoryList.querySelectorAll('li');
  items.forEach(i => i.classList.toggle('active', i.dataset.value === value));
}
categoryFilter.addEventListener('input', (e) => {
  const q = (e.target.value || '').toLowerCase().trim();
  const filtered = categoriesCache.filter(c => c === 'all' || c.toLowerCase().includes(q));
  populateCategoryList(filtered);
  setActiveListItem(currentCategory);
  if (filtered.length === 0) {
    categoryList.innerHTML = '<li style="padding: 8px 10px; color: var(--muted); cursor: default;">No categories found</li>';
  }
});

// vvv 3. MODIFY THIS EVENT LISTENER vvv
document.addEventListener('click', (e) => {
  const isDropdownOpen = !categoryDropdown.hidden;
  if (!isDropdownOpen) return; // Do nothing if dropdown is already closed

  // Check if the click is on the button or in the dropdown menu
  if (categoryDropdown.contains(e.target) || categoryButton.contains(e.target)) {
    return; // Don't close, let the other handlers work
  }

  // At this point, the click is *outside* the dropdown/button.
  // We WILL close the dropdown.
  
  // Check if the click was on *another* control (like the search bar)
  const isClickOnAnotherControl = controls.contains(e.target);
  
  // We only return focus to the button if the click was "out in the wild"
  // (i.e., NOT on another control).
  closeDropdown(!isClickOnAnotherControl);
});
// ^^^ END MODIFICATION ^^^

categoryButton.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
    e.preventDefault();
    openDropdown();
  }
});
categoryButton.addEventListener('click', (e) => {
  toggleDropdown();
});


// === NEW EVENT HANDLERS ===
function selectCategory(cat) {
  currentCategory = cat;
  selectedCategoryEl.textContent = (cat === 'all') ? 'All' : cat;
  fetchAndRender();
}
statusButtons.forEach(btn => {
  btn.addEventListener('click', (e) => {
    statusButtons.forEach(b => b.classList.remove('active'));
    e.currentTarget.classList.add('active');
    currentStatus = e.currentTarget.dataset.status;
    fetchAndRender();
  });
});
searchInput.addEventListener('input', () => {
  currentSearchQuery = searchInput.value.toLowerCase().trim();
  debouncedRender();
});
function debouncedRender() {
  clearTimeout(renderDebounceTimer);
  renderDebounceTimer = setTimeout(render, 150);
}
// === END EVENT HANDLERS ===


// fetch items (unchanged)
async function fetchCars(category = 'all', status = 'released') {
  try {
    const res = await fetch(`/api/cars?category=${encodeURIComponent(category)}&status=${encodeURIComponent(status)}`);
    const items = await res.json();
    return items;
  } catch (err) {
    console.error('Failed to fetch cars', err);
    return [];
  }
}

// image selection (unchanged)
function getImageSrc(item) {
  if (item.category && item.sku) {
    return `/images/${encodeURIComponent(item.category)}/${encodeURIComponent(item.sku)}.jpg`;
  }
  if (item.image_local_path) {
    const normalized = item.image_local_path.replace(/\\\\/g, '/').replace(/\\/g, '/');
    const parts = normalized.split('/');
    const filename = parts[parts.length - 1];
    if (filename) {
      return `/images/${encodeURIComponent(item.category || 'unknown')}/${encodeURIComponent(filename)}`;
    }
  }
  if (item.image_url) {
    return `/img-proxy?url=${encodeURIComponent(item.image_url)}`;
  }
  return '/images/placeholder.jpg';
}

// create card (unchanged)
function createCard(item) {
  const card = document.createElement(item.detail_url ? 'a' : 'div');
  card.className = 'card';
  if (item.detail_url) {
    card.href = item.detail_url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
  }
  const imgWrap = document.createElement('div');
  imgWrap.className = 'imgwrap';
  const img = document.createElement('img');
  img.alt = item.name || item.sku || 'car';
  img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
  img.dataset.src = getImageSrc(item);
  if (item.image_url) {
    img.dataset.fallbackUrl = item.image_url;
  }
  imgWrap.appendChild(img);
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = item.name;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = item.sku || '';
  const status = document.createElement('div');
  status.className = 'status ' + (item.status === 'preorder' ? 'preorder' : 'released');
  status.textContent = item.status === 'preorder' ? 'Pre-Order' : 'Released';
  card.appendChild(imgWrap);
  card.appendChild(name);
  card.appendChild(meta);
  card.appendChild(status);
  return card;
}

// === NEW RENDER & FETCH LOGIC ===
async function fetchAndRender() {
  cardObserver.disconnect();
  grid.innerHTML = '';
  empty.textContent = 'Loading...';
  empty.hidden = false;
  
  itemsCache = await fetchCars(currentCategory, currentStatus);
  
  render();
}
function render() {
  cardObserver.disconnect();
  grid.innerHTML = '';
  empty.hidden = true;

  let filteredItems = [];
  if (currentSearchQuery.length > 0) {
    filteredItems = itemsCache.filter(item => {
      const nameMatch = item.name.toLowerCase().includes(currentSearchQuery);
      const skuMatch = item.sku.toLowerCase().includes(currentSearchQuery);
      return nameMatch || skuMatch;
    });
  } else {
    filteredItems = itemsCache;
  }

  if (!filteredItems || filteredItems.length === 0) {
    empty.hidden = false;
    if (itemsCache.length > 0 && currentSearchQuery.length > 0) {
        empty.textContent = 'No cars match your search';
    } else {
        empty.textContent = 'No cars found';
    }
    return;
  }
  
  filteredItems.forEach(it => {
    const card = createCard(it);
    grid.appendChild(card);
    cardObserver.observe(card);
  });
}

// initialization
window.addEventListener('DOMContentLoaded', async () => {
  await fetchCategories();
  currentCategory = 'all';
  selectedCategoryEl.textContent = 'All';
  currentStatus = 'released';
  document.getElementById('btn-released').classList.add('active');
  await fetchAndRender();
});