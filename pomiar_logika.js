/* ============================================================================================
   pomiar_logika.js — LOGIKA POMIARU QUIC KONTRA TLS NA TELEFONIE  [karta 36 Astry, 30.09.2026]
   --------------------------------------------------------------------------------------------
   PO CO: Tomasz 30.09: „Tylko telefon” — przed sobotą pomiar autem na trasie ze słabym zasięgiem, kilka
   przejazdów. Strona `pomiar.html` trzyma DWA połączenia naraz tym samym kontem (TLS = MQTT.js po wss 8889,
   QUIC = MQTT.js po WebTransport 8890 przez gateway) i co 2 s puszcza echo. Tu leży WSZYSTKO, co liczy:
   percentyle, zgubione, przerwy, ważność przejazdu, porównanie z kryteriami i werdykt serii. Strona tylko
   zbiera zdarzenia i rysuje — dzięki temu każdą liczbę da się sprawdzić offline w Node, bez telefonu
   i bez brokera (granica pomiaru, zasada 3). Test: narzedzia_hmi/proby_audyt/pwa/proba_pomiar36.cjs.

   SPIS TREŚCI
     [1] Nastawy pomiaru i KRYTERIA KORZYŚCI (ustalone PRZED pomiarem — jedyne źródło liczb)
     [2] Rozkład: percentyl (najbliższa ranga) i komplet p50/p95/p99/max
     [3] Czas między punktami (zegar monotoniczny w obrębie jednej strony)
     [4] Rytm ticków: który tick teraz, ile pominięto (strona w tle)
     [5] Zgubione: echo nieodebrane w limicie
     [6] Kolejność zdarzeń (zegar monotoniczny, nie ścienny) i przerwy: zerwania, suma przerw, powrót, zimny start,
         czas bez gotowości
     [7] Najdłuższa seria bez echa
     [8] Podsumowanie transportu i całego przejazdu
     [9] Ważność przejazdu, porównanie TLS/QUIC, werdykt serii
     [10] Opcje połączenia (te same dla obu dróg; QUIC bez zapasu wss)
     [10b] Ponawianie jak w aplikacji T3 (QUIC po porażce czeka; wybaczenie przy zmianie rodzaju łącza) [D-537]
     [11] Eksport CSV
     [12] Opis kryteriów słowami (nagłówek strony i docs/36 — spięte testem)

   WEJŚCIA:  próbki i zdarzenia zapisane przez stronę (kształt niżej), nastawy z [1].
   WYJŚCIA:  window.PomiarLogika (przeglądarka) albo module.exports (Node).
   ⚠ Na ESP-IDF nie dotyczy — to narzędzie przeglądarki, nie firmware.

   KSZTAŁT PRÓBKI (jedna na tick i transport):
     { sesja, tr: 'tls'|'quic', seq, t (Date.now), m (performance.now), inst (id wczytania strony),
       stan: 'wyslany'|'odebrany'|'zgubiony'|'bez_polaczenia'|'przerwany'|'potwierdzony' (PUBACK bez echa po zerwaniu, [8]),
       przy_utracie (true: była w drodze, gdy połączenie padło),
       rtt (ms, echo), puback (ms), puback_blad, spozn (ms, echo po limicie), dup (ile duplikatów),
       lat, lon, dokl (m), v (m/s), gps_wiek (ms), n_typ, n_eff, n_rtt (ms), n_down (Mb/s),
       widok ('visible'|'hidden'), opozn (ms spóźnienia ticku) }
   KSZTAŁT ZDARZENIA:
     { sesja, tr: 'tls'|'quic'|'*', typ, t, m, inst, opis, nr (numer kolejny nadany przez bazę — tylko w odczycie z niej) }
     typy liczone: 'start' (początek albo wznowienie, tr '*'), 'stop' (tr '*'), 'gotowy' (po CONNACK
     i SUBACK — dopiero wtedy echo ma sens), 'utrata' (pierwsze close/offline/błąd po gotowości),
     'pominiete' (tr '*', opis = liczba pominiętych ticków). Pozostałe (connect/close/offline/reconnect/
     error/siec/widok/...) idą do dziennika i eksportu, liczby z nich nie powstają. Opis ostatniego z 'error',
     'blad_gniazda' (błąd sesji WebTransport z nakładki — MQTT.js w przeglądarce go nie przekazuje), 'odmowa'
     i 'brak' idzie do podsumowania transportu jako `ostatni_blad` (zdanie przy „nie połączył się ani razu”).
   ============================================================================================ */
(function (glob) {
  'use strict';

  /* ------------------------------------------------------------------------------------------
     [1] NASTAWY POMIARU I KRYTERIA KORZYŚCI
     ------------------------------------------------------------------------------------------
     POMIAR: rytm echa i limit zgubienia z karty 36 (co 2 s echo, seq nieodebrany w 30 s = zgubiony).
     KRYTERIA: ustalone 30.09.2026 PRZED pierwszym przejazdem [karta 36 pkt 3; ODPOWIEDZ 11-c1, 5.3-d, 5.3-f].
       Kopia słowami: docs/36_pomiar_quic_tls_telefon.md (blok KRYTERIA) — test pilnuje zgodności,
       strona rysuje je z tego obiektu i zapisuje ich kopię w każdej sesji (widać, gdyby ktoś je zmienił
       po fakcie). ⚠ ZMIANA PO PIERWSZYM PRZEJEŹDZIE = nowa `wersja` i zdanie w dzienniku decyzji. */
  var POMIAR = {
    INTERWAL_MS: 2000,          /* co tyle echo na każdym transporcie */
    LIMIT_ZGUBIENIA_MS: 30000,  /* echo nie wróciło w tym czasie = zgubione */
    OPOZN_MAX_MS: 1000,         /* tick spóźniony bardziej = „nie w terminie” (strona w tle, telefon oszczędza) */
    /* [30.09, przegląd sceptyka; zasada 10] transport niegotowy dłużej = zdanie na ekranie z ostatnim błędem i tym, co
       sprawdzić (QUIC: gateway, UDP 8890, adres strony). 2 × limit połączenia MQTT.js (10 s) — pierwsza próba mogła
       paść na słabym zasięgu, druga już nie powinna. Tylko ekran — na liczby i ocenę nie wpływa. */
    ALARM_BEZ_GOTOWOSCI_MS: 20000
  };
  var KRYTERIA = {
    wersja: '2026-09-30',
    /* ważność przejazdu */
    min_czas_min: 20,              /* krótszy przejazd = za mało próbek na p95 i p99 */
    min_w_terminie_proc: 95,       /* tyle ticków musi pójść w terminie przy widocznej stronie */
    slaby_p95_ms: 300,             /* „słaby zasięg był”: p95 echa któregoś transportu co najmniej tyle… */
    slaby_dostarczone_proc: 99.5,  /* …albo dostarczone któregoś poniżej tego… */
    /*                                …albo choć jedno zerwanie któregoś — inaczej to pomiar DOBREJ sieci */
    /* przewaga QUIC w przejeździe — wystarczy jedna */
    P1_p95_iloraz: 0.8, P1_p95_roznica_ms: 100,          /* p95 echa QUIC ≤ 0,8 × TLS i o ≥ 100 ms krócej */
    P2_dostarczone_pp: 2,                                  /* dostarczone QUIC ≥ TLS + 2 punkty procentowe */
    P3_niegotowy_iloraz: 0.5, P3_niegotowy_roznica_s: 30,  /* czas bez gotowości QUIC ≤ 0,5 × TLS i o ≥ 30 s krócej */
    /* pogorszenie przez QUIC — jedno wystarczy, żeby przewaga nie liczyła się czysto */
    G1_dostarczone_pp: 1,                                  /* dostarczone QUIC < TLS − 1 punkt procentowy */
    G2_p95_iloraz: 1.2, G2_p95_roznica_ms: 100,            /* p95 echa QUIC > 1,2 × TLS i o > 100 ms dłużej */
    G3_niegotowy_iloraz: 1.5, G3_niegotowy_roznica_s: 30,  /* czas bez gotowości QUIC > 1,5 × TLS i o > 30 s dłużej */
    /* werdykt serii */
    min_przejazdow: 3,             /* mniej ważnych przejazdów = BRAK DANYCH */
    preferowany_udzial: 2 / 3      /* PREFEROWANY: QUIC lepszy w ≥ 2/3 ważnych przejazdów i ani razu gorszy */
  };
  var TRANSPORTY = ['tls', 'quic'];

  /* ------------------------------------------------------------------------------------------
     [2] ROZKŁAD
     WEJŚCIA:  tablica liczb (null/NaN pomijane), p w procentach 0..100.
     CO Z CZEGO WYNIKA: METODA NAJBLIŻSZEJ RANGI bez interpolacji — wynik jest zawsze jedną z ZMIERZONYCH
       wartości (indeks ⌈p/100·n⌉−1). ⚠ Przy n < 100 p99 = maksimum, przy n < 20 p95 = maksimum — dlatego
       obok percentyli zawsze idzie n.
     WYJŚCIA:  liczba albo null, gdy nie ma z czego liczyć.
     ------------------------------------------------------------------------------------------ */
  function czyste(tab) {
    var w = [];
    for (var i = 0; i < (tab || []).length; i++) { var x = tab[i]; if (typeof x === 'number' && isFinite(x)) w.push(x); }
    return w;
  }
  function percentyl(tab, p) {
    var w = czyste(tab).sort(function (a, b) { return a - b; });
    if (!w.length) return null;
    var i = Math.ceil(p / 100 * w.length) - 1;
    return w[Math.min(w.length - 1, Math.max(0, i))];
  }
  function rozklad(tab) {
    var w = czyste(tab);
    return { n: w.length, p50: percentyl(w, 50), p95: percentyl(w, 95), p99: percentyl(w, 99),
             max: w.length ? Math.max.apply(null, w) : null };
  }

  /* ------------------------------------------------------------------------------------------
     [3] CZAS MIĘDZY PUNKTAMI [ODPOWIEDZ 11-c2: zegar monotoniczny]
     WEJŚCIA:  dwa punkty {t, m, inst}.
     CO Z CZEGO WYNIKA: w obrębie JEDNEGO wczytania strony (to samo `inst`) — różnica performance.now()
       (nie skacze przy zmianie czasu telefonu); między wczytaniami — różnica Date.now() (innej nie ma).
     WYJŚCIA:  ms ≥ 0.
     ------------------------------------------------------------------------------------------ */
  function czasMiedzy(a, b) {
    if (!a || !b) return 0;
    var d = (a.inst && a.inst === b.inst && isFinite(a.m) && isFinite(b.m)) ? b.m - a.m : b.t - a.t;
    return d > 0 ? d : 0;
  }

  /* ------------------------------------------------------------------------------------------
     [4] RYTM TICKÓW
     WEJŚCIA:  start rytmu (performance.now), interwał, numer ostatniego wykonanego ticku (−1 = żaden), teraz.
     CO Z CZEGO WYNIKA: tick k należy do chwili start + k·interwał. Gdy przeglądarka spóźni zegar (strona w tle
       — Chrome dławi zegary do raz na minutę), NIE nadrabiamy serią ticków naraz (seria echa to inny pomiar),
       tylko liczymy pominięte — to jest „licznik gubienia ticku”.
     WYJŚCIA:  { k, pominiete, opozn (ms spóźnienia tego ticku), za (ms do następnego) }.
     ------------------------------------------------------------------------------------------ */
  function planTicku(startM, interwal, ostatniK, terazM) {
    var k = Math.max(ostatniK + 1, Math.floor((terazM - startM) / interwal));
    var pominiete = Math.max(0, k - ostatniK - 1);
    var opozn = Math.max(0, terazM - (startM + k * interwal));
    var za = Math.max(0, startM + (k + 1) * interwal - terazM);
    return { k: k, pominiete: pominiete, opozn: opozn, za: za };
  }

  /* ------------------------------------------------------------------------------------------
     [5] ZGUBIONE
     WEJŚCIA:  próbki w stanie 'wyslany' (z tego wczytania strony), teraz (performance.now), limit.
     CO Z CZEGO WYNIKA: echo, które nie wróciło w limicie, jest zgubione — także gdy przyjdzie później
       (wtedy strona dopisze `spozn`, ale stan zostaje 'zgubiony': dla człowieka odpowiedź po 30 s nie istnieje).
     WYJŚCIA:  lista próbek do oznaczenia jako zgubione.
     ------------------------------------------------------------------------------------------ */
  function przeterminowane(oczekujace, terazM, limitMs) {
    var w = [];
    (oczekujace || []).forEach(function (s) { if (s.stan === 'wyslany' && terazM - s.m >= limitMs) w.push(s); });
    return w;
  }

  /* ------------------------------------------------------------------------------------------
     [6] PRZERWY Z ZDARZEŃ (jeden transport)
     WEJŚCIA:  zdarzenia sesji w dowolnej kolejności (porządek nadaje `kolejnoscZdarzen` — zegar monotoniczny),
               transport, punkt końca {t, m, inst} (STOP albo „teraz”).
     CO Z CZEGO WYNIKA — automat: nic → (start) zimny → (gotowy) gotowy → (utrata) przerwa → (gotowy) gotowy …
       • ZIMNY START = od 'start' do pierwszego 'gotowy' (osobno, NIE jest zerwaniem);
       • ZERWANIE = pierwsza 'utrata' po 'gotowy'; kolejne nieudane próby w przerwie nic nie dodają;
       • POWRÓT = czas przerwy zakończonej 'gotowy' — tylko takie idą do p50/p95 powrotu;
       • przerwa otwarta przy 'start' (przeładowanie strony) albo 'stop' = URWANA: liczy się do sumy przerw
         i zerwań, NIE do powrotu (nie wiadomo, kiedy by wróciło);
       • przerwa trwająca na końcu = TRWA (to samo co urwana, z flagą trwa);
       • CZAS BEZ GOTOWOŚCI = zimne starty (także nieudane, do końca) + wszystkie przerwy — łapie też transport,
         który nie połączył się NIGDY (wtedy zerwań 0, a czas bez gotowości = cały przejazd).
     WYJŚCIA:  { zerwania, przerwy:[{od,do,ms,urwana,trwa}], suma_przerw_ms, powrot: rozklad, zimny_ms:[],
                 niegotowy_ms, gotowy_kiedykolwiek }.
     ------------------------------------------------------------------------------------------ */
  /* KOLEJNOŚĆ ZDARZEŃ: ZEGAR MONOTONICZNY, NIE ŚCIENNY  [30.09, przegląd sceptyka; ODPOWIEDZ 11-c2]
     Dawniej sortowanie po `t` (Date.now): Android koryguje zegar w trakcie jazdy (NITZ/NTP, skoki rzędu sekund),
     więc cofnięty zegar zamieniał 'utrata' i 'gotowy' — przerwa zostawała otwarta do końca przejazdu (zmierzone
     na symulacji: suma przerw 1 190 000 ms zamiast 1 500), a jedno takie zdarzenie odwracało P3/G3 całego przejazdu.
     WEJŚCIA:  zdarzenia w dowolnej kolejności — na żywo (tablica w kolejności zapisu, bez `nr`), z bazy (z numerem
               kolejnym `nr`, autoIncrement), po wznowieniu (najpierw z bazy z `nr`, potem nowe bez `nr`), z JSON.
     CO Z CZEGO WYNIKA — klucz porządku ma trzy piętra, `t` (zegar ścienny) NIE jest żadnym z nich:
       1. WCZYTANIE STRONY (`inst`) w kolejności zapisu: numer `nr`, gdy mają go wszystkie, inaczej kolejność tablicy.
          `m` (performance.now) zaczyna się od zera przy każdym wczytaniu, więc między wczytaniami porządku nie daje;
       2. w obrębie wczytania — `m`, zegar monotoniczny (gdy mają go wszystkie zdarzenia tego wczytania; stare zapisy
          bez `m` zostają w kolejności zapisu);
       3. remis — kolejność zapisu (sortowanie stabilne).
     `t` zostaje wyłącznie do opisu (godzina w dzienniku i CSV) i do czasu MIĘDZY wczytaniami (`czasMiedzy`).
     WYJŚCIA:  nowa tablica (wejście nietknięte). */
  function kolejnoscZdarzen(zd) {
    var liczba = function (x) { return typeof x === 'number' && isFinite(x); };
    var w = (zd || []).filter(Boolean).map(function (e, i) { return { e: e, i: i }; });
    if (w.length && w.every(function (x) { return liczba(x.e.nr); }))
      w.sort(function (a, b) { return (a.e.nr - b.e.nr) || (a.i - b.i); });
    var grupa = Object.create(null), zM = Object.create(null), n = 0;
    w.forEach(function (x, j) {
      var k = String(x.e.inst);
      if (!(k in grupa)) { grupa[k] = n++; zM[k] = true; }
      if (!liczba(x.e.m)) zM[k] = false;
      x.g = grupa[k]; x.k = k; x.j = j;
    });
    w.sort(function (a, b) { return (a.g - b.g) || (zM[a.k] ? a.e.m - b.e.m : 0) || (a.j - b.j); });
    return w.map(function (x) { return x.e; });
  }
  var posortowane = kolejnoscZdarzen;
  function przerwy(zdarzenia, tr, koniec) {
    var stan = 'nic', od = null, zimnyOd = null;
    var w = { zerwania: 0, przerwy: [], suma_przerw_ms: 0, zimny_ms: [], niegotowy_ms: 0, gotowy_kiedykolwiek: false };
    var powroty = [];
    var zamknijPrzerwe = function (pkt, urwana, trwa) {
      var ms = czasMiedzy(od, pkt);
      w.przerwy.push({ od: od.t, do: pkt.t, ms: ms, urwana: !!urwana, trwa: !!trwa });
      w.suma_przerw_ms += ms; w.niegotowy_ms += ms;
      if (!urwana && !trwa) powroty.push(ms);
    };
    posortowane(zdarzenia).forEach(function (e) {
      var wspolne = (e.tr === '*');
      if (!wspolne && e.tr !== tr) return;
      if (e.typ === 'start' && wspolne) {
        if (stan === 'przerwa') zamknijPrzerwe(e, true, false);
        else if (stan === 'zimny') w.niegotowy_ms += czasMiedzy(zimnyOd, e);
        stan = 'zimny'; zimnyOd = e;
      } else if (e.typ === 'stop' && wspolne) {
        if (stan === 'przerwa') zamknijPrzerwe(e, true, false);
        else if (stan === 'zimny') w.niegotowy_ms += czasMiedzy(zimnyOd, e);
        stan = 'nic';
      } else if (e.typ === 'gotowy' && !wspolne) {
        if (stan === 'zimny') { var z = czasMiedzy(zimnyOd, e); w.zimny_ms.push(z); w.niegotowy_ms += z; }
        else if (stan === 'przerwa') zamknijPrzerwe(e, false, false);
        if (stan !== 'nic') { stan = 'gotowy'; w.gotowy_kiedykolwiek = true; }
      } else if (e.typ === 'utrata' && !wspolne) {
        if (stan === 'gotowy') { w.zerwania++; stan = 'przerwa'; od = e; }
      }
    });
    if (koniec) {
      if (stan === 'przerwa') zamknijPrzerwe(koniec, false, true);
      else if (stan === 'zimny') w.niegotowy_ms += czasMiedzy(zimnyOd, koniec);
    }
    w.powrot = rozklad(powroty);
    return w;
  }

  /* ------------------------------------------------------------------------------------------
     [7] NAJDŁUŻSZA SERIA BEZ ECHA
     WEJŚCIA:  próbki jednego transportu, interwał.
     CO Z CZEGO WYNIKA: kolejne (po seq) ticki bez echa — zgubione albo bez połączenia. Łapie też „ciche”
       zerwanie: gniazdo formalnie żyje (bez zdarzenia close), a nic nie przechodzi aż do limitu keepalive.
       Próbki przerwane i jeszcze oczekujące nie przerywają serii i nie wchodzą do niej.
     WYJŚCIA:  ms (od pierwszego nieudanego ticku do ostatniego + jeden interwał), 0 gdy nie było.
     ------------------------------------------------------------------------------------------ */
  function najdluzszaSeria(probki, interwal) {
    var s = (probki || []).slice().sort(function (a, b) { return a.seq - b.seq; });
    var naj = 0, pocz = null, ost = null;
    var zamknij = function () { if (pocz) { naj = Math.max(naj, czasMiedzy(pocz, ost) + interwal); } pocz = ost = null; };
    s.forEach(function (p) {
      if (p.stan === 'zgubiony' || p.stan === 'bez_polaczenia') { if (!pocz) pocz = p; ost = p; }
      else if (p.stan === 'odebrany') zamknij();
    });
    zamknij();
    return naj;
  }

  /* ------------------------------------------------------------------------------------------
     [8] PODSUMOWANIE
     WEJŚCIA:  próbki i zdarzenia jednej sesji, punkt końca, interwał.
     CO Z CZEGO WYNIKA (na transport):
       baza = ticki − przerwane − oczekujące (te dwa jeszcze/już nie mają rozstrzygnięcia);
       dostarczone % = odebrane / baza — liczy RAZEM straty w locie i czas bez połączenia (to widzi człowiek);
       dostarczone z wysłanych % = odebrane / (odebrane + zgubione) — sama strata w locie;
       echo (rtt) i PUBACK: rozkład p50/p95/p99/max z próbek, które je mają;
       ostatni_blad: opis ostatniego zdarzenia błędu tego transportu (TYPY_BLEDU) albo null.
     WYJŚCIA:  { tls:{…}, quic:{…}, ticki:{ wykonane, pominiete, w_terminie, w_terminie_proc, czas_min } }.
     ------------------------------------------------------------------------------------------ */
  function podsumujTransport(probki, zdarzenia, tr, koniec, interwal) {
    var p = (probki || []).filter(function (x) { return x.tr === tr; });
    var ile = function (st) { return p.filter(function (x) { return x.stan === st; }).length; };
    var odebrane = ile('odebrany'), zgubione = ile('zgubiony'), bez = ile('bez_polaczenia');
    var przerwane = ile('przerwany'), oczek = ile('wyslany');
    /* POTWIERDZONE [D-537 pkt 2; docs/36 §11.3 P2]: wysłane na połączeniu, które padło, zanim echo mogło wrócić,
       a broker potwierdził je PUBACK-iem (przed zerwaniem albo po powtórce MQTT.js na nowym połączeniu). MQTT.js
       powtarza zaległe publikacje PRZED zdarzeniem 'connect', a strona subskrybuje dopiero po nim — echo powtórki
       nie ma dokąd wrócić. Broker ma wiadomość = DOSTARCZONA (bez czasu echa); do 02.10 liczone jako zgubione
       (9 z 13 „zgubionych” przejazdu 01.10 15:00). */
    var potwierdzone = ile('potwierdzony');
    var baza = p.length - przerwane - oczek;
    var prz = przerwy(zdarzenia, tr, koniec);
    var zd = kolejnoscZdarzen(zdarzenia).filter(function (e) { return e.tr === tr; });
    var bledy = zd.filter(function (e) { return TYPY_BLEDU.indexOf(e.typ) >= 0 && e.opis; });
    return {
      ticki: p.length, odebrane: odebrane, zgubione: zgubione, bez_polaczenia: bez, przerwane: przerwane, oczekujace: oczek,
      potwierdzone: potwierdzone,
      /* próby ponowienia (MQTT.js 'reconnect') i przerwy QUIC po porażce ([10b]) — „licznik prób w wyniku” (D-537) */
      proby: zd.filter(function (e) { return e.typ === 'reconnect'; }).length,
      wstrzymania: zd.filter(function (e) { return e.typ === 'wstrzymany'; }).length,
      dostarczone_proc: baza > 0 ? 100 * (odebrane + potwierdzone) / baza : null,
      dostarczone_z_wyslanych_proc: (odebrane + potwierdzone + zgubione) > 0 ? 100 * (odebrane + potwierdzone) / (odebrane + potwierdzone + zgubione) : null,
      rtt: rozklad(p.filter(function (x) { return x.stan === 'odebrany'; }).map(function (x) { return x.rtt; })),
      puback: rozklad(p.map(function (x) { return x.puback; })),
      puback_bledy: p.filter(function (x) { return x.puback_blad; }).length,
      spoznione: p.filter(function (x) { return typeof x.spozn === 'number'; }).length,
      duplikaty: p.reduce(function (s, x) { return s + (x.dup || 0); }, 0),
      najdl_seria_ms: najdluzszaSeria(p, interwal),
      zerwania: prz.zerwania, suma_przerw_ms: prz.suma_przerw_ms, powrot: prz.powrot, zimny_ms: prz.zimny_ms,
      niegotowy_ms: prz.niegotowy_ms, gotowy_kiedykolwiek: prz.gotowy_kiedykolwiek, przerwy: prz.przerwy,
      ostatni_blad: bledy.length ? String(bledy[bledy.length - 1].opis) : null
    };
  }
  var TYPY_BLEDU = ['error', 'blad_gniazda', 'odmowa', 'brak'];
  function podsumuj(probki, zdarzenia, koniec, opcje) {
    opcje = opcje || {};
    var interwal = opcje.interwal || POMIAR.INTERWAL_MS, opoznMax = opcje.opoznMax || POMIAR.OPOZN_MAX_MS;
    var w = {};
    TRANSPORTY.forEach(function (tr) { w[tr] = podsumujTransport(probki, zdarzenia, tr, koniec, interwal); });
    /* ticki liczymy po seq (oba transporty dzielą tick), pominięte z zdarzeń 'pominiete' */
    var seqy = {}, ok = {};
    (probki || []).forEach(function (x) {
      seqy[x.seq] = true;
      if (x.widok !== 'hidden' && (x.opozn || 0) <= opoznMax) ok[x.seq] = (ok[x.seq] !== false);
      else ok[x.seq] = false;
    });
    var wyk = Object.keys(seqy).length;
    var pom = (zdarzenia || []).filter(function (e) { return e.typ === 'pominiete'; })
                               .reduce(function (s, e) { return s + (+e.opis || 0); }, 0);
    var wTerm = Object.keys(ok).filter(function (k) { return ok[k]; }).length;
    w.ticki = { wykonane: wyk, pominiete: pom, w_terminie: wTerm,
                w_terminie_proc: (wyk + pom) > 0 ? 100 * wTerm / (wyk + pom) : null,
                czas_min: (wyk + pom) * interwal / 60000 };
    return w;
  }

  /* ------------------------------------------------------------------------------------------
     [9] WAŻNOŚĆ, PORÓWNANIE, WERDYKT
     ------------------------------------------------------------------------------------------ */
  /* WAŻNOŚĆ PRZEJAZDU — powody nieważności słowami (zasada 10: nie „nieważny” bez zdania, dlaczego).
     WEJŚCIA: podsumowanie, metadane sesji ({webtransport, klasa_wt}), kryteria.
     CO Z CZEGO WYNIKA — ⚠ SYMETRIA [30.09, przegląd sceptyka]: transport, który NIE POŁĄCZYŁ SIĘ ANI RAZU, nie mówi
       nic o sieci — jego „0 % dostarczonych” to bramka, konto albo przeglądarka, nie zasięg. Dawniej martwy QUIC sam
       spełniał warunek „słaby zasięg obecny” (0 % < 99,5 %), więc przejazd w DOBREJ sieci przy stojącej bramce
       wychodził WAŻNY i QUIC_GORSZY (G1, G3), a trzy takie dawały serię ODLOZONY — podczas gdy martwy TLS dawał
       „błąd przygotowania, NIEWAŻNY”. Teraz dla obu dróg tak samo:
         • słaby zasięg liczymy WYŁĄCZNIE z transportów, które choć raz były gotowe (echo tego, co przeszło przez
           radio). Transport, który działał i ma zerwania/ogon, dalej się liczy — w obie strony (problem tylko TLS
           albo tylko QUIC nie ucieka jako „nieważny”);
         • TLS ani razu = NIEWAŻNY (błąd przygotowania); QUIC ani razu przy TLS, który działał = osobny, jawny wynik
           QUIC_NIE_DZIALA (ocenPrzejazd) — poza porównaniem, nigdy QUIC_GORSZY. Z ostatnim błędem gniazda
           i tym, co sprawdzić. Brak WebTransport w przeglądarce albo w stronie ma własny powód (przyczyna znana),
           więc wtedy QUIC_NIE_DZIALA się nie pojawia.
     WYJŚCIA: { wazny, powody:[zdania], quic_nie_dziala }. */
  function waznosc(pods, meta, K) {
    K = K || KRYTERIA; meta = meta || {};
    var powody = [];
    var blad = function (t) { return t.ostatni_blad ? ' (ostatni błąd: ' + t.ostatni_blad + ')' : ''; };
    var ul = function (x) { return String(x).replace('.', ','); };
    if (!(pods.ticki.czas_min >= K.min_czas_min))
      powody.push('za krótki: ' + fmt(pods.ticki.czas_min, 1) + ' min (trzeba ≥ ' + K.min_czas_min + ')');
    if (!(pods.ticki.w_terminie_proc >= K.min_w_terminie_proc))
      powody.push('ticki w terminie przy widocznej stronie: ' + fmt(pods.ticki.w_terminie_proc, 1) + ' % (trzeba ≥ ' + K.min_w_terminie_proc + ' %) — ekran gasł albo strona była w tle');
    if (!pods.tls.gotowy_kiedykolwiek)
      powody.push('TLS nie połączył się ani razu' + blad(pods.tls) + ' — to błąd przygotowania (konto, hasło, adres, zasięg na starcie), nie wynik QUIC');
    if (meta.webtransport === false)
      powody.push('przeglądarka bez WebTransport — QUIC nie mógł ruszyć z powodu telefonu, nie sieci');
    /* [30.09, przegląd przed pierwszym przejazdem] brak klasy WebTransport z nakładki (paho_na_mqttjs.js nie wczytał
       się albo stara kopia bez `Paho._WTjakoWS`) = QUIC „0 %” z powodu STRONY — to nie jest porażka QUIC, więc
       przejazd nie może wejść do serii jako QUIC_GORSZY */
    if (meta.klasa_wt === false)
      powody.push('strona bez klasy WebTransport z nakładki (paho_na_mqttjs.js) — QUIC nie mógł ruszyć z powodu strony, nie sieci');
    var quicNieDziala = !pods.quic.gotowy_kiedykolwiek && meta.webtransport !== false && meta.klasa_wt !== false;
    if (quicNieDziala)
      powody.push('QUIC nie połączył się ani razu' + blad(pods.quic) + ' — przejazd poza porównaniem (QUIC_NIE_DZIALA), to nie jest wynik QUIC: sprawdź dodatek aquareact_quic w HA, przekierowanie UDP 8890 na routerze i adres strony (https://tomekwierzbowski.github.io)');
    var zywe = TRANSPORTY.filter(function (tr) { return pods[tr].gotowy_kiedykolwiek; });
    var slaby = zywe.some(function (tr) {
      var t = pods[tr];
      return (t.rtt.p95 != null && t.rtt.p95 >= K.slaby_p95_ms) ||
             (t.dostarczone_proc != null && t.dostarczone_proc < K.slaby_dostarczone_proc) || t.zerwania > 0;
    });
    if (zywe.length && !slaby)
      powody.push('słabego zasięgu nie było (' + zywe.map(function (tr) { return tr.toUpperCase(); }).join(' i ') +
                  ': p95 < ' + K.slaby_p95_ms + ' ms, dostarczone ≥ ' + ul(K.slaby_dostarczone_proc) + ' %, bez zerwań' +
                  (zywe.length < TRANSPORTY.length ? '; transport bez ani jednego połączenia nie świadczy o sieci' : '') +
                  ') — to pomiar dobrej sieci');
    return { wazny: powody.length === 0, powody: powody, quic_nie_dziala: quicNieDziala };
  }

  /* PORÓWNANIE JEDNEGO PRZEJAZDU wg kryteriów [1].
     WYJŚCIA: { przewagi:[kod+zdanie], pogorszenia:[…], wynik: QUIC_LEPSZY | QUIC_GORSZY | MIESZANY | BEZ_ROZNICY } */
  function porownaj(tls, quic, K) {
    K = K || KRYTERIA;
    var P = [], G = [];
    var p95t = tls.rtt.p95, p95q = quic.rtt.p95;
    var dt = tls.dostarczone_proc, dq = quic.dostarczone_proc;
    var nt = tls.niegotowy_ms / 1000, nq = quic.niegotowy_ms / 1000;
    if (p95t != null && p95q != null) {
      if (p95q <= K.P1_p95_iloraz * p95t && p95t - p95q >= K.P1_p95_roznica_ms)
        P.push('P1 p95 echa QUIC ' + fmt(p95q, 0) + ' ms wobec TLS ' + fmt(p95t, 0) + ' ms');
      if (p95q > K.G2_p95_iloraz * p95t && p95q - p95t > K.G2_p95_roznica_ms)
        G.push('G2 p95 echa QUIC ' + fmt(p95q, 0) + ' ms wobec TLS ' + fmt(p95t, 0) + ' ms');
    }
    if (dt != null && dq != null) {
      if (dq >= dt + K.P2_dostarczone_pp) P.push('P2 dostarczone QUIC ' + fmt(dq, 1) + ' % wobec TLS ' + fmt(dt, 1) + ' %');
      if (dq < dt - K.G1_dostarczone_pp) G.push('G1 dostarczone QUIC ' + fmt(dq, 1) + ' % wobec TLS ' + fmt(dt, 1) + ' %');
    }
    if (nq <= K.P3_niegotowy_iloraz * nt && nt - nq >= K.P3_niegotowy_roznica_s)
      P.push('P3 bez gotowości QUIC ' + fmt(nq, 0) + ' s wobec TLS ' + fmt(nt, 0) + ' s');
    if (nq > K.G3_niegotowy_iloraz * nt && nq - nt > K.G3_niegotowy_roznica_s)
      G.push('G3 bez gotowości QUIC ' + fmt(nq, 0) + ' s wobec TLS ' + fmt(nt, 0) + ' s');
    var wynik = P.length && G.length ? 'MIESZANY' : P.length ? 'QUIC_LEPSZY' : G.length ? 'QUIC_GORSZY' : 'BEZ_ROZNICY';
    return { przewagi: P, pogorszenia: G, wynik: wynik };
  }

  /* OCENA PRZEJAZDU = ważność + porównanie (nieważny nie ma wyniku porównania w serii).
     WYNIK: porównanie, gdy ważny; QUIC_NIE_DZIALA, gdy TLS działał, a QUIC nie połączył się ani razu (bez znanej
     przyczyny po stronie telefonu/strony) — ta etykieta ma pierwszeństwo przed NIEWAZNY, bo mówi, co naprawić
     (także przy krótkiej próbie suchej); pozostałe = NIEWAZNY. `wynik_gdyby_wazny` = samo porównanie, do wglądu. */
  function ocenPrzejazd(pods, meta, K) {
    var wz = waznosc(pods, meta, K), por = porownaj(pods.tls, pods.quic, K);
    var wynik = wz.wazny ? por.wynik : (wz.quic_nie_dziala && pods.tls.gotowy_kiedykolwiek) ? 'QUIC_NIE_DZIALA' : 'NIEWAZNY';
    return { wazny: wz.wazny, powody: wz.powody, przewagi: por.przewagi, pogorszenia: por.pogorszenia,
             wynik: wynik, wynik_gdyby_wazny: por.wynik };
  }

  /* WERDYKT SERII — tylko dla APLIKACJI NA TELEFONIE [ODPOWIEDZ 5.1-b: sterownik osobno, tu nie mierzony].
     WEJŚCIA: lista wyników przejazdów (ocenPrzejazd(...).wynik).
     CO Z CZEGO WYNIKA:  N = ważne, L = QUIC_LEPSZY, G = QUIC_GORSZY, Q = QUIC_NIE_DZIALA (zaznaczone, NIE są ważne)
       N < min_przejazdow                 → BRAK_DANYCH (karta 36: brak wyniku = BRAK DANYCH)
       L ≥ ⌈N·udział⌉ i G = 0 i Q = 0     → PREFEROWANY (QUIC może być pierwszą drogą aplikacji; wss dalej zapasem,
                                            produkt dopiero po słowie Tomasza „wdrażamy”, D-499 pkt 3)
       L = 0 albo G ≥ L                   → ODLOZONY (przy małym zysku wygrywa prostszy TLS/WSS, 5.3-f)
       pozostałe                          → OPCJONALNY (zysk niepowtarzalny: QUIC zostaje dodatkową drogą T3)
     ⚠ QUIC_NIE_DZIALA [30.09, przegląd sceptyka]: nie wchodzi do N ani do G — martwy gateway nie może dać serii
       „QUIC gorszy”. Ale zaznaczony blokuje PREFEROWANY: QUIC, który w części przejazdów nie połączył się wcale,
       nie zostaje pierwszą drogą aplikacji, dopóki ktoś nie wyjaśni dlaczego. Odznaczenie „wlicz do serii” = świadome
       „to był gateway, nie QUIC” (Tomasz, po sprawdzeniu dziennika gatewaya). */
  function werdyktSerii(wyniki, K) {
    K = K || KRYTERIA;
    var Q = (wyniki || []).filter(function (w) { return w === 'QUIC_NIE_DZIALA'; }).length;
    var wazne = (wyniki || []).filter(function (w) { return w && w !== 'NIEWAZNY' && w !== 'QUIC_NIE_DZIALA'; });
    var N = wazne.length;
    var L = wazne.filter(function (w) { return w === 'QUIC_LEPSZY'; }).length;
    var G = wazne.filter(function (w) { return w === 'QUIC_GORSZY'; }).length;
    var M = wazne.filter(function (w) { return w === 'MIESZANY'; }).length;
    var werdykt, opis, lepszyWiekszosc = L >= Math.ceil(N * K.preferowany_udzial - 1e-9);
    if (N < K.min_przejazdow) { werdykt = 'BRAK_DANYCH'; opis = 'ważnych przejazdów ' + N + ' z wymaganych ' + K.min_przejazdow; }
    else if (lepszyWiekszosc && G === 0 && Q === 0) { werdykt = 'PREFEROWANY'; opis = 'QUIC lepszy w ' + L + ' z ' + N + ', ani razu gorszy'; }
    else if (L === 0 || G >= L) { werdykt = 'ODLOZONY'; opis = 'QUIC lepszy w ' + L + ', gorszy w ' + G + ' z ' + N + ' — prostszy TLS/WSS wygrywa'; }
    else if (lepszyWiekszosc && G === 0) { werdykt = 'OPCJONALNY'; opis = 'QUIC lepszy w ' + L + ' z ' + N + ', ale zaznaczone QUIC_NIE_DZIALA blokują PREFEROWANY — najpierw wyjaśnić, dlaczego QUIC się nie połączył'; }
    else { werdykt = 'OPCJONALNY'; opis = 'QUIC lepszy w ' + L + ' z ' + N + ' (gorszy ' + G + ', mieszany ' + M + ') — zysk niepowtarzalny'; }
    if (Q) opis += '; QUIC_NIE_DZIALA: ' + Q + ' (poza porównaniem — sprawdzić bramkę aquareact_quic, UDP 8890, adres strony)';
    return { N: N, L: L, G: G, M: M, Q: Q, werdykt: werdykt, opis: opis };
  }

  /* ------------------------------------------------------------------------------------------
     [10] OPCJE POŁĄCZENIA — JEDNO MIEJSCE, TE SAME NASTAWY DLA OBU DRÓG
     WEJŚCIA:  transport, nastawy połączenia strony, konto, budowniczy WebTransport (klasa udająca WebSocket
               z paho_na_mqttjs.js — `Paho._WTjakoWS`).
     CO Z CZEGO WYNIKA: jedyna różnica to adres i — dla QUIC — `createWebsocket`. ⛔ QUIC NIE MA ZAPASU wss:
       porażka QUIC ma zostać porażką QUIC (w aplikacji T3 nakładka przechodzi na wss, tu celowo nie).
     WYJŚCIA:  { url, opcje } do mqtt.connect.
     ------------------------------------------------------------------------------------------ */
  function opcjePolaczenia(tr, N, konto, WT) {
    var opcje = {
      protocolVersion: 5, clientId: konto.clientId, username: konto.user, password: konto.haslo,
      /* reconnectPeriod 0 [D-537 pkt 2]: MQTT.js sam NIE ponawia — kiedy ponowić, decyduje odstepPonowienia ([10b]),
         a strona woła reconnect z tymi samymi magazynami (powtórka niepotwierdzonych publikacji jak dotąd) */
      keepalive: N.KEEPALIVE_S, clean: true, reconnectPeriod: 0, connectTimeout: N.CONNECT_TIMEOUT_MS,
      resubscribe: false   /* subskrypcję stawiamy sami po KAŻDYM połączeniu — dopiero SUBACK = „gotowy” */
    };
    if (tr === 'quic') {
      if (typeof WT !== 'function') throw new Error('brak klasy WebTransport (Paho._WTjakoWS) — QUIC nie może ruszyć');
      opcje.createWebsocket = function (url) { return new WT(url); };
      return { url: N.URL_QUIC, opcje: opcje };
    }
    return { url: N.URL_TLS, opcje: opcje };
  }

  /* ------------------------------------------------------------------------------------------
     [10b] PONAWIANIE JAK W APLIKACJI T3  [D-537 pkt 2, 03.10.2026; docs/36 §11.3, §11.7]
     PO CO: do 02.10 QUIC ponawiał co 1 s. Każda nieudana próba WebTransport zostaje w Chrome „oczekująca” przez
       5 min i opóźnia następne wykładniczo (do 60 s, przy 64 oczekujących odmowa od ręki) — seria mierzyła więc
       karę, którą strona sama sobie wywołała, a nie sieć. Teraz QUIC ponawia tak, jak robi to T3
       (paho_na_mqttjs.js: QUIC_PRZERWA_MIN, quicZapomnij), więc wynik mówi, co QUIC da klientowi.
     WEJŚCIA:  transport, czy zakończona próba była PORAŻKĄ (nie doszła do gotowości: CONNACK + SUBACK), nastawy strony
               (N.RECONNECT_MS, N.QUIC_PRZERWA_MS); dla wybaczenia: czy przerwa QUIC trwa, chwila ostatniego wybaczenia.
     CO Z CZEGO WYNIKA:
       • TLS — zawsze po N.RECONNECT_MS (jak dotąd; wss nie ma kary przeglądarki, porównanie z seriami 01.10 zostaje);
       • QUIC po utracie GOTOWEGO połączenia — po N.RECONNECT_MS (T3: nowa próba QUIC od razu, pamięci porażki brak);
       • QUIC po PORAŻCE — przerwa N.QUIC_PRZERWA_MS (T3: tyle minut prosto wss; tu QUIC po prostu czeka — bez zapasu
         wss, porażka QUIC zostaje porażką QUIC);
       • WYBACZENIE: zmiana RODZAJU łącza (wifi ↔ komórka) albo `online` w czasie przerwy = jedna próba od razu,
         najwyżej raz na N.QUIC_PRZERWA_MS od poprzedniego wybaczenia (T3, audyt WT 02.10).
     WYJŚCIA:  odstepPonowienia → { ms, wstrzymany }; wybaczenie → true/false.
     ------------------------------------------------------------------------------------------ */
  function odstepPonowienia(tr, porazka, N) {
    if (tr === 'quic' && porazka) return { ms: N.QUIC_PRZERWA_MS, wstrzymany: true };
    return { ms: N.RECONNECT_MS, wstrzymany: false };
  }
  function wybaczenie(przerwaTrwa, ostWybaczenieM, terazM, N) {
    if (!przerwaTrwa) return false;
    return ostWybaczenieM == null || (terazM - ostWybaczenieM) >= N.QUIC_PRZERWA_MS;
  }

  /* ------------------------------------------------------------------------------------------
     [11] EKSPORT CSV — średnik jak w dziennikach karty SD projektu, kropka dziesiętna, UTF-8 z BOM (Excel PL
     czyta polskie litery). Pola z średnikiem, cudzysłowem albo końcem linii — w cudzysłowie.
     Liczby domyślnie z dokładnością 0,1 (czasy w ms). ⚠ [30.09, przegląd przed pierwszym przejazdem] WYJĄTEK:
     położenie z dokładnością 6 miejsc (~0,1 m) i przepustowość 2 miejsc — domyślne 0,1 ucinało szerokość
     i długość do ~10 km, czyli mapa z CSV pokazałaby całą trasę w kilku punktach. Stała liczba miejsc
     (`stale`) daje tekst, który poleCsv przepuszcza bez zmian.
     ------------------------------------------------------------------------------------------ */
  var MIEJSCA_GPS = 6, MIEJSCA_MBPS = 2;
  function stale(pole, miejsc) {
    return function (p) { return typeof p[pole] === 'number' && isFinite(p[pole]) ? p[pole].toFixed(miejsc) : ''; };
  }
  var KOLUMNY_PROBEK = [
    ['sesja', 'sesja'], ['transport', 'tr'], ['seq', 'seq'], ['czas', function (p) { return iso(p.t); }],
    ['stan', 'stan'], ['echo_ms', 'rtt'], ['puback_ms', 'puback'], ['puback_blad', 'puback_blad'],
    ['echo_po_limicie_ms', 'spozn'], ['duplikaty', 'dup'], ['lat', stale('lat', MIEJSCA_GPS)], ['lon', stale('lon', MIEJSCA_GPS)],
    ['gps_dokladnosc_m', 'dokl'],
    ['predkosc_kmh', function (p) { return typeof p.v === 'number' ? Math.round(p.v * 36) / 10 : ''; }],
    ['gps_wiek_ms', 'gps_wiek'], ['siec_typ', 'n_typ'], ['siec_efektywna', 'n_eff'], ['siec_rtt_ms', 'n_rtt'],
    ['siec_downlink_mbps', stale('n_down', MIEJSCA_MBPS)], ['widocznosc', 'widok'], ['opoznienie_ticku_ms', 'opozn'], ['wczytanie', 'inst']
  ];
  var KOLUMNY_ZDARZEN = [
    ['sesja', 'sesja'], ['transport', 'tr'], ['czas', function (e) { return iso(e.t); }], ['typ', 'typ'],
    ['opis', 'opis'], ['wczytanie', 'inst']
  ];
  function iso(t) { return typeof t === 'number' ? new Date(t).toISOString() : ''; }
  function poleCsv(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return isFinite(v) ? String(Math.round(v * 10) / 10) : '';
    var s = String(v);
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function doCsv(wiersze, kolumny) {
    var linie = [kolumny.map(function (k) { return k[0]; }).join(';')];
    (wiersze || []).forEach(function (w) {
      linie.push(kolumny.map(function (k) { return poleCsv(typeof k[1] === 'function' ? k[1](w) : w[k[1]]); }).join(';'));
    });
    return '﻿' + linie.join('\r\n') + '\r\n';
  }
  function csvProbek(probki) {
    return doCsv((probki || []).slice().sort(function (a, b) { return (a.seq - b.seq) || (a.tr < b.tr ? -1 : 1); }), KOLUMNY_PROBEK);
  }
  function csvZdarzen(zd) { return doCsv(posortowane(zd), KOLUMNY_ZDARZEN); }

  /* ------------------------------------------------------------------------------------------
     [12] KRYTERIA SŁOWAMI — nagłówek strony i blok w docs/36 (test porównuje tekst 1:1)
     ------------------------------------------------------------------------------------------ */
  function fmt(x, miejsc) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    return Number(x).toFixed(miejsc).replace('.', ',');
  }
  function opisKryteriow(K) {
    K = K || KRYTERIA;
    var ul = function (x) { return String(x).replace('.', ','); };
    var udzial = Math.abs(K.preferowany_udzial - 2 / 3) < 1e-9 ? '2/3' : fmt(100 * K.preferowany_udzial, 0) + ' %';
    return [
      'Kryteria z ' + K.wersja + ', ustalone przed pierwszym przejazdem. Oba połączenia naraz, to samo konto, te same nastawy; QUIC bez zapasu wss.',
      'Przejazd ważny: co najmniej ' + K.min_czas_min + ' min, ' + K.min_w_terminie_proc + ' % ticków w terminie przy widocznej stronie, TLS i QUIC połączone choć raz, WebTransport w przeglądarce i w stronie oraz słaby zasięg obecny (na którymś transporcie, który choć raz był gotowy: p95 echa ≥ ' + K.slaby_p95_ms + ' ms albo dostarczone < ' + ul(K.slaby_dostarczone_proc) + ' % albo choć jedno zerwanie).',
      'P1 przewaga QUIC: p95 echa QUIC ≤ ' + ul(K.P1_p95_iloraz) + ' × TLS i krótsze o co najmniej ' + K.P1_p95_roznica_ms + ' ms.',
      'P2 przewaga QUIC: dostarczone QUIC ≥ TLS + ' + K.P2_dostarczone_pp + ' punkty procentowe.',
      'P3 przewaga QUIC: czas bez gotowości QUIC ≤ ' + ul(K.P3_niegotowy_iloraz) + ' × TLS i krótszy o co najmniej ' + K.P3_niegotowy_roznica_s + ' s.',
      'G1 pogorszenie: dostarczone QUIC < TLS − ' + K.G1_dostarczone_pp + ' punkt procentowy.',
      'G2 pogorszenie: p95 echa QUIC > ' + ul(K.G2_p95_iloraz) + ' × TLS i dłuższe o ponad ' + K.G2_p95_roznica_ms + ' ms.',
      'G3 pogorszenie: czas bez gotowości QUIC > ' + ul(K.G3_niegotowy_iloraz) + ' × TLS i dłuższy o ponad ' + K.G3_niegotowy_roznica_s + ' s.',
      'Wynik przejazdu: QUIC_LEPSZY (jest P, nie ma G), QUIC_GORSZY (nie ma P, jest G), MIESZANY (są oba), BEZ_ROZNICY (żadnego); QUIC_NIE_DZIALA, gdy TLS połączył się, a QUIC ani razu — przejazd poza porównaniem (najpierw bramka, UDP 8890, adres strony), nigdy QUIC_GORSZY.',
      'Werdykt serii (aplikacja na telefonie): mniej niż ' + K.min_przejazdow + ' ważne przejazdy = BRAK_DANYCH; QUIC_LEPSZY w co najmniej ' + udzial + ' ważnych, ani jednego QUIC_GORSZY i ani jednego zaznaczonego QUIC_NIE_DZIALA = PREFEROWANY; żadnego QUIC_LEPSZY albo QUIC_GORSZY co najmniej tyle razy co QUIC_LEPSZY = ODLOZONY; pozostałe = OPCJONALNY.'
    ];
  }

  var API = {
    WERSJA: '2026-10-03', POMIAR: POMIAR, KRYTERIA: KRYTERIA, TRANSPORTY: TRANSPORTY,
    odstepPonowienia: odstepPonowienia, wybaczenie: wybaczenie,
    percentyl: percentyl, rozklad: rozklad, czasMiedzy: czasMiedzy, planTicku: planTicku,
    przeterminowane: przeterminowane, kolejnoscZdarzen: kolejnoscZdarzen, przerwy: przerwy, najdluzszaSeria: najdluzszaSeria,
    podsumujTransport: podsumujTransport, podsumuj: podsumuj, waznosc: waznosc, porownaj: porownaj,
    ocenPrzejazd: ocenPrzejazd, werdyktSerii: werdyktSerii, opcjePolaczenia: opcjePolaczenia,
    csvProbek: csvProbek, csvZdarzen: csvZdarzen, poleCsv: poleCsv, opisKryteriow: opisKryteriow, fmt: fmt
  };
  glob.PomiarLogika = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
