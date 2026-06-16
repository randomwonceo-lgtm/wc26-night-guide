// Vercel serverless function — live venue ratings via Google Places (Text Search).
// The API key stays server-side (never shipped to the browser).
// Set GOOGLE_PLACES_API_KEY in env. NOTE: requires billing enabled on the Google Cloud project
// (Google gives a recurring free usage credit that covers typical traffic).
// Docs: https://developers.google.com/maps/documentation/places/web-service/search-text
//
// Request:  POST { queries: [{ id, q }] }   (q = "Venue Name City")
// Response: { places: { <id>: { rating, total, openNow } } }

const ENDPOINT = "https://maps.googleapis.com/maps/api/place/textsearch/json";

async function readBody(req) {
  if (req.body) return typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  let body = "";
  await new Promise((resolve) => { req.on("data", (c) => (body += c)); req.on("end", resolve); });
  return body;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // Ratings change slowly — cache hard at the edge so we don't re-bill Google per visit.
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) { res.statusCode = 503; res.end(JSON.stringify({ error: "no_key", places: {} })); return; }
  if (req.method !== "POST") { res.statusCode = 405; res.end(JSON.stringify({ error: "method", places: {} })); return; }

  let queries = [];
  try { queries = (JSON.parse((await readBody(req)) || "{}").queries) || []; } catch (e) {}
  queries = queries.slice(0, 30); // safety cap

  const places = {};
  await Promise.all(queries.map(async (item) => {
    if (!item || !item.q || !item.id) return;
    try {
      const r = await fetch(`${ENDPOINT}?query=${encodeURIComponent(item.q)}&key=${key}`);
      const d = await r.json();
      const hit = (d.results && d.results[0]) || null;
      if (hit) {
        places[item.id] = {
          rating: hit.rating ?? null,
          total: hit.user_ratings_total ?? null,
          openNow: hit.opening_hours ? !!hit.opening_hours.open_now : null,
        };
      }
    } catch (e) { /* skip this one */ }
  }));

  res.statusCode = 200;
  res.end(JSON.stringify({ places }));
}
