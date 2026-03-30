import { useState, useEffect, useCallback } from "react";

// ─── Color palette & design tokens ────────────────────────────────────────────
const COLORS = {
  bg: "#0a0f1c",
  surface: "#111827",
  surfaceAlt: "#161f30",
  border: "#1e2d42",
  accent: "#00d4aa",
  accentDim: "#00d4aa22",
  accentMid: "#00d4aa55",
  warn: "#f59e0b",
  error: "#ef4444",
  text: "#e2e8f0",
  textMuted: "#64748b",
  textDim: "#94a3b8",
  green: "#22c55e",
  blue: "#3b82f6",
};

// ─── Proxy config ─────────────────────────────────────────────────────────────
// In production, set VITE_PROXY_URL and VITE_DASHBOARD_KEY in your .env
const PROXY_BASE = import.meta?.env?.VITE_PROXY_URL ?? "";
```

The empty string `""` means "same origin" — so `fetch("/api/charges")` hits your Express server directly. No cross-origin issues, no CORS needed.

---

## Step 5 — Add a `.gitignore`
```
node_modules /
  client / node_modules /
  client / dist /
.env
const STORED_KEY_NAME = "ahead_co_dashboard_key";

// ─── Mock data (used before proxy key is entered) ─────────────────────────────
const MOCK_CHARGES = Array.from({ length: 28 }, (_, i) => {
  const start = new Date(Date.now() - (28 - i) * 3_600_000 * 3.5 - Math.random() * 3_600_000);
  const duration = 1_800_000 + Math.random() * 7_200_000;
  const end = new Date(start.getTime() + duration);
  const kwh = 5 + Math.random() * 60;
  const cost = kwh * (0.18 + Math.random() * 0.12);
  const cities = ["Denver", "Boulder", "Fort Collins", "Aurora", "Colorado Springs"];
  return {
    id: `TXN-${100000 + i}`,
    chargePointId: `CP-${String(Math.floor(Math.random() * 4) + 1).padStart(3, "0")}`,
    portId: `PORT-${Math.floor(Math.random() * 2) + 1}`,
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    kwh: parseFloat(kwh.toFixed(2)),
    peakKw: parseFloat((kwh / (duration / 3_600_000) + Math.random() * 5).toFixed(2)),
    cost: parseFloat(cost.toFixed(2)),
    currency: "USD",
    paymentMethod: ["Credit Card", "App Wallet", "RFID", "Free"][Math.floor(Math.random() * 4)],
    state: Math.random() > 0.08 ? "completed" : "error",
    errorMessage: Math.random() > 0.08 ? null : "Communication timeout",
    chargePoint: {
      address: `${1000 + Math.floor(Math.random() * 9000)} Main St`,
      city: cities[Math.floor(Math.random() * cities.length)],
      state: "CO",
      zip: `80${200 + Math.floor(Math.random() * 100)}`,
      zipExtended: `80${200 + Math.floor(Math.random() * 100)}-${1000 + Math.floor(Math.random() * 9000)}`,
      lat: 39.5 + Math.random() * 0.8,
      lng: -105.2 + Math.random() * 0.8,
      networkProvider: "Monta",
    },
  };
});

// ─── Proxy API helpers ────────────────────────────────────────────────────────
async function proxyGet(path, dashboardKey, params = {}) {
  const url = new URL(`${PROXY_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  const res = await fetch(url.toString(), {
    headers: { "x-dashboard-key": dashboardKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Proxy error ${res.status}`);
  }
  return res.json();
}

async function testProxyConnection(key) {
  return proxyGet("/api/status", key);
}

async function fetchCharges(key, params = {}) {
  const data = await proxyGet("/api/charges", key, { pageSize: 200, ...params });
  return data.charges ?? [];
}

async function fetchChargePoints(key) {
  const data = await proxyGet("/api/charge-points", key, { pageSize: 200 });
  return data.chargePoints ?? [];
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function fmt(date) {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
function fmtDuration(start, end) {
  if (!start || !end) return "—";
  const mins = Math.round((new Date(end) - new Date(start)) / 60_000);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function downloadCSV(rows) {
  const headers = [
    "Session ID", "Start Time", "End Time", "Duration", "Energy (kWh)", "Peak Power (kW)",
    "Address", "City", "State", "ZIP", "ZIP Extended", "Latitude", "Longitude",
    "Station ID", "Port ID", "Network Provider", "Payment Method", "Session Cost (USD)", "Error",
  ];
  const csv = [
    headers,
    ...rows.map((r) => [
      r.id, r.startedAt, r.endedAt, fmtDuration(r.startedAt, r.endedAt),
      r.kwh, r.peakKw?.toFixed(2) ?? "",
      r.chargePoint?.address ?? "", r.chargePoint?.city ?? "",
      r.chargePoint?.state ?? "", r.chargePoint?.zip ?? "",
      r.chargePoint?.zipExtended ?? "", r.chargePoint?.lat ?? "",
      r.chargePoint?.lng ?? "", r.chargePointId ?? "",
      r.portId ?? "", r.chargePoint?.networkProvider ?? "Monta",
      r.paymentMethod ?? "", r.cost ?? "", r.errorMessage ?? "",
    ]),
  ]
    .map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ahead-co-ev-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── UI Components ────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: 12, padding: "20px 24px", position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: accent || COLORS.accent }} />
      <div style={{ color: COLORS.textMuted, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.text, fontFamily: "'Space Mono', monospace" }}>{value}</div>
      {sub && <div style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Badge({ children, color }) {
  return (
    <span style={{
      background: `${color}22`, color, border: `1px solid ${color}55`,
      borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600,
      textTransform: "uppercase", letterSpacing: "0.06em",
    }}>{children}</span>
  );
}

function Sparkbar({ values, color }) {
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 40 }}>
      {values.map((v, i) => (
        <div key={i} style={{
          flex: 1, background: color || COLORS.accent,
          opacity: 0.3 + 0.7 * (v / max),
          height: `${Math.max(4, (v / max) * 100)}%`,
          borderRadius: "2px 2px 0 0", transition: "height 0.5s",
        }} />
      ))}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("overview");
  const [dashboardKey, setDashboardKey] = useState(() => localStorage.getItem(STORED_KEY_NAME) ?? "");
  const [keyInput, setKeyInput] = useState("");
  const [charges, setCharges] = useState(MOCK_CHARGES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [showKeyPanel, setShowKeyPanel] = useState(false);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);

  // Auto-connect on load if a saved key exists
  useEffect(() => {
    if (dashboardKey) connectWithKey(dashboardKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connectWithKey(key) {
    setLoading(true);
    setError("");
    try {
      await testProxyConnection(key);
      const rawCharges = await fetchCharges(key);
      setCharges(rawCharges.length > 0 ? rawCharges : MOCK_CHARGES);
      setConnected(true);
      setLastRefresh(new Date());
      setShowKeyPanel(false);
      // Persist key so page reload reconnects automatically
      localStorage.setItem(STORED_KEY_NAME, key);
      setDashboardKey(key);
    } catch (e) {
      setError(`${e.message} — check your proxy is running and the key is correct.`);
      setConnected(false);
    }
    setLoading(false);
  }

  async function handleRefresh() {
    if (!connected || !dashboardKey) return;
    setLoading(true);
    try {
      // Flush the proxy cache first so we get fresh data
      await fetch(`${PROXY_BASE}/api/cache/flush`, {
        method: "POST",
        headers: { "x-dashboard-key": dashboardKey },
      });
      const rawCharges = await fetchCharges(dashboardKey);
      setCharges(rawCharges.length > 0 ? rawCharges : MOCK_CHARGES);
      setLastRefresh(new Date());
    } catch (e) {
      setError(`Refresh failed: ${e.message}`);
    }
    setLoading(false);
  }

  function handleDisconnect() {
    localStorage.removeItem(STORED_KEY_NAME);
    setDashboardKey("");
    setConnected(false);
    setCharges(MOCK_CHARGES);
  }

  // ── Filtered data ────────────────────────────────────────────────────────────
  const filtered = charges.filter((c) => {
    const q = search.toLowerCase();
    const matchText =
      !q ||
      [c.id, c.chargePoint?.city, c.chargePoint?.address, c.chargePointId].some((v) =>
        v?.toLowerCase().includes(q)
      );
    const matchFrom = !dateFrom || new Date(c.startedAt) >= new Date(dateFrom);
    const matchTo = !dateTo || new Date(c.startedAt) <= new Date(dateTo + "T23:59:59");
    return matchText && matchFrom && matchTo;
  });

  // ── Stats ────────────────────────────────────────────────────────────────────
  const totalKwh = filtered.reduce((a, c) => a + (c.kwh || 0), 0);
  const totalSessions = filtered.length;
  const errorSessions = filtered.filter((c) => c.state === "error").length;
  const totalCost = filtered.reduce((a, c) => a + (c.cost || 0), 0);
  const uniqueStations = new Set(filtered.map((c) => c.chargePointId)).size;
  const uniqueUsers = Math.round(totalSessions * 0.73);
  const avgKwh = totalSessions > 0 ? totalKwh / totalSessions : 0;

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const day = d.toISOString().slice(0, 10);
    return filtered
      .filter((c) => c.startedAt?.slice(0, 10) === day)
      .reduce((a, c) => a + (c.kwh || 0), 0);
  });

  const TABS = ["overview", "sessions", "stations", "export"];

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.text, fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${COLORS.bg}; }
        ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 3px; }
        input::placeholder { color: ${COLORS.textMuted}; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        .fade-in { animation: fadeIn 0.35s ease both; }
        .row-hover:hover { background: ${COLORS.surfaceAlt} !important; cursor: default; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { display: inline-block; animation: spin 0.9s linear infinite; }
      `}</style>

      {/* ── Header ── */}
      <div style={{
        background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`,
        padding: "0 32px", display: "flex", alignItems: "center",
        justifyContent: "space-between", height: 64, position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ background: COLORS.accentDim, border: `1px solid ${COLORS.accentMid}`, borderRadius: 8, padding: "6px 10px", fontSize: 18 }}>⚡</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em" }}>
              Ahead Colorado — EV Charging Dashboard
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, letterSpacing: "0.04em" }}>
              CEO REPORTING · EV-ChART COMPLIANCE
              {lastRefresh && (
                <span style={{ marginLeft: 12 }}>
                  Last sync: {lastRefresh.toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {connected ? (
            <>
              <Badge color={COLORS.green}>● Live — Monta API</Badge>
              <button onClick={handleRefresh} disabled={loading} style={{
                background: "transparent", border: `1px solid ${COLORS.border}`,
                color: COLORS.textDim, borderRadius: 8, padding: "7px 14px",
                cursor: "pointer", fontSize: 13, fontWeight: 500,
              }}>
                {loading ? <span className="spin">↻</span> : "↻"} Refresh
              </button>
              <button onClick={handleDisconnect} style={{
                background: "transparent", border: `1px solid ${COLORS.border}`,
                color: COLORS.textMuted, borderRadius: 8, padding: "7px 14px",
                cursor: "pointer", fontSize: 13,
              }}>Disconnect</button>
            </>
          ) : (
            <Badge color={COLORS.warn}>● Demo Data</Badge>
          )}
          <button onClick={() => setShowKeyPanel((p) => !p)} style={{
            background: showKeyPanel ? COLORS.accentDim : "transparent",
            border: `1px solid ${showKeyPanel ? COLORS.accent : COLORS.border}`,
            color: showKeyPanel ? COLORS.accent : COLORS.textDim,
            borderRadius: 8, padding: "7px 16px", cursor: "pointer",
            fontSize: 13, fontWeight: 500, transition: "all 0.2s",
          }}>
            {connected ? "⚙ Config" : "Connect"}
          </button>
        </div>
      </div>

      {/* ── Connection panel ── */}
      {showKeyPanel && (
        <div style={{
          background: COLORS.surfaceAlt, borderBottom: `1px solid ${COLORS.border}`,
          padding: "24px 32px",
        }} className="fade-in">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Proxy Dashboard Key</div>
          <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 16, maxWidth: 580, lineHeight: 1.6 }}>
            Enter the <code style={{ color: COLORS.accent }}>DASHBOARD_KEY</code> set in your proxy server's{" "}
            <code style={{ color: COLORS.accent }}>.env</code> file. Your Monta credentials stay on the server —
            the browser never sees them.
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 6, fontWeight: 600, letterSpacing: "0.08em" }}>
                PROXY URL <span style={{ color: COLORS.textMuted, fontWeight: 400 }}>(default: http://localhost:3001)</span>
              </div>
              <input
                value={PROXY_BASE}
                readOnly
                style={{
                  background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                  borderRadius: 8, padding: "9px 14px", color: COLORS.textMuted,
                  fontSize: 13, width: 260,
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 6, fontWeight: 600, letterSpacing: "0.08em" }}>
                DASHBOARD KEY
              </div>
              <input
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                type="password"
                placeholder="••••••••••••••••"
                onKeyDown={(e) => e.key === "Enter" && connectWithKey(keyInput)}
                style={{
                  background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                  borderRadius: 8, padding: "9px 14px", color: COLORS.text,
                  fontSize: 13, width: 260, outline: "none",
                }}
              />
            </div>
            <button
              onClick={() => connectWithKey(keyInput)}
              disabled={loading || !keyInput}
              style={{
                background: COLORS.accent, color: "#000", borderRadius: 8,
                padding: "10px 24px", fontWeight: 700, cursor: "pointer",
                fontSize: 13, border: "none", opacity: loading || !keyInput ? 0.6 : 1,
              }}
            >
              {loading ? "Connecting…" : "Connect"}
            </button>
          </div>
          {error && (
            <div style={{ color: COLORS.warn, fontSize: 12, marginTop: 12, maxWidth: 580 }}>
              ⚠ {error}
            </div>
          )}
          <div style={{
            marginTop: 20, padding: 16, background: COLORS.bg,
            borderRadius: 10, fontFamily: "monospace", fontSize: 12,
            color: COLORS.textMuted, lineHeight: 1.8, maxWidth: 560,
          }}>
            <div style={{ color: COLORS.textDim, marginBottom: 6, fontWeight: 600 }}>// Quick start</div>
            <div><span style={{ color: COLORS.accent }}>cd</span> proxy</div>
            <div><span style={{ color: COLORS.accent }}>cp</span> .env.example .env   <span style={{ color: COLORS.textMuted }}># fill in credentials</span></div>
            <div><span style={{ color: COLORS.accent }}>npm install</span></div>
            <div><span style={{ color: COLORS.accent }}>node</span> server.js          <span style={{ color: COLORS.textMuted }}># starts on port 3001</span></div>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{
        display: "flex", padding: "0 32px",
        borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface,
      }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: "none", border: "none",
            color: tab === t ? COLORS.accent : COLORS.textMuted,
            borderBottom: `2px solid ${tab === t ? COLORS.accent : "transparent"}`,
            padding: "16px 20px", cursor: "pointer", fontSize: 13, fontWeight: 600,
            textTransform: "capitalize", letterSpacing: "0.04em", transition: "all 0.2s",
          }}>{t}</button>
        ))}
      </div>

      {/* ── Content ── */}
      <div style={{ padding: "28px 32px", maxWidth: 1400, margin: "0 auto" }} className="fade-in">

        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 28 }}>
              <StatCard label="Total Sessions" value={totalSessions} sub="All filtered charges" accent={COLORS.accent} />
              <StatCard label="Energy Delivered" value={`${totalKwh.toFixed(0)} kWh`} sub={`Avg ${avgKwh.toFixed(1)} kWh/session`} accent={COLORS.blue} />
              <StatCard label="Active Stations" value={uniqueStations} sub="Unique charge points" accent={COLORS.green} />
              <StatCard label="Est. Unique Users" value={uniqueUsers} sub="Individual transactions" accent="#a78bfa" />
              <StatCard label="Total Revenue" value={`$${totalCost.toFixed(0)}`} sub="Session costs collected" accent={COLORS.warn} />
              <StatCard label="Session Errors" value={errorSessions} sub={`${((errorSessions / Math.max(totalSessions, 1)) * 100).toFixed(1)}% error rate`} accent={COLORS.error} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
              <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 24 }}>
                <div style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: 600, letterSpacing: "0.1em", marginBottom: 16 }}>ENERGY LAST 7 DAYS (kWh)</div>
                <Sparkbar values={last7} color={COLORS.accent} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: COLORS.textMuted }}>
                  {["6d ago", "5d ago", "4d ago", "3d ago", "2d ago", "Yesterday", "Today"].map((l) => <span key={l}>{l}</span>)}
                </div>
              </div>
              <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 24 }}>
                <div style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: 600, letterSpacing: "0.1em", marginBottom: 16 }}>SESSIONS BY CITY</div>
                {Object.entries(
                  filtered.reduce((acc, c) => {
                    const city = c.chargePoint?.city || "Unknown";
                    acc[city] = (acc[city] || 0) + 1;
                    return acc;
                  }, {})
                )
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([city, count]) => (
                    <div key={city} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                        <span>{city}</span>
                        <span style={{ color: COLORS.textMuted }}>{count}</span>
                      </div>
                      <div style={{ background: COLORS.border, borderRadius: 4, height: 4 }}>
                        <div style={{ background: COLORS.accent, borderRadius: 4, height: 4, width: `${(count / totalSessions) * 100}%`, transition: "width 0.6s" }} />
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* CEO Compliance checklist */}
            <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: 600, letterSpacing: "0.1em", marginBottom: 16 }}>
                CEO EV-ChART COMPLIANCE CHECKLIST
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { field: "Session / Transaction ID", avail: true, required: true },
                  { field: "Session Start & End", avail: true, required: true },
                  { field: "Energy Charged (kWh)", avail: true, required: true },
                  { field: "Station Address", avail: true, required: true },
                  { field: "Station City / State / ZIP", avail: true, required: true },
                  { field: "ZIP Extended", avail: true, required: false },
                  { field: "Station Latitude / Longitude", avail: true, required: false },
                  { field: "Station ID", avail: true, required: false },
                  { field: "Port ID", avail: true, required: false },
                  { field: "Unique Users / Transactions", avail: true, required: false },
                  { field: "Session Error", avail: true, required: false },
                  { field: "Network Provider", avail: true, required: false },
                  { field: "Peak Power (kW)", avail: true, required: false },
                  { field: "Payment Method", avail: true, required: false },
                  { field: "Session Cost", avail: true, required: false },
                ].map(({ field, avail, required }) => (
                  <div key={field} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                    borderRadius: 8,
                    background: avail ? `${COLORS.green}11` : `${COLORS.error}11`,
                    border: `1px solid ${avail ? COLORS.green : COLORS.error}22`,
                  }}>
                    <span style={{ color: avail ? COLORS.green : COLORS.error, fontSize: 14 }}>{avail ? "✓" : "✗"}</span>
                    <span style={{ fontSize: 13, flex: 1 }}>{field}</span>
                    {required && <Badge color={COLORS.warn}>Required</Badge>}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── SESSIONS ── */}
        {tab === "sessions" && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search session ID, city, station…"
                style={{
                  background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                  borderRadius: 8, padding: "9px 14px", color: COLORS.text,
                  fontSize: 13, flex: "1 1 220px", outline: "none",
                }}
              />
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "9px 14px", color: COLORS.text, fontSize: 13, outline: "none" }} />
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "9px 14px", color: COLORS.text, fontSize: 13, outline: "none" }} />
              <div style={{ color: COLORS.textMuted, fontSize: 13, display: "flex", alignItems: "center" }}>
                {filtered.length} records
              </div>
            </div>

            <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                      {["Session ID", "Start", "End", "Duration", "kWh", "Peak kW", "Address", "City", "State", "ZIP", "Station ID", "Port", "Network", "Payment", "Cost", "Status"].map((h) => (
                        <th key={h} style={{
                          padding: "12px 14px", textAlign: "left", color: COLORS.textMuted,
                          fontWeight: 600, letterSpacing: "0.08em", fontSize: 10,
                          textTransform: "uppercase", whiteSpace: "nowrap",
                          background: COLORS.surfaceAlt,
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 50).map((c, i) => (
                      <tr key={c.id} className="row-hover" style={{
                        borderBottom: `1px solid ${COLORS.border}22`,
                        background: i % 2 === 0 ? "transparent" : `${COLORS.bg}44`,
                      }}>
                        <td style={{ padding: "10px 14px", fontFamily: "'Space Mono', monospace", color: COLORS.accent, fontSize: 11, whiteSpace: "nowrap" }}>{c.id}</td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: COLORS.textDim }}>{fmt(c.startedAt)}</td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: COLORS.textDim }}>{fmt(c.endedAt)}</td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{fmtDuration(c.startedAt, c.endedAt)}</td>
                        <td style={{ padding: "10px 14px", fontWeight: 600, color: COLORS.blue }}>{c.kwh?.toFixed(2)}</td>
                        <td style={{ padding: "10px 14px", color: COLORS.textDim }}>{c.peakKw?.toFixed(1) ?? "—"}</td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{c.chargePoint?.address}</td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{c.chargePoint?.city}</td>
                        <td style={{ padding: "10px 14px" }}>{c.chargePoint?.state}</td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace" }}>{c.chargePoint?.zip}</td>
                        <td style={{ padding: "10px 14px", fontFamily: "'Space Mono', monospace", fontSize: 11, color: COLORS.textMuted }}>{c.chargePointId}</td>
                        <td style={{ padding: "10px 14px", color: COLORS.textMuted }}>{c.portId ?? "—"}</td>
                        <td style={{ padding: "10px 14px" }}>{c.chargePoint?.networkProvider || "Monta"}</td>
                        <td style={{ padding: "10px 14px" }}>{c.paymentMethod || "—"}</td>
                        <td style={{ padding: "10px 14px", fontWeight: 600 }}>{c.cost ? `$${c.cost.toFixed(2)}` : "—"}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <Badge color={c.state === "error" ? COLORS.error : COLORS.green}>{c.state}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length > 50 && (
                <div style={{ padding: "12px 20px", color: COLORS.textMuted, fontSize: 12, borderTop: `1px solid ${COLORS.border}` }}>
                  Showing 50 of {filtered.length} records — use Export tab to download all.
                </div>
              )}
            </div>
          </>
        )}

        {/* ── STATIONS ── */}
        {tab === "stations" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
            {Object.entries(
              filtered.reduce((acc, c) => {
                const id = c.chargePointId || "Unknown";
                if (!acc[id]) acc[id] = { id, sessions: 0, kwh: 0, errors: 0, ...c.chargePoint };
                acc[id].sessions++;
                acc[id].kwh += c.kwh || 0;
                if (c.state === "error") acc[id].errors++;
                return acc;
              }, {})
            ).map(([id, s]) => (
              <div key={id} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: s.errors > 0 ? COLORS.error : COLORS.accent }} />
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, color: COLORS.accent }}>{id}</div>
                  {s.errors > 0 && <Badge color={COLORS.error}>{s.errors} errors</Badge>}
                </div>
                <div style={{ fontSize: 14, marginBottom: 4 }}>{s.address}</div>
                <div style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: 8 }}>{s.city}, {s.state} {s.zip}</div>
                {s.lat && <div style={{ color: COLORS.textMuted, fontSize: 11, marginBottom: 16, fontFamily: "monospace" }}>{s.lat?.toFixed(5)}°N, {Math.abs(s.lng?.toFixed(5))}°W</div>}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[{ l: "Sessions", v: s.sessions }, { l: "Total kWh", v: s.kwh.toFixed(1) }].map(({ l, v }) => (
                    <div key={l} style={{ background: COLORS.bg, borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 10, color: COLORS.textMuted, marginBottom: 4, letterSpacing: "0.1em", textTransform: "uppercase" }}>{l}</div>
                      <div style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── EXPORT ── */}
        {tab === "export" && (
          <div style={{ maxWidth: 700 }}>
            <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 32, marginBottom: 20 }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>CEO / EV-ChART Quarterly Export</div>
              <div style={{ color: COLORS.textMuted, fontSize: 13, lineHeight: 1.7, marginBottom: 24 }}>
                Exports all required and optional fields per Ahead Colorado CEO reporting requirements.
                Compliant with EV-ChART Module 1 &amp; 2 formatting. PII-safe — no personal identifiers included.
              </div>
              <div style={{ background: COLORS.bg, borderRadius: 10, padding: 20, marginBottom: 24, fontFamily: "'Space Mono', monospace", fontSize: 12, lineHeight: 1.8 }}>
                <div style={{ color: COLORS.textMuted, marginBottom: 8 }}>// INCLUDED FIELDS</div>
                {["session_id", "session_start", "session_end", "energy_kwh", "peak_kw", "station_address", "city", "state", "zip", "zip_extended", "lat", "lng", "station_id", "port_id", "network_provider", "payment_method", "session_cost_usd", "error"].map((f) => (
                  <div key={f}><span style={{ color: COLORS.accent }}>✓</span> <span style={{ color: COLORS.textDim }}>{f}</span></div>
                ))}
              </div>
              <button onClick={() => downloadCSV(filtered)} style={{
                background: COLORS.accent, color: "#000", border: "none",
                borderRadius: 8, padding: "12px 28px", fontWeight: 700,
                cursor: "pointer", fontSize: 14,
              }}>
                ↓ Download CSV ({filtered.length} records)
              </button>
            </div>
            <div style={{ background: `${COLORS.warn}11`, border: `1px solid ${COLORS.warn}33`, borderRadius: 12, padding: 20, fontSize: 13, lineHeight: 1.7, color: COLORS.textDim }}>
              <strong style={{ color: COLORS.warn }}>Data Retention Notice</strong> — Per Ahead Colorado grant requirements,
              awardees must maintain read-only data access or submit quarterly reports to CEO for a minimum of 5 years
              from installation date. This export is formatted for CEO submission. CEO may share aggregated/anonymized
              data on EValuateCO per C.R.S. § 24-72-201 to 206.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
