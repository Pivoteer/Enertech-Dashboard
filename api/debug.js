/**
 * /api/debug — Cache diagnostics (safe to share, no sensitive data)
 *
 * Visit /api/debug in your browser to see:
 * - Whether Vercel KV is connected
 * - What's in the cache (counts, age)
 * - Any KV errors
 */

const CACHE_KEY = 'monta_dashboard_v1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const report = {
    timestamp: new Date().toISOString(),
    kv: { status: 'unknown', error: null },
    cache: { exists: false, ageMinutes: null, counts: null },
    env: {
      hasKvUrl: !!process.env.KV_URL,
      hasKvRestUrl: !!process.env.KV_REST_API_URL,
      hasKvToken: !!process.env.KV_REST_API_TOKEN,
      hasMontaClientId: !!process.env.MONTA_CLIENT_ID,
      hasMontaClientSecret: !!process.env.MONTA_CLIENT_SECRET,
    },
  };

  try {
    const { kv } = await import('@vercel/kv');
    report.kv.status = 'connected';

    const cached = await kv.get(CACHE_KEY);
    if (cached) {
      const ageMs = Date.now() - (cached.fetchedAt || 0);
      report.cache = {
        exists: true,
        fetchedAt: cached.fetchedAt ? new Date(cached.fetchedAt).toISOString() : null,
        ageMinutes: Math.round(ageMs / 60000),
        counts: {
          chargePoints: cached.cps?.length ?? 'missing',
          charges: cached.charges?.length ?? 'missing',
          sites: cached.sites?.length ?? 'missing (old cache — hit Refresh)',
        },
      };
    } else {
      report.cache.exists = false;
      report.cache.note = 'No data in KV yet — visit /api/data or click Refresh in the dashboard';
    }
  } catch (err) {
    report.kv.status = 'error';
    report.kv.error = err.message;
    report.kv.hint = 'Check that Vercel KV is provisioned and linked to this project under Storage in the Vercel dashboard. The KV_URL, KV_REST_API_URL, and KV_REST_API_TOKEN env vars must be set.';
  }

  return res.status(200).json(report);
}
