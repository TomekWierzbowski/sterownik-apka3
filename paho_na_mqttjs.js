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
   ============================================================================================ */
(function () {
  'use strict';
  if (!window.mqtt || !window.mqtt.connect) { console.error('paho_na_mqttjs: brak mqtt.min.js'); return; }
  var V5_NA_V3 = { 0x84: 1, 0x85: 2, 0x88: 3, 0x89: 3, 0x86: 4, 0x87: 5, 0x8C: 5 };
  var hex = function (n) { return '0x' + (+n).toString(16).toUpperCase(); };
  var utf8 = new TextDecoder('utf-8');
  var enc = new TextEncoder();

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
  var quicZapamietaj = function (host, powod) {
    try { sessionStorage.setItem('aqr_quic_zawodzi:' + host, String(Date.now())); } catch (e) {}
    console.warn('QUIC do ' + host + ' zawiodl (' + (powod || '?') + ') - wss przez ' + QUIC_PRZERWA_MIN + ' min');
  };

  /* WebTransport UDAJĄCY WebSocket — MQTT.js w przeglądarce przyjmuje własny obiekt przez opcję `createWebsocket`
     i używa z niego tylko: readyState/OPEN, zdarzeń open/message/close/error, send(), close(), bufferedAmount.
     Jedna sesja WebTransport = jeden strumień dwukierunkowy = jedno połączenie MQTT (jak strumień w bramce). */
  class WTjakoWS extends EventTarget {
    constructor(url) {
      super();
      this.url = url; this.readyState = 0; this.binaryType = 'arraybuffer'; this.bufferedAmount = 0; this.protocol = 'mqtt';
      this.onopen = this.onclose = this.onerror = this.onmessage = null;
      try { this._wt = new WebTransport(url.replace(/^wss?:/, 'https:')); }
      catch (e) { setTimeout(() => this._blad(e), 0); return; }
      this._wt.ready.then(() => this._wt.createBidirectionalStream()).then(s => {
        if (this.readyState !== 0) return;
        this._pisz = s.writable.getWriter(); this.readyState = 1;
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
    close() { if (this.readyState >= 2) return; this.readyState = 2; try { this._wt.close(); } catch (e) {} this._koniec(); }
    _blad(e) {
      if (this.readyState === 3) return;
      const ev = new Event('error'); ev.message = String((e && e.message) || e); this._zdarz('error', ev); this._koniec();
    }
    _koniec() { if (this.readyState === 3) return; this.readyState = 3; this._zdarz('close', new CloseEvent('close', { code: 1006 })); }
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
    this.onConnectionLost = null; this.onMessageArrived = null; this.onConnected = null;
  }
  Client.prototype.isConnected = function () { return !!this._polaczony; };

  Client.prototype.connect = function (o) {
    o = o || {};
    if (this._polaczony) throw new Error('AMQJS0011E Invalid state already connected.');
    var ja = this, wss = this._uri || ((o.useSSL ? 'wss://' : 'ws://') + this._host + ':' + this._port + this._path);
    /* [D-500 Q2] QUIC NAJPIERW, wss JAKO ZAPAS — tylko dla serwera z mapy QUIC_DROGI i przeglądarki z WebTransport.
       Porażka QUIC (UDP zablokowane, bramka nie działa, stary telefon) = od razu wss, niewidocznie dla apki,
       i przez QUIC_PRZERWA_MIN nie próbujemy QUIC na tym serwerze (inaczej każde ponowne łączenie czekałoby na
       nieudaną próbę). ⚠ Odmowa LOGOWANIA (kod 6) NIE przechodzi na wss: broker już odpowiedział przez QUIC,
       złe hasło zostaje złym hasłem — apka ma dostać tę odmowę, a nie drugą taką samą po wss. */
    var q = (!this._uri && o.useSSL) ? QUIC_DROGI[this._host + ':' + this._port] : null;
    if (q && window.WebTransport && !quicZawodzi(this._host)) {
      var oq = {}; for (var x in o) oq[x] = o[x];
      oq.timeout = Math.min(o.timeout || 30, QUIC_LIMIT_S);
      oq.onFailure = function (r) {
        if (r && r.errorCode === 6) { if (o.onFailure) o.onFailure(r); return; }
        quicZapamietaj(ja._host, r && r.errorMessage);
        ja._polacz(o, wss, null);
      };
      this._polacz(oq, 'wss://' + this._host + ':' + q + this._path, function (u) { return new WTjakoWS(u); });
      return;
    }
    this._polacz(o, wss, null);
  };

  /* Jedno podejście do połączenia jedną drogą (wss albo WebTransport). `budowniczy` = null -> zwykły WebSocket. */
  Client.prototype._polacz = function (o, uri, budowniczy) {
    var ja = this;
    var zamkniety = false, udane = false, bladGniazda = null, bladKeepalive = false, powodV5 = null;
    var droga = budowniczy ? uri.replace(/^wss?:/, 'webtransport:') : uri;   /* do dziennika łącza apki: widać, którą drogą */
    var zakoncz = function () { if (zamkniety) return; zamkniety = true; try { k.end(true); } catch (e) {} };
    var porazka = function (kod, txt) { clearTimeout(zegar); zakoncz(); if (o.onFailure) o.onFailure({ errorCode: kod, errorMessage: txt, invocationContext: o.invocationContext }); };
    var k = mqtt.connect(uri, {
      protocolVersion: 5, clientId: this.clientId, username: o.userName, password: o.password,
      keepalive: o.keepAliveInterval != null ? o.keepAliveInterval : 60, clean: o.cleanSession !== false,
      /* ⚠ connectTimeout 0 w MQTT.js NIE wyłącza limitu - ustawia ZEROWY (zmierzone 26.09: natychmiastowe
         „connack timeout"). Limit = `timeout` z opcji Paho; nasz zegar niżej jest zapasem o sekundę dłuższym. */
      reconnectPeriod: 0, connectTimeout: (o.timeout || 30) * 1000, resubscribe: false,
      createWebsocket: budowniczy || undefined,
    });
    this._k = k;
    var zegar = setTimeout(function () { if (!udane && !zamkniety) porazka(1, 'AMQJS0001E Connect timed out.'); }, (o.timeout || 30) * 1000 + 1000);
    k.on('connect', function () {
      if (zamkniety || ja._k !== k) return;
      clearTimeout(zegar); udane = true; ja._polaczony = true;
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
      ja._polaczony = false; zamkniety = true; try { k.end(true); } catch (e) {}
      var r = bladKeepalive ? { errorCode: 4, errorMessage: 'AMQJS0004E Ping timed out.' }
            : bladGniazda ? { errorCode: 7, errorMessage: 'AMQJS0007E Socket error:' + (bladGniazda.message || bladGniazda) + '.' }
            : { errorCode: 8, errorMessage: 'AMQJS0008I Socket closed.' + (powodV5 ? ' (MQTT 5 DISCONNECT ' + hex(powodV5) + ')' : '') };
      if (ja.onConnectionLost) ja.onConnectionLost(r);
    });
  };

  Client.prototype.disconnect = function () {
    if (!this._polaczony) throw new Error('AMQJS0011E Invalid state not connected.');
    var k = this._k; this._polaczony = false; this._k = null;
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
    this._k.publish(m.destinationName, m._tekst != null ? m._tekst : m._bajty, { qos: m.qos || 0, retain: !!m.retained });
  };
  Client.prototype.publish = Client.prototype.send;

  window.Paho = { Client: Client, Message: Message, MQTT: { Client: Client, Message: Message } };
  window.Paho.MQTT_WERSJA = 5;   /* apka3 może pokazać, którą drogą idzie */
})();
