/**
 * /api/data — Shared Monta data cache
 *
 * GET /api/data           → return KV-cached data (or fetch fresh if stale)
 * GET /api/data?refresh=1 → force re-fetch from Monta, update KV cache
 *
 * Required environment variables (set in Vercel dashboard):
 *   MONTA_CLIENT_ID      — your Monta partner client ID
 *   MONTA_CLIENT_SECRET  — your Monta partner client secret
 *
 * Required Vercel add-on (free tier works):
 *   Vercel KV — provision at vercel.com/dashboard → Storage → Create KV Database
 *   (env vars KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN are auto-set after linking)
 */

const MONTA_API = 'https://partner-api.monta.com/api/v1';
const CACHE_KEY = 'monta_dashboard_v1';
// No TTL — data persists in KV until manually refreshed via ?refresh=1 shared cache

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
  // Fetch all three in parallel; sites gracefully falls back to [] if unavailable
  const [cps, charges, sites] = await Promise.all([
    fetchAll(token, '/charge-points'),
    fetchAll(token, '/charges'),
    fetchAll(token, '/sites').catch(() => []),
  ]);
  return { cps, charges, sites, fetchedAt: Date.now() };
}

// ---- KV helpers (gracefully degrade if KV not provisioned) ----

async function kvGet(key) {
  try {
    const { kv } = await import('@vercel/kv');
    return await kv.get(key);
  } catch {
    return null;
  }
}

async function kvSet(key, value) {
  try {
    const { kv } = await import('@vercel/kv');
    await kv.set(key, value); // no TTL — persists until manual refresh
  } catch {
    // KV not configured — no-op, will re-fetch next request
  }
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

  try {
    // Return cached data if available and not forcing refresh
    if (!forceRefresh) {
      const cached = await kvGet(CACHE_KEY);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Fetched-At', String(cached.fetchedAt));
        return res.status(200).json(cached);
      }
    }

    // Fetch fresh data from Monta
    const data = await fetchFromMonta();
    await kvSet(CACHE_KEY, data);

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('X-Fetched-At', String(data.fetchedAt));
    return res.status(200).json(data);

  } catch (err) {
    console.error('[api/data] Error:', err);

    // On refresh failure, try to return stale cache rather than erroring out
    if (forceRefresh) {
      const stale = await kvGet(CACHE_KEY);
      if (stale) {
        res.setHeader('X-Cache', 'STALE');
        res.setHeader('X-Fetched-At', String(stale.fetchedAt));
        return res.status(200).json({ ...stale, stale: true, staleReason: err.message });
      }
    }

    return res.status(500).json({ error: err.message });
  }
}
