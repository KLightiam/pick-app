import { Router } from 'express';

// The page someone opens from a rider's shared trip link. It needs no account and shows only what
// helps them know the rider is safe: the trip's progress, the driver and car, and where the car is.
const page = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Pick trip</title>
<style>body{font-family:system-ui,sans-serif;max-width:440px;margin:0 auto;padding:24px 16px;color:#1a1a1a}
h1{font-size:22px;margin:0 0 4px}.muted{color:#6b6b6b}.card{border:1px solid #ddd;border-radius:12px;padding:14px;margin:14px 0}
a.button{display:block;text-align:center;background:#0B6E4F;color:#fff;border-radius:10px;padding:12px;text-decoration:none}
.brand{color:#0B6E4F;font-weight:700}[hidden]{display:none!important}</style></head><body>
<p class="brand">Pick</p><h1 id="status">Loading…</h1><p class="muted" id="sub"></p>
<div class="card" id="trip" hidden><div class="muted">From</div><div id="from"></div><div class="muted">To</div><div id="to"></div></div>
<div class="card" id="driver" hidden><div id="name"></div><div class="muted" id="car"></div></div>
<a class="button" id="where" hidden target="_blank" rel="noopener">See where the car is</a>
<p class="muted" id="foot">This page updates by itself. In an emergency, call 112.</p>
<script>
var STATUS = { requested: 'Waiting for a driver', accepted: 'Driver on the way to the pickup', arrived: 'Driver at the pickup',
  in_progress: 'On the way', completed: 'Trip finished', cancelled: 'Trip cancelled' };
function show(id, on) { document.getElementById(id).hidden = !on; }
function text(id, t) { document.getElementById(id).textContent = t || ''; }
async function load() {
  var res = await fetch(location.pathname.replace(/\\/$/, '') + '/status').catch(function () { return null; });
  if (!res || !res.ok) { text('status', res && res.status === 404 ? 'This link doesn\\'t work' : 'Can\\'t reach Pick'); return; }
  var s = await res.json();
  text('status', STATUS[s.status]);
  if (s.ended) {
    text('sub', 'Trip details are no longer shown.');
    ['trip', 'driver', 'where', 'foot'].forEach(function (id) { show(id, false); });
    clearInterval(timer);
    return;
  }
  text('sub', 'Someone shared their Pick trip with you.');
  text('from', s.pickupAddress || 'Pickup'); text('to', s.dropoffAddress || 'Drop-off'); show('trip', true);
  if (s.driver) {
    text('name', s.driver.name || 'Driver');
    text('car', [s.driver.vehicleMake, s.driver.vehiclePlate].filter(Boolean).join(' · '));
    show('driver', true);
  }
  var at = s.driver && s.driver.location;
  if (at) document.getElementById('where').href = 'https://www.openstreetmap.org/?mlat=' + at.lat + '&mlon=' + at.lng + '#map=16/' + at.lat + '/' + at.lng;
  show('where', !!at);
}
var timer = setInterval(load, 10000);
load();
</script></body></html>`;

export function shareRouter({ safety }) {
  const router = Router();

  router.get('/:token', (_req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).type('html').send(page);
  });

  // GET /share/:token/status -> what the page shows; 404 for an unknown link
  router.get('/:token/status', async (req, res, next) => {
    try {
      const view = await safety.shared(req.params.token);
      if (!view) return res.status(404).json({ error: 'not found' });
      res.set('Cache-Control', 'no-store').json(view);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
