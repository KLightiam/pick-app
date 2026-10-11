// A small Leaflet page that draws a scene (see scene.js). The same page runs in a WebView on phones and an iframe on the web.
// Map tiles come from OpenStreetMap unless EXPO_PUBLIC_MAP_TILES names another provider.

const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist';
export const TILES = process.env.EXPO_PUBLIC_MAP_TILES ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const ATTRIBUTION = process.env.EXPO_PUBLIC_MAP_ATTRIBUTION ?? '&copy; OpenStreetMap contributors';

export function mapHtml({ tiles = TILES, attribution = ATTRIBUTION } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="${LEAFLET}/leaflet.css" crossorigin="">
<script src="${LEAFLET}/leaflet.js" crossorigin=""></script>
<style>
html,body,#map{height:100%;margin:0;background:#eef0ea}
.pin{width:28px;height:28px;border-radius:14px;color:#fff;font:600 13px system-ui,sans-serif;display:flex;
  align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)}
.pickup{background:#0B6E4F}.dropoff{background:#1A1A1A}.car{background:#fff;font-size:16px}
</style></head><body><div id="map"></div><script>
var map = L.map('map', { zoomControl: false, attributionControl: true }).setView([5.6037, -0.187], 12);
L.tileLayer(${JSON.stringify(tiles)}, { maxZoom: 19, attribution: ${JSON.stringify(attribution)} }).addTo(map);
var LABEL = { pickup: 'P', dropoff: 'D', car: '\\u{1F697}' };
var markers = {}, line = null, fitKey = null, fitPoints = [];
function fit() {
  map.invalidateSize({ pan: false });
  if (fitPoints.length === 1) map.setView(fitPoints[0], 15, { animate: false });
  else if (fitPoints.length > 1) map.fitBounds(fitPoints, { padding: [40, 40], maxZoom: 16, animate: false });
}
window.addEventListener('resize', fit);
window.pickUpdate = function (scene) {
  var seen = {};
  scene.markers.forEach(function (m) {
    seen[m.id] = true;
    if (markers[m.id]) return markers[m.id].setLatLng([m.lat, m.lng]);
    var icon = L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14],
      html: '<div class="pin ' + m.kind + '">' + LABEL[m.kind] + '</div>' });
    markers[m.id] = L.marker([m.lat, m.lng], { icon: icon, zIndexOffset: m.kind === 'car' ? 1000 : 0 }).addTo(map);
  });
  Object.keys(markers).forEach(function (id) { if (!seen[id]) { map.removeLayer(markers[id]); delete markers[id]; } });
  if (line) { map.removeLayer(line); line = null; }
  if (scene.line) line = L.polyline(scene.line.map(function (p) { return [p.lat, p.lng]; }), { color: '#0B6E4F', weight: 4, opacity: 0.7 }).addTo(map);
  if (scene.fitKey !== fitKey && scene.markers.length) {
    fitKey = scene.fitKey;
    fitPoints = scene.markers.map(function (m) { return [m.lat, m.lng]; });
    fit();
  }
};
window.addEventListener('message', function (e) { if (e.data && e.data.pickScene) window.pickUpdate(e.data.pickScene); });
</script></body></html>`;
}
