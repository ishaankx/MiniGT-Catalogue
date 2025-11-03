// server.js (ESM) - full file
import express from 'express';
import path from 'path';
import fsp from 'fs/promises';
import fs from 'fs';
import cors from 'cors';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit'; // <-- 1. IMPORT RATE LIMITER

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// data directory (where your per-category JSON is stored)
const DATA_DIR = path.join(__dirname, 'data');

// vvv 2. CONFIGURE CORS AND RATE LIMITER vvv

// Define allowed websites
const allowedOrigins = [
  'http://localhost:3000', // For your development
  'https://minigt-catalogue.onrender.com' 
];

// Set up CORS
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, or local file://)
    if (!origin) return callback(null, true);
    
    // Check if the origin is in our allowed list
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  }
}));

// Set up Rate Limiter
// This allows 100 requests per 15 minutes from a single IP for all API routes
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100, // Limit each IP to 100 requests per `windowMs`
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: 'Too many requests from this IP, please try again after 15 minutes',
});

// ^^^ END OF CONFIGURATION ^^^


app.use(express.static(path.join(__dirname, 'public'))); // serves /images/* automatically

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

// ----- API -----

// vvv 3. APPLY THE RATE LIMITER TO ALL API ROUTES vvv
app.use('/api', apiLimiter);

// GET /api/categories -> returns folder names inside data/
app.get('/api/categories', async (req, res) => {
  try {
    const items = await fsp.readdir(DATA_DIR, { withFileTypes: true });
    const categories = items.filter(i => i.isDirectory()).map(d => d.name);
    res.json(categories);
  } catch (err) {
    console.error('Error reading DATA_DIR:', err?.message);
    res.status(500).json({ error: 'Cannot read categories' });
  }
});

// GET /api/cars?category=IMSA|all&status=released|preorder|all
app.get('/api/cars', async (req, res) => {
  const category = (req.query.category || 'all').trim();
  const requestedStatus = (req.query.status || 'released').trim().toLowerCase();

  try {
    let categoriesToSearch = [];
    if (category === 'all') {
      const items = await fsp.readdir(DATA_DIR, { withFileTypes: true });
      categoriesToSearch = items.filter(i => i.isDirectory()).map(d => d.name);
    } else {
      const p = path.join(DATA_DIR, category);
      try {
        const stat = await fsp.stat(p);
        if (!stat.isDirectory()) return res.json([]);
        categoriesToSearch = [category];
      } catch {
        return res.json([]); // unknown category
      }
    }

    const results = [];

    for (const cat of categoriesToSearch) {
      // prefer dedicated status file if present
      const statusFile = path.join(DATA_DIR, cat, `${requestedStatus}.json`);
      const statusData = await readJson(statusFile);
      if (Array.isArray(statusData)) {
        statusData.forEach(it => results.push(normalizeItem(it, cat)));
        continue;
      }

      // fallback: look for all.json or cars.json or <cat>.json
      const fallbackFiles = ['all.json', 'cars.json', `${cat}.json`];
      let dataArr = null;
      for (const f of fallbackFiles) {
        const pth = path.join(DATA_DIR, cat, f);
        const d = await readJson(pth);
        if (Array.isArray(d)) { dataArr = d; break; }
      }
      if (!Array.isArray(dataArr)) continue;

      dataArr.forEach(item => {
        const itemStatus = normalizeStatus(item.status || item.Status);
        if (requestedStatus === 'all' || itemStatus === requestedStatus) results.push(normalizeItem(item, cat));
      });
    }

    res.json(results);
  } catch (err) {
    console.error('Error in /api/cars:', err);
    res.status(500).json({ error: 'Failed to load data' });
  }
});

// GET /api/car/:sku -> search for one SKU across all categories
app.get('/api/car/:sku', async (req, res) => {
  const skuLower = (req.params.sku || '').toLowerCase();
  try {
    const items = await fsp.readdir(DATA_DIR, { withFileTypes: true });
    const cats = items.filter(i => i.isDirectory()).map(d => d.name);
    for (const cat of cats) {
      const aggregated = [];
      const a = await readJson(path.join(DATA_DIR, cat, 'all.json'));
      if (Array.isArray(a)) aggregated.push(...a);
      const r = await readJson(path.join(DATA_DIR, cat, 'released.json'));
      if (Array.isArray(r)) aggregated.push(...r);
      const p = await readJson(path.join(DATA_DIR, cat, 'preorder.json'));
      if (Array.isArray(p)) aggregated.push(...p);

      for (const it of aggregated) {
        const candidate = (it.sku || it.SKU || it.code || it.id || '').toLowerCase();
        if (candidate && candidate === skuLower) {
          return res.json(normalizeItem(it, cat));
        }
      }
    }
    res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error('Error in /api/car/:sku', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ----- lightweight image proxy fallback -----

// vvv 4. SECURE THE IMAGE PROXY vvv
app.get('/img-proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('missing url');
    if (!/^https?:\/\//i.test(url)) return res.status(400).send('invalid url');

    // **SECURITY FIX**: Only allow proxying from 'minigt.tsm-models.com'
    const allowed = ['minigt.tsm-models.com'];
    const host = new URL(url).hostname;
    if (!allowed.includes(host)) {
        return res.status(403).send('forbidden host');
    }

    const remote = await fetch(url);
    if (!remote.ok) return res.status(404).send('image not found');

    const contentType = remote.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    // let the browser cache for 1 day
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const body = remote.body;
    if (body && typeof body.pipe === 'function') {
      body.pipe(res);
    } else {
      // older Node: read as arrayBuffer then send
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
  console.log(`Server running: http://localhost:${PORT}`);
  try {
    const s = await fsp.stat(DATA_DIR);
    if (!s.isDirectory()) {
      console.warn(`Warning: ${DATA_DIR} exists but is not a directory`);
    } else {
      console.log(`DATA_DIR: ${DATA_DIR}`);
    }
  } catch (e) {
    console.warn(`Warning: DATA_DIR (${DATA_DIR}) does not exist — create it and add category folders (e.g. data/IMSA/all.json)`);
  }
});