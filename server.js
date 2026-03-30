/**
 * Ahead Colorado — Monta API Proxy Server
 * ----------------------------------------
 * Keeps Monta credentials server-side and exposes a simple
 * internal API for the React dashboard to consume.
 *
 * Setup:
 *   1. npm install
 *   2. Copy .env.example → .env and fill in your Monta credentials
 *   3. node server.js   (or: npx nodemon server.js for dev)
 *
 * Endpoints exposed to the dashboard (all require x-dashboard-key header):
 *   GET  /api/status          — health check + connection test
 *   GET  /api/charges         — paginated charge sessions
 *   GET  /api/charge-points   — list of charge point details
 *   GET  /api/charges/:id     — single charge detail
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const NodeCache = require("node-cache");

const app = express();
const cache = new NodeCache({ stdTTL: 300 }); // 5-min cache

// ─── Config ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const MONTA_BASE = "https://public-api.monta.com/api/v1";
const MONTA_CLIENT_ID = process.env.MONTA_CLIENT_ID;
const MONTA_CLIENT_SECRET = process.env.MONTA_CLIENT_SECRET;
const DASHBOARD_KEY = process.env.DASHBOARD_KEY || "change-me-in-env";

if (!MONTA_CLIENT_ID || !MONTA_CLIENT_SECRET) {
  console.warn(
    "⚠  MONTA_CLIENT_ID or MONTA_CLIENT_SECRET not set in .env — " +
    "the proxy will fail to authenticate with Monta."
  );
}

// ─── CORS — allow the React dev server and your production domain ──────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:3000")
  .split(",")
  .map((s) => s.trim());

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// ─── Monta token management ────────────────────────────────────────────────────
let _accessToken = null;
let _tokenExpiry = 0;

async function getMontaToken() {
  const now = Date.now();
  if (_accessToken && now < _tokenExpiry - 60_000) {
    return _accessToken; // reuse if >1 min remaining
  }

  const res = await fetch(`${MONTA_BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: MONTA_CLIENT_ID,
      clientSecret: MONTA_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Monta auth failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  _accessToken = data.accessToken;
  // Monta tokens typically expire in 1 hour; default to 55 min if not provided
  const expiresIn = data.expiresIn ?? 3300;
  _tokenExpiry = now + expiresIn * 1000;
  return _accessToken;
}

// ─── Middleware: validate dashboard API key ────────────────────────────────────
function requireDashboardKey(req, res, next) {
  const key = req.headers["x-dashboard-key"];
  if (!key || key !== DASHBOARD_KEY) {
    return res.status(401).json({ error: "Unauthorized — invalid dashboard key" });
  }
  next();
}

// ─── Helper: proxy a Monta GET request ────────────────────────────────────────
async function montaGet(path, queryParams = {}) {
  const token = await getMontaToken();
  const url = new URL(`${MONTA_BASE}${path}`);
  Object.entries(queryParams).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });

  const cacheKey = url.toString();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Monta API error (${res.status}): ${body}`);
  }

  const data = await res.json();
  cache.set(cacheKey, data);
  return data;
}

// ─── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/status
 * Health check — verifies proxy is running and Monta credentials are valid.
 */
app.get("/api/status", requireDashboardKey, async (req, res) => {
  try {
    await getMontaToken();
    res.json({ ok: true, message: "Proxy connected to Monta API", ts: new Date().toISOString() });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/charges
 * Query params forwarded to Monta:
 *   pageSize   — number of records (default 100, max 200)
 *   page       — page number (default 1)
 *   from       — ISO date string, filter start date
 *   to         — ISO date string, filter end date
 *   chargePointId — filter by specific charge point
 */
app.get("/api/charges", requireDashboardKey, async (req, res) => {
  try {
    const { pageSize = 100, page = 1, from, to, chargePointId } = req.query;
    const data = await montaGet("/charges", { pageSize, page, from, to, chargePointId });

    // Normalise response shape — Monta may return { charges: [] } or { data: [] }
    const charges = data.charges ?? data.data ?? [];
    res.json({ charges, total: data.total ?? charges.length, page: data.page ?? page });
  } catch (err) {
    console.error("GET /api/charges error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

/**
 * GET /api/charges/:id
 * Returns a single charge session with full detail.
 */
app.get("/api/charges/:id", requireDashboardKey, async (req, res) => {
  try {
    const data = await montaGet(`/charges/${req.params.id}`);
    res.json(data);
  } catch (err) {
    console.error(`GET /api/charges/${req.params.id} error:`, err.message);
    res.status(502).json({ error: err.message });
  }
});

/**
 * GET /api/charge-points
 * Query params: pageSize, page
 */
app.get("/api/charge-points", requireDashboardKey, async (req, res) => {
  try {
    const { pageSize = 100, page = 1 } = req.query;
    const data = await montaGet("/charge-points", { pageSize, page });
    const chargePoints = data.chargePoints ?? data.data ?? [];
    res.json({ chargePoints, total: data.total ?? chargePoints.length });
  } catch (err) {
    console.error("GET /api/charge-points error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

/**
 * GET /api/charge-points/:id
 */
app.get("/api/charge-points/:id", requireDashboardKey, async (req, res) => {
  try {
    const data = await montaGet(`/charge-points/${req.params.id}`);
    res.json(data);
  } catch (err) {
    console.error(`GET /api/charge-points/${req.params.id} error:`, err.message);
    res.status(502).json({ error: err.message });
  }
});

// ─── Cache management (internal use / debugging) ───────────────────────────────
app.post("/api/cache/flush", requireDashboardKey, (req, res) => {
  cache.flushAll();
  res.json({ ok: true, message: "Cache flushed" });
});

const path = require("path");

// Serve the built React app
app.use(express.static(path.join(__dirname, "client/dist")));

// Catch-all: send index.html for any non-API route
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client/dist", "index.html"));
});

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n⚡ Ahead Colorado Monta Proxy running on http://localhost:${PORT}`);
  console.log(`   CORS allowed origins: ${allowedOrigins.join(", ")}`);
  console.log(`   Cache TTL: 5 minutes`);
  console.log(`   Monta client ID: ${MONTA_CLIENT_ID ? MONTA_CLIENT_ID.slice(0, 6) + "…" : "NOT SET"}\n`);
});
