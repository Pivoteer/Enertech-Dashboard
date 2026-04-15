/**
 * /api/data — Shared Monta data cache
 *
 * GET /api/data           → return KV-cached data (or fetch fresh if unavailable)
 * GET /api/data?refresh=1 → force re-fetch from Monta, update KV cache
 *
 * Required environment variables (set in Vercel dashboard):
 *   MONTA_CLIENT_ID      — your Monta partner client ID
 *   MONTA_CLIENT_SECRET  — your Monta partner client secret
 *
 * Required Vercel add-on (free tier works):
 *   Vercel KV — provision at vercel.com/dashboard → Storage → Create KV Database
 *   (env vars KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN are auto-set after linking)
 *
 * Visit /api/debug to check KV status and cache contents.
 */

const MONTA_API = 'https://partner-api.monta.com/api/v1';
const CACHE_KEY = 'monta_dashboard_v1';
// No TTL — data persists in KV until manually refreshed via ?refresh=1

// ---- Monta API helpers ----

async function montaAuth() {
  const r = await fetch(`${MONTA_API}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.MONTA_CLIENT_ID,
      clientSecret: process.env.MONTA_CLIENT_SECRET,
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Monta auth failed ${r.status}: ${body}`);
  }
  return (await r.json()).accessToken;
}

async function apiGet(token, path, params = {}) {
  const u = new URL(`${MONTA_API}${path}`);
  Object.entries(params).forEach(([k, v]) => v !== undefined && u.searchParams.set(k, String(v)));
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Monta ${path} → ${r.status}`);
  return r.json();
}

// Fetches all pages concurrently (batches of 5) for speed
async function fetchAll(token, path, params = {}) {
  const first = await apiGet(token, path, { ...params, page: 0, perPage: 100 });
  const items = [...(first.data || [])];
  const totalPages = first.meta?.totalPageCount ?? 1;

  for (let start = 1; start < totalPages; start += 5) {
    const batchSize = Math.min(5, totalPages - start);
    const pages = await Promise.all(
      Array.from({ length: batchSize }, (_, i) =>
        apiGet(token, path, { ...params, page: start + i, perPage: 100 })
      )
    );
    pages.forEach(p => items.push(...(p.data || [])));
  }
  return items;
}

async function fetchFromMonta() {
  const token = await montaAuth();

  // Only fetch charges from the last 90 days — full history can exceed the 1 MB
  // Upstash REST API limit and slows down the fetch significantly.
  const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch all three in parallel; sites gracefully falls back to [] if unavailable
  const [cps, charges, sites] = await Promise.all([
    fetchAll(token, '/charge-points'),
    fetchAll(token, '/charges', { from }),
    fetchAll(token, '/sites').catch(() => []),
  ]);
  return { cps, charges, sites, fetchedAt: Date.now() };
}

// ---- KV helpers (Upstash REST API — no package dependency) ----

function upstashUrl() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  if (!url) throw new Error('Missing UPSTASH_REDIS_REST_URL env var');
  return url.replace(/\/$/, '');
}

function upstashToken() {
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!token) throw new Error('Missing UPSTASH_REDIS_REST_TOKEN env var');
  return token;
}

async function kvGet(key) {
  const r = await fetch(`${upstashUrl()}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${upstashToken()}` },
  });
  if (!r.ok) throw new Error(`KV GET failed ${r.status}: ${await r.text()}`);
  const { result } = await r.json();
  if (result === null) return null;
  return typeof result === 'string' ? JSON.parse(result) : result;
}

async function kvSet(key, value) {
  // Upstash REST /set/key expects the raw value as text/plain body
  const r = await fetch(`${upstashUrl()}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${upstashToken()}`,
      'Content-Type': 'text/plain',
    },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`KV SET failed ${r.status}: ${await r.text()}`);
  const resp = await r.json();
  if (resp.error) throw new Error(`KV SET error: ${resp.error}`);
}

// ---- Handler ----

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const forceRefresh = req.query.refresh === '1';

  // ---- Try KV cache first ----
  let kvError = null;
  if (!forceRefresh) {
    try {
      const cached = await kvGet(CACHE_KEY);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Fetched-At', String(cached.fetchedAt));
        return res.status(200).json(cached);
      }
      // KV connected but no data yet
      res.setHeader('X-Cache', 'MISS');
    } catch (err) {
      kvError = err.message;
      console.error('[api/data] KV read error:', err.message);
      res.setHeader('X-Cache', 'KV-ERROR');
      res.setHeader('X-KV-Error', err.message);
      // Fall through to Monta fetch
    }
  }

  // ---- Fetch fresh from Monta ----
  try {
    const data = await fetchFromMonta();

    // Save to KV (non-fatal if it fails)
    let kvWriteError = null;
    try {
      await kvSet(CACHE_KEY, data);
    } catch (err) {
      kvWriteError = err.message;
      console.error('[api/data] KV write error:', err.message);
      res.setHeader('X-KV-Write-Error', err.message);
    }

    res.setHeader('X-Fetched-At', String(data.fetchedAt));
    // Include kvWriteError in response so callers can surface it (null = success)
    return res.status(200).json({ ...data, kvWriteError });

  } catch (err) {
    console.error('[api/data] Monta fetch error:', err.message);

    // Last resort: return stale cache even if forceRefresh was requested
    try {
      const stale = await kvGet(CACHE_KEY);
      if (stale) {
        res.setHeader('X-Cache', 'STALE');
        res.setHeader('X-Fetched-At', String(stale.fetchedAt));
        return res.status(200).json({ ...stale, stale: true, staleReason: err.message });
      }
    } catch {}

    return res.status(500).json({ error: err.message, kvError });
  }
}
