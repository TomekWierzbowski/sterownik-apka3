/* ============================================================================================================
 *  wykres_temp.js — WYKRES TEMPERATURY WODY W APCE T3  [Tomasz 27/28.09.2026: „wypasiony wykres temperatury…
 *  ładne opisanie osi, trend, zakres 1h 24h 7d, renderowany z efektami, przenikaniem” · prototyp zatwierdzony: „jest, wydaj T3”]
 * ============================================================================================================
 *  WEJŚCIA:  wiadomości `swiat` z most_js.js (te same, które rysuje hala): d.temp, d.temp_set, d.grzeje,
 *            d.poziomStan.pompa, d.obieg_nr, d.awtemp; nazwa obiektu z każdej wiadomości niosącej d.obiekt.
 *  CO ROBI:  (1) co minutę zapisuje próbkę w pamięci telefonu (localStorage, 7 dni na obiekt i obieg);
 *            (2) w kaflu temperatury dokłada ikonę wykresu (nakładka - układ kafli bez zmian, dotknięcie reszty
 *                kafla dalej otwiera nastawę); (3) po dotknięciu ikony: wykres na cały ekran - zakresy 1 h / 24 h /
 *                7 dni z przenikaniem, trend °C/h, prognoza dojścia do zadanej, pasy grzania i postoju pompy.
 *  WYJŚCIA:  tylko ekran. Nic nie wysyła do sterownika.
 *  ⚠ HISTORIA Z TELEFONU: apka zbiera dane, gdy jest otwarta - przerwy zostają przerwami (bez linii przez brak danych).
 *    Pełna historia przyjdzie ze sterownika (pierścień 7 dni po MQTT 5) - wtedy `dolozHistorie()` wleje ją tutaj.
 *  ⚠ Moduł jest dołączany tylko do apki (zbuduj_pwa.py --apka3); makieta hali i generator LVGL go nie widzą.
 * ============================================================================================================ */
(function () {
  'use strict';
  if (window.__wykresTemp) return; window.__wykresTemp = true;
  const MIN = 60000, GODZ = 60 * MIN, DOBA = 24 * GODZ, TRZYMAJ = 7 * DOBA;
  const PREF = (window.APKA_KLUCZ || 'apka') + '_wykresT_';
  let obiekt = 'obiekt', ostatnie = null;

  /* ---------------- [1] ZBIERANIE PRÓBEK ---------------- */
  /* ZAPIS ZWARTY [28.09, zmierzone sondą]: 7 dni po minucie w JSON to ~220 kB na obieg - konto serwisowe z kilkoma
     obiektami doszłoby do limitu localStorage (5 MB), a wtedy odmowę dostałby też zapis LOGOWANIA apki. Tu: 4 znaki
     na próbkę (flagi a-d + temperatura×100 w base36 na 3 znakach), przerwa „!<minuty>.”, zmiana zadanej „z<×10>.”
     → ~40 kB na obieg i tydzień. Do tego limit łączny LIMIT_ZNAKOW: gdy przekroczony, najpierw wypada historia
     obiektu oglądanego najdawniej. Wykres jest pomocniczy - nigdy nie może zająć miejsca logowaniu. */
  const LIMIT_ZNAKOW = 1200000;
  const klucz = (ob) => PREF + obiekt + '_' + ob;
  function koduj(p) {
    if (!p.length) return '';
    let s = '', pop = p[0][0] - 1, zad = -2;
    for (const [m, t, z, f] of p) {
      if (m - pop !== 1) s += '!' + (m - pop).toString(36) + '.';
      if (z !== zad) { s += 'z' + (z < 0 ? '' : z.toString(36)) + '.'; zad = z; }
      s += String.fromCharCode(97 + (f & 3)) + ('00' + Math.max(0, Math.min(46655, t)).toString(36)).slice(-3);
      pop = m;
    }
    return s;
  }
  function dekoduj(m0, s) {
    const p = []; let m = m0 - 1, zad = -1, i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '!' || c === 'z') { const k = s.indexOf('.', i); const v = s.slice(i + 1, k); i = k + 1;
        if (c === '!') m += parseInt(v, 36) - 1; else zad = v === '' ? -1 : parseInt(v, 36); continue; }
      m++; p.push([m, parseInt(s.substr(i + 1, 3), 36), zad, c.charCodeAt(0) - 97]); i += 4;
    }
    return p;
  }
  function wczytaj(ob) { try { const t = localStorage.getItem(klucz(ob)); const j = t ? JSON.parse(t) : null; return j && j.v === 2 ? dekoduj(j.m0, j.s) : []; } catch (e) { return []; } }
  function zapisz(ob, p) {
    const k = klucz(ob), txt = JSON.stringify({ v: 2, u: Date.now(), m0: p.length ? p[0][0] : 0, s: koduj(p) });
    try {
      let razem = txt.length; const inne = [];
      for (let i = 0; i < localStorage.length; i++) { const n = localStorage.key(i);
        if (n && n.indexOf(PREF) === 0 && n !== k && n !== PREF + 'zakres') { const v = localStorage.getItem(n) || ''; razem += v.length;
          let u = 0; try { u = JSON.parse(v).u || 0; } catch (e) {} inne.push([u, n, v.length]); } }
      inne.sort((a, b) => a[0] - b[0]);
      while (razem > LIMIT_ZNAKOW && inne.length) { const [, n, dl] = inne.shift(); localStorage.removeItem(n); razem -= dl; }
      localStorage.setItem(k, txt);
    } catch (e) {}                                       // pełna pamięć albo tryb prywatny: wykres żyje z RAM
  }
  const pamiec = {};                                   // ob -> tablica [minuta, temp*100, zadana*10, flagi]
  const seria = (ob) => (pamiec[obiekt + '|' + ob] = pamiec[obiekt + '|' + ob] || wczytaj(ob));
  /* KTÓRY OBIEKT: pakiet `swiat` go nie niesie - nazwę ma zewnętrzny pakiet klienta chmury (`d.obiekt`, most_js.js
     wspolne()). Podpinamy się pod startMqtt zanim hala go wywoła (hala startuje po doładowaniu biblioteki MQTT,
     czyli po tym skrypcie). Konto serwisowe przełącza obiekty - bez tego historie różnych basenów by się zlały.
     ⛔ Nie czytać nazwy z listy wyboru na pasku: przed pierwszą paczką stoi tam „czekam…” (sonda 28.09 zapisała
     historię pod obiektem „czekam__”). */
  const nazwa = (s) => String(s).replace(/[^A-Za-z0-9_.-]/g, '_');
  const M = window.MOST_JS;
  if (M && typeof M.startMqtt === 'function' && !M.__wykresTemp) {
    const pierwotny = M.startMqtt; M.__wykresTemp = true;
    M.startMqtt = function (podaj, o) { return pierwotny.call(this, (d) => { if (d && typeof d.obiekt === 'string' && d.obiekt) obiekt = nazwa(d.obiekt); return podaj(d); }, o); };
  }
  window.addEventListener('message', (ev) => {
    const d = ev.data; if (!d || typeof d !== 'object') return;
    if (d.typ !== 'swiat' || typeof d.temp !== 'number' || !isFinite(d.temp) || d.awtemp || d.awtempBrak) return;
    const ob = typeof d.obieg_nr === 'number' ? d.obieg_nr : 0;
    const pompa = !!(d.poziomStan && d.poziomStan.pompa);
    ostatnie = { ob, temp: d.temp, zad: typeof d.temp_set === 'number' ? d.temp_set : null, grz: !!d.grzeje, pompa, t: Date.now() };
    const m = Math.floor(Date.now() / MIN), p = seria(ob);
    if (p.length && p[p.length - 1][0] >= m) {           // jedna próbka na minutę (zegar telefonu cofnięty = czekamy);
      if (otwarte && otwarte.ob === ob && widok) podsumuj();   // liczba w oknie i tak na żywo, co pakiet
      return;
    }
    p.push([m, Math.round(d.temp * 100), ostatnie.zad === null ? -1 : Math.round(ostatnie.zad * 10), (ostatnie.grz ? 1 : 0) | (pompa ? 2 : 0)]);
    const granica = m - TRZYMAJ / MIN; while (p.length && p[0][0] < granica) p.shift();
    zapisz(ob, p);
    if (otwarte && otwarte.ob === ob) { widok = zbuduj(zakres); rysuj(false); }
  });
  /* Wejście na przyszłość: historia ze sterownika (tablice jak wyżej) - scala bez dubli. */
  window.dolozHistorie = function (ob, wpisy) {
    const p = seria(ob), jest = new Set(p.map(x => x[0]));
    wpisy.forEach(w => { if (!jest.has(w[0])) p.push(w); }); p.sort((a, b) => a[0] - b[0]); zapisz(ob, p);
  };

  /* ---------------- [2] WYGLĄD (paleta apki T3) ---------------- */
  const styl = document.createElement('style');
  styl.textContent = `
  .temp .th.lewa{position:relative}
  .wt-ikona{position:absolute;bottom:8px;right:8px;width:30px;height:30px;border-radius:9px;border:1px solid #dfe3e8;background:#fff;
    display:grid;place-items:center;cursor:pointer;color:#1e6fd9;box-shadow:0 1px 3px rgba(20,22,26,.12);padding:0;z-index:2}
  .wt-ikona svg{width:18px;height:18px}
  .wt-ikona:active{transform:scale(.94)}
  .wt-tlo{position:fixed;inset:0;z-index:2147483000;background:rgba(14,22,32,.42);display:grid;place-items:center;padding:14px;
    opacity:0;transition:opacity .25s ease;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wt-tlo.widac{opacity:1}
  .wt-karta{width:min(880px,100%);max-height:100%;overflow:auto;background:#fff;color:#14161a;border-radius:16px;
    box-shadow:0 10px 40px rgba(0,0,0,.28);padding:16px 16px 12px;display:grid;gap:12px;transform:translateY(12px);transition:transform .3s cubic-bezier(.2,.8,.2,1)}
  .wt-tlo.widac .wt-karta{transform:none}
  .wt-glowa{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:10px 18px}
  .wt-brew{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#5d6470}
  .wt-war{display:flex;align-items:baseline;gap:8px;margin-top:4px}
  .wt-liczba{font-size:clamp(40px,11vw,58px);font-weight:700;line-height:.95;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .wt-jedn{font-size:20px;color:#5d6470}
  .wt-opis{font-size:13px;color:#5d6470;margin-top:6px;display:flex;flex-wrap:wrap;gap:4px 12px}
  .wt-opis b{color:#14161a}
  .wt-kropka{display:inline-block;width:7px;height:7px;border-radius:50%;background:#e0701f;margin-right:5px;vertical-align:1px}
  .wt-prawa{display:grid;gap:6px;justify-items:end}
  .wt-trend{display:inline-flex;align-items:center;gap:6px;padding:5px 10px 5px 8px;border-radius:999px;background:#f3f5f8;font-weight:700;font-size:14px;font-variant-numeric:tabular-nums;color:#5d6470}
  .wt-trend.rosnie{color:#e0701f}
  .wt-trend svg{width:16px;height:16px;transition:transform .5s cubic-bezier(.2,.8,.2,1)}
  .wt-prog{font-size:13px;color:#5d6470;text-align:right;max-width:32ch}
  .wt-prog b{color:#e0701f}
  .wt-pasek{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px}
  .wt-zakresy{display:inline-flex;background:#f3f5f8;border-radius:10px;padding:3px;gap:2px;position:relative}
  .wt-zakresy button{font:700 14px/1 system-ui,sans-serif;color:#5d6470;background:transparent;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;position:relative;z-index:1}
  .wt-zakresy button[aria-pressed=true]{color:#14161a}
  .wt-suwak{position:absolute;top:3px;bottom:3px;left:3px;border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(20,22,26,.12);transition:transform .35s cubic-bezier(.2,.8,.2,1),width .35s cubic-bezier(.2,.8,.2,1)}
  .wt-zamknij{border:1px solid #dfe3e8;background:#fff;border-radius:10px;padding:8px 14px;font:600 14px/1 system-ui,sans-serif;color:#14161a;cursor:pointer}
  .wt-wykres{position:relative;width:100%;height:clamp(240px,52vw,380px);touch-action:pan-y}
  .wt-wykres canvas{position:absolute;inset:0;width:100%;height:100%}
  .wt-pusto{position:absolute;inset:0;display:grid;place-items:center;text-align:center;color:#5d6470;font-size:14px;padding:20px;pointer-events:none}
  .wt-dymek{position:absolute;top:8px;pointer-events:none;background:#fff;border:1px solid #dfe3e8;border-radius:10px;box-shadow:0 6px 20px rgba(20,22,26,.14);padding:8px 10px;min-width:140px;font-size:12px;color:#5d6470;opacity:0;transition:opacity .15s}
  .wt-dymek.widac{opacity:1}
  .wt-dymek .v{font-size:22px;font-weight:700;color:#14161a;font-variant-numeric:tabular-nums;margin:2px 0 4px}
  .wt-znacz{display:inline-block;font-size:11px;font-weight:700;padding:3px 6px;border-radius:6px;background:#f3f5f8;margin:0 4px 0 0}
  .wt-znacz.c{background:rgba(224,112,31,.14);color:#e0701f}
  .wt-stat{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;border-top:1px solid #dfe3e8;padding-top:10px}
  .wt-stat span{display:block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a929d}
  .wt-stat b{font-size:20px;font-variant-numeric:tabular-nums}
  .wt-leg{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:#5d6470}
  .wt-leg i{display:inline-block;width:16px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
  .wt-stopka{font-size:11px;color:#8a929d}
  @media (max-width:480px){.wt-stat{grid-template-columns:repeat(2,minmax(0,1fr))}.wt-prawa{justify-items:start}.wt-prog{text-align:left}}
  @media (prefers-reduced-motion:reduce){.wt-tlo,.wt-karta,.wt-suwak,.wt-trend svg{transition:none}}`;
  document.head.appendChild(styl);

  /* ---------------- [3] IKONA W KAFLU (po każdym przerysowaniu hali) ---------------- */
  const IKONA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18l5-6 4 3 5-8 4 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function doloz() {
    const lewa = document.querySelector('.tile.temp .th.lewa'); if (!lewa || lewa.querySelector('.wt-ikona')) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'wt-ikona'; b.setAttribute('aria-label', 'Wykres temperatury wody'); b.innerHTML = IKONA;
    b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); otworz(); });
    lewa.appendChild(b);
  }
  new MutationObserver(doloz).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', doloz); doloz();

  /* ---------------- [4] WIDOK: dane dla zakresu ---------------- */
  const ZAK = { '1h': { dl: GODZ, kub: 1 }, '24h': { dl: DOBA, kub: 5 }, '7d': { dl: 7 * DOBA, kub: 30 } };
  let zakres = '24h'; try { const z = localStorage.getItem(PREF + 'zakres'); if (ZAK[z]) zakres = z; } catch (e) {}
  const fmt = (v, m = 1) => v.toLocaleString('pl-PL', { minimumFractionDigits: m, maximumFractionDigits: m });
  const hhmm = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const dz = new Intl.DateTimeFormat('pl-PL', { weekday: 'short' }), dzien = (t) => dz.format(new Date(t)).replace('.', '');
  const KROKI = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5];

  function zbuduj(z) {
    const ob = otwarte ? otwarte.ob : 0, cfg = ZAK[z], teraz = Date.now(), t0 = teraz - cfg.dl;
    const surowe = seria(ob).filter(p => p[0] * MIN >= t0).map(p => ({ t: p[0] * MIN, v: p[1] / 100, zad: p[2] >= 0 ? p[2] / 10 : null, grz: !!(p[3] & 1), pompa: !!(p[3] & 2) }));
    const zad = ostatnie && ostatnie.ob === ob && ostatnie.zad !== null ? ostatnie.zad : (surowe.length ? surowe[surowe.length - 1].zad : null);
    const kub = cfg.kub * MIN, punkty = [];
    let i = 0;
    while (i < surowe.length) {
      const k0 = Math.floor(surowe[i].t / kub) * kub; let s = 0, n = 0, lo = Infinity, hi = -Infinity, tsum = 0;
      while (i < surowe.length && surowe[i].t < k0 + kub) { const v = surowe[i].v; s += v; n++; lo = Math.min(lo, v); hi = Math.max(hi, v); tsum += surowe[i].t; i++; }
      punkty.push({ t: tsum / n, v: s / n, lo, hi });
    }
    const odcinki = []; let odc = [];                                        // przerwa > 2,5 kubełka = osobny odcinek
    punkty.forEach((p, j) => { if (j && p.t - punkty[j - 1].t > 2.5 * Math.max(kub, MIN)) { odcinki.push(odc); odc = []; } odc.push(p); });
    if (odc.length) odcinki.push(odc);
    const ostS = surowe[surowe.length - 1];                                  // ostatni kubełek kończy się OSTATNIM odczytem -
    if (ostS && odcinki.length) { const o = odcinki[odcinki.length - 1];     // inaczej kropka „teraz” wisi nad średnią z 5-30 min
      o[o.length - 1] = Object.assign({}, o[o.length - 1], { t: ostS.t, v: ostS.v }); }
    const przedz = (f) => { const w = []; let od = null, pop = null;
      surowe.forEach(p => { const ciag = pop && p.t - pop.t <= 3 * MIN; if (f(p) && (od === null || !ciag)) { if (od !== null) w.push([od, pop.t]); od = p.t; }
        else if (!f(p) && od !== null) { w.push([od, p.t]); od = null; } else if (f(p) && !ciag && od !== null) { w.push([od, pop.t]); od = p.t; } pop = p; });
      if (od !== null && pop) w.push([od, pop.t]); return w; };
    // trend z ostatniej godziny (regresja liniowa), prognoza tylko przy grzaniu
    const godz = surowe.filter(p => p.t >= teraz - GODZ); let nach = null, prognoza = null;
    if (godz.length >= 15 && godz[godz.length - 1].t - godz[0].t >= 20 * MIN) {
      const x0 = godz[0].t; let sx = 0, sy = 0, sxy = 0, sxx = 0; const n = godz.length;
      godz.forEach(p => { const x = (p.t - x0) / GODZ; sx += x; sy += p.v; sxy += x * p.v; sxx += x * x; });
      nach = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      const ost = godz[godz.length - 1];
      if (ost.grz && zad !== null && nach > 0.05 && ost.v < zad) { const min = (zad - ost.v) / nach * 60; if (min < 8 * 60) prognoza = { t: ost.t + min * MIN, min }; }
    }
    let t1 = teraz;
    if (prognoza && z === '24h') t1 = Math.min(prognoza.t, teraz + 4 * GODZ) + 12 * MIN;
    if (prognoza && z === '1h') t1 = teraz + 22 * MIN;
    const wart = surowe.map(p => p.v);
    let ymin = wart.length ? Math.min(...wart) : 26, ymax = wart.length ? Math.max(...wart) : 29;
    if (zad !== null) { ymin = Math.min(ymin, zad); ymax = Math.max(ymax, zad); }
    const zapas = Math.max(0.12, (ymax - ymin) * 0.12); ymin -= zapas; ymax += zapas;
    const krokY = KROKI.find(k => (ymax - ymin) / k <= 6) || 5; ymin = Math.floor(ymin / krokY) * krokY; ymax = Math.ceil(ymax / krokY) * krokY;
    let s = 0, grzMin = 0; surowe.forEach(p => { s += p.v; if (p.grz) grzMin++; });
    return { z, t0, t1, teraz, ymin, ymax, krokY, surowe, odcinki, zad, nach, prognoza, ost: surowe[surowe.length - 1] || null,
      grzanie: przedz(p => p.grz), postoj: przedz(p => !p.pompa),
      stat: wart.length ? { min: Math.min(...wart), max: Math.max(...wart), sr: s / wart.length, grzMin } : null };
  }

  /* ---------------- [5] RYSOWANIE ---------------- */
  let otwarte = null, widok = null, W = 0, H = 0, DPR = 1, pole = null, cv, cx, ov, ox, kursor = null, anim = null;
  const X = (w, t) => pole.l + (t - w.t0) / (w.t1 - w.t0) * (pole.r - pole.l);
  const Y = (w, v) => pole.d - (v - w.ymin) / (w.ymax - w.ymin) * (pole.d - pole.g);
  const K = { ink2: '#5d6470', ink3: '#8a929d', siatka: '#edf0f3', woda: '30,111,217', turk: '18,162,181', cieplo: '224,112,31' };
  function wymiary() { DPR = Math.min(window.devicePixelRatio || 1, 2.5); const r = cv.parentNode.getBoundingClientRect(); W = r.width; H = r.height;
    [cv, ov].forEach(c => { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }); pole = { l: 46, r: W - 14, g: 14, d: H - 30 }; }
  function krzywa(ctx, pkt) {                                                   // monotoniczna (Fritsch-Carlson) - bez przeregulowań
    const n = pkt.length; if (n === 1) { ctx.moveTo(pkt[0][0], pkt[0][1]); ctx.lineTo(pkt[0][0] + 0.1, pkt[0][1]); return; }
    const d = [], m = []; for (let i = 0; i < n - 1; i++) d.push((pkt[i + 1][1] - pkt[i][1]) / ((pkt[i + 1][0] - pkt[i][0]) || 1e-6));
    m.push(d[0]); for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2); m.push(d[n - 2]);
    for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { const q = 3 / Math.sqrt(s); m[i] = q * a * d[i]; m[i + 1] = q * b * d[i]; } }
    ctx.moveTo(pkt[0][0], pkt[0][1]);
    for (let i = 0; i < n - 1; i++) { const h = (pkt[i + 1][0] - pkt[i][0]) / 3; ctx.bezierCurveTo(pkt[i][0] + h, pkt[i][1] + m[i] * h, pkt[i + 1][0] - h, pkt[i + 1][1] - m[i + 1] * h, pkt[i + 1][0], pkt[i + 1][1]); }
  }
  function szraf(ctx) { const p = document.createElement('canvas'); p.width = p.height = 8; const q = p.getContext('2d'); q.strokeStyle = K.ink3; q.globalAlpha = .35; q.lineWidth = 1.2;
    q.beginPath(); q.moveTo(0, 8); q.lineTo(8, 0); q.moveTo(-2, 2); q.lineTo(2, -2); q.moveTo(6, 10); q.lineTo(10, 6); q.stroke(); return ctx.createPattern(p, 'repeat'); }

  function klatka(ctx, w) {
    ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillStyle = szraf(ctx); w.postoj.forEach(([a, b]) => ctx.fillRect(X(w, a), pole.g, Math.max(1, X(w, b) - X(w, a)), pole.d - pole.g));
    w.grzanie.forEach(([a, b]) => { const x = X(w, a), s = Math.max(1, X(w, b) - x); ctx.fillStyle = 'rgba(' + K.cieplo + ',.045)'; ctx.fillRect(x, pole.g, s, pole.d - pole.g);
      ctx.fillStyle = 'rgba(' + K.cieplo + ',.85)'; ctx.fillRect(x, pole.d - 3, s, 3); });
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const miejsc = Math.abs(w.krokY * 10 - Math.round(w.krokY * 10)) > 1e-9 ? 2 : 1;
    for (let v = w.ymin; v <= w.ymax + 1e-9; v += w.krokY) { const y = Math.round(Y(w, v)) + .5; ctx.strokeStyle = K.siatka; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pole.l, y); ctx.lineTo(pole.r, y); ctx.stroke(); ctx.fillStyle = K.ink3; ctx.fillText(fmt(v, miejsc) + '°', pole.l - 8, y); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    /* OPISY OSI X [sonda 28.09: na 430 px „21:00” wchodziło na „pon 00:00”]: najpierw zbieramy znaczniki, potem
       rysujemy - mocne (północ, dni) pierwsze, zwykłe tylko tam, gdzie nie nachodzą na już postawione. Linie siatki
       idą przy każdym znaczniku, także bez napisu. */
    const znaczniki = [];
    if (w.z === '1h') { const k = 10 * MIN; for (let t = Math.ceil(w.t0 / k) * k; t <= w.t1; t += k) znaczniki.push([t, hhmm(t), false]); }
    else if (w.z === '24h') { const d = new Date(w.t0); d.setMinutes(0, 0, 0); for (let t = d.getTime(); t <= w.t1; t += GODZ) { const g = new Date(t).getHours(); if (t >= w.t0 && g % 3 === 0) znaczniki.push([t, g === 0 ? dzien(t) + ' 00:00' : hhmm(t), g === 0]); } }
    else { const d = new Date(w.t0); d.setHours(0, 0, 0, 0); for (let t = d.getTime() + DOBA; t <= w.t1; t += DOBA) { const q = new Date(t); znaczniki.push([t, dzien(t) + ' ' + q.getDate() + '.' + String(q.getMonth() + 1).padStart(2, '0'), true]); } }
    const zajete = [];
    znaczniki.forEach(([t]) => { const x = X(w, t); if (x < pole.l - 1 || x > pole.r + 1) return; ctx.strokeStyle = K.siatka;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, pole.g); ctx.lineTo(Math.round(x) + .5, pole.d); ctx.stroke(); });
    [true, false].forEach(etap => znaczniki.filter(z => z[2] === etap).forEach(([t, tx, mocno]) => {
      const x = X(w, t); if (x < pole.l - 1 || x > pole.r + 1) return;
      ctx.font = (mocno ? '600 ' : '500 ') + '12px system-ui, sans-serif';
      const sz = ctx.measureText(tx).width, xs = Math.min(Math.max(x, pole.l + sz / 2), pole.r - sz / 2), a = xs - sz / 2 - 5, b = xs + sz / 2 + 5;
      if (zajete.some(([p, k]) => a < k && b > p)) return;
      zajete.push([a, b]); ctx.fillStyle = mocno ? K.ink2 : K.ink3; ctx.fillText(tx, xs, pole.d + 8); }));
    if (w.t1 > w.teraz) { const x = X(w, w.teraz), g = ctx.createLinearGradient(x, 0, pole.r, 0); g.addColorStop(0, 'rgba(' + K.cieplo + ',.07)'); g.addColorStop(1, 'rgba(' + K.cieplo + ',0)');
      ctx.fillStyle = g; ctx.fillRect(x, pole.g, pole.r - x, pole.d - pole.g); ctx.fillStyle = 'rgb(' + K.cieplo + ')'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillText('PROGNOZA', pole.r - 4, pole.g + 4); }
    if (w.zad !== null) { const y = Math.round(Y(w, w.zad)) + .5; ctx.setLineDash([6, 5]); ctx.strokeStyle = K.ink2; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pole.l, y); ctx.lineTo(pole.r, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = K.ink2; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.font = '600 12px system-ui, sans-serif'; const podLinia = y - pole.g < 34;            // blisko góry: pod linią, żeby nie wejść na „PROGNOZA”
      if (podLinia) ctx.textBaseline = 'top'; ctx.fillText('zadana ' + fmt(w.zad) + ' °C', pole.r - 4, podLinia ? y + 4 : y - 4); }
    w.odcinki.forEach(odc => {
      if (w.z === '7d' && odc.length > 1) { ctx.beginPath(); odc.forEach((p, i) => i ? ctx.lineTo(X(w, p.t), Y(w, p.hi)) : ctx.moveTo(X(w, p.t), Y(w, p.hi)));
        for (let i = odc.length - 1; i >= 0; i--) ctx.lineTo(X(w, odc[i].t), Y(w, odc[i].lo)); ctx.closePath(); ctx.fillStyle = 'rgba(' + K.woda + ',.13)'; ctx.fill(); }
      const pkt = odc.map(p => [X(w, p.t), Y(w, p.v)]);
      ctx.beginPath(); krzywa(ctx, pkt); ctx.lineTo(pkt[pkt.length - 1][0], pole.d); ctx.lineTo(pkt[0][0], pole.d); ctx.closePath();
      const g = ctx.createLinearGradient(0, pole.g, 0, pole.d); g.addColorStop(0, 'rgba(' + K.woda + ',.30)'); g.addColorStop(.55, 'rgba(' + K.turk + ',.12)'); g.addColorStop(1, 'rgba(' + K.turk + ',0)');
      ctx.fillStyle = g; ctx.fill();
      const gl = ctx.createLinearGradient(pole.l, 0, pole.r, 0); gl.addColorStop(0, 'rgba(' + K.turk + ',.95)'); gl.addColorStop(1, 'rgba(' + K.woda + ',1)');
      ctx.beginPath(); krzywa(ctx, pkt); ctx.strokeStyle = gl; ctx.lineWidth = 2.6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(' + K.woda + ',.45)'; ctx.shadowBlur = 12; ctx.stroke(); ctx.shadowBlur = 0; });
    if (w.prognoza && w.t1 > w.teraz && w.ost) { const a = [X(w, w.ost.t), Y(w, w.ost.v)], tk = Math.min(w.prognoza.t, w.t1 - 4 * MIN);
      const vk = w.ost.v + (w.zad - w.ost.v) * (tk - w.ost.t) / (w.prognoza.t - w.ost.t), b = [X(w, tk), Y(w, vk)];
      ctx.setLineDash([2, 5]); ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgb(' + K.cieplo + ')'; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
      if (tk >= w.prognoza.t - 1) { ctx.beginPath(); ctx.arc(b[0], b[1], 4, 0, Math.PI * 2); ctx.fillStyle = 'rgb(' + K.cieplo + ')'; ctx.fill(); } }
    ctx.restore();
  }

  function rysuj(przenikanie) {
    if (!otwarte) return; const pusto = otwarte.el.querySelector('.wt-pusto');
    pusto.hidden = widok.surowe.length > 1;
    pusto.textContent = 'Zbieram dane: wykres wypełnia się, gdy apka jest otwarta. Pełna historia ze sterownika przyjdzie z jego aktualizacją.';
    if (!przenikanie || matchMedia('(prefers-reduced-motion: reduce)').matches) { if (anim) cancelAnimationFrame(anim); anim = null; klatka(cx, widok); podsumuj(); return; }
    const A = document.createElement('canvas'); A.width = cv.width; A.height = cv.height; A.getContext('2d').drawImage(cv, 0, 0);
    const B = document.createElement('canvas'); B.width = cv.width; B.height = cv.height; klatka(B.getContext('2d'), widok);
    const t0 = performance.now(); if (anim) cancelAnimationFrame(anim);
    const krok = (t) => { const u = Math.min(1, (t - t0) / 480), e = 1 - Math.pow(1 - u, 3);
      cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height); cx.globalAlpha = 1 - e; cx.drawImage(A, 0, 0); cx.globalAlpha = e; cx.drawImage(B, 0, 0); cx.globalAlpha = 1;
      if (u < 1) anim = requestAnimationFrame(krok); else { anim = null; klatka(cx, widok); } };
    anim = requestAnimationFrame(krok); podsumuj();
  }

  function nakladka(czas) {
    if (!otwarte) return; requestAnimationFrame(nakladka);
    ox.setTransform(1, 0, 0, 1, 0, 0); ox.clearRect(0, 0, ov.width, ov.height); if (anim || !widok || !widok.ost) return;
    ox.setTransform(DPR, 0, 0, DPR, 0, 0);
    const o = widok.ost, x = X(widok, o.t), y = Y(widok, o.v);
    if (Date.now() - o.t < 3 * MIN) { if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { const f = (czas % 1800) / 1800; ox.beginPath(); ox.arc(x, y, 5 + f * 14, 0, 7); ox.fillStyle = 'rgba(' + K.woda + ',' + (.35 * (1 - f)) + ')'; ox.fill(); }
      ox.beginPath(); ox.arc(x, y, 5, 0, 7); ox.fillStyle = '#fff'; ox.fill(); ox.lineWidth = 3; ox.strokeStyle = 'rgb(' + K.woda + ')'; ox.stroke(); }
    const dym = otwarte.el.querySelector('.wt-dymek');
    if (kursor === null) { dym.classList.remove('widac'); return; }
    const t = widok.t0 + (kursor - pole.l) / (pole.r - pole.l) * (widok.t1 - widok.t0), s = widok.surowe;
    let lo = 0, hi = s.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m].t < t) lo = m; else hi = m; }
    const p = Math.abs(s[lo].t - t) < Math.abs(s[hi].t - t) ? s[lo] : s[hi], blisko = Math.abs(p.t - t) <= Math.max(3 * MIN, (widok.t1 - widok.t0) / (pole.r - pole.l) * 6);
    const kx = blisko ? X(widok, p.t) : kursor;
    ox.strokeStyle = K.ink3; ox.lineWidth = 1; ox.setLineDash([3, 3]); ox.beginPath(); ox.moveTo(Math.round(kx) + .5, pole.g); ox.lineTo(Math.round(kx) + .5, pole.d); ox.stroke(); ox.setLineDash([]);
    const d = new Date(blisko ? p.t : t), dt = dzien(d.getTime()) + ' ' + d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0') + ', ' + hhmm(d.getTime());
    if (blisko) { ox.beginPath(); ox.arc(kx, Y(widok, p.v), 4.5, 0, 7); ox.fillStyle = 'rgb(' + K.woda + ')'; ox.fill(); ox.lineWidth = 2; ox.strokeStyle = '#fff'; ox.stroke();
      dym.innerHTML = '<div>' + dt + '</div><div class="v">' + fmt(p.v, 2) + ' °C</div>' + (p.grz ? '<span class="wt-znacz c">grzanie</span>' : '<span class="wt-znacz">bez grzania</span>') + '<span class="wt-znacz">' + (p.pompa ? 'pompa pracuje' : 'pompa stoi') + '</span>'; }
    else dym.innerHTML = '<div>' + dt + '</div><div class="v">brak danych</div><span class="wt-znacz">apka była zamknięta</span>';
    const sz = dym.offsetWidth || 150; dym.style.left = Math.min(Math.max(8, kx + (kx > W / 2 ? -sz - 14 : 14)), W - sz - 8) + 'px'; dym.classList.add('widac');
  }

  function podsumuj() {
    const w = widok, el = otwarte.el, q = (s) => el.querySelector(s), o = w.ost;
    q('.wt-liczba').textContent = ostatnie && ostatnie.ob === otwarte.ob ? fmt(ostatnie.temp) : (o ? fmt(o.v) : '— —');
    const grz = ostatnie && ostatnie.ob === otwarte.ob ? ostatnie.grz : (o && o.grz), pom = ostatnie && ostatnie.ob === otwarte.ob ? ostatnie.pompa : (o && o.pompa);
    q('.wt-opis').innerHTML = (w.zad !== null ? '<span>zadana <b>' + fmt(w.zad) + ' °C</b></span>' : '') + '<span>' + (grz ? '<i class="wt-kropka"></i>grzanie pracuje' : 'grzanie nie pracuje') + '</span><span>' + (pom ? 'pompa pracuje' : 'pompa stoi') + '</span>';
    const tr = q('.wt-trend');
    if (w.nach === null) { tr.hidden = true; } else { tr.hidden = false; tr.classList.toggle('rosnie', w.nach > 0.05);
      tr.querySelector('b').textContent = (w.nach >= 0 ? '+' : '−') + fmt(Math.abs(w.nach), 2) + ' °C/h'; tr.querySelector('svg').style.transform = 'rotate(' + Math.max(-45, Math.min(45, -w.nach * 120)) + 'deg)'; }
    const cz = (m) => { const h = Math.floor(m / 60), mm = Math.round(m % 60); return (h ? h + ' h ' : '') + mm + ' min'; };
    q('.wt-prog').innerHTML = w.prognoza ? 'Osiągnie <b>' + fmt(w.zad) + ' °C ok. ' + hhmm(w.prognoza.t) + '</b><br>za ' + cz(w.prognoza.min) + ' przy obecnym tempie' : (w.nach === null ? 'Trend po 20 min danych' : '');
    const st = w.stat;
    q('.wt-s-min').textContent = st ? fmt(st.min) + '°' : '–'; q('.wt-s-max').textContent = st ? fmt(st.max) + '°' : '–'; q('.wt-s-sr').textContent = st ? fmt(st.sr) + '°' : '–';
    q('.wt-s-grz').textContent = st ? Math.floor(st.grzMin / 60) + ':' + String(st.grzMin % 60).padStart(2, '0') + ' h' : '–';
    const p = seria(otwarte.ob); q('.wt-stopka').textContent = p.length ? 'Historia z tego telefonu od ' + dzien(p[0][0] * MIN) + ' ' + hhmm(p[0][0] * MIN) + ' (' + p.length + ' próbek co minutę, 7 dni).' : '';
  }

  /* ---------------- [6] OKNO WYKRESU ---------------- */
  function otworz() {
    if (otwarte) return;
    const ob = ostatnie ? ostatnie.ob : 0, el = document.createElement('div'); el.className = 'wt-tlo'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Wykres temperatury wody');
    el.innerHTML = '<div class="wt-karta"><div class="wt-glowa"><div><div class="wt-brew">Temperatura wody · obieg ' + (ob + 1) + '</div>' +
      '<div class="wt-war"><span class="wt-liczba">— —</span><span class="wt-jedn">°C</span></div><div class="wt-opis"></div></div>' +
      '<div class="wt-prawa"><span class="wt-trend" hidden><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><b></b></span><div class="wt-prog"></div></div></div>' +
      '<div class="wt-pasek"><div class="wt-zakresy" role="group" aria-label="Zakres"><span class="wt-suwak"></span><button type="button" data-z="1h">1 h</button><button type="button" data-z="24h">24 h</button><button type="button" data-z="7d">7 dni</button></div>' +
      '<button type="button" class="wt-zamknij">Zamknij</button></div>' +
      '<div class="wt-wykres"><canvas></canvas><canvas aria-hidden="true"></canvas><div class="wt-pusto" hidden></div><div class="wt-dymek"></div></div>' +
      '<div class="wt-leg"><span><i style="background:linear-gradient(180deg,rgba(30,111,217,.9),rgba(18,162,181,.25))"></i>temperatura</span><span><i style="height:0;border-top:2px dashed #5d6470;border-radius:0"></i>zadana</span>' +
      '<span><i style="background:rgba(224,112,31,.22);border-bottom:3px solid #e0701f"></i>grzanie</span><span><i style="background:repeating-linear-gradient(135deg,#8a929d 0 1.5px,transparent 1.5px 5px);opacity:.6"></i>pompa stoi</span></div>' +
      '<div class="wt-stat"><div><span>minimum</span><b class="wt-s-min">–</b></div><div><span>maksimum</span><b class="wt-s-max">–</b></div><div><span>średnia</span><b class="wt-s-sr">–</b></div><div><span>grzanie łącznie</span><b class="wt-s-grz" style="color:#e0701f">–</b></div></div>' +
      '<div class="wt-stopka"></div></div>';
    document.body.appendChild(el);
    [cv, ov] = el.querySelectorAll('canvas'); cx = cv.getContext('2d'); ox = ov.getContext('2d');
    otwarte = { el, ob };
    const zamknij = () => { if (!otwarte) return; el.classList.remove('widac'); otwarte = null; kursor = null; setTimeout(() => el.remove(), 260); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') zamknij(); };
    el.addEventListener('click', (e) => { if (e.target === el) zamknij(); });
    el.querySelector('.wt-zamknij').addEventListener('click', zamknij); document.addEventListener('keydown', esc);
    const przyc = [...el.querySelectorAll('.wt-zakresy button')], suw = el.querySelector('.wt-suwak');
    const ustaw = () => { const b = przyc.find(x => x.dataset.z === zakres); suw.style.width = b.offsetWidth + 'px'; suw.style.transform = 'translateX(' + (b.offsetLeft - 3) + 'px)'; przyc.forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
    przyc.forEach(b => b.addEventListener('click', () => { if (b.dataset.z === zakres) return; zakres = b.dataset.z; try { localStorage.setItem(PREF + 'zakres', zakres); } catch (e) {}
      ustaw(); widok = zbuduj(zakres); rysuj(true); }));
    const pw = el.querySelector('.wt-wykres');
    const ruch = (e) => { const r = pw.getBoundingClientRect(), x = e.clientX - r.left; kursor = (x >= pole.l && x <= pole.r && widok && widok.surowe.length) ? x : null; };
    pw.addEventListener('pointermove', ruch); pw.addEventListener('pointerdown', ruch); pw.addEventListener('pointerleave', () => { kursor = null; });
    new ResizeObserver(() => { if (!otwarte) return; wymiary(); widok = zbuduj(zakres); rysuj(false); ustaw(); }).observe(pw);
    requestAnimationFrame(() => { el.classList.add('widac'); wymiary(); ustaw(); widok = zbuduj(zakres); rysuj(false); requestAnimationFrame(nakladka); });
  }
})();
