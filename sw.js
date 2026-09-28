/* SERVICE WORKER APLIKACJI [D-270]: pliki aplikacji z pamięci telefonu (cache-first),
   żeby HMI otwierało się od razu i bez zasięgu (dane z brokera i tak wymagają sieci -
   bez niej ekran pokazuje ostatni stan z napisem „czekam na pakiet”). Nowa wersja
   plików = nowa nazwa pamięci (WERSJA z odcisku treści) -> stare kopie znikają. */
/* RODZINA = nazwy cache TEJ apki; SW kasuje przy aktywacji TYLKO swoją rodzinę [izolacja TEST2, 23.09]:
   klient i TEST2 siedzą pod jednym origin (GitHub Pages), więc filtr „wszystko poza moją wersją"
   kasował cache drugiej apki i zostawiał ją bez plików do startu offline (zmierzone przez Astrę). */
const RODZINA = 'test3-basen-hmi-';
const WERSJA = RODZINA + 'bd2477087e';
const PLIKI = ['./', './index.html', './hmi.html', './most_js.js', './mqtt.min.js', './paho_na_mqttjs.js', './wykres_temp.js',
               './manifest.webmanifest', './ikona-192.png', './ikona-512.png', './ikona-maskable-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(WERSJA).then(c => c.addAll(PLIKI)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== WERSJA && k.startsWith(RODZINA)).map(k => caches.delete(k))))
              .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // broker (wss) i obce hosty - bez udziału SW
  /* ⚠ STRONY I SKRYPTY: NAJPIERW SIEĆ [2026-09-09, Tomasz: „mam starą wersję, nie odświeża"].
     Pierwsza wersja była cache-first i telefon utykał na starych plikach mimo nowej wersji
     na serwerze. Teraz: gdy jest zasięg — świeży plik (i odśwież kopię offline); bez zasięgu —
     z pamięci. Ikony/manifest/Paho zostają cache-first (nie zmieniają się, oszczędza transfer). */
  const swiezy = e.request.mode === 'navigate' || /\.(html|js|webmanifest)$/.test(u.pathname);
  if (swiezy) {
    /*  ⛔ SIEC MA LIMIT CZASU [2026-09-13, Tomasz: „pwa nie startuje, staje na logo"]
        Pierwsza wersja robila `fetch(...).catch(kopia z pamieci)`. `catch` lapie BLAD, ale NIE lapie
        ZAWIESZENIA: gdy telefon ma zasieg, a transmisja nie idzie (slabe LTE, przeskok WiFi/LTE,
        sprawdzanie logowania w hotspocie), `fetch` nie odrzuca przez dlugie sekundy - i apka stoi na
        logo, MIMO ZE ma komplet plikow w pamieci. Nie ma gorszego przypadku niz aplikacja, ktora
        nie startuje, chociaz wszystko ma.
        Teraz siec sciga sie z licznikiem: po SIEC_LIMIT_MS oddajemy kopie z pamieci i apka rusza.
        ⚠ Swiezosc NIE GINIE: odpowiedz z sieci, gdy w koncu przyjdzie, i tak nadpisuje kopie, wiec
        nastepny start jest juz nowy. Przy sprawnym laczu (kilkadziesiat ms) licznik nie zdazy
        wystrzelic i dziala dokladnie tak, jak dotad [D-289: „mam stara wersje, nie odswieza"]. */
    const SIEC_LIMIT_MS = 2500;
    e.respondWith(new Promise(res => {
      let dano = false;
      const daj = o => { if (!dano && o) { dano = true; res(o); } };
      const zPamieci = () => caches.match(e.request, { ignoreSearch: true }).then(daj);
      const licznik = setTimeout(zPamieci, SIEC_LIMIT_MS);
      fetch(e.request).then(odp => {
        clearTimeout(licznik);
        if (odp && odp.ok) { const kopia = odp.clone(); caches.open(WERSJA).then(c => c.put(e.request, kopia)); }
        daj(odp);
      }).catch(() => {
        clearTimeout(licznik);
        zPamieci().then(() => { if (!dano) { dano = true; res(Response.error()); } });
      });
    }));
  } else {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(odp => {
      if (odp && odp.ok) { const kopia = odp.clone(); caches.open(WERSJA).then(c => c.put(e.request, kopia)); }
      return odp;
    })));
  }
});
