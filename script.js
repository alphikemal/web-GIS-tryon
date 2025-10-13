/* ============================================================================
   script.js — WebGIS front-end (Leaflet)
   Purpose:
     - Render polygons from your GeoJSON API (public.buildings via /buildings)
     - Support local file import, multi-select, rectangle-select
     - Show attribute table and export selected to GeoJSON/CSV
     - Provide explicit "Reload" + optional auto-refresh
   ============================================================================ */

/* =========================
   0) CONFIG: API endpoint
   - Use your public HTTPS API (Render/Railway/Cloudflared).
   - Example (Render):  https://your-api.onrender.com
   - Example (tunnel):  https://abc123.trycloudflare.com
   - Local-only dev:    http://127.0.0.1:3000   (won’t work from Netlify)
   ========================= */
// put your real deployed API URL here (must be HTTPS for Netlify)
const API_BASE = "https://dulcet-lolly-53b12c.netlify.app/";

// load buildings from API with no-cache so QGIS edits show up
fetch(`${API_BASE}/buildings?limit=10000&_=${Date.now()}`, { cache: 'no-store' })
  .then(r => r.json())
  .then(geojson => {
    if (window.bldgLayer) map.removeLayer(window.bldgLayer);
    window.bldgLayer = L.geoJSON(geojson, {
      style: { weight: 2, fillOpacity: 0.25 },
      onEachFeature: (f, l) => l.bindPopup(`<b>${f.properties.name ?? f.properties.id ?? 'Building'}</b>`)
    }).addTo(map);
    try { map.fitBounds(window.bldgLayer.getBounds(), { maxZoom: 16 }); } catch {}
  })
  .catch(err => console.error("API error:", err));


/* ============================================================================
   1) MAP & BASEMAP
   ============================================================================ */
let map = L.map('map').setView([0, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

/* ============================================================================
   2) GLOBALS & STYLES
   ============================================================================ */
let geojsonLayer = L.geoJSON(null, {
  style: defaultStyle,
  onEachFeature: onEachFeature,
  pointToLayer: makePoint
}).addTo(map);

let selected = new Map();      // layerId -> { feature, layer }
let allPropertyKeys = [];      // union of property keys for attribute table
let buildingsLayerRef = null;  // keep reference to easily replace on reload

function defaultStyle(_) { return { color: '#3388ff', weight: 2, fillOpacity: 0.2 }; }
function selectedStyle(_) { return { color: '#ff7800', weight: 3, fillOpacity: 0.35 }; }
function makePoint(feature, latlng) {
  return L.circleMarker(latlng, { radius: 6, color: '#3388ff', fillOpacity: 0.9 });
}

/* ============================================================================
   3) FEATURE INTERACTION (click → select/deselect, popup)
   ============================================================================ */
function onEachFeature(feature, layer) {
  if (feature.properties) {
    const lines = Object.entries(feature.properties)
      .slice(0, 10)
      .map(([k, v]) => `<b>${k}</b>: ${v}`);
    layer.bindPopup(`<div style="max-width:240px">${lines.join('<br/>')}</div>`);
  }
  layer.on('click', () => toggleSelect(layer));
}

function toggleSelect(layer) {
  const lid = layer._leaflet_id;
  if (selected.has(lid)) {
    selected.delete(lid);
    geojsonLayer.resetStyle(layer);
  } else {
    selected.set(lid, { feature: layer.feature, layer: layer });
    try { layer.setStyle(selectedStyle(layer.feature)); } catch {}
  }
  updateAttributeTable();
}

/* ============================================================================
   4) LOADING & DRAWING GEOJSON (from API or file)
   ============================================================================ */
function loadGeoJSON(obj) {
  // clear live layer & selection
  geojsonLayer.clearLayers();
  selected.clear();
  allPropertyKeys = [];

  // add features
  geojsonLayer.addData(obj);

  // compute union of keys for table header
  if (obj.features && obj.features.length) {
    obj.features.forEach(f => {
      if (f.properties) {
        Object.keys(f.properties).forEach(k => {
          if (!allPropertyKeys.includes(k)) allPropertyKeys.push(k);
        });
      }
    });
  }

  // zoom to data if present
  try { map.fitBounds(geojsonLayer.getBounds(), { maxZoom: 16 }); } catch {}
  updateAttributeTable();
}

/* ============================================================================
   5) FETCH FROM API (public.buildings)
   - No cache to ensure we see latest QGIS edits
   - ?limit=10000 to avoid truncation for larger sets
   - Optional q= and bbox= (wire UI later if needed)
   ============================================================================ */
async function fetchBuildings(params = {}) {
  const q = params.q ? `&q=${encodeURIComponent(params.q)}` : '';
  const bbox = params.bbox ? `&bbox=${params.bbox}` : '';
  const url = `${API_BASE}/buildings?limit=10000${q}${bbox}&_=${Date.now()}`; // cache-buster
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data;
}

async function loadBuildingsFromAPI(params = {}) {
  setLoading(true, "Loading buildings…");
  try {
    const gj = await fetchBuildings(params);
    // replace current layer display
    loadGeoJSON(gj);
  } catch (err) {
    console.error(err);
    alert("Failed to load buildings from API.\n" + err.message);
  } finally {
    setLoading(false);
  }
}

/* ============================================================================
   6) FILE INPUT (local GeoJSON import)
   ============================================================================ */
document.getElementById('file-input')?.addEventListener('change', function (e) {
  const f = e.target.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = function (ev) {
    try {
      const obj = JSON.parse(ev.target.result);
      loadGeoJSON(obj);
    } catch (err) {
      alert('Invalid GeoJSON file.');
      console.error(err);
    }
  };
  reader.readAsText(f);
  e.target.value = null;
});

/* ============================================================================
   7) SELECTION CONTROLS (select all / deselect all / clear)
   ============================================================================ */
document.getElementById('select-all')?.addEventListener('click', function () {
  geojsonLayer.eachLayer(layer => {
    const lid = layer._leaflet_id;
    if (!selected.has(lid)) {
      selected.set(lid, { feature: layer.feature, layer: layer });
      try { layer.setStyle(selectedStyle(layer.feature)); } catch {}
    }
  });
  updateAttributeTable();
});

document.getElementById('deselect-all')?.addEventListener('click', function () {
  selected.forEach(val => { try { geojsonLayer.resetStyle(val.layer); } catch {} });
  selected.clear();
  updateAttributeTable();
});

document.getElementById('clear-selection')?.addEventListener('click', function () {
  selected.forEach(val => { try { geojsonLayer.resetStyle(val.layer); } catch {} });
  selected.clear();
  updateAttributeTable();
});

/* ============================================================================
   8) EXPORT (selected → GeoJSON / CSV)
   ============================================================================ */
document.getElementById('export-geojson')?.addEventListener('click', function () {
  if (selected.size === 0) { alert('No features selected'); return; }
  const fc = { type: 'FeatureCollection', features: Array.from(selected.values()).map(v => v.feature) };
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'selected_features.geojson'; a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('export-csv')?.addEventListener('click', function () {
  if (selected.size === 0) { alert('No features selected'); return; }
  const keys = allPropertyKeys;
  const rows = [];
  rows.push(keys.join(','));
  for (let { feature } of selected.values()) {
    const props = feature.properties || {};
    const row = keys.map(k => {
      const v = props[k] !== undefined ? String(props[k]) : '';
      return `"${v.replace(/"/g, '""')}"`; // CSV-escape
    }).join(',');
    rows.push(row);
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'selected_features.csv'; a.click();
  URL.revokeObjectURL(url);
});

/* ============================================================================
   9) ATTRIBUTE TABLE RENDERING + SEARCH
   ============================================================================ */
function updateAttributeTable() {
  const head = document.getElementById('table-head');
  const body = document.getElementById('table-body');
  if (!head || !body) return;

  head.innerHTML = '';
  body.innerHTML = '';

  const keys = allPropertyKeys.slice();
  if (keys.length === 0 && selected.size > 0) {
    selected.forEach(({ feature }) => {
      Object.keys(feature.properties || {}).forEach(k => { if (!keys.includes(k)) keys.push(k); });
    });
  }

  // header
  let hrow = '<tr><th>#</th>';
  keys.forEach(k => { hrow += `<th>${k}</th>`; });
  hrow += '</tr>';
  head.innerHTML = hrow;

  // body
  let i = 1;
  for (let { feature } of selected.values()) {
    const props = feature.properties || {};
    let row = `<tr><td>${i}</td>`;
    keys.forEach(k => { row += `<td>${escapeHtml(props[k] !== undefined ? String(props[k]) : '')}</td>`; });
    row += '</tr>';
    body.insertAdjacentHTML('beforeend', row);
    i++;
  }
}

document.getElementById('table-search')?.addEventListener('input', function (e) {
  const q = e.target.value.trim().toLowerCase();
  const tbody = document.getElementById('table-body');
  if (!tbody) return;
  Array.from(tbody.rows).forEach(r => {
    const txt = r.textContent.toLowerCase();
    r.style.display = txt.indexOf(q) >= 0 ? '' : 'none';
  });
});

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ============================================================================
   10) RECTANGLE SELECT (Leaflet.draw)
   ============================================================================ */
const drawnItems = new L.FeatureGroup().addTo(map);
const drawControl = new L.Control.Draw({
  draw: { polyline: false, polygon: false, marker: false, circle: false, circlemarker: false, rectangle: { shapeOptions: { color: '#f06' } } },
  edit: { featureGroup: drawnItems, edit: false, remove: false }
});
map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, function (e) {
  const layer = e.layer;
  drawnItems.addLayer(layer);
  const rectBounds = layer.getBounds();

  geojsonLayer.eachLayer(gLayer => {
    if (gLayer.getLatLng) {
      if (rectBounds.contains(gLayer.getLatLng())) selectLayer(gLayer);
    } else if (gLayer.getBounds) {
      if (rectBounds.intersects(gLayer.getBounds())) selectLayer(gLayer);
    }
  });

  // remove rectangle after selection (UX preference)
  setTimeout(() => drawnItems.removeLayer(layer), 300);
  updateAttributeTable();
});

function selectLayer(gLayer) {
  const lid = gLayer._leaflet_id;
  if (!selected.has(lid)) {
    selected.set(lid, { feature: gLayer.feature, layer: gLayer });
    try { gLayer.setStyle(selectedStyle(gLayer.feature)); } catch {}
  }
}

/* ============================================================================
   11) LOADING INDICATOR + RELOAD/REFRESH
   ============================================================================ */
function setLoading(on, msg = 'Loading…') {
  let el = document.getElementById('loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loading';
    el.style.cssText = 'position:absolute;top:10px;right:10px;z-index:9999;background:#0008;color:#fff;padding:8px 12px;border-radius:8px;font:14px/1.3 system-ui;';
    document.body.appendChild(el);
  }
  el.style.display = on ? 'block' : 'none';
  el.textContent = on ? msg : '';
}

// Add a basic reload button if your HTML has <button id="reload-api">Reload</button>
document.getElementById('reload-api')?.addEventListener('click', () => loadBuildingsFromAPI());

// OPTIONAL: auto-refresh every 20s (comment out if not desired)
// setInterval(loadBuildingsFromAPI, 20000);

/* ============================================================================
   12) INITIAL LOAD
   - Try API first. If API_BASE is left as placeholder or fetch fails,
     fall back to local sample.geojson if present.
   ============================================================================ */
(async function bootstrap() {
  if (!API_BASE || API_BASE.includes('REPLACE_WITH_YOUR_PUBLIC_API')) {
    // fallback to sample file for first load
    try {
      const r = await fetch('sample.geojson', { cache: 'no-store' });
      if (r.ok) loadGeoJSON(await r.json());
    } catch {}
    console.warn('⚠️ Set API_BASE to your public API to load DB data.');
  } else {
    await loadBuildingsFromAPI(); // live data
  }
})();


