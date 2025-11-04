// server.js (ESM) - full file
import express from 'express';
import path from 'path';
import fsp from 'fs/promises';
import fs from 'fs';
import cors from 'cors';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 10000;

// data directory (where your per-category JSON is stored)
const DATA_DIR = path.join(__dirname, 'data');

// === vvv NEW CACHE VARIABLES vvv ===
// These will hold all your data in memory
let categoryCache = [];
let carDataCache = {};
let skuCache = new Map();
// === ^^^ END CACHE VARIABLES ^^^ ===

// --- CORS & Rate Limiter (no changes) ---
const allowedOrigins = [
  'http://localhost:3000', // For your development
  'https://minigt-catalogue.onrender.com' 
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  }
}));
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 100,
	standardHeaders: true, 
	legacyHeaders: false, 
  message: 'Too many requests from this IP, please try again after 15 minutes',
});

app.use(express.static(path.join(__dirname, 'public')));

// ----- helpers ----- (no changes)
async function readJson(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}
function normalizeStatus(s) {
  if (!s) return null;
  const t = String(s).toLowerCase();
  if (t.includes('pre')) return 'preorder';
  if (t.includes('release')) return 'released';
  return t;
}
function normalizeItem(raw, category) {
  return {
    sku: raw.sku || raw.SKU || raw.code || raw.id || '',
    name: raw.name || raw.title || '',
    status: normalizeStatus(raw.status) || null,
    image_url: raw.image_url || raw.image || null,
    image_local_path: raw.image_local_path || raw.local_image || null,
    detail_url: raw.detail_url || raw.url || null,
    category: raw.category || category || ''
  };
}
// === ^^^ END HELPERS ^^^ ===


// === vvv NEW CACHE LOADING FUNCTION vvv ===
/**
 * Loads all data from disk into the cache variables.
 * This runs ONCE at server startup.
 */
async function loadCache() {
  console.log('Loading cache...');
  try {
    // 1. Load categories
    const items = await fsp.readdir(DATA_DIR, { withFileTypes: true });
    const categories = items.filter(i => i.isDirectory()).map(d => d.name);
    categoryCache = categories; // Cache the category names

    const newCarDataCache = {};
    const newSkuCache = new Map();

    // 2. Load car data for each category
    for (const cat of categories) {
      const categoryData = {};

      // Read all possible files for this category
      const releasedData = await readJson(path.join(DATA_DIR, cat, 'released.json'));
      if (releasedData) categoryData.released = releasedData.map(item => normalizeItem(item, cat));
      
      const preorderData = await readJson(path.join(DATA_DIR, cat, 'preorder.json'));
      if (preorderData) categoryData.preorder = preorderData.map(item => normalizeItem(item, cat));
      
      // Handle 'all.json' and its fallbacks
      let allData = null;
      const fallbackFiles = ['all.json', 'cars.json', `${cat}.json`];
      for (const f of fallbackFiles) {
         const d = await readJson(path.join(DATA_DIR, cat, f));
         if (Array.isArray(d)) { allData = d; break; }
      }
      if (allData) categoryData.all = allData.map(item => normalizeItem(item, cat));

      // Add this category's data to the main cache
      newCarDataCache[cat] = categoryData;

      // 3. Populate the SKU cache for fast lookups
      // We combine all arrays, so /api/car/:sku can find any car
      const allItems = [
        ...(categoryData.released || []),
        ...(categoryData.preorder || []),
        ...(categoryData.all || [])
      ];

      for (const item of allItems) {
        if(item.sku) {
          const skuLower = item.sku.toLowerCase();
          // Only add if it's not already in the map (first one wins)
          if (!newSkuCache.has(skuLower)) {
             newSkuCache.set(skuLower, item);
          }
        }
      }
    }
    
    carDataCache = newCarDataCache;
    skuCache = newSkuCache;

    console.log(`✅ Cache loaded successfully: ${categoryCache.length} categories, ${skuCache.size} unique SKUs found.`);

  } catch (err) {
    console.error('❌ FAILED TO LOAD CACHE:', err);
    // Exit the process if the cache fails to build, as the site won't work.
    process.exit(1); 
  }
}
// === ^^^ END CACHE LOADING FUNCTION ^^^ ===


// ----- API -----
app.use('/api', apiLimiter);

// GET /api/categories -> NOW READS FROM CACHE
app.get('/api/categories', (req, res) => {
  // This is now instant. No file I/O.
  res.json(categoryCache);
});

// GET /api/cars -> NOW READS FROM CACHE
app.get('/api/cars', (req, res) => {
  const category = (req.query.category || 'all').trim();
  const requestedStatus = (req.query.status || 'released').trim().toLowerCase();

  try {
    // 1. Get categories to search (from cache)
    const categoriesToSearch = (category === 'all')
      ? categoryCache
      : (carDataCache[category] ? [category] : []); // Check if category exists in cache

    const results = [];

    // 2. Loop through categories and pull data *from the cache*
    for (const cat of categoriesToSearch) {
      const categoryData = carDataCache[cat];
      if (!categoryData) continue; // Should not happen, but safe check

      // 3. Try finding data for the specific status (e.g., 'released')
      let dataArr = categoryData[requestedStatus];
      
      if (Array.isArray(dataArr)) {
        // Found specific data (e.g., released.json). Add it.
        results.push(...dataArr);
        continue;
      }

      // 4. Fallback: 'released.json' not found, so use 'all.json' data
      dataArr = categoryData.all; // 'all' holds the data from all.json/cars.json
      if (!Array.isArray(dataArr)) continue; // No 'all' file for this category

      // 5. We have the 'all' data, so we must filter it
      if (requestedStatus === 'all') {
        results.push(...dataArr);
      } else {
        // Only add items that match the requested status
        const filtered = dataArr.filter(item => item.status === requestedStatus);
        results.push(...filtered);
      }
    }

    // 6. De-duplication logic (no changes)
    let finalResults = results;
    if (category === 'all') {
      const uniqueSKUs = new Set();
      finalResults = results.filter(item => {
        if (!item.sku) return true;
        if (uniqueSKUs.has(item.sku)) return false;
        uniqueSKUs.add(item.sku);
        return true;
      });
    }
    
    res.json(finalResults); // Send the fast, cached, de-duplicated results

  } catch (err) {
    console.error('Error in /api/cars:', err);
    res.status(500).json({ error: 'Failed to load data' });
  }
});

// GET /api/car/:sku -> READS FROM CACHE
app.get('/api/car/:sku', (req, res) => {
  const skuLower = (req.params.sku || '').toLowerCase();
  
  // This is now an instant O(1) lookup. No loops, no file I/O.
  const item = skuCache.get(skuLower);
  
  if (item) {
    return res.json(item);
  }
  
  res.status(404).json({ error: 'Not found' });
});

// ----- lightweight image proxy fallback ----- 
app.get('/img-proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('missing url');
    if (!/^https?:\/\//i.test(url)) return res.status(400).send('invalid url');

    const allowed = ['minigt.tsm-models.com', 'minitoysensei.co.uk'];
    const host = new URL(url).hostname;
    if (!allowed.includes(host)) {
        return res.status(403).send('forbidden host');
    }

    const remote = await fetch(url);
    if (!remote.ok) return res.status(404).send('image not found');

    const contentType = remote.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const body = remote.body;
    if (body && typeof body.pipe === 'function') {
      body.pipe(res);
    } else {
      const ab = await remote.arrayBuffer();
      res.end(Buffer.from(ab));
    }
  } catch (err) {
    console.error('img-proxy error:', err);
    res.status(500).send('proxy error');
  }
});

// server startup check
app.listen(PORT, async () => {
  // === vvv LOAD CACHE *BEFORE* ACCEPTING REQUESTS vvv ===
  await loadCache(); 
  // === ^^^ CACHE IS NOW READY ^^^ ===

  console.log(`Server running: http://localhost:${PORT}`);
  // can remove the old DATA_DIR check, loadCache() handles it.
});