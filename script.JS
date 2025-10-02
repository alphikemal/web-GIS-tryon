/* script.js - Simple WebGIS with multi-select, rectangle select, attribute table, export */
let map = L.map('map').setView([0, 0], 2);

// Basemap
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Globals
let geojsonLayer = L.geoJSON(null, { style: defaultStyle, onEachFeature: onEachFeature, pointToLayer: makePoint }).addTo(map);
let selected = new Map(); // layerId -> { feature, layer }
let allPropertyKeys = [];  // will be union of property keys for table header

// Styles
function defaultStyle(feature) {
  return { color: '#3388ff', weight: 2, fillOpacity: 0.2 };
}
function selectedStyle(feature) {
  return { color: '#ff7800', weight: 3, fillOpacity: 0.35 };
}
function makePoint(feature, latlng) {
  return L.circleMarker(latlng, { radius: 6, color: '#3388ff', fillOpacity: 0.9 });
}

// When a GeoJSON feature is added, hook click
function onEachFeature(feature, layer) {
  // set a popup with properties summary
  if (feature.properties) {
    const lines = Object.entries(feature.properties).slice(0,10).map(([k,v]) => `<b>${k}</b>: ${v}`);
    layer.bindPopup(`<div style="max-width:240px">${lines.join('<br/>')}</div>`);
  }

  layer.on('click', function (e) {
    toggleSelect(layer);
    // open popup optionally
    // layer.openPopup();
  });
}

// Toggle select/deselect
function toggleSelect(layer) {
  const lid = layer._leaflet_id;
  if (selected.has(lid)) {
    // deselect
    selected.delete(lid);
    geojsonLayer.resetStyle(layer);
  } else {
    // select
    selected.set(lid, { feature: layer.feature, layer: layer });
    try { layer.setStyle(selectedStyle(layer.feature)); } catch (err) { /* markers may not support setStyle in some cases */ }
  }
  updateAttributeTable();
}

// Load geojson data (object)
function loadGeoJSON(obj) {
  geojsonLayer.clearLayers();
  selected.clear();
  allPropertyKeys = [];
  // Add features
  geojsonLayer.addData(obj);
  // compute union of properties keys
  if (obj.features && obj.features.length) {
    obj.features.forEach(f => {
      if (f.properties) {
        Object.keys(f.properties).forEach(k => { if (!allPropertyKeys.includes(k)) allPropertyKeys.push(k); });
      }
    });
  }
  // Fit map to data if available
  try {
    map.fitBounds(geojsonLayer.getBounds(), { maxZoom: 16 });
  } catch (e) {
    // ignore if no bounds
  }
  updateAttributeTable();
}

// File input handling
document.getElementById('file-input').addEventListener('change', function(e){
  const f = e.target.files[0];
  if(!f) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
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

// SELECT ALL / DESELECT / CLEAR
document.getElementById('select-all').addEventListener('click', function(){
  geojsonLayer.eachLayer(layer => {
    const lid = layer._leaflet_id;
    if (!selected.has(lid)) {
      selected.set(lid, { feature: layer.feature, layer: layer });
      try { layer.setStyle(selectedStyle(layer.feature)); } catch {}
    }
  });
  updateAttributeTable();
});
document.getElementById('deselect-all').addEventListener('click', function(){
  selected.forEach((val, lid) => {
    try { geojsonLayer.resetStyle(val.layer); } catch {}
  });
  selected.clear();
  updateAttributeTable();
});
document.getElementById('clear-selection').addEventListener('click', function(){
  // same as deselect-all
  selected.forEach((val, lid) => {
    try { geojsonLayer.resetStyle(val.layer); } catch {}
  });
  selected.clear();
  updateAttributeTable();
});

// Export selected GeoJSON
document.getElementById('export-geojson').addEventListener('click', function(){
  if (selected.size === 0) { alert('No features selected'); return; }
  const fc = { type: 'FeatureCollection', features: Array.from(selected.values()).map(v => v.feature) };
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'selected_features.geojson'; a.click();
  URL.revokeObjectURL(url);
});

// Export selected CSV
document.getElementById('export-csv').addEventListener('click', function(){
  if (selected.size === 0) { alert('No features selected'); return; }
  // CSV header: union of property keys
  const keys = allPropertyKeys;
  const rows = [];
  rows.push(keys.join(','));
  for (let { feature } of selected.values()) {
    const props = feature.properties || {};
    const row = keys.map(k => {
      const v = props[k] !== undefined ? String(props[k]) : '';
      // escape quotes & commas
      return `"${v.replace(/"/g,'""')}"`;
    }).join(',');
    rows.push(row);
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'selected_features.csv'; a.click();
  URL.revokeObjectURL(url);
});

// Attribute table update
function updateAttributeTable() {
  const head = document.getElementById('table-head');
  const body = document.getElementById('table-body');
  head.innerHTML = '';
  body.innerHTML = '';

  // build header with union keys
  const keys = allPropertyKeys.slice(); // copy
  if (keys.length === 0 && selected.size > 0) {
    // derive keys from selected features if none collected
    selected.forEach(({feature}) => {
      Object.keys(feature.properties || {}).forEach(k => { if (!keys.includes(k)) keys.push(k); });
    });
  }
  // table header
  let hrow = '<tr><th>#</th>';
  keys.forEach(k => { hrow += `<th>${k}</th>`; });
  hrow += '</tr>';
  head.innerHTML = hrow;

  // table body - iterate selected
  let i = 1;
  for (let { feature } of selected.values()) {
    const props = feature.properties || {};
    let row = `<tr><td>${i}</td>`;
    keys.forEach(k => {
      const v = props[k] !== undefined ? String(props[k]) : '';
      row += `<td>${escapeHtml(v)}</td>`;
    });
    row += '</tr>';
    body.insertAdjacentHTML('beforeend', row);
    i++;
  }
}

// simple search filter for table
document.getElementById('table-search').addEventListener('input', function(e){
  const q = e.target.value.trim().toLowerCase();
  const tbody = document.getElementById('table-body');
  Array.from(tbody.rows).forEach(r => {
    const txt = r.textContent.toLowerCase();
    r.style.display = txt.indexOf(q) >= 0 ? '' : 'none';
  });
});

// helper
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; });
}

// =====================
// Rectangle drawing for box-select
// =====================
const drawnItems = new L.FeatureGroup().addTo(map);
const drawControl = new L.Control.Draw({
  draw: {
    polyline: false,
    polygon: false,
    marker: false,
    circle: false,
    circlemarker: false,
    rectangle: { shapeOptions: { color: '#f06' } }
  },
  edit: { featureGroup: drawnItems, edit: false, remove: false }
});
map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, function(e) {
  const layer = e.layer;
  // add to map and select intersecting features
  drawnItems.addLayer(layer);
  const rectBounds = layer.getBounds();
  geojsonLayer.eachLayer(gLayer => {
    // for points
    if (gLayer.getLatLng) {
      if (rectBounds.contains(gLayer.getLatLng())) selectLayer(gLayer);
    } else if (gLayer.getBounds) {
      // polygon / line -> check bbox intersection
      if (rectBounds.intersects(gLayer.getBounds())) selectLayer(gLayer);
    }
  });
  // remove the drawn rectangle after selection (optional)
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

// Utility: reset on page load sample fetch
// If you want to auto-load sample.geojson in the folder:
fetch('sample.geojson').then(r => {
  if (r.ok) return r.json();
  else throw new Error('no sample');
}).then(obj => {
  loadGeoJSON(obj);
}).catch(e => {
  // no sample -> ignore
});
