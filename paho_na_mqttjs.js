/* ============================================================================================
   paho_na_mqttjs.js — API Paho (tyle, ile używa apka) NA BIBLIOTECE MQTT.js W WERSJI 5.0
   [D-498, apka3 = TEST3 · MQTT 5, 26.09.2026]
   --------------------------------------------------------------------------------------------
   PO CO: Paho w przeglądarce zna tylko MQTT 3.1/3.1.1. Zamiast przepisywać apkę (most_js.js,
   index.html — kilkadziesiąt miejsc z logiką ponawiania, zakresu kont i komunikatów), podmieniamy
   SAMĄ BIBLIOTEKĘ: z zewnątrz ten plik udaje Paho, w środku łączy się MQTT.js protokołem 5.0.
   Dzięki temu apka3 różni się od apki2 wyłącznie drogą, a nie logiką — różnicę w pomiarze można
   przypisać protokołowi (granica pomiaru, zasada 3).

   WEJŚCIA:  globalny `mqtt` z mqtt.min.js (MQTT.js 5.16.0, ładowany WCZEŚNIEJ).
   CO Z CZEGO WYNIKA — wiernie jak Paho, bo apka na tym polega:
     • odmowa CONNACK → onFailure({errorCode: 6, errorMessage: "AMQJS0006E Bad Connack return code:N ..."}),
       gdzie N to kod w stylu 3.1.1 (apka i ekran logowania rozpoznają po nim złe hasło: 4/5).
       Kody przyczyn MQTT 5 → 3.1.1:  0x84→1 (wersja), 0x85→2 (identyfikator), 0x88/0x89→3 (niedostępny),
       0x86→4 (zły login/hasło), 0x87/0x8C→5 (brak uprawnień); oryginał zostaje w treści („MQTT 5: 0x86").
     • brak CONNACK w `timeout` s → onFailure({errorCode: 1, "AMQJS0001E Connect timed out."})
     • błąd gniazda przed połączeniem → onFailure({errorCode: 7, "AMQJS0007E Socket error:..."})
     • zerwanie po połączeniu → onConnectionLost: 7 „Socket error" (błąd), 4 „Ping timed out" (keepalive),
       8 „AMQJS0008I Socket closed." (zwykłe zamknięcie, także DISCONNECT od brokera — powód v5 w treści)
     • disconnect() → onConnectionLost({errorCode: 0, "AMQJS0000I OK."}) — Paho robi to samo, a apka
       ma na to osłonę [D-483]
     • connect() gdy połączony / send() i subscribe() gdy nie → wyjątek "AMQJS0011E Invalid state ..."
     • subscribe(t, {qos, onSuccess, onFailure}): SUBACK z kodem ≥ 0x80 (w v5 np. 0x87 „brak uprawnień")
       = onFailure — na tym apka liczy zakres konta [D-484]
     • onSuccess PRZED onConnected(false, uri), jak w Paho
   WYJŚCIA:  window.Paho = { Client, Message, MQTT: { Client, Message } }.
   ⚠ Ponawianie: `reconnectPeriod: 0` — ponawia APKA (D-310), dokładnie jak przy Paho `reconnect:false`.
   ⚠ Właściwości MQTT 5 (wygaśnięcie sesji, aliasy tematów) celowo jeszcze NIE — najpierw pomiar
     „to samo co apka2, tylko po v5" (skill loxone-mqtt5 §2a, D-498).
   ⛔ JEDEN WŁAŚCICIEL POŁĄCZENIA [Astra 11, 29.09.2026]: próba = numer generacji (`_gen`) + jeden termin całej
     operacji (QUIC i wss razem, `timeout` z opcji). Nowe connect() / disconnect() w trakcie próby WYCOFUJE starą:
     jej klient MQTT.js jest zamykany, a jej zdarzenia i zegary nie wołają już niczego. Spóźnione „connect" starej
     próby (np. QUIC doszedł po przejściu na wss) zamyka ją od razu — dawniej zostawała żywa z tym samym clientId,
     broker przejmował sesję i wyrzucał dobrą (A→B→sukces B→późne A). wss po nieudanym QUIC dostaje RESZTĘ terminu,
     nie pełny limit od nowa (dawniej do 4+1+10+1 s, a formularz liczył 10). Sesja WebTransport zamyka się przy
     końcu strumienia, błędzie i close() - raz; strumień otwarty po anulowaniu jest od razu porzucany.
   ⛔ AUDYT WT/QUIC [02.10.2026, uwagi Astry; pełny opis: docs/36 §11] — trzy poprawki z mechanizmu potwierdzonego
     W KODZIE Chromium (content/browser/webtransport/web_transport_throttle_context.cc, web_transport_connector_impl.cc):
     • każde NIEUDANE uzgodnienie WebTransport liczy się w przeglądarce jako „oczekujące” przez 5 MIN, a start kolejnego
       czeka 10 ms × 2^(oczekujących−1) × los(0,5–1,5) (do 60 s); przy 64 oczekujących nowa próba pada OD RĘKI, bez
       jednego pakietu UDP („Opening handshake failed”);
     • close() strony NIE wycofuje próby z kolejki przeglądarki (OnThrottleDone rusza mimo to; TODO w kodzie Chromium) —
       porzucona próba żyje dalej jako „zombie” i dokłada się do kolejki;
     ⇒ (1) próba WebTransport przerwana przez nowe connect()/disconnect() = porażka QUIC (następna idzie wss, bez
       drugiego zombie); (2) zmiana sieci daje QUIC drugą szansę NAJWYŻEJ raz na QUIC_PRZERWA_MIN (wcześniej każde
       `online`/zmiana łącza kasowały pamięć porażki — przy migającym zasięgu każde ponowienie szło znowu w WebTransport);
       (3) strażnik PUBACK otwartej sesji WebTransport (WT_PUBACK_LIMIT_S) — sesja, która formalnie żyje, a nie
       potwierdza publikacji, jest zamykana i apka przechodzi na wss (wcześniej czekała na keepalive 30–45 s albo
       strażnika ciszy 75 s). Komendy NIE są ponawiane (nowy klient MQTT.js ich nie zna; apka mówi „nie potwierdził w 5 s").
     + diagnostyka: liczniki zawsze, dziennik zdarzeń prób z flagą `localStorage aqr_diag_wt=1` (Paho._diagWT()).
   ============================================================================================ */
(function () {
  'use strict';
  if (!window.mqtt || !window.mqtt.connect) { console.error('paho_na_mqttjs: brak mqtt.min.js'); return; }
  var V5_NA_V3 = { 0x84: 1, 0x85: 2, 0x88: 3, 0x89: 3, 0x86: 4, 0x87: 5, 0x8C: 5 };
  var hex = function (n) { return '0x' + (+n).toString(16).toUpperCase(); };
  var utf8 = new TextDecoder('utf-8');
  var SEK = window.APKA_SEKUNDA_MS || 1000;   /* [Astra 11] test offline skraca sekundę (_test_polaczenie11.html) */
  var WSS_MIN_MS = SEK;                       /* mniej niż tyle z terminu po porażce QUIC = od razu „timed out" */
  var enc = new TextEncoder();

  /* DIAGNOSTYKA PRÓB [audyt WT/QUIC 02.10] — liczniki zawsze (kilka liczb), dziennik zdarzeń tylko z flagą, żeby nie
     zalewać pamięci telefonu. Zdarzenie: {gen (numer próby adaptera), etap, m (zegar monotoniczny strony, ms), t (czas
     ścienny do korelacji z bramką/routerem), szcz}. Bez treści wiadomości, haseł i PIN-ów — tylko końcówka tematu. */
  var DIAG = { proby: 0, wt_utworzone: 0, wt_aktywne: 0, wt_ready: 0, wt_odrzucone: 0, wt_zamkniete: 0,
               wt_porzucone: 0, wss_starty: 0, fallback: {}, puback_oczekuje: 0, puback_zastoj: 0,
               wybaczenia: 0, wybaczenia_wstrzymane: 0 };
  var DZ = [], DZ_MAX = 400;
  var diagWlaczona = function () {
    if (window.APKA_DIAG_WT) return true;
    try { return localStorage.getItem('aqr_diag_wt') === '1'; } catch (e) { return false; }
  };
  var zdarzenie = function (gen, etap, szcz) {
    if (!diagWlaczona()) return;
    DZ.push({ gen: gen, etap: etap, m: Math.round(performance.now()), t: Date.now(), szcz: szcz || '' });
    if (DZ.length > DZ_MAX) DZ.shift();
  };

  /* ------------------------------------------------------------------------------------------
     QUIC PRZEZ WebTransport [D-500 Q2]
     QUIC_DROGI: serwer wss (host:port z ekranu logowania) -> port UDP bramki QUIC (dodatek aquareact_quic).
     Tylko NASZ broker [Tomasz: „nieważne, czy zewnętrzne brokery to mają — ważne, żeby nasz to miał"].
     ------------------------------------------------------------------------------------------ */
  var QUIC_DROGI = window.APKA_QUIC || { 'aquareact.duckdns.org:8889': 8890 };
  var QUIC_LIMIT_S = 4;            /* tyle czekamy na CONNACK przez QUIC, potem wss */
  var QUIC_PRZERWA_MIN = 10;       /* po porażce QUIC tyle minut prosto wss */
  var quicZawodzi = function (host) {
    try { var t = +sessionStorage.getItem('aqr_quic_zawodzi:' + host); return t && (Date.now() - t) < QUIC_PRZERWA_MIN * 60000; }
    catch (e) { return false; }
  };
  /* [audyt WT 02.10] Strażnik PUBACK otwartej sesji WebTransport. 5 s = termin wyniku komendy w apce (most_js.js:
     „sterownik nie potwierdził komendy w 5 s”) — po nim człowiek i tak dostał porażkę; dłuższe czekanie na sesję,
     która nie potwierdza, niczego nie ratuje. TLS: PUBACK p95 0,23 s (pomiar 01.10, docs/36 §9). Tylko WebTransport —
     droga wss bez zmian. */
  var WT_PUBACK_LIMIT_S = 5;
  var quicZapamietaj = function (host, powod) {
    try { sessionStorage.setItem('aqr_quic_zawodzi:' + host, String(Date.now())); } catch (e) {}
    var kl = String(powod || '?').replace(/[0-9.]+/g, 'N').slice(0, 60);
    DIAG.fallback[kl] = (DIAG.fallback[kl] || 0) + 1;
    console.warn('QUIC do ' + host + ' zawiodl (' + (powod || '?') + ') - wss przez ' + QUIC_PRZERWA_MIN + ' min');
  };
  /* ZMIANA SIECI KASUJE PAMIĘĆ PORAŻKI [26.09, próba Tomasza WireGuard -> LTE]: sesja QUIC urwała się w trakcie
     przełączania sieci, ponowna próba padła (sieci jeszcze nie było) i apka szła 10 min po wss, choć na LTE UDP
     przechodziło bez problemu. Porażka dotyczy SIECI, w której wystąpiła - nowa sieć = nowa próba. Zdarzenia:
     `online` (każda przeglądarka) i `navigator.connection.change` (Chrome/Android: WiFi<->komórka). Na sieci
     z zablokowanym UDP bez zmiany sieci ochrona 10 min zostaje - tam każda próba to 4 s straty. */
  /* ⛔ [audyt WT 02.10] NAJWYŻEJ JEDNO WYBACZENIE NA QUIC_PRZERWA_MIN. Przy migającym zasięgu `online` i zmiana łącza
     przychodzą co kilka sekund — każde kasowało pamięć porażki, więc KAŻDE ponowienie szło znowu w WebTransport,
     a każda nieudana próba przeglądarka trzyma 5 min jako „oczekującą” i wykładniczo opóźnia następne (nagłówek).
     Teraz: pierwsza zmiana sieci po porażce = nowa szansa (zachowany sens zmiany z 26.09: WireGuard -> LTE); kolejna
     porażka w tym samym oknie trzyma wss do końca okna, mimo dalszych zmian sieci. */
  var quicZapomnij = function (skad) {
    try {
      var klucze = [];
      for (var i = sessionStorage.length - 1; i >= 0; i--) {
        var k = sessionStorage.key(i);
        if (k && k.indexOf('aqr_quic_zawodzi:') === 0) klucze.push(k);
      }
      if (!klucze.length) return;
      var ost = +sessionStorage.getItem('aqr_quic_wybaczono') || 0;
      if (ost && (Date.now() - ost) < QUIC_PRZERWA_MIN * 60000) {
        DIAG.wybaczenia_wstrzymane++; zdarzenie(0, 'WYBACZENIE_WSTRZYMANE', skad);
        console.info('zmiana sieci (' + skad + ') - QUIC nadal wstrzymany: druga porazka w ' + QUIC_PRZERWA_MIN + ' min po poprzedniej zmianie sieci');
        return;
      }
      klucze.forEach(function (kk) { sessionStorage.removeItem(kk); });
      sessionStorage.setItem('aqr_quic_wybaczono', String(Date.now()));
      DIAG.wybaczenia++; zdarzenie(0, 'WYBACZENIE', skad);
      console.info('zmiana sieci (' + skad + ') - QUIC znow dozwolony (jedna szansa na ' + QUIC_PRZERWA_MIN + ' min)');
    } catch (e) {}
  };
  window.addEventListener('online', function () { quicZapomnij('online'); });
  try { if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', function () { quicZapomnij('typ lacza'); }); } catch (e) {}

  /* WebTransport UDAJĄCY WebSocket — MQTT.js w przeglądarce przyjmuje własny obiekt przez opcję `createWebsocket`
     i używa z niego tylko: readyState/OPEN, zdarzeń open/message/close/error, send(), close(), bufferedAmount.
     Jedna sesja WebTransport = jeden strumień dwukierunkowy = jedno połączenie MQTT (jak strumień w bramce). */
  class WTjakoWS extends EventTarget {
    constructor(url) {
      super();
      this.url = url; this.readyState = 0; this.binaryType = 'arraybuffer'; this.bufferedAmount = 0; this.protocol = 'mqtt';
      this.onopen = this.onclose = this.onerror = this.onmessage = null;
      this._gen = WTjakoWS.gen || 0;          /* numer próby adaptera (do dziennika diagnostycznego) */
      DIAG.wt_utworzone++; DIAG.wt_aktywne++; this._aktywny = true; zdarzenie(this._gen, 'WT_CREATE', url);
      try { this._wt = new WebTransport(url.replace(/^wss?:/, 'https:')); }
      catch (e) { setTimeout(() => this._blad(e), 0); return; }
      /* [Astra 11] anulowane przed ready: strumienia nie otwieramy; otwarty mimo to (wyścig) - porzucamy od razu */
      this._wt.ready.then(() => {
        DIAG.wt_ready++; zdarzenie(this._gen, 'WT_READY', this.readyState === 0 ? '' : 'po anulowaniu');
        return this.readyState === 0 ? this._wt.createBidirectionalStream() : null;
      }).then(s => {
        if (!s) return;
        if (this.readyState !== 0) { try { s.writable.abort(); } catch (e) {} try { s.readable.cancel(); } catch (e) {} return; }
        this._pisz = s.writable.getWriter(); this.readyState = 1;
        zdarzenie(this._gen, 'STREAM_OPEN', '');
        this._zdarz('open', new Event('open')); this._czytaj(s.readable.getReader());
      }).catch(e => this._blad(e));
      this._wt.closed.then(() => this._koniec(), e => this._blad(e));
    }
    async _czytaj(r) {
      try {
        for (;;) {
          const { value, done } = await r.read();
          if (done) break;
          this._zdarz('message', new MessageEvent('message', { data: value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) }));
        }
      } catch (e) { /* strumień zamknięty - niżej koniec */ }
      this._koniec();
    }
    send(d) {
      if (this.readyState !== 1) return;
      const u = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : enc.encode(String(d));
      this.bufferedAmount += u.byteLength;
      this._pisz.write(u).then(() => { this.bufferedAmount -= u.byteLength; }, e => this._blad(e));
    }
    close() { if (this.readyState >= 2) return; zdarzenie(this._gen, 'WT_CLOSE_REQUESTED', this.readyState === 0 ? 'przed ready' : ''); this.readyState = 2; this._koniec(); }
    _blad(e) {
      if (this.readyState === 3) return;
      if (this.readyState === 0) { DIAG.wt_odrzucone++; zdarzenie(this._gen, 'WT_READY_REJECT', String((e && e.message) || e)); }
      const ev = new Event('error'); ev.message = String((e && e.message) || e); this._zdarz('error', ev); this._koniec();
    }
    /* [Astra 11] KONIEC = zamknięcie CAŁEJ sesji WebTransport (dawniej EOF strumienia zostawiał sesję otwartą) - raz */
    _koniec() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this._aktywny) { this._aktywny = false; DIAG.wt_aktywne--; DIAG.wt_zamkniete++; zdarzenie(this._gen, 'WT_CLOSED', ''); }
      if (this._wt && !this._wtZamkniete) { this._wtZamkniete = true; try { this._wt.close(); } catch (e) {} }
      this._zdarz('close', new CloseEvent('close', { code: 1006 }));
    }
    _zdarz(t, ev) { this.dispatchEvent(ev); const h = this['on' + t]; if (typeof h === 'function') h.call(this, ev); }
  }
  WTjakoWS.CONNECTING = 0; WTjakoWS.OPEN = 1; WTjakoWS.CLOSING = 2; WTjakoWS.CLOSED = 3;
  WTjakoWS.prototype.CONNECTING = 0; WTjakoWS.prototype.OPEN = 1; WTjakoWS.prototype.CLOSING = 2; WTjakoWS.prototype.CLOSED = 3;

  function Message(dane) {
    if (!(this instanceof Message)) return new Message(dane);
    this._tekst = (typeof dane === 'string') ? dane : null;   /* tekst publikujemy jako tekst */
    this._bajty = (typeof dane === 'string') ? enc.encode(dane) : new Uint8Array(dane || []);
    this.destinationName = undefined; this.qos = 0; this.retained = false; this.duplicate = false;
  }
  Object.defineProperty(Message.prototype, 'payloadString', { get: function () { return utf8.decode(this._bajty); } });
  Object.defineProperty(Message.prototype, 'payloadBytes', { get: function () { return this._bajty; } });

  /* new Client(host, port, path, clientId) albo new Client(uri, clientId) — apka używa pierwszej postaci */
  function Client(host, port, path, clientId) {
    if (!(this instanceof Client)) return new Client(host, port, path, clientId);
    if (typeof port === 'string' && clientId === undefined && path === undefined) { this._uri = host; this.clientId = port; }
    else { this._host = host; this._port = port; this._path = path || '/mqtt'; this.clientId = clientId; }
    this._k = null; this._polaczony = false;
    this._gen = 0; this._proba = null;   /* [Astra 11] generacja i bieżąca próba (null = brak próby w toku) */
    this.onConnectionLost = null; this.onMessageArrived = null; this.onConnected = null;
  }
  /* [Astra 11] Wycofaj próbę w toku BEZ wywołań zwrotnych: zegar stop, klient MQTT.js zamknięty, zdarzenia martwe. */
  Client.prototype._wycofaj = function () {
    var p = this._proba; this._proba = null; this._gen++;
    if (!p) return;
    /* ⛔ [audyt WT 02.10] PORZUCONA PRÓBA WebTransport = PORAŻKA QUIC. close() strony nie wycofuje jej z kolejki
       przeglądarki (nagłówek) — dalej żyje jako „zombie”. Następna próba prosto wss, zamiast dokładać drugiego. */
    if (p.etap === 'wt') {
      DIAG.wt_porzucone++; zdarzenie(p.gen, 'WT_PORZUCONA', 'nowe connect()/disconnect() w trakcie proby WebTransport');
      quicZapamietaj(this._host, 'proba WebTransport przerwana przez nowe polaczenie');
    }
    p.martwa = true; clearTimeout(p.zegar);
    try { if (p.k) p.k.end(true); } catch (e) {}
    if (this._k === p.k) this._k = null;
  };
  Client.prototype.isConnected = function () { return !!this._polaczony; };

  Client.prototype.connect = function (o) {
    o = o || {};
    if (this._polaczony) throw new Error('AMQJS0011E Invalid state already connected.');
    this._wycofaj();                     /* [Astra 11] poprzednia próba w toku - wycofana, nie równoległa */
    var ja = this, wss = this._uri || ((o.useSSL ? 'wss://' : 'ws://') + this._host + ':' + this._port + this._path);
    var p = { gen: this._gen, martwa: false, k: null, zegar: null, koniec: Date.now() + (o.timeout || 30) * SEK, etap: null };
    this._proba = p;
    DIAG.proby++;
    var pozostalo = function () { return p.koniec - Date.now(); };
    /* koniec CAŁEJ operacji porażką - jedno onFailure, dopiero gdy nie ma już drogi w terminie */
    var porazkaOperacji = function (r) {
      if (p.martwa) return;
      p.martwa = true; clearTimeout(p.zegar);
      if (ja._proba === p) ja._proba = null;
      if (o.onFailure) o.onFailure(r);
    };
    /* [D-500 Q2] QUIC NAJPIERW, wss JAKO ZAPAS — tylko dla serwera z mapy QUIC_DROGI i przeglądarki z WebTransport.
       Porażka QUIC (UDP zablokowane, bramka nie działa, stary telefon) = od razu wss, niewidocznie dla apki,
       i przez QUIC_PRZERWA_MIN nie próbujemy QUIC na tym serwerze (inaczej każde ponowne łączenie czekałoby na
       nieudaną próbę). ⚠ Odmowa LOGOWANIA (kod 6) NIE przechodzi na wss: broker już odpowiedział przez QUIC,
       złe hasło zostaje złym hasłem — apka ma dostać tę odmowę, a nie drugą taką samą po wss. */
    var q = (!this._uri && o.useSSL) ? QUIC_DROGI[this._host + ':' + this._port] : null;
    if (q && window.WebTransport && !quicZawodzi(this._host)) {
      p.etap = 'wt';
      this._polacz(p, o, 'wss://' + this._host + ':' + q + this._path, function (u) { WTjakoWS.gen = p.gen; return new WTjakoWS(u); },
                   Math.min(QUIC_LIMIT_S * SEK, pozostalo()), function (r) {
        if (r && r.errorCode === 6) { porazkaOperacji(r); return; }
        zdarzenie(p.gen, 'FALLBACK_REASON', r && r.errorMessage);
        quicZapamietaj(ja._host, r && r.errorMessage);
        var zost = pozostalo();                   /* [Astra 11] wss dostaje RESZTĘ terminu, nie pełny limit od nowa */
        if (zost < WSS_MIN_MS) { p.etap = null; porazkaOperacji({ errorCode: 1, errorMessage: 'AMQJS0001E Connect timed out.', invocationContext: o.invocationContext }); return; }
        p.etap = 'wss'; DIAG.wss_starty++; zdarzenie(p.gen, 'WSS_START', 'po porazce QUIC, zostalo ' + Math.round(zost) + ' ms');
        ja._polacz(p, o, wss, null, zost, porazkaOperacji);
      });
      return;
    }
    p.etap = 'wss'; DIAG.wss_starty++; zdarzenie(p.gen, 'WSS_START', q ? (quicZawodzi(this._host) ? 'QUIC wstrzymany po porazce' : 'przegladarka bez WebTransport') : '');
    this._polacz(p, o, wss, null, pozostalo(), porazkaOperacji);
  };

  /* Jedno podejście do połączenia jedną drogą (wss albo WebTransport) w ramach próby `p`. `budowniczy` = null ->
     zwykły WebSocket; `limitMs` = ile z terminu próby ma ta droga; `naPorazke` = co dalej (zapas albo koniec). */
  Client.prototype._polacz = function (p, o, uri, budowniczy, limitMs, naPorazke) {
    var ja = this;
    if (p.martwa) return;
    var zamkniety = false, udane = false, bladGniazda = null, bladKeepalive = false, powodV5 = null;
    var droga = budowniczy ? uri.replace(/^wss?:/, 'webtransport:') : uri;   /* do dziennika łącza apki: widać, którą drogą */
    /* [Astra 11] czy ten klient to wciąż BIEŻĄCA droga bieżącej generacji (inaczej: wycofany, spóźniony) */
    var biezacy = function () { return !p.martwa && p.gen === ja._gen && ja._k === k; };
    var zakoncz = function () { if (zamkniety) return; zamkniety = true; try { k.end(true); } catch (e) {} };
    var porazka = function (kod, txt) { clearTimeout(zegar); zakoncz(); if (!biezacy()) return; naPorazke({ errorCode: kod, errorMessage: txt, invocationContext: o.invocationContext }); };
    var k = mqtt.connect(uri, {
      protocolVersion: 5, clientId: this.clientId, username: o.userName, password: o.password,
      keepalive: o.keepAliveInterval != null ? o.keepAliveInterval : 60, clean: o.cleanSession !== false,
      /* ⚠ connectTimeout 0 w MQTT.js NIE wyłącza limitu - ustawia ZEROWY (zmierzone 26.09: natychmiastowe
         „connack timeout"). Limit = reszta terminu próby; nasz zegar niżej jest zapasem o 1/4 s dłuższym. */
      reconnectPeriod: 0, connectTimeout: Math.max(1, Math.round(limitMs)), resubscribe: false,
      createWebsocket: budowniczy || undefined,
    });
    p.k = k; this._k = k;
    var zegar = setTimeout(function () { if (!udane && !zamkniety) porazka(1, 'AMQJS0001E Connect timed out.'); }, limitMs + SEK / 4);
    p.zegar = zegar;
    k.on('connect', function () {
      if (zamkniety || !biezacy()) { zamkniety = true; try { k.end(true); } catch (e) {} return; }   /* [Astra 11] spóźniona: zamknij */
      clearTimeout(zegar); udane = true; ja._polaczony = true;
      p.martwa = true; p.etap = null; if (ja._proba === p) ja._proba = null;   /* próba zakończona sukcesem - połączenie trzyma `_k` */
      zdarzenie(p.gen, 'MQTT_CONNACK', droga);
      ja._genPol = p.gen;
      /* [audyt WT 02.10] STRAŻNIK PUBACK — tylko droga WebTransport (nagłówek, WT_PUBACK_LIMIT_S) */
      clearInterval(ja._straz); ja._pub = null;
      if (budowniczy) {
        ja._pub = {}; ja._pubNr = 0;
        var straz = ja._straz = setInterval(function () {
          if (ja._k !== k || !ja._polaczony) { clearInterval(straz); return; }
          var teraz = Date.now(), najst = null;
          for (var n in ja._pub) { if (najst === null || ja._pub[n] < najst) najst = ja._pub[n]; }
          if (najst === null || teraz - najst < WT_PUBACK_LIMIT_S * SEK) return;
          clearInterval(straz); DIAG.puback_zastoj++;
          zdarzenie(p.gen, 'WT_ZASTOJ', 'brak PUBACK ' + ((teraz - najst) / SEK).toFixed(1) + ' s');
          quicZapamietaj(ja._host, 'sesja WebTransport otwarta, brak PUBACK ' + WT_PUBACK_LIMIT_S + ' s');
          bladGniazda = new Error('WebTransport: brak PUBACK ' + WT_PUBACK_LIMIT_S + ' s - sesja uznana za martwa');
          try { k.end(true); } catch (e) {}
        }, SEK);
      }
      if (o.onSuccess) o.onSuccess({ invocationContext: o.invocationContext });
      ja.droga = droga;
      if (ja.onConnected) ja.onConnected(false, droga);
    });
    k.on('message', function (temat, dane, pakiet) {
      if (ja._k !== k || !ja.onMessageArrived) return;
      var m = new Message(dane); m.destinationName = temat; m.qos = pakiet.qos; m.retained = !!pakiet.retain; m.duplicate = !!pakiet.dup;
      ja.onMessageArrived(m);
    });
    k.on('error', function (e) {
      if (ja._k !== k) return;
      if (!udane && e && typeof e.code === 'number' && e.code >= 0x80) {   /* odmowa CONNACK z kodem przyczyny v5 */
        porazka(6, 'AMQJS0006E Bad Connack return code:' + (V5_NA_V3[e.code] || 3) + ' ' + (e.message || '') + ' (MQTT 5: ' + hex(e.code) + ').');
        return;
      }
      if (!udane && /connack timeout/i.test(String(e && e.message))) { porazka(1, 'AMQJS0001E Connect timed out.'); return; }
      if (/keepalive/i.test(String(e && e.message))) bladKeepalive = true; else bladGniazda = e;
    });
    k.on('disconnect', function (p) { if (p && p.reasonCode) powodV5 = p.reasonCode; });   /* DISCONNECT od brokera (v5) */
    k.on('close', function () {
      if (ja._k !== k) return;
      if (!udane) { if (!zamkniety) porazka(7, 'AMQJS0007E Socket error:' + (bladGniazda ? (bladGniazda.message || bladGniazda) : 'polaczenie zamkniete przed CONNACK') + '.'); return; }
      if (!ja._polaczony) return;
      clearInterval(ja._straz); ja._pub = null;
      ja._polaczony = false; ja._k = null; zamkniety = true; try { k.end(true); } catch (e) {}
      var r = bladKeepalive ? { errorCode: 4, errorMessage: 'AMQJS0004E Ping timed out.' }
            : bladGniazda ? { errorCode: 7, errorMessage: 'AMQJS0007E Socket error:' + (bladGniazda.message || bladGniazda) + '.' }
            : { errorCode: 8, errorMessage: 'AMQJS0008I Socket closed.' + (powodV5 ? ' (MQTT 5 DISCONNECT ' + hex(powodV5) + ')' : '') };
      if (ja.onConnectionLost) ja.onConnectionLost(r);
    });
  };

  Client.prototype.disconnect = function () {
    if (!this._polaczony) {
      /* [Astra 11] anulowanie próby w toku: wycofana bez wywołań zwrotnych (zdecydowała apka), bez wyjątku */
      if (this._proba) { this._wycofaj(); return; }
      throw new Error('AMQJS0011E Invalid state not connected.');
    }
    var k = this._k; this._polaczony = false; this._k = null; this._gen++;
    clearInterval(this._straz); this._pub = null;
    try { k.end(false); } catch (e) {}
    if (this.onConnectionLost) this.onConnectionLost({ errorCode: 0, errorMessage: 'AMQJS0000I OK.' });
  };

  Client.prototype.subscribe = function (temat, o) {
    o = o || {};
    if (!this._polaczony) throw new Error('AMQJS0011E Invalid state not connected.');
    this._k.subscribe(temat, { qos: o.qos || 0 }, function (blad, dane) {
      var kod = dane && dane[0] ? dane[0].qos : 0x80;
      if (blad || kod >= 0x80) { if (o.onFailure) o.onFailure({ errorCode: 0, errorMessage: 'SUBACK ' + hex(kod) + (blad ? ' ' + blad.message : ''), invocationContext: o.invocationContext }); }
      else if (o.onSuccess) o.onSuccess({ grantedQos: [kod], invocationContext: o.invocationContext });
    });
  };

  Client.prototype.unsubscribe = function (temat, o) {
    o = o || {};
    if (!this._polaczony) throw new Error('AMQJS0011E Invalid state not connected.');
    this._k.unsubscribe(temat, function (blad) {
      if (blad) { if (o.onFailure) o.onFailure({ errorCode: 0, errorMessage: String(blad.message || blad) }); }
      else if (o.onSuccess) o.onSuccess({ invocationContext: o.invocationContext });
    });
  };

  Client.prototype.send = function (m, dane, qos, retained) {
    if (!this._polaczony) throw new Error('AMQJS0011E Invalid state not connected.');
    if (typeof m === 'string') { var x = new Message(dane); x.destinationName = m; x.qos = qos || 0; x.retained = !!retained; m = x; }
    var q = m.qos || 0, ja = this, dane = m._tekst != null ? m._tekst : m._bajty;
    if (q >= 1 && this._pub) {                /* [audyt WT 02.10] droga WebTransport: liczymy czas do PUBACK */
      var nr = ++this._pubNr, temat = String(m.destinationName).split('/').pop(), gen = this._genPol;
      this._pub[nr] = Date.now(); DIAG.puback_oczekuje++; zdarzenie(gen, 'COMMAND_SENT', temat + ' #' + nr);
      this._k.publish(m.destinationName, dane, { qos: q, retain: !!m.retained }, function (blad) {
        DIAG.puback_oczekuje--;
        if (ja._pub) delete ja._pub[nr];
        zdarzenie(gen, blad ? 'PUBACK_BRAK' : 'PUBACK_RECEIVED', temat + ' #' + nr + (blad ? ' ' + (blad.message || blad) : ''));
      });
      return;
    }
    this._k.publish(m.destinationName, dane, { qos: q, retain: !!m.retained });
  };
  Client.prototype.publish = Client.prototype.send;

  window.Paho = { Client: Client, Message: Message, MQTT: { Client: Client, Message: Message } };
  window.Paho._WTjakoWS = WTjakoWS;   /* [Astra 11] test offline (_test_polaczenie11.html) ORAZ strona pomiaru apka3/pomiar.html (karta 36: QUIC przez WebTransport) — NIE USUWAĆ; pilnują K2 w proba_pomiar36.cjs i zbuduj_pwa.py --apka3 */
  window.Paho.MQTT_WERSJA = 5;   /* apka3 może pokazać, którą drogą idzie */
  /* [audyt WT 02.10] liczniki + dziennik zdarzeń prób (dziennik tylko z flagą aqr_diag_wt=1); kopia, nie żywe obiekty */
  window.Paho._diagWT = function () {
    return { liczniki: JSON.parse(JSON.stringify(DIAG)), dziennik_wlaczony: diagWlaczona(), zdarzenia: DZ.slice(),
             wt_puback_limit_s: WT_PUBACK_LIMIT_S, quic_limit_s: QUIC_LIMIT_S, quic_przerwa_min: QUIC_PRZERWA_MIN };
  };
})();
