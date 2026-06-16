// Vercel serverless function — proxies live World Cup scores from football-data.org.
// The API key stays server-side here (never shipped to the browser).
// Set FOOTBALL_DATA_API_KEY in your environment (.env locally, Vercel project settings in prod).
//
// Free API key: https://www.football-data.org/client/register
// Docs: https://docs.football-data.org/general/v4/index.html  (FIFA World Cup competition code: WC)

const API_BASE = "https://api.football-data.org/v4";
const COMPETITION = "WC"; // FIFA World Cup (included in football-data.org free tier)

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

// Trim the upstream payload to just what the UI needs.
function slim(m) {
  return {
    id: m.id,
    utcDate: m.utcDate,
    status: m.status, // SCHEDULED | TIMED | IN_PLAY | PAUSED | FINISHED | ...
    minute: m.minute ?? null,
    injuryTime: m.injuryTime ?? null,
    stage: m.stage || null,
    group: m.group || null,
    home: m.homeTeam?.name ?? m.homeTeam?.shortName ?? "TBD",
    away: m.awayTeam?.name ?? m.awayTeam?.shortName ?? "TBD",
    homeScore: m.score?.fullTime?.home ?? null,
    awayScore: m.score?.fullTime?.away ?? null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // Let the browser cache for a few seconds so rapid polling doesn't hammer the upstream.
  res.setHeader("Cache-Control", "public, max-age=10, stale-while-revalidate=30");

  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) {
    res.statusCode = 503;
    res.end(
      JSON.stringify({
        error: "no_key",
        message:
          "FOOTBALL_DATA_API_KEY is not set. Add it to .env (local) or Vercel project settings.",
        matches: [],
      })
    );
    return;
  }

  // Window: yesterday through tomorrow (UTC) so we catch late-night live games either side of midnight.
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 3600 * 1000);
  const to = new Date(now.getTime() + 24 * 3600 * 1000);
  const url = `${API_BASE}/competitions/${COMPETITION}/matches?dateFrom=${ymd(from)}&dateTo=${ymd(to)}`;

  try {
    const upstream = await fetch(url, { headers: { "X-Auth-Token": key } });

    if (!upstream.ok) {
      const body = await upstream.text();
      res.statusCode = upstream.status === 429 ? 429 : 502;
      res.end(
        JSON.stringify({
          error: "upstream",
          status: upstream.status,
          message:
            upstream.status === 403
              ? "football-data.org rejected the key (invalid, or competition not in your plan)."
              : upstream.status === 429
              ? "Rate limit hit (free tier is ~10 requests/min). Try again shortly."
              : `Upstream returned ${upstream.status}.`,
          detail: body.slice(0, 300),
          matches: [],
        })
      );
      return;
    }

    const data = await upstream.json();
    const matches = Array.isArray(data.matches) ? data.matches.map(slim) : [];

    res.statusCode = 200;
    res.end(JSON.stringify({ asOf: now.toISOString(), competition: COMPETITION, matches }));
  } catch (err) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        error: "fetch_failed",
        message: String(err?.message || err),
        matches: [],
      })
    );
  }
}
