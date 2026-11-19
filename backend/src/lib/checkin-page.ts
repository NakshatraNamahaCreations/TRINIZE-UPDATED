/**
 * The page a visitor's phone opens from the QR sticker at the gate: a short form, then the flat's
 * answer, live. One self-contained document — no build step, no third-party code, nothing loaded
 * from anywhere else. Everything shown is set as text, never as HTML.
 */
export const checkinPage = (nonce: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Visitor check-in</title>
<style nonce="${nonce}">
  :root { --acc: #7C55F7; --accBg: #F1ECFE; --ink: #1B1B2A; --ink2: #5A5F73; --ink3: #8A8FA3; --line: #E4E6EF; --bg: #F5F4FA;
    --good: #12855A; --goodBg: #E3F6EC; --warn: #A66300; --warnBg: #FFF2D9; --bad: #C0362C; --badBg: #FDEBE9; }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 480px; margin: 0 auto; padding: 16px 16px 40px; }
  header { padding: 8px 0 14px; }
  h1 { font-size: 21px; margin: 0; line-height: 1.25; }
  .sub { color: var(--ink2); font-size: 14px; margin-top: 2px; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 16px; padding: 14px; }
  label, .lbl { display: block; font-size: 13.5px; font-weight: 700; margin: 14px 0 6px; }
  label:first-child, .lbl:first-child { margin-top: 0; }
  .lbl.gap { margin-top: 14px; }
  input.gap { margin-top: 8px; }
  input { width: 100%; font: inherit; color: var(--ink); background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; outline: none; }
  input:focus { border-color: var(--acc); box-shadow: 0 0 0 3px var(--accBg); }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { font: inherit; font-size: 14px; font-weight: 700; color: var(--ink); background: #fff; border: 1px solid var(--line); border-radius: 999px; padding: 9px 16px; min-height: 40px; cursor: pointer; }
  .chip.on { background: var(--acc); border-color: var(--acc); color: #fff; }
  .list { margin-top: 6px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: #fff; }
  .opt { display: block; width: 100%; text-align: left; font: inherit; background: #fff; border: 0; border-bottom: 1px solid var(--line); padding: 12px 14px; cursor: pointer; }
  .opt:last-child { border-bottom: 0; }
  .opt b { display: block; }
  .opt span, .hint { color: var(--ink3); font-size: 13px; }
  .hint { margin-top: 6px; }
  .picked { display: flex; align-items: center; gap: 10px; background: var(--accBg); border-radius: 12px; padding: 10px 14px; }
  .picked div { flex: 1; min-width: 0; }
  .picked b { display: block; }
  .link { font: inherit; font-size: 14px; font-weight: 700; color: var(--acc); background: none; border: 0; padding: 6px; cursor: pointer; }
  .step { display: flex; align-items: center; gap: 16px; }
  .step button { width: 44px; height: 44px; font-size: 22px; line-height: 1; color: var(--ink); background: #fff; border: 1px solid var(--line); border-radius: 12px; cursor: pointer; }
  .step output { font-size: 18px; font-weight: 800; min-width: 24px; text-align: center; }
  .btn { display: block; width: 100%; font: inherit; font-weight: 800; color: #fff; background: var(--acc); border: 0; border-radius: 14px; padding: 15px; margin-top: 18px; cursor: pointer; }
  .btn[disabled] { opacity: .55; }
  .btn.ghost { background: #fff; color: var(--acc); border: 1.5px solid var(--acc); }
  .btn.quiet { background: none; color: var(--bad); font-weight: 700; padding: 12px; margin-top: 10px; }
  .err { color: var(--bad); background: var(--badBg); border-radius: 12px; padding: 10px 14px; font-size: 14px; margin-top: 14px; }
  .state { border-radius: 18px; padding: 22px 18px; text-align: center; }
  .state .mark { font-size: 44px; line-height: 1; }
  .state h2 { margin: 8px 0 4px; font-size: 24px; }
  .state p { margin: 0; font-size: 15px; }
  .state.wait { background: var(--warnBg); color: var(--warn); }
  .state.ok { background: var(--goodBg); color: var(--good); }
  .state.no { background: var(--badBg); color: var(--bad); }
  .state.done { background: #ECEEF4; color: var(--ink2); }
  .ref { margin-top: 14px; font-size: 13px; }
  .ref b { display: block; font-size: 34px; letter-spacing: 6px; font-variant-numeric: tabular-nums; }
  .left { margin-top: 12px; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .rows { margin-top: 14px; }
  .row { display: flex; justify-content: space-between; gap: 14px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 14.5px; }
  .row:last-child { border-bottom: 0; }
  .row span { color: var(--ink2); }
  .row b { text-align: right; overflow-wrap: anywhere; }
  .clock { text-align: center; color: var(--ink3); font-size: 13px; margin-top: 12px; font-variant-numeric: tabular-nums; }
  .pulse { animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .45; } }
  @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <header>
    <h1 id="society">Visitor check-in</h1>
    <div class="sub" id="gate"></div>
  </header>

  <div id="closed" class="card" hidden>
    <b>This QR code is not in use.</b>
    <div class="hint">Please speak to the security guard.</div>
  </div>

  <form id="form" class="card" hidden novalidate>
    <div class="lbl">Who are you?</div>
    <div class="chips" id="types"></div>

    <div id="partnerBox" hidden>
      <div class="lbl gap" id="partnerLbl"></div>
      <div class="chips" id="partners"></div>
      <input id="partner" class="gap" maxlength="40" placeholder="Company name" autocomplete="off" aria-labelledby="partnerLbl" hidden>
    </div>

    <label for="phone">Your mobile number</label>
    <input id="phone" inputmode="numeric" placeholder="10-digit mobile number" autocomplete="tel-national">

    <label for="name">Your name</label>
    <input id="name" maxlength="80" placeholder="Name" autocomplete="name">

    <label for="flat">Which flat are you visiting?</label>
    <div id="flatSearch">
      <input id="flat" maxlength="20" placeholder="Flat number, for example 1108" autocomplete="off">
      <div class="list" id="flats" hidden></div>
      <div class="hint" id="flatHint" hidden></div>
    </div>
    <div class="picked" id="picked" hidden>
      <div><b id="pickedCode"></b><span class="hint" id="pickedLabel"></span></div>
      <button type="button" class="link" id="change">Change</button>
    </div>

    <label for="purpose">Purpose (optional)</label>
    <input id="purpose" maxlength="200" placeholder="For example: family visit, AC repair">

    <label for="vehicle">Vehicle number (optional)</label>
    <input id="vehicle" maxlength="20" placeholder="KA 01 AB 1234" autocapitalize="characters" autocomplete="off">

    <div class="lbl">How many people</div>
    <div class="step">
      <button type="button" id="less" aria-label="One fewer">&minus;</button>
      <output id="people">1</output>
      <button type="button" id="more" aria-label="One more">+</button>
    </div>

    <div class="err" id="err" role="alert" hidden></div>
    <button class="btn" id="send" type="submit">Ask the flat</button>
    <div class="hint">The flat is asked on their phone. The security guard sees the same answer.</div>
  </form>

  <section id="status" hidden>
    <div class="state" id="state" role="status" aria-live="polite">
      <div class="mark" id="mark"></div>
      <h2 id="title"></h2>
      <p id="text"></p>
      <div class="ref" id="refBox">Entry code<b id="ref"></b></div>
      <div class="left" id="left" hidden></div>
    </div>
    <div class="card rows">
      <div class="row"><span>Name</span><b id="sName"></b></div>
      <div class="row"><span>Visiting</span><b id="sUnit"></b></div>
      <div class="row"><span>Type</span><b id="sType"></b></div>
      <div class="row"><span>People</span><b id="sPeople"></b></div>
      <div class="row" id="sVehicleRow"><span>Vehicle</span><b id="sVehicle"></b></div>
    </div>
    <div class="clock" id="clock"></div>
    <div class="err" id="statusErr" role="alert" hidden></div>
    <button class="btn quiet" id="cancel" type="button" hidden>Cancel this request</button>
    <button class="btn ghost" id="again" type="button" hidden>Make a new request</button>
  </section>
</main>
<script nonce="${nonce}">
(function () {
  'use strict';
  var token = location.pathname.split('/').filter(Boolean).pop();
  var KEY = 'trinize.ticket.' + token;
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set: function (v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode: the page still works until it is closed */ } },
    clear: function () { try { localStorage.removeItem(KEY); } catch (e) { /* nothing kept */ } }
  };
  function api(method, path, body) {
    return fetch(path, { method: method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          if (res.ok) return data;
          var e = new Error((data && data.error && data.error.message) || 'Something went wrong. Please try again.');
          e.status = res.status;
          throw e;
        });
      });
  }
  function show(id) { ['closed', 'form', 'status'].forEach(function (x) { $(x).hidden = x !== id; }); }

  /* ---------- the form ---------- */
  var type = 'Guest', unit = null, people = 1, searchTimer = 0, searchSeq = 0;
  // who the rider or driver works for: one tap for the usual names, "Other" to type it
  var PARTNERS = {
    Delivery: ['Delivering for', ['Swiggy', 'Zomato', 'Amazon', 'Flipkart', 'Blinkit', 'Zepto', 'BigBasket', 'Dunzo', 'Courier']],
    Cab: ['Cab or bike service', ['Uber', 'Ola', 'Rapido', 'Namma Yatri', 'BluSmart', 'Auto']]
  };
  var partner = '', otherPartner = false;
  function drawPartners() {
    var set = PARTNERS[type], box = $('partners');
    $('partnerBox').hidden = !set;
    if (!set) return;
    $('partnerLbl').textContent = set[0];
    box.textContent = '';
    set[1].concat('Other').forEach(function (p) {
      var other = p === 'Other', on = other ? otherPartner : !otherPartner && partner === p;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip' + (on ? ' on' : ''); b.textContent = p;
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', function () {
        // tapping the chosen one again clears it: the company is optional
        if (other) { otherPartner = !otherPartner; partner = ''; } else { otherPartner = false; partner = on ? '' : p; }
        drawPartners();
        if (otherPartner) $('partner').focus();
      });
      box.appendChild(b);
    });
    $('partner').hidden = !otherPartner;
    if (!otherPartner) $('partner').value = '';
  }
  function drawTypes(types) {
    var box = $('types');
    box.textContent = '';
    types.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip' + (t === type ? ' on' : ''); b.textContent = t;
      b.setAttribute('aria-pressed', String(t === type));
      b.addEventListener('click', function () { if (t !== type) { partner = ''; otherPartner = false; } type = t; drawTypes(types); drawPartners(); });
      box.appendChild(b);
    });
  }
  function pick(u) {
    unit = u;
    $('flatSearch').hidden = !!u; $('picked').hidden = !u;
    if (u) { $('pickedCode').textContent = u.code; $('pickedLabel').textContent = u.label; }
    else { $('flat').value = ''; $('flats').hidden = true; $('flatHint').hidden = true; $('flat').focus(); }
  }
  function search() {
    var q = $('flat').value.trim(), seq = ++searchSeq, list = $('flats'), hint = $('flatHint');
    if (q.length < 2) { list.hidden = true; hint.hidden = true; return; }
    api('GET', '/v1/checkin/' + token + '/units?q=' + encodeURIComponent(q)).then(function (rows) {
      if (seq !== searchSeq) return;
      list.textContent = '';
      rows.forEach(function (u) {
        var b = document.createElement('button'), code = document.createElement('b'), label = document.createElement('span');
        b.type = 'button'; b.className = 'opt'; code.textContent = u.code; label.textContent = u.label;
        b.appendChild(code); b.appendChild(label);
        b.addEventListener('click', function () { pick(u); });
        list.appendChild(b);
      });
      list.hidden = !rows.length;
      hint.hidden = !!rows.length;
      hint.textContent = 'No flat matches that. Check the number, or ask the security guard.';
    }).catch(function (e) { if (seq === searchSeq) { list.hidden = true; hint.hidden = false; hint.textContent = e.message; } });
  }
  function fail(msg) { var e = $('err'); e.textContent = msg; e.hidden = !msg; if (msg) e.scrollIntoView({ block: 'center' }); }

  $('flat').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(search, 250); });
  $('change').addEventListener('click', function () { pick(null); });
  // a pasted "+91 98222 00021" becomes the ten digits; the box has no length limit, or the paste would be cut first
  $('phone').addEventListener('input', function () { var d = this.value.replace(/\\D/g, ''); if (d.length > 10) d = d.replace(/^(91|0)/, ''); this.value = d.slice(0, 10); });
  $('less').addEventListener('click', function () { people = Math.max(1, people - 1); $('people').textContent = String(people); });
  $('more').addEventListener('click', function () { people = Math.min(20, people + 1); $('people').textContent = String(people); });
  $('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var phone = $('phone').value, name = $('name').value.trim();
    if (!/^[6-9]\\d{9}$/.test(phone)) return fail('Enter your 10-digit mobile number.');
    if (name.length < 2) return fail('Enter your name.');
    if (!unit) return fail('Choose the flat you are visiting from the list.');
    fail('');
    var body = { visitorType: type, name: name, phone: phone, unitId: unit.id, purpose: $('purpose').value.trim(), people: people };
    var vehicle = $('vehicle').value.trim(), company = otherPartner ? $('partner').value.trim() : partner;
    if (vehicle) body.vehicle = vehicle;
    if (PARTNERS[type] && company) body.partner = company;
    var send = $('send');
    send.disabled = true; send.textContent = 'Sending…';
    api('POST', '/v1/checkin/' + token + '/visits', body).then(function (v) {
      store.set(v.ticket);
      ticket = v.ticket;
      track(v);
    }).catch(function (e) { fail(e.message); }).then(function () { send.disabled = false; send.textContent = 'Ask the flat'; });
  });

  /* ---------- the answer ---------- */
  var ticket = store.get(), pollTimer = 0, clockTimer = 0;
  var VIEW = {
    Pending: ['wait', '⏳', 'Waiting for the flat', 'They have been asked on their phone. Keep this page open — the answer appears here by itself, no need to refresh.'],
    Expired: ['done', '⌛', 'Request expired', 'The flat did not answer within 10 minutes. Make a new request, or speak to the security guard.'],
    Approved: ['ok', '✓', 'Approved', 'Show this screen to the security guard.'],
    Inside: ['ok', '✓', 'You are checked in', 'The guard has let you in. Have a good visit.'],
    AtGate: ['wait', '📦', 'Leave it with security', 'The flat asked for this delivery to be left at the gate.'],
    Rejected: ['no', '✕', 'Not approved', 'This visit was not approved. Please speak to the security guard.'],
    Cancelled: ['done', '•', 'Request cancelled', 'You cancelled this request. The flat has been told.']
  };
  var CLOSED = ['done', '•', 'This visit is closed', 'Scan the QR code again for a new visit.'];
  var LIVE = { Pending: 1, Approved: 1 };
  function draw(v) {
    var w = VIEW[v.status] || CLOSED;
    $('state').className = 'state ' + w[0];
    $('mark').textContent = w[1]; $('mark').className = 'mark' + (v.status === 'Pending' ? ' pulse' : '');
    $('title').textContent = w[2]; $('text').textContent = w[3];
    $('ref').textContent = v.ref; $('refBox').hidden = !(v.status in LIVE);
    $('sName').textContent = v.name; $('sUnit').textContent = (v.unit || '') + (v.society ? ' · ' + v.society : '');
    $('sType').textContent = v.visitorType; $('sPeople').textContent = String(v.people);
    $('sVehicleRow').hidden = !v.vehicle; $('sVehicle').textContent = v.vehicle || '';
    $('again').hidden = v.status in LIVE;
    $('cancel').hidden = !(v.status in LIVE);
    $('statusErr').hidden = true;
    show('status');
    // a running clock: the guard can tell a live page from a screenshot
    clearInterval(clockTimer);
    // the wait is ten minutes: count it down, and ask once more when it runs out so the page says so at once
    var deadline = v.status === 'Pending' && v.expiresInMs != null ? Date.now() + v.expiresInMs : 0, asked = false;
    $('left').hidden = !deadline;
    var tick = function () {
      $('clock').textContent = (v.gate ? v.gate + ' · ' : '') + new Date().toLocaleTimeString();
      if (!deadline) return;
      var s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      $('left').textContent = 'Request expires in ' + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
      if (!s && !asked) { asked = true; api('GET', '/v1/checkin-status/' + ticket).then(track).catch(function () { /* the poll comes round */ }); }
    };
    tick(); clockTimer = setInterval(tick, 1000);
    return v.status in LIVE;
  }
  /* The answer arrives over a WebSocket the moment it is given. Asking again on a timer stays as the net
     under it: quick while there is no connection (old browser, blocked network), slow once there is. */
  var ws = null, wsUp = false, wsTries = 0, wsTimer = 0;
  function live() {
    clearTimeout(wsTimer);
    if (ws || !ticket || !window.WebSocket) return;
    var mine = ticket, sock;
    try { sock = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/v1/checkin-status/' + mine + '/live'); } catch (e) { return; }
    ws = sock;
    sock.onopen = function () { wsUp = true; wsTries = 0; };
    sock.onmessage = function (ev) {
      if (ws !== sock || mine !== ticket) return;
      var v; try { v = JSON.parse(ev.data); } catch (e) { return; }
      track(v);
    };
    sock.onclose = function () {
      if (ws !== sock) return;
      ws = null; wsUp = false;
      // dropped while still waiting: try again, a little later each time
      if (mine === ticket && watching) wsTimer = setTimeout(live, Math.min(15000, 1000 * Math.pow(2, wsTries++)));
    };
  }
  function hush() { clearTimeout(wsTimer); var s = ws; ws = null; wsUp = false; if (s) { try { s.close(); } catch (e) { /* already gone */ } } }
  var watching = false;
  /** show where things stand, and keep listening for as long as the answer can still change */
  function track(v) {
    watching = draw(v);
    if (watching) { follow(); live(); } else { clearTimeout(pollTimer); hush(); }
  }
  function follow() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(function () {
      if (document.visibilityState === 'hidden') return follow();
      api('GET', '/v1/checkin-status/' + ticket).then(track)
        .catch(function (e) { if (e.status === 404) reset(); else follow(); });
    }, wsUp ? 20000 : 4000);
  }
  function reset() { watching = false; clearTimeout(pollTimer); clearInterval(clockTimer); hush(); store.clear(); ticket = null; show('form'); }
  $('again').addEventListener('click', reset);
  $('cancel').addEventListener('click', function () {
    if (!window.confirm('Cancel this request? The flat will be told you are not coming.')) return;
    var b = this;
    b.disabled = true;
    clearTimeout(pollTimer);
    api('POST', '/v1/checkin-status/' + ticket + '/cancel').then(track).catch(function (e) {
      // most likely the guard has just let them in: show why, then show where things really stand
      $('statusErr').textContent = e.message; $('statusErr').hidden = false;
      follow();
    }).then(function () { b.disabled = false; });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && ticket && !$('status').hidden) {
      api('GET', '/v1/checkin-status/' + ticket).then(track).catch(function () { /* the next poll tries again */ });
    }
  });

  /* ---------- start ---------- */
  api('GET', '/v1/checkin/' + token).then(function (info) {
    $('society').textContent = info.society;
    $('gate').textContent = 'Visitor check-in · ' + info.gate;
    document.title = 'Visitor check-in · ' + info.society;
    drawTypes(info.visitorTypes);
    if (!ticket) return show('form');
    return api('GET', '/v1/checkin-status/' + ticket).then(track, function () { reset(); });
  }).catch(function () { show('closed'); });
})();
</script>
</body>
</html>`;
