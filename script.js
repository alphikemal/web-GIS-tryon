// server.js
// ──────────────────────────────────────────────────────────────────────────────
// WebGIS API (Express + PostGIS)
// Purpose: Serve live GeoJSON from PostGIS for your Leaflet/WebGIS frontend.
// Key endpoints:
//   GET /                       → quick info page
//   GET /health                 → DB health check
//   GET /whoami                 → DB user + client/server IPs (debugging)
//   GET /blocks                 → GeoJSON from public.blocks (filters + no-cache)
//   GET /buildings              → GeoJSON from public.buildings (filters + no-cache)
//   GET /debug/buildings-stats  → quick stats for buildings (count/SRID/extent)
// ──────────────────────────────────────────────────────────────────────────────

import express from "express";
import cors from "cors";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;
const app = express();

/* ───────────── CORS ───────────── */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);                 // allow curl/Postman
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("CORS not allowed for origin: " + origin));
    },
  })
);

/* ──────── Postgres connection pool ──────── */
const dbCfg = {
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  // ssl: { rejectUnauthorized: false }, // ← enable if your provider requires SSL
};

console.log("DB config:", {
  host: dbCfg.host,
  port: dbCfg.port,
  database: dbCfg.database,
  user: dbCfg.user,
});

const pool = new Pool(dbCfg);

// Test DB connection at startup
pool
  .connect()
  .then((client) => {
    console.log("✅ Connected to PostgreSQL successfully");
    client.release();
  })
  .catch((err) => {
    console.error("❌ Failed to connect to PostgreSQL at startup:", err.message);
  });

/* ───────────── Routes ───────────── */

// 1) Home
app.get("/", (_req, res) => {
  res
    .type("text")
    .send("WebGIS API is running.\nTry /health, /whoami, /blocks, /buildings\n");
});

// 2) Health
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3) Who am I
app.get("/whoami", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        current_user,
        inet_client_addr()  AS client_ip,
        inet_server_addr()  AS server_ip,
        inet_server_port()  AS server_port
    `);
    res.json(rows?.[0] || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4) /blocks → public.blocks (geom), with ?limit & ?bbox & ?q
app.get("/blocks", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 1000, 10000);
    const q = req.query.q ? String(req.query.q).trim() : null;
    const bbox = req.query.bbox ? req.query.bbox.split(",").map(Number) : null;

    const where = [];
    const params = [];
    let i = 0;

    if (q) {
      where.push(`name ILIKE '%' || $${++i} || '%'`);
      params.push(q);
    }
    if (bbox && bbox.length === 4 && bbox.every(Number.isFinite)) {
      where.push(
        `ST_Intersects(geom, ST_MakeEnvelope($${++i}, $${++i}, $${++i}, $${++i}, 4326))`
      );
      params.push(bbox[0], bbox[1], bbox[2], bbox[3]);
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const sql = `
      SELECT jsonb_build_object(
        'type','FeatureCollection',
        'features', COALESCE(jsonb_agg(
          jsonb_build_object(
            'type','Feature',
            'geometry', ST_AsGeoJSON(geom)::jsonb,
            'properties', to_jsonb(row) - 'geom'
          )
        ), '[]'::jsonb)
      ) AS geojson
      FROM (
        SELECT * FROM public.blocks
        ${whereSQL}
        LIMIT ${limit}
      ) row;
    `;

    const { rows } = await pool.query(sql, params);
    res.set("Cache-Control", "no-store");
    res.json(rows?.[0]?.geojson ?? { type: "FeatureCollection", features: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5) /buildings → public.buildings (geom), same filters
app.get("/buildings", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 1000, 10000);
    const q = req.query.q ? String(req.query.q).trim() : null;
    const bbox = req.query.bbox ? req.query.bbox.split(",").map(Number) : null;

    const where = [];
    const params = [];
    let i = 0;

    // adjust "name" if your label field differs
    if (q) { where.push(`name ILIKE '%' || $${++i} || '%'`); params.push(q); }

    if (bbox && bbox.length === 4 && bbox.every(Number.isFinite)) {
      where.push(
        `ST_Intersects(geom, ST_MakeEnvelope($${++i}, $${++i}, $${++i}, $${++i}, 4326))`
      );
      params.push(bbox[0], bbox[1], bbox[2], bbox[3]);
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const sql = `
      SELECT jsonb_build_object(
        'type','FeatureCollection',
        'features', COALESCE(jsonb_agg(
          jsonb_build_object(
            'type','Feature',
            'geometry', ST_AsGeoJSON(geom)::jsonb,
            'properties', to_jsonb(row) - 'geom'
          )
        ), '[]'::jsonb)
      ) AS geojson
      FROM (
        SELECT * FROM public.buildings
        ${whereSQL}
        LIMIT ${limit}
      ) row;
    `;

    const { rows } = await pool.query(sql, params);
    res.set("Cache-Control", "no-store");
    res.json(rows?.[0]?.geojson ?? { type: "FeatureCollection", features: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6) Debug stats for buildings
app.get("/debug/buildings-stats", async (_req, res) => {
  try {
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM public.buildings`
    );
    const { rows: sr } = await pool.query(
      `SELECT COALESCE(ST_SRID(geom),0) AS srid
       FROM public.buildings
       WHERE geom IS NOT NULL
       LIMIT 1`
    );
    const { rows: bbox } = await pool.query(
      `SELECT ST_Extent(geom) AS extent FROM public.buildings`
    );
    res.json({
      count: cnt[0].count,
      srid: sr[0]?.srid ?? 0,
      extent: bbox[0].extent,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ───────────── Start server ───────────── */
const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`✅ API running on http://localhost:${port}`);
});
