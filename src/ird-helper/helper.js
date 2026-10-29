/*
 * BillKhata -> prize.ird.gov.np form filler.
 *
 * One source for both the Tampermonkey userscript and the bookmarklet (see vite.config.js).
 * BillKhata opens the portal as https://prize.ird.gov.np/#billkhata=<bill>; this script picks
 * the bill up, clears it from the address bar, and on one click fills all 8 fields of the
 * cash-bill form: payment method, bill number, seller PAN, bill date, amount, name, mobile
 * and address. It never touches the hidden honeypot field, the security check or the submit
 * button. After the user submits, it spots the coupon number and offers to save it back to
 * BillKhata.
 *
 * Plain ES2017 with block comments only, so it survives being squeezed into a bookmarklet.
 */
function billkhataIrdHelper(MODE) {
  'use strict';

  var KEY = 'billkhata_pending_bill';
  var HOST_ID = 'billkhata-ird-helper';
  var TEXT_FIELDS = [
    ['bill_number', 'Bill number'],
    ['seller_pan_no', 'Seller PAN'],
    ['billed_total_amount', 'Billed total amount'],
    ['name', 'Name'],
    ['mobile_number', 'Mobile number'],
    ['address', 'Address'],
  ];

  if (!/(^|\.)prize\.ird\.gov\.np$/.test(location.hostname)) {
    if (MODE !== 'userscript') alert('BillKhata: open https://prize.ird.gov.np first, then click the bookmark again.');
    return;
  }

  /* ---------- small helpers ---------- */

  function ascii(s) {
    return String(s == null ? '' : s).replace(/[०-९]/g, function (c) { return String(c.charCodeAt(0) - 0x0966); });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function waitFor(fn, ms) {
    var end = Date.now() + (ms || 8000);
    while (Date.now() < end) {
      var v = fn();
      if (v) return v;
      await sleep(100);
    }
    return null;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* The same clean-up the portal applies, so the value we type is the value it keeps. */
  function clean(name, v) {
    var s = ascii(v).trim();
    if (name === 'bill_number') return s.replace(/[^0-9A-Za-z./_-]/g, '').slice(0, 40).toUpperCase();
    if (name === 'seller_pan_no') return s.replace(/\D/g, '').slice(0, 9);
    if (name === 'mobile_number') return s.replace(/\D/g, '').slice(0, 15);
    if (name === 'billed_total_amount') {
      var n = Number(s.replace(/[^0-9.]/g, ''));
      return isFinite(n) && n > 0 ? n.toFixed(2) : '';
    }
    if (name === 'name') return s.slice(0, 120);
    if (name === 'address') return s.slice(0, 250);
    return s;
  }

  /* ---------- the bill handed over by BillKhata ---------- */

  function decode(s) {
    var bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function remember(p) {
    try {
      if (p) sessionStorage.setItem(KEY, JSON.stringify(p));
      else sessionStorage.removeItem(KEY);
    } catch (e) { /* storage blocked */ }
  }
  function remembered() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function takeBill() {
    var p = null;
    if (window.__billkhata_payload) {
      p = window.__billkhata_payload;
      delete window.__billkhata_payload;
    }
    var m = location.hash.match(/[#&]billkhata=([A-Za-z0-9_-]+)/);
    if (m) {
      try { p = p || decode(m[1]); } catch (e) { /* bad link */ }
      /* Keep personal details out of the address bar and history. */
      history.replaceState(history.state, '', location.pathname + location.search);
    }
    if (p) remember(p);
    return p || remembered();
  }

  /* ---------- form filling ---------- */

  function field(name) {
    return document.querySelector('form input[name="' + name + '"]:not([type="hidden"]), form textarea[name="' + name + '"]');
  }

  /* React ignores plain `el.value = x`; set it through the native setter and fire the events. */
  function setValue(el, value) {
    var proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
      : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    if (el.tagName !== 'SELECT') el.focus({ preventScroll: true });
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (el.tagName !== 'SELECT') el.blur();
  }

  function byText(selector, re) {
    return Array.prototype.find.call(document.querySelectorAll(selector), function (b) { return re.test(b.textContent.trim()); });
  }

  async function openEnrollForm() {
    if (field('bill_number')) return true;
    var tab = byText('button', /^(Enroll Bill|बिल दर्ता)$/);
    if (tab) tab.click();
    return !!(await waitFor(function () { return field('bill_number') || document.querySelector('[role="radio"]'); }, 5000));
  }

  async function chooseCash() {
    var cash = byText('[role="radio"]', /^(Cash|नगद)/);
    if (!cash) return { ok: false, note: 'Payment buttons not found' };
    if (cash.getAttribute('aria-checked') !== 'true') cash.click();
    var ok = await waitFor(function () { return cash.getAttribute('aria-checked') === 'true' && field('bill_number'); }, 5000);
    return ok ? { ok: true } : { ok: false, note: 'Could not select Cash' };
  }

  function parseYmd(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(ascii(s).trim());
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }

  /* The bill date is a custom calendar (no input). Open it, set year and month, click the day.
     In Nepali mode it lists BS years, in English mode AD years. */
  async function chooseDate(p) {
    var input = field('bill_number');
    var trigger = input && input.form && input.form.querySelector('.nepali-date-trigger');
    if (!trigger) return { ok: false, note: 'Date picker not found' };
    var box = trigger.parentElement;
    function close() { if (trigger.getAttribute('aria-expanded') === 'true') trigger.click(); }
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
    var pop = await waitFor(function () { return box.querySelector('.nepali-calendar-popover'); }, 3000);
    if (!pop) return { ok: false, note: 'Calendar did not open' };
    function sel(i) { return pop.querySelectorAll('.nepali-calendar-selects select')[i]; }
    if (!sel(0) || !sel(1)) { close(); return { ok: false, note: 'Calendar layout changed' }; }

    var years = Array.prototype.map.call(sel(1).options, function (o) { return +o.value; });
    var bsMode = years.some(function (y) { return y > 2060; });
    var d = parseYmd(bsMode ? p.bs : p.ad);
    if (!d) { close(); return { ok: false, note: 'No ' + (bsMode ? 'BS' : 'AD') + ' date saved in BillKhata' }; }
    if (years.indexOf(d.y) < 0) { close(); return { ok: false, note: 'The portal does not offer year ' + d.y }; }

    if (+sel(1).value !== d.y) { setValue(sel(1), String(d.y)); await sleep(80); }
    if (+sel(0).value !== d.m - 1) { setValue(sel(0), String(d.m - 1)); await sleep(80); }
    var shown = await waitFor(function () { return +sel(1).value === d.y && +sel(0).value === d.m - 1; }, 1500);
    var day = pop.querySelectorAll('button.nepali-calendar-day')[d.d - 1];
    if (!shown || !day || day.disabled) {
      close();
      return { ok: false, note: 'The portal will not accept this date (future or outside the program)' };
    }
    day.click();
    await waitFor(function () { return trigger.getAttribute('aria-expanded') !== 'true'; }, 1500);
    return { ok: true };
  }

  /* Text fields go last and are re-checked, so a re-render cannot leave one empty. */
  async function fillText(p) {
    for (var round = 0; round < 3; round++) {
      TEXT_FIELDS.forEach(function (f) {
        var want = clean(f[0], p[f[0]]);
        var el = field(f[0]);
        if (el && want && el.value !== want) setValue(el, want);
      });
      await sleep(round === 0 ? 300 : 150);
    }
    return TEXT_FIELDS.map(function (f) {
      var want = clean(f[0], p[f[0]]);
      var el = field(f[0]);
      var note = '';
      if (!want) note = f[0] === 'bill_number' ? 'Not saved in BillKhata. Type it from the paper bill.' : 'Missing in BillKhata';
      else if (!el) note = 'Field not found on the page';
      else if (el.value !== want) note = 'The portal did not keep the value';
      return { label: f[1], value: want, ok: !note, note: note };
    });
  }

  async function fill(p) {
    var rows = [];
    if (!(await openEnrollForm())) return [{ label: 'Enrollment form', ok: false, note: 'Open “Enroll Bill” on the portal and try again' }];
    var cash = await chooseCash();
    rows.push({ label: 'Payment method', value: 'Cash', ok: cash.ok, note: cash.note || '' });
    if (!cash.ok) return rows;
    var date = await chooseDate(p);
    rows.push({ label: 'Bill date', value: p.bs ? p.bs + ' BS' : p.ad, ok: date.ok, note: date.note || '' });
    rows = rows.concat(await fillText(p));
    /* Move the first failed field (usually none) into view and focus it. */
    var firstBad = TEXT_FIELDS.find(function (f) { var el = field(f[0]); return el && !el.value; });
    if (firstBad) field(firstBad[0]).focus();
    else {
      var check = document.querySelector('.cf-turnstile, iframe[src*="turnstile"]');
      (check || field('address')).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return rows;
  }

  /* ---------- coupon pickup after submit ---------- */

  var observer = null;
  function watchForCoupon(p) {
    if (observer) observer.disconnect();
    var seen = Array.prototype.map.call(document.querySelectorAll('.coupon-numerals'), function (n) { return n.textContent; });
    observer = new MutationObserver(function () {
      var nodes = document.querySelectorAll('.prize-coupon-card .coupon-numerals');
      for (var i = 0; i < nodes.length; i++) {
        if (seen.indexOf(nodes[i].textContent) >= 0) continue;
        var code = ascii(nodes[i].textContent).replace(/\D/g, '');
        if (code.length === 12) {
          observer.disconnect();
          remember(null);
          render('coupon', p, { code: code });
          return;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  /* ---------- the floating panel ---------- */

  var CSS = ':host{all:initial}*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Devanagari",sans-serif}'
    + '.box{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(360px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#0f172a;border-radius:14px;box-shadow:0 12px 40px rgba(15,23,42,.28);border:1px solid #e2e8f0;font-size:14px;line-height:1.45}'
    + '.hd{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#0f172a;color:#fff;border-radius:14px 14px 0 0;font-weight:800}'
    + '.hd b{color:#fca5a5}.x{margin-left:auto;background:none;border:0;color:#cbd5e1;font-size:20px;cursor:pointer;line-height:1}'
    + '.bd{padding:12px 14px}.muted{color:#64748b;font-size:12.5px}.big{font-size:16px;font-weight:700;margin:2px 0}'
    + '.row{display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px solid #f1f5f9}.row:last-child{border:0}'
    + '.ok{color:#047857;font-weight:800}.no{color:#b91c1c;font-weight:800}.lab{font-weight:600}.val{color:#475569;font-size:12.5px;word-break:break-all}'
    + '.btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}button.b{border:0;border-radius:9px;padding:9px 14px;font-weight:700;font-size:14px;cursor:pointer}'
    + '.p{background:#b91c1c;color:#fff}.p:hover{background:#991b1b}.s{background:#f1f5f9;color:#0f172a}.s:hover{background:#e2e8f0}'
    + '.note{margin-top:10px;padding:9px 10px;border-radius:9px;background:#fffbeb;color:#78350f;font-size:13px}'
    + '.good{background:#ecfdf5;color:#064e3b}.code{font:700 22px/1.2 ui-monospace,Menlo,monospace;letter-spacing:2px;margin:6px 0}';

  function panel() {
    var host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.attachShadow({ mode: 'open' });
      document.body.appendChild(host);
    }
    return host.shadowRoot;
  }
  function closePanel() {
    var host = document.getElementById(HOST_ID);
    if (host) host.remove();
    if (observer) observer.disconnect();
  }
  function money(v) {
    var n = Number(clean('billed_total_amount', v));
    return n ? 'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '';
  }

  function render(state, p, extra) {
    var root = panel();
    var body = '';
    var summary = p ? '<div class="big">' + esc(p.merchant || 'Your bill') + '</div><div class="muted">Bill ' + esc(clean('bill_number', p.bill_number) || '—')
      + ' · ' + esc(money(p.billed_total_amount)) + ' · ' + esc(p.bs ? p.bs + ' BS' : p.ad || '') + '</div>' : '';

    if (state === 'none') {
      body = '<div class="big">No bill waiting</div><div class="muted">In BillKhata, open a cash bill, press <b>Apply to IRD Lucky Draw</b>, then <b>Open portal &amp; auto-fill</b>. This tab will receive the bill.</div>'
        + '<div class="btns"><button class="b s" data-a="close">Close</button></div>';
    } else if (state === 'digital') {
      body = summary + '<div class="note">This bill was paid by Fonepay / QR / card, so your bank or wallet has already entered it in the draw. Do not enroll it again: duplicate entries are disqualified. Find the coupon number in your banking or wallet app and save it in BillKhata.</div>'
        + '<div class="btns"><button class="b s" data-a="forget">OK</button></div>';
    } else if (state === 'ready') {
      body = summary + '<div class="btns"><button class="b p" data-a="fill">Fill the form</button><button class="b s" data-a="forget">Not now</button></div>'
        + '<div class="muted" style="margin-top:8px">Fills payment method, bill number, seller PAN, bill date, amount, name, mobile and address.</div>';
    } else if (state === 'working') {
      body = summary + '<div class="note good">Filling the form…</div>';
    } else if (state === 'done') {
      var rows = extra.rows;
      var bad = rows.filter(function (r) { return !r.ok; }).length;
      body = summary + '<div style="margin-top:8px">' + rows.map(function (r) {
        return '<div class="row"><span class="' + (r.ok ? 'ok' : 'no') + '">' + (r.ok ? '✓' : '✗') + '</span><span><span class="lab">' + esc(r.label) + '</span>'
          + (r.value ? ' <span class="val">' + esc(r.value) + '</span>' : '') + (r.note ? '<br><span class="val" style="color:#b91c1c">' + esc(r.note) + '</span>' : '') + '</span></div>';
      }).join('') + '</div>'
        + '<div class="note' + (bad ? '' : ' good') + '">' + (bad ? 'Fill the field' + (bad > 1 ? 's' : '') + ' marked ✗ by hand. Then c' : 'All ' + rows.length + ' fields filled. C')
        + 'omplete the security check and press <b>Generate prize coupon</b> (<b>पुरस्कार कुपन सिर्जना गर्नुहोस्</b>). This box will catch the coupon number.</div>'
        + '<div class="btns"><button class="b s" data-a="fill">Fill again</button><button class="b s" data-a="close">Hide</button></div>';
    } else if (state === 'coupon') {
      body = '<div class="muted">Prize coupon for ' + esc(p.merchant || 'your bill') + '</div><div class="code">' + esc(extra.code) + '</div>'
        + '<div class="btns">' + (p.app && p.id ? '<button class="b p" data-a="save">Save to BillKhata</button>' : '') + '<button class="b s" data-a="copy">Copy</button></div>'
        + '<div class="muted" style="margin-top:8px">Keep the paper bill. You need it to claim a prize.</div>';
    }

    root.innerHTML = '<style>' + CSS + '</style><div class="box" role="dialog" aria-label="BillKhata"><div class="hd"><span>Bill<b>Khata</b> · IRD auto-fill</span><button class="x" data-a="close" aria-label="Close">×</button></div><div class="bd">' + body + '</div></div>';

    root.querySelectorAll('[data-a]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var a = btn.getAttribute('data-a');
        if (a === 'close') closePanel();
        else if (a === 'forget') { remember(null); closePanel(); }
        else if (a === 'fill') {
          render('working', p);
          var result = await fill(p);
          render('done', p, { rows: result });
          watchForCoupon(p);
        } else if (a === 'copy') {
          try { await navigator.clipboard.writeText(extra.code); btn.textContent = 'Copied'; } catch (e) { prompt('Coupon number', extra.code); }
        } else if (a === 'save') {
          if (/^https:\/\/|^http:\/\/localhost[:/]/.test(p.app)) window.open(p.app.replace(/\/$/, '') + '/#/coupon/' + encodeURIComponent(p.id) + '/' + extra.code, '_blank');
        }
      });
    });
  }

  /* ---------- start ---------- */

  var bill = takeBill();
  if (!bill) {
    if (MODE !== 'userscript') render('none');
    return;
  }
  if (bill.pay === 'digital') { render('digital', bill); return; }
  if (MODE === 'userscript') {
    render('ready', bill);
  } else {
    /* A bookmark click is the "one click": fill straight away. */
    render('working', bill);
    fill(bill).then(function (rows) {
      render('done', bill, { rows: rows });
      watchForCoupon(bill);
    });
  }
}
