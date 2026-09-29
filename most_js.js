/* ============================================================
 *  most_js.js - MOST W PRZEGLADARCE [D-221, 2026-09-06]
 * ============================================================
 *  SPIS TRESCI
 *   [1] po co: strona na AP sterownika 1:1 z mostem
 *   [2] tabele kontraktu (te same, co most.py): nastawy MN, wylaczniki,
 *       kody zaciskow, sposoby akcesoriow
 *   [3] dekodowanie: blok panelu + linia MN + rejestry -> pakiet "swiat"
 *       (port swiat_z_bloku / nastawy_z_mn / harm_z_rejestrow z most.py)
 *   [4] komendy makiety -> zapisy rejestrow (port komenda_na_rejestr,
 *       nastawa_na_rejestr, akc, wycisz-alarmy, ustaw-czas)
 *   [5] klient AP: /blok.txt co 1 s, /rej co 10 s, /cmd?adr=;
 *       podaje pakiety makiecie i przechwytuje fetch('/cmd?co=...')
 *
 *  [1] PO CO [Tomasz 2026-09-06: „strona na AP - da sie zrobic 1:1 jak
 *  wyglada i dziala most sadzawki?" - „pelne"]. Most (most.py) liczy
 *  pakiet stanu (74 pola) z trzech surowych rzeczy: bloku panelu (72
 *  slowa, ten sam, ktory idzie do Tab5), linii nastaw MN (128 pol)
 *  i kilku rejestrow. Sterownik na AP NIE liczy tego w C (bylaby to
 *  druga kopia 74 pol - zrodlo rozjazdow, patrz D-217), tylko wystawia
 *  surowe linie MB;/MN; jak po USB, a liczy TEN plik - ta sama makieta
 *  pod mostem na PC i pod AP na telefonie. Docelowo most.py zostaje
 *  samym transportem po USB, a jedyny zapis dekodowania jest tutaj.
 *
 *  ⚠ PRZEJSCIOWO DWA ZAPISY (Python w most.py i JS tutaj) - spina je
 *  sonda parytetu (makieta pod mostem liczy swiat z /blok.txt mostu
 *  i porownuje z /stan.json pole po polu). Rozjazd = blad w porcie.
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------- [2] TABELE */
  /* MN_NASTAWY: [indeks MN, klucz makiety, skala, rodzaj]
     rodzaj: 'l' liczba, 'b' bool, 'z' liczba ze znakiem, [a,b] = wybor 0/1 */
  const MN_NASTAWY = [
    [0, 'dol_start', 1, 'l'], [1, 'dol_stop', 1, 'l'], [2, 'sucho_stop', 1, 'l'],
    [3, 'sonda_reakcja', 1, ['pracuj', 'stop']], [4, 'nadmiar_prog', 1, 'l'],
    [5, 'nadmiar_hist', 1, 'l'], [7, 'dol_maxs', 1, 'l'], [8, 'litr_cm', 10.0, 'l'],
    [9, 'uklad', 1, ['skimmer', 'przelew']], [10, 'dol_limit_l', 1, 'l'],
    [11, 'dol_awaria', 1, 'l'], [12, 'prefill_max', 1, 'l'],
    [13, 'geo_ksztalt', 1, ['prost', 'okrag']], [14, 'geo_a', 100.0, 'l'],
    [15, 'geo_b', 100.0, 'l'], [16, 'geo_d', 100.0, 'l'], [17, 'geo_gl', 100.0, 'l'],
    [18, 'geo_h', 100.0, 'l'], [19, 'dol_autokas', 1, 'b'],
    [20, 'pl_wstepna', 1, 'l'], [22, 'pl_koncowa', 1, 'l'], [23, 'pl_dolewka', 1, 'b'],
    [24, 'pl_ile', 1, 'l'], [25, 'pl_blokuj', 1, 'b'], [26, 'pl_wid_min', 1, 'l'],
    [27, 'pl_wid_max', 1, 'l'], [28, 'cA_prog', 100.0, 'l'], [29, 'cA_min', 1, 'l'],
    [30, 'cB_prog', 100.0, 'l'], [31, 'cC_prog', 100.0, 'l'], [32, 'cC_min', 1, 'l'],
    [33, 'cisn_reakcja', 1, ['pracuj', 'stop']],   /* [D-503] 4600+5 - reakcja na uszkodzenie czujnika cisnienia */
    [34, 'kal_poz_zak', 1, 'l'], [35, 'kal_cis_zak', 100.0, 'l'],
    [36, 'kal_temp_kor', 10.0, 'z'], [37, 'grz_hist', 10.0, 'l'],
    [38, 'kal_poz_off', 1, 'z'], [39, 'kal_cis_off', 100.0, 'z'],
    [40, 'heat_tryb', 1, 'l'], [41, 'heat_prio', 1, 'l'], [42, 'heat_delta', 10.0, 'l'],
    [43, 'heat_min', 1, 'l'],
    [45, 'pl_powt', 1, 'l']        /* zalegle plukanie: ile prob (4560+8), 0 = nie rob [D-233] */
  ];
  /* MN_UKLAD: indeks MN -> [baza rejestru, przesuniecie]; adres = baza + obieg*20 + rel */
  const MN_UKLAD = [];
  for (let r = 0; r < 20; r++) MN_UKLAD.push([4520, r]);
  for (let r = 0; r < 8; r++) MN_UKLAD.push([4560, r]);
  for (let r = 0; r < 6; r++) MN_UKLAD.push([4600, r]);
  for (const r of [2, 5, 6, 7, 8, 9]) MN_UKLAD.push([4640, r]);
  for (let r = 0; r < 4; r++) MN_UKLAD.push([4680, r]);
  MN_UKLAD.push([4680, 4]);      /* [44] numer obiegu bloku - nie nastawa (rejestr nie istnieje) */
  MN_UKLAD.push([4560, 8]);      /* [45] zalegle plukanie: ile prob [D-233] */
  const WYLACZNIKI = [['cA_wl', 4024], ['cB_wl', 4028], ['cC_wl', 4030], ['uv_wl', 4044],
                      ['grz_wl', 4046], ['dol_wl', 4048], ['pluk_wl', 4050]];
  const MAPA_KOD_DO = { 1: 'Pompa filtracyjna', 2: 'Zawór głowicy płuczącej', 3: 'Zawór dolewania',
    4: 'Grzanie — styk 1', 5: 'Grzanie — styk 2', 6: 'Lampa UV', 7: 'Masaż wodny 1', 8: 'Masaż wodny 2',
    9: 'Masaż powietrzny 1', 10: 'Masaż powietrzny 2', 11: 'Atrakcja 1', 12: 'Atrakcja 2',
    13: 'Oświetlenie białe', 14: 'Oświetlenie barwne', 15: 'Zawór trybu cichego' };   /* 15 [D-495, 2026-09-26] */
  const MAPA_KOD_DI = { 1: 'Przełącznik w pozycji AUTO', 2: 'Przełącznik w pozycji HAND',
    3: 'Termik pompy filtracyjnej', 4: 'Przycisk masażu 1', 5: 'Przycisk masażu 2', 6: 'Przycisk światła',
    7: 'Roleta zamknięta', 8: 'Termik pompy masażu 1', 9: 'Termik pompy masażu 2',
    10: 'Wymuszenie zewnętrzne', 11: 'Zanik fazy', 12: 'Przycisk trybu cichego' };   /* 12 [D-495] */
  const AKC_SPOSOBY = ['tylko z ekranu', 'przelacznik', 'na czas', 'na czas, bez przerwania', 'podtrzymanie'];

  /* ---------------------------------------------------------- [3] DEKODOWANIE */
  const i16 = x => (x >= 0x8000 ? x - 0x10000 : x);
  const bit = (v, n) => !!((v >> n) & 1);

  /* linie tekstowe jak po USB: "MB;a,b,c" -> tablica liczb albo null */
  function parsujLinie(txt, prefiks) {
    if (!txt) return null;
    for (const l of txt.split(/\r?\n/)) {
      if (!l.startsWith(prefiks)) continue;
      const w = l.slice(prefiks.length).split(',');
      const out = [];
      for (const x of w) { if (x === '') continue; const n = Number(x); if (!Number.isFinite(n)) return null; out.push(n); }
      return out;
    }
    return null;
  }

  function mapaNazwa(slowo, tabela, obiegiIle) {
    if (slowo === null || slowo === undefined) return null;
    const kod = slowo & 0xFF;
    if (kod === 0) return '';
    let nazwa = tabela[kod];
    if (nazwa === undefined) return 'kod ' + kod;
    if (obiegiIle > 1) nazwa += ' — obieg ' + (((slowo >> 8) & 3) + 1);
    return nazwa;
  }
  function mapaIoNazwy(slDo, slDi, obiegiIle) {
    obiegiIle = obiegiIle || 1;
    if (!slDo && !slDi) return [null, null];
    return [(slDo || []).map(w => mapaNazwa(w, MAPA_KOD_DO, obiegiIle)),
            (slDi || []).map(w => mapaNazwa(w, MAPA_KOD_DI, obiegiIle))];
  }
  /*  WŁASNE NAZWY KANAŁÓW [D-493]: rejestry 4140 + 10*kanał, 2 bajty UTF-8 na słowo (starszy pierwszy),
      19 bajtów + zero. Pusta = ekran pisze nazwę fabryczną; niepusta = „Gejzer (Atrakcja 1)". */
  const AKC_NAZWY_REJ = 4140, AKC_NAZWA_SLOW = 10, AKC_NAZWA_MAX_B = 19;
  function nazwaNaSlowa(tekst) {
    let b = new TextEncoder().encode(String(tekst || '').trim());
    if (b.length > AKC_NAZWA_MAX_B) {                      /* nie tniemy w pół litery */
      let n = AKC_NAZWA_MAX_B; while (n > 0 && (b[n] & 0xC0) === 0x80) n--; b = b.slice(0, n);
    }
    const out = [];
    for (let i = 0; i < AKC_NAZWA_SLOW; i++) out.push(((b[2 * i] || 0) << 8) | (b[2 * i + 1] || 0));
    return out;
  }
  function akcNazwyZRej(g) {
    const out = []; let jest = false;
    for (let k = 0; k < 16; k++) {
      const b = [];
      for (let i = 0; i < AKC_NAZWA_SLOW; i++) {
        const v = g(AKC_NAZWY_REJ + k * AKC_NAZWA_SLOW + i);
        if (v === null) break; jest = true;
        const a = (v >> 8) & 255, c = v & 255;
        if (!a) break; b.push(a); if (!c) break; b.push(c);
      }
      out.push(b.length ? new TextDecoder().decode(new Uint8Array(b)) : '');
    }
    return jest ? out : null;
  }
  function akcNastawyZMn(slowo) {
    if (slowo(68) === null) return null;
    const out = [];
    for (let k = 0; k < 16; k++) {
      const sp = slowo(68 + k * 2), cz = slowo(69 + k * 2);
      out.push({ sposob: sp, czas: cz,
        opis: (sp !== null && sp < AKC_SPOSOBY.length) ? AKC_SPOSOBY[sp] : (sp === null ? null : 'kod ' + sp) });
    }
    return out;
  }
  function funkcjeZMn(w, o, uvZapas) {
    if (w === null || w === undefined) return { uv: uvZapas, grz: null, dol: null, pluk: null };
    return { grz: bit(w, 0 + o), dol: bit(w, 2 + o), pluk: bit(w, 4 + o), uv: bit(w, 6 + o) };
  }
  function profilZSlow(slowa) {
    if (!slowa || slowa.every(s => s === null)) return null;
    let zn = '';
    for (const s of slowa) {
      if (s === null) break;
      const hi = (s >> 8) & 0xFF, lo = s & 0xFF;
      if (hi === 0) break;
      zn += String.fromCharCode(hi);
      if (lo === 0) break;
      zn += String.fromCharCode(lo);
    }
    return zn || null;
  }
  function dataBuilda(slowo) {
    if (!slowo) return null;
    const p2 = n => String(n).padStart(2, '0');
    return (2000 + (slowo >> 9)) + '-' + p2((slowo >> 5) & 0xF) + '-' + p2(slowo & 0x1F);
  }
  /* nastawy z MN: klucze makiety serwisu (N), w jej jednostkach */
  function nastawyZMn(n) {
    const out = {};
    for (const [i, klucz, skala, rodzaj] of MN_NASTAWY) {
      let x = n(i);
      if (x === null || x === undefined) continue;
      if (Array.isArray(rodzaj)) out[klucz] = x ? rodzaj[1] : rodzaj[0];
      else if (rodzaj === 'b') out[klucz] = !!x;
      else { if (rodzaj === 'z') x = i16(x); out[klucz] = skala !== 1 ? x / skala : x; }
    }
    /* POLE 45 = ile prob (bajt dolny) | wlacznik zaleglych << 8 [D-236] - jak most.py */
    if ('pl_powt' in out) { const v = out.pl_powt | 0; out.pl_powt = v & 0xFF; out.pl_zalegle = !!(v & 0x100); }
    /* POLE 128 = korekta temperatury powietrza x10 ze znakiem [D-282]; starszy firmware go nie ma -> pomijamy */
    { const kp = n(128); if (kp !== null && kp !== undefined) out.kal_pow_kor = i16(kp) / 10; }
    return out;
  }
  /* tydzien okien z rejestrow w ukladzie 4300+ (dzien RTClib*8 + okno*2: start|0x8000, stop);
     dzien 0 = poniedzialek. [D-495] wspolne dla filtracji (4300+) i trybu cichego (5000+) -
     kodowanie IDENTYCZNE, jeden dekoder (port okna_z_rejestrow z most.py) */
  function oknaZRejestrow(g, baza) {
    const tydz = [];
    for (let dz = 0; dz < 7; dz++) {
      const b8 = (dz + 1) % 7;
      const okna = [];
      for (let k = 0; k < 4; k++) {
        const a = baza + b8 * 8 + k * 2;
        const s = g(a), e = g(a + 1);
        if (s === null || s === undefined || !(s & 0x8000)) continue;
        okna.push([(s & 0x7FFF) / 60.0, (e || 0) / 60.0]);
      }
      tydz.push(okna);
    }
    return tydz;
  }
  /* harmonogram z rejestrow: g(adr) -> liczba albo null; dzien 0 = poniedzialek.
     [D-495] `cichy` = harmonogram trybu cichego (5000 + o*60) w ksztalcie `filt` */
  function harmZRejestrow(g, o) {
    const filt = oknaZRejestrow(g, 4300 + o * 60), pluk = [];
    for (let dz = 0; dz < 7; dz++) {
      const b8 = (dz + 1) % 7;
      const v = g(4500 + o * 10 + b8);
      pluk.push((v === null || v === undefined || !(v & 0x8000)) ? null : (v & 0x7FFF) / 60.0);
    }
    const sek = g(4560 + o * 20 + 1);
    return { filt: filt, pluk: pluk, sek: sek || 0, cichy: oknaZRejestrow(g, CICHY_HARM + o * CICHY_HARM_KROK) };
  }
  /* TRYB CICHY [D-495, 2026-09-26] - port cichy_z_rejestrow z most.py, 1:1
     WEJSCIA:  rejestry z 06b_tryb_cichy.h [7]: 3328+o stan (bity), 3330+o minuty do konca,
               5120+o*10 +1 sposob / +2 czas. Apka ma je z lustra (paczki `zm`, zakresy SIEC_ZM_R),
               strona na AP i most - z odczytu /rej.
     CO Z CZEGO WYNIKA: bit 0 „funkcja jest" (przelew + zawor przypisany) rozstrzyga o wszystkim -
               bez niego nie ma kafla, bloczka ani sekcji serwisu („nie pokazuj, czego nie ma").
               Lustro apki niesie 0 tam, gdzie rejestru nie da sie odczytac - 0 to tez „nie ma".
     WYJSCIA:  plaskie pola `cichy_*` swiata - te same klucze co w most.py (sonda parytetu). */
  const CICHY_HARM = 5000, CICHY_HARM_KROK = 60, CICHY_NAST = 5120, CICHY_NAST_KROK = 10,
        CICHY_STAN = 3328, CICHY_POZOST = 3330;
  function cichyZRejestrow(g, o) {
    const s = g(CICHY_STAN + o);
    const jest = s !== null && s !== undefined && !!(s & 1);
    if (!jest) return { cichy_jest: false, cichy_zadany: false, cichy_zawor: false, cichy_okno: false,
                        cichy_zwarty: false, cichy_ubytek: false, cichy_ogr: false, cichy_powod: 0, cichy_zostalo: 0,
                        cichy_sposob: null, cichy_czas: null };
    const n = CICHY_NAST + o * CICHY_NAST_KROK;
    return { cichy_jest: true,
             cichy_zadany: bit(s, 1),          /* tryb cichy wlaczony (zadanie) */
             cichy_zawor: bit(s, 2),           /* zawor pod napieciem = ssanie z dna */
             cichy_okno: bit(s, 3),            /* okno trzeciego harmonogramu trwa */
             cichy_zwarty: bit(s, 4),          /* przycisk przy niecce zwarty */
             cichy_ubytek: bit(s, 5),          /* tempo ubytku liczone bilansem trybu cichego */
             cichy_ogr: bit(s, 6),             /* ogranicznik: chwila przerwy po zbyt wielu załączeniach [2026-09-26] */
             cichy_powod: (s >> 8) & 0x0F,     /* 1 pompa stoi, 2 nadmiar, 3 plukanie, 4 brak pomiaru, 5 test */
             cichy_zostalo: g(CICHY_POZOST + o) || 0,
             cichy_sposob: g(n + 1), cichy_czas: g(n + 2) };
  }
  /* zapis przyjety = wartosc JEST w rejestrze -> od razu do pamieci (harmonogram, sposob, czas);
     ⚠ NIE komenda 5120/5130 - tam odczyt niesie STAN, ktory ustala dopiero przebieg sterownika */
  const cichyAdresLustra = adr =>
    (adr >= CICHY_HARM && adr < CICHY_HARM + 2 * CICHY_HARM_KROK && (adr - CICHY_HARM) % CICHY_HARM_KROK < 56)
    || (adr >= CICHY_NAST && adr < CICHY_NAST + 2 * CICHY_NAST_KROK && [1, 2].includes((adr - CICHY_NAST) % CICHY_NAST_KROK));

  /* PAKIET STANU - port swiat_z_bloku(b, obieg) z most.py, 1:1.
     b = 72 slow bloku panelu, mn = tablica MN (albo null), o = obieg */
  function swiatZBloku(b, mn, o) {
    if (!b || b.length < 70) return null;
    const p = b.slice(10 + o * 30, 40 + o * 30);
    if (p.length < 20) return null;
    const v = mn || null;
    const nast = (i, dom) => (v && i < v.length) ? v[i] : (dom === undefined ? 0 : dom);
    const nastOb = (oo, i, dom) => (!v || v.length < 45 || v[44] !== oo) ? (dom === undefined ? 0 : dom) : nast(i, dom);
    const mnSlowo = i => (v && i < v.length) ? v[i] : null;
    const wyp = p[0], st = p[6];
    /* 64 bity alarmow: 4 slowa; BigInt, bo JS liczy bitowo na 32 bitach [D-108] */
    const alarmy = BigInt(b[4]) | (BigInt(b[5]) << 16n)
                 | (BigInt(b.length > 7 ? b[7] : 0) << 32n) | (BigInt(b.length > 8 ? b[8] : 0) << 48n);
    const almBit = n => !!((alarmy >> BigInt(n)) & 1n);
    const alm = bitBasen => almBit(bitBasen + o);
    const mapy = mapaIoNazwy([0, 1, 2, 3, 4, 5, 6, 7].map(i => mnSlowo(52 + i)),
                             [0, 1, 2, 3, 4, 5, 6, 7].map(i => mnSlowo(60 + i)));
    let obiegiIle = 0;
    const obiegiJest = [];
    for (const i of [0, 1]) if (b.length > 10 + i * 30 && (b[10 + i * 30] & 1)) { obiegiIle++; obiegiJest.push(i); }
    return {
      typ: 'swiat',
      hoa: ({ 0: 'auto', 1: 'reka' })[p[14]] || 'stop',
      poziom: i16(p[3]),
      cis: p[4] / 100.0,
      temp: i16(p[1]) / 10.0,
      temp_set: i16(p[2]) / 10.0,
      grzeje: bit(st, 3) || bit(st, 4),
      grzanie_on: bit(st, 12),
      termik: alm(8),
      termikAkc: alm(34),
      awTempPowBrak: almBit(36),
      awOdcQuic: almBit(37), awOdcDziennik: almBit(38),   /* [B.0z-69] */
      awsonda: alm(2), awmano: alm(4), awtemp: alm(6), awtempBrak: alm(28),
      /* [D-241] alarmy kwitowalne bez klucza - jak most.py */
      awDolew: alm(0), awBwNiesk: alm(12), awZuzycie: alm(19), awPrefill: almBit(o === 0 ? 21 : 32), awWyciek: alm(26),
      awRtc: almBit(17), awI2C: almBit(22), awFazy: almBit(23),
      ostrzCis: alm(30),
      zatrzask: bit(st, 7) ? (p[16] & 0xFF) : 0,
      uv_on: bit(st, 5),
      pluk: p[7] !== 0,
      bw_skip_alarm: alm(24), bw_skip_powod: p[17], bw_widelki_powod: p[18],   /* [D-245] */
      bw_pompa_pracowala: bit(st, 13), bw_zalegle: bit(st, 14),
      bw_czeka: bit(st, 10),        /* zadanie plukania odlozone do konca dolewania [D-227] */
      pluk_czas_s: nastOb(o, 21) || null,
      przezn: v ? nast(46 + o) : null,
      /* [2026-09-26] przeznaczenia WSZYSTKICH obiegów (indeks = numer obiegu) - nazwy obiegów w dzienniku i alarmach
         („dolewanie wanna 1”); przy jednym obiegu lista ma jeden element i dopisku nie ma */
      przezn_obiegow: v ? obiegiJest.map(i => nast(46 + i)) : null,
      akc_ist: (nast(48) >> (8 * o)) & 0xFF,
      akc_prac: mnSlowo(116) !== null ? (mnSlowo(116) >> (8 * o)) & 0xFF : null,
      akc_zostalo: [0, 1, 2, 3, 4, 5, 6, 7].map(k => mnSlowo(100 + o * 8 + k)),
      akc_ust: mnSlowo(117) !== null ? (mnSlowo(117) >> (8 * o)) & 0xFF : 0,
      akc_term: mnSlowo(127) !== null ? (mnSlowo(127) >> (8 * o)) & 0xFF : 0,
      akc_wl: (nast(49) >> (8 * o)) & 0xFF,
      obieg_jest: !!(wyp & 1), obieg_nr: o, obiegi_ile: obiegiIle,
      pluk_faza: p[7],
      czas: (b[2] << 16) | b[3],
      pluk_s: p.length > 8 ? p[8] : 0,
      dolewka_proc: p.length > 9 ? p[9] : 0,        /* postep dopelnienia [%] (D-127/D-226) */
      wodaAwaria: bit(st, 11),
      brakuje: p[15], zuzycie24: p[10], parowanie24: i16(p[11]), ubytek_l_h: i16(p[12]),
      bw_zrzut: p[13],
      mies_zrzut: p.length > 27 ? (p[26] | (p[27] << 16)) : 0,
      rok_zrzut: p.length > 29 ? (p[28] | (p[29] << 16)) : 0,
      di_do: b.length > 9 ? b[9] : null,
      adc_poz: p.length > 23 ? p[22] : null, adc_cis: p.length > 23 ? p[23] : null,
      mapa_v: b[0], obiegi: b[1],
      obejscia: { sonda: bit(st, 8), mano: bit(st, 9) },
      poziomStan: { sucho: bit(st, 6), dolewa: bit(st, 2),
                    wymusz: o === 0 ? alm(16) : almBit(18), pompa: bit(st, 0) },
      progiPoz: { start: nastOb(o, 0, 250), stop: nastOb(o, 1, 350), sucho: nastOb(o, 2, 100),
                  nadmiar: nastOb(o, 4, 0), hist: nastOb(o, 5, 0), zak: nastOb(o, 34, 1000),
                  przelew: !!nastOb(o, 9, 0) },
      progiCis: { min: nastOb(o, 28) / 100.0, ostrz: nastOb(o, 31) / 100.0, kryt: nastOb(o, 30) / 100.0,
                  zak: (nastOb(o, 35) || 600) / 100.0 },
      /* [D-503] reakcje na uszkodzenie czujnikow (0 pompa pracuje dalej, 1 zatrzymanie) - hala dopisuje przy
         alarmie „pompa też zatrzymana”, jak panel (hmi_modbus.c). Jak most.py. */
      reakcja: { sonda: nastOb(o, 3, 0), cisn: nastOb(o, 33, 0) },
      nast: { pl_dolewka: !!nastOb(o, 23, 0), pl_ile: nastOb(o, 24, 0), pl_blokuj: !!nastOb(o, 25, 0),
              pl_wstepna: nastOb(o, 20, 10), pl_koncowa: nastOb(o, 22, 10) },
      limit_wody: 0,
      mapa_do: mapy[0], mapa_di: mapy[1],
      akc_nast: akcNastawyZMn(mnSlowo),
      jest_uv: bit(wyp, 7), jest_grz: bit(wyp, 5) || bit(wyp, 6), grz_styk: bit(wyp, 13),
      jest_dol: bit(wyp, 4), jest_pluk: bit(wyp, 3),
      jest_roleta: bit(wyp, 12),     /* styk rolety przypisany [D-234] */
      temp_pow: b.length > 71 ? i16(b[70]) / 10.0 : null,
      temp_pow_stan: b.length > 71 ? b[71] : 0,
      funkcje: funkcjeZMn(mnSlowo(50), o, bit(wyp, 7)),
      zwloka: { grz: p.length > 20 ? p[20] : 0, uv: p.length > 21 ? p[21] : 0 },
      profil: profilZSlow([0, 1, 2, 3, 4, 5, 6, 7].map(i => mnSlowo(118 + i))),
      fw_data: dataBuilda(mnSlowo(126))
    };
  }
  /* DODATKI - port most.dodatki(): harmonogram, nastawy (MN + wylaczniki), srednia miesieczna.
     rej = {adres: wartosc} z /rej; hist pomijamy (strona historii - komenda 12, osobne zadanie) */
  function dodatki(rej, mn, o) {
    const g = a => (a in rej ? rej[a] : null);
    const out = { harm: harmZRejestrow(g, o) };
    let nast = {};
    if (mn && mn.length >= 45 && mn[44] === o) nast = nastawyZMn(i => (i < mn.length ? mn[i] : null));
    for (const [kl, adr] of WYLACZNIKI) { const v = g(adr + o); if (v !== null) nast[kl] = !!v; }
    out.nastawy = nast;
    const lo = g(3061 + 2 * o), hi = g(3062 + 2 * o);
    if (lo !== null) out.sr_mies = ((hi || 0) << 16) | lo;
    const naz = akcNazwyZRej(g); if (naz) out.akc_naz = naz;   /* [D-493] */
    Object.assign(out, cichyZRejestrow(g, o));                   /* [D-495] pola `cichy_*` */
    if (out.cichy_jest) { nast.cichy_sposob = out.cichy_sposob; nast.cichy_czas = out.cichy_czas; }
    return out;
  }
  /* obieg z bloku: pierwszy, ktory istnieje (most dostaje --obieg; na AP wynika z bloku) */
  function obiegZBloku(b) {
    if (b && b.length > 10 && (b[10] & 1)) return 0;
    if (b && b.length > 40 && (b[40] & 1)) return 1;
    return 0;
  }

  /* ---------------------------------------------------------- [4] KOMENDY -> REJESTRY */
  function akcNastawaNaRejestr(klucz, wart) {
    if (!klucz.startsWith('akc')) return null;
    const m = /^akc(\d+)_(sposob|czas)$/.exec(klucz);
    if (!m) return null;
    const nr = parseInt(m[1], 10);
    if (!(nr >= 0 && nr < 16)) return null;
    return [4100 + nr * 2 + (m[2] === 'sposob' ? 0 : 1), Math.round(parseFloat(wart)) & 0xFFFF];
  }
  function nastawaNaRejestr(klucz, wart, o) {
    const para = akcNastawaNaRejestr(klucz, wart);
    if (para) return para;
    const s = String(wart).trim().toLowerCase();
    for (const [k, adr] of WYLACZNIKI) if (k === klucz) return [adr + o, ['1', 'true', 'tak', 'on'].includes(s) ? 1 : 0];
    if (klucz === 'pl_zalegle') return [4560 + o * 20 + 9, ['1', 'true', 'tak', 'on'].includes(s) ? 1 : 0];   /* [D-236] */
    if (klucz === 'kal_pow_kor') return [4068, Math.round(parseFloat(wart) * 10) & 0xFFFF];   /* korekta temp. powietrza - GLOBALNA, bez obiegu [D-282] */
    /* TRYB CICHY [D-495]: poza tabela MN - 5120 + obieg*10 (+1 sposob, +2 czas [min]) */
    if (klucz === 'cichy_sposob') return [CICHY_NAST + o * CICHY_NAST_KROK + 1, Math.round(parseFloat(wart)) & 0xFFFF];
    if (klucz === 'cichy_czas')   return [CICHY_NAST + o * CICHY_NAST_KROK + 2, Math.round(parseFloat(wart)) & 0xFFFF];
    for (const [i, k, skala, rodzaj] of MN_NASTAWY) {
      if (k !== klucz) continue;
      const [baza, rel] = MN_UKLAD[i];
      const adr = baza + o * 20 + rel;
      let w;
      if (Array.isArray(rodzaj)) w = (s === rodzaj[1]) ? 1 : 0;
      else if (rodzaj === 'b') w = ['1', 'true', 'tak', 'on'].includes(s) ? 1 : 0;
      else w = Math.round(parseFloat(wart) * (skala !== 1 ? skala : 1));
      return [adr, w & 0xFFFF];
    }
    return null;
  }
  /* zwraca {zapisy: [[adr, wart], ...]} albo {blad: '...'} */
  function komendaNaZapisy(co, wart, o) {
    const w = (wart === undefined || wart === null) ? '' : String(wart);
    if (co === 'rej') {
      const [a, v] = w.split(':'); const adr = parseInt(a, 10), val = parseInt(v, 10);
      if (!Number.isFinite(adr) || !Number.isFinite(val)) return { blad: 'format: wart="adres:wartosc"' };
      return { zapisy: [[adr, val]] };
    }
    if (co === 'akc') {
      const [k, s] = w.split(':'); const kan = parseInt(k, 10), st = parseInt(s, 10);
      if (!Number.isFinite(kan) || !Number.isFinite(st)) return { blad: 'format: wart="kanal:1/0"' };
      return { zapisy: [[4067, ((kan & 0xFF) << 8) | (st ? 1 : 0)]] };
    }
    if (co === 'nastawa') {
      const i = w.indexOf(':'); if (i < 0) return { blad: 'format: wart="klucz:wartosc"' };
      const mNaz = /^akc(\d+)_nazwa$/.exec(w.slice(0, i));       /* [D-493] nazwa = dziesięć słów */
      if (mNaz) {
        const k = parseInt(mNaz[1], 10); if (!(k >= 0 && k < 16)) return { blad: 'kanał poza zakresem' };
        if (new TextEncoder().encode(w.slice(i + 1).trim()).length > AKC_NAZWA_MAX_B)
          return { blad: 'nazwa za długa - najwyżej ' + AKC_NAZWA_MAX_B + ' bajtów (polska litera liczy się podwójnie)' };
        return { zapisy: nazwaNaSlowa(w.slice(i + 1)).map((s, j) => [AKC_NAZWY_REJ + k * AKC_NAZWA_SLOW + j, s]) };
      }
      const para = nastawaNaRejestr(w.slice(0, i), w.slice(i + 1), o);
      return para ? { zapisy: [para] } : { blad: 'nieznana nastawa: ' + w.slice(0, i) };
    }
    if (co === 'temp-set') { const t = Math.max(10, Math.min(40, parseFloat(w))); return { zapisy: [[4000 + o, Math.round(t * 10)]] }; }
    if (co === 'grzanie') return { zapisy: [[4002 + o, (w === 'true' || w === '1') ? 1 : 0]] };
    if (co === 'kasuj-zatrzask') return { zapisy: [[4022 + o, 1]] };
    if (co === 'kasuj-awarie-wodna') return { zapisy: [[4052 + o, 1]] };
    if (co === 'reset-wody') return { zapisy: [[4054 + o, 1]] };
    if (co === 'plukaj') return { zapisy: [[4006 + o, 1]] };
    if (co === 'kasuj-alarm') return { zapisy: [[4008, parseInt(w, 10)]] };
    if (co === 'zdejmij-ochrony') return { zapisy: [[4062, parseInt(w, 10) & 0x7F]] };
    if (co === 'wycisz-alarmy') {
      let m; try { m = BigInt(w); } catch (e) { return { blad: 'wycisz-alarmy: oczekiwana liczba 64-bit' }; }
      return { zapisy: [0, 1, 2, 3].map(i => [4058 + i, Number((m >> BigInt(16 * i)) & 0xFFFFn)]) };
    }
    if (co === 'ustaw-czas') {
      /* most: unix = timegm(localtime) - sterownik chodzi na czasie lokalnym */
      const unix = /^\d+$/.test(w) ? parseInt(w, 10) : Math.floor(Date.now() / 1000 - new Date().getTimezoneOffset() * 60);
      return { zapisy: [[4034, (unix >> 16) & 0xFFFF], [4035, unix & 0xFFFF]] };
    }
    if (['hoa', 'termik', 'termikm', 'przycisk', 'poz', 'cis', 'model', 'zrzut', 'parowanie', 'wy', 'stan', 'we',
         'mapa', 'spocz', 'czujnik', 'zakres'].includes(co))
      return { blad: 'komenda testera - na stronie ze sterownika nie ma testera' };
    return { blad: 'nieznana komenda: ' + co };
  }

  /* ---------------------------------------------------------- [5] KLIENT AP */
  const M = {
    tryb: null,            /* null = nieaktywny, 'ap' = strona ze sterownika */
    obieg: 0,
    ost: { mb: null, mn: null, t: null, k: null, rej: {} },
    /* liczy pakiet z surowych danych (uzywa tez sonda parytetu pod mostem) */
    swiatZ(mbTxt, mnTxt, rej, o) {
      const mb = Array.isArray(mbTxt) ? mbTxt : parsujLinie(mbTxt, 'MB;');
      const mn = Array.isArray(mnTxt) ? mnTxt : parsujLinie(mnTxt, 'MN;');
      if (!mb) return null;
      if (o === undefined || o === null) o = obiegZBloku(mb);
      const s = swiatZBloku(mb, mn, o);
      if (!s) return null;
      return Object.assign(s, dodatki(rej || {}, mn, o));
    },
    komendaNaZapisy, nastawaNaRejestr, nastawyZMn, harmZRejestrow, cichyZRejestrow, swiatZBloku, parsujLinie, dodatki, obiegZBloku,
    MN_NASTAWY, MN_UKLAD, WYLACZNIKI,

    /* pobierz rejestry /rej po 16 (jak most po USB) do M.ost.rej */
    async rejestry(o) {
      const zakresy = [[4300 + o * 60, 56], [4500 + o * 10, 7], [4560 + o * 20 + 1, 1], [4024, 28], [3061 + 2 * o, 2],
                       /* TRYB CICHY [D-495]: stan (oba obiegi), zadanie/sposob/czas, harmonogram */
                       [CICHY_STAN, 4], [CICHY_NAST + o * CICHY_NAST_KROK, 3], [CICHY_HARM + o * CICHY_HARM_KROK, 56]];
      /* nazwy kanałów [D-493] - 160 słów, rzadko się zmieniają: co minutę, nie co 10 s */
      if (!M.ost.nazwyMs || Date.now() - M.ost.nazwyMs > 60000) { zakresy.push([AKC_NAZWY_REJ, 160]); M.ost.nazwyMs = Date.now(); }
      const c = Object.assign({}, M.ost.rej);
      for (const [adr, ile] of zakresy) {
        for (let start = adr; start < adr + ile; start += 16) {
          const n = Math.min(16, adr + ile - start);
          try {
            const r = await fetch('/rej?adr=' + start + '&ile=' + n, { cache: 'no-store' });
            const d = await r.json();
            if (d && Array.isArray(d.wartosci)) d.wartosci.forEach((x, i) => { if (x !== null) c[start + i] = x; });
          } catch (e) { return; }
        }
      }
      M.ost.rej = c;
    },
    /* TRYB CICHY - STAN CO SEKUNDE [D-495]: kafel stoi na rejestrach, nie na bloku, wiec przy /rej
       co 10 s dotkniecie kafla albo przycisk przy niecce pokazywaly sie po kilku sekundach.
       Dwa krotkie odczyty (stan 3328-3331, zadanie 5120+o*10) i TYLKO gdy funkcja jest. */
    async rejestryCichy(o) {
      if (!((M.ost.rej[CICHY_STAN + o] || 0) & 1)) return;
      const c = Object.assign({}, M.ost.rej);
      for (const [adr, ile] of [[CICHY_STAN, 4], [CICHY_NAST + o * CICHY_NAST_KROK, 1]]) {
        try {
          const r = await fetch('/rej?adr=' + adr + '&ile=' + ile, { cache: 'no-store' });
          const d = await r.json();
          if (d && Array.isArray(d.wartosci)) d.wartosci.forEach((x, i) => { if (x !== null) c[adr + i] = x; });
        } catch (e) { return; }
      }
      M.ost.rej = c;
    },
    /* jedna komenda: zapisy po kolei, wynik z /blok.txt (linia K;nr,adr,wart,wynik) */
    async wyslij(co, wart) {
      const t = komendaNaZapisy(co, wart, M.obieg);
      if (t.blad) return { ok: false, opis: t.blad };
      let ostOpis = '';
      for (const [adr, val] of t.zapisy) {
        let nr = 0;
        try {
          const r = await fetch('/cmd?adr=' + adr + '&wart=' + val, { cache: 'no-store' });
          const txt = await r.text();
          if (!r.ok) return { ok: false, opis: 'sterownik: ' + txt };
          const m = /;(\d+)/.exec(txt); nr = m ? parseInt(m[1], 10) : 0;
        } catch (e) { return { ok: false, opis: 'sterownik nie odpowiada: ' + e }; }
        /* wynik: petla logiki wykonuje kolejke w nastepnym ticku; czekamy max 2 s */
        let wynik = null;
        for (let i = 0; i < 20 && nr; i++) {
          await new Promise(res => setTimeout(res, 100));
          try {
            const r = await fetch('/blok.txt', { cache: 'no-store' }); const txt = await r.text();
            const k = parsujLinie(txt, 'K;');
            if (k && k[0] >= nr) { wynik = k; break; }
          } catch (e) { break; }
        }
        if (wynik && wynik[0] === nr && wynik[3] !== 0)
          return { ok: false, opis: 'sterownik ODMOWIL zapisu ' + adr + '=' + val + ' (kod ' + wynik[3] + ')' };
        /*  BRAK POTWIERDZENIA TO NIE JEST SUKCES [D-318, audyt etapu 3 pkt 6; zasada 10].
            Czekamy dwie sekundy na linię `K;` z numerem NASZEJ komendy. Gdy nie przyjdzie - albo
            przyjdzie numer dalszy, czyli nasz wynik już przepadł - sterownik mógł wykonać i mógł
            odmówić, a apka nie wie która. Dawniej wracało wtedy „ok" i użytkownik widział
            „zrobione" nad rzeczą, która się nie stała. Teraz mówimy prawdę i odsyłamy do ekranu. */
        if (!wynik || wynik[0] !== nr)
          return { ok: false, nieznany: true, opis: 'sterownik nie potwierdził zapisu ' + adr + '=' + val + ' - sprawdź na ekranie' };
        ostOpis = 'rejestr ' + adr + ' <- ' + val;
        /* [D-495] przyjety zapis harmonogramu / nastaw trybu cichego od razu w pamieci - inaczej
           ekran po wyjsciu z edytora wracal na 10 s do stanu sprzed zmiany (wyglada jak odmowa) */
        if (cichyAdresLustra(adr)) M.ost.rej = Object.assign({}, M.ost.rej, { [adr]: val & 0xFFFF });
      }
      return { ok: true, opis: ostOpis };
    },
    /* start trybu AP: podaj(d) dostaje {polaczony, swiat, wiek_s} jak z most.html */
    start(podaj) {
      if (M.tryb) return;
      M.tryb = 'ap';
      /* przechwycenie fetch('/cmd?co=...') - makieta ma 9 miejsc, ktore wolaja most tak,
         jak most.html; tu tlumaczymy na rejestry i odpowiadamy tym samym JSON-em */
      const f0 = window.fetch.bind(window);
      window.fetch = function (u, opt) {
        const s = String(u);
        if (s.startsWith('/cmd?co=')) {
          const q = new URLSearchParams(s.slice(5));
          return M.wyslij(q.get('co'), q.get('wart')).then(r =>
            new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return f0(u, opt);
      };
      let licz = 0;
      const cykl = async () => {
        let txt = null;
        try { const r = await fetch('/blok.txt', { cache: 'no-store' }); if (r.ok) txt = await r.text(); } catch (e) { txt = null; }
        const mb = parsujLinie(txt, 'MB;'), mn = parsujLinie(txt, 'MN;'), t = parsujLinie(txt, 'T;');
        M.ost.mb = mb; M.ost.mn = mn; M.ost.t = t; M.ost.k = parsujLinie(txt, 'K;');
        if (mb) M.obieg = obiegZBloku(mb);
        if (licz % 10 === 0) await M.rejestry(M.obieg);
        else await M.rejestryCichy(M.obieg);        /* [D-495] stan trybu cichego co 1 s, gdy funkcja jest */
        licz++;
        /* wiek bloku: T;ms_od_MB,ms_od_MN,uptime - sterownik nadaje blok co ~1 s */
        const wiek = t ? t[0] / 1000 : null;
        const polaczony = !!mb && (wiek === null || wiek < 5);
        const swiat = polaczony ? M.swiatZ(mb, mn, M.ost.rej, M.obieg) : null;
        podaj({ polaczony: polaczony && !!swiat, swiat: swiat, wiek_s: wiek === null ? 0 : wiek });
        setTimeout(cykl, 1000);
      };
      cykl();
    }
  };
  /* wystawione dla makiety: dziennik zdarzeń tłumaczy numer rejestru na etykietę nastawy [D-295] */
  M.nastawaNaRejestr = (klucz, wart, o) => nastawaNaRejestr(klucz, wart, o);
  /* ---------------------------------------------------------- [6] KLIENT CHMURY (MQTT)
     [Tomasz 2026-09-08: „a gdyby apka budowała się na podstawie MQTT jak HMI?"]
     WEJŚCIA:  broker po WebSocket TLS (HiveMQ 8884), temat `basen/+/+/blok` -
               sterownik publikuje tam DOKŁADNIE to, co daje pod /blok.txt.
     CO Z CZEGO WYNIKA: ten sam swiatZ() co dla strony na AP; obiekt wybiera
               parametr ?obiekt= albo pierwszy, który się odezwie. Świeżość
               liczymy od ODBIORU pakietu, nie z linii T; (ta mówi o wieku
               bloku w sterowniku, nie o drodze przez chmurę).
     WYJŚCIA:  podaj({polaczony, swiat, wiek_s, obiekty}) - jak z mostu i z AP.
     ⛔ NIC NIE PUBLIKUJEMY. Każde fetch('/cmd?…') dostaje odmowę z powodem
        „podgląd przez chmurę - sterowanie z panelu w szafie" [D-47]. Kafle
        wyglądają 1:1, ale są martwe - i mówią dlaczego. */
  M.startMqtt = function (podaj, o) {
    if (M.tryb) return;
    M.tryb = 'mqtt';
    const Klient = window.Paho && (Paho.Client || (Paho.MQTT && Paho.MQTT.Client));
    if (!Klient) { podaj({ polaczony: false, swiat: null, wiek_s: null, blad: 'brak biblioteki MQTT (cdnjs)' }); return; }
    /*  KONTO OBIEKTU WIDZI TYLKO SWÓJ OBIEKT [D-306, Tomasz 2026-09-11 00:05: „rozumiem, że ten link prowadzi do
        sadzawki albo basenu"]. Użytkownik brokera = slug nazwy sterownika („Gliczarów wanna" → gliczarow-wanna);
        temat obiektu = 'basen/' + slug z PIERWSZYM myślnikiem zamienionym na '/' → 'basen/gliczarow/wanna' - taki sam
        prefiks wpisuje się w sterowniku (serwis → sieć). Konto bez myślnika (serwisowe: „sterownik") widzi wszystko.
        To filtr po stronie apki; twarde odcięcie tematów per konto da dopiero ACL na własnym Mosquitto. */
    /*  KTO WIDZI CO [D-312]: `serwis` przychodzi z logowania (ptaszek „konto serwisowe"). Gdy go nie ma - zapis
        sprzed 11.09 - zostaje stara zasada (login bez myślnika = serwisowy), żeby zapamiętane logowanie nie padło.
        ⚠ Sama zasada była dziurawa: klient o jednoczłonowej nazwie („Sadzawka") dostawał widok na wszystkie obiekty. */
    /*  ZAKRES TEMATOW - DWIE POSTACI NAZW NARAZ  [D-439, Tomasz 2026-09-18]
        ═══════════════════════════════════════════════════════════════════════════════════════
        WEJSCIA:   nazwa konta na brokerze · ptaszek „konto serwisowe"
        CO Z CZEGO WYNIKA: nowa postac tematu to `obiekt/<nazwa konta>` - DWA poziomy, a nazwa
                   obiektu jest wprost nazwa konta. Stara to `basen/<a>/<b>` - trzy poziomy,
                   gdzie temat powstawal przez zamiane pierwszego myslnika na ukosnik.
        WYJSCIA:   LISTA wzorcow, od najnowszego. Pierwszy sluzy tez za opis na ekranie.

        ⚠ OBA NARAZ, BO FLOTA PRZECHODZI POJEDYNCZO. Sterownik dostaje nowy prefiks przy wizycie
          na obiekcie, wiec przez jakis czas czesc obiektow nadaje pod `basen/`, a czesc pod
          `obiekt/`. Gdyby apka znala tylko jedna postac, wpiecie jednego obiektu odcinaloby
          serwisowi widok na pozostale.
        ⚠ Stara postac ZNIKNIE, gdy ostatni sterownik przejdzie - wtedy zostaje sama pierwsza
          pozycja listy (DOZROBIENIA: migracja prefiksu). */
    const zakresZ = (uzyt, serwis) => { const u = String(uzyt || ''); const i = u.indexOf('-');
      const serw = (serwis === undefined || serwis === null) ? (i <= 0) : !!serwis;
      if (serw) return ['obiekt/+', 'basen/+/+'];
      /*  Klient: nowy temat to wprost nazwa konta; stary wymagal rozbicia po pierwszym mysliku. */
      const stary = i > 0 ? 'basen/' + u.slice(0, i) + '/' + u.slice(i + 1) : 'basen/' + u + '/+';
      return ['obiekt/' + u, stary]; };
    const serwisowe = (o.serwis === undefined || o.serwis === null)
                      ? (String(o.user || '').indexOf('-') <= 0)   /* stary zapis: login bez myslnika = serwisowy */
                      : !!o.serwis;
    /*  [D-439] `temat` zostaje NAPISEM (opis na ekranie, zgodnosc z zapamietanym logowaniem),
        a `tematy` to lista wzorcow, ktorymi naprawde sie zapisujemy. Rozdzielenie jest celowe:
        ekran ma pokazac jedno zdanie, a nasluch ma objac obie postaci nazw. */
    if (!o.temat) { const lista = zakresZ(o.user, o.serwis);
      o.tematy = lista; o.temat = lista[0];
      /*  Konto jednego obiektu (bez `+` w zadnym wzorcu) samo wskazuje, ktory obiekt otworzyc. */
      if (lista.every(t => t.indexOf('+') < 0) && !o.obiekt) o.obiekt = lista[0]; }
    if (!o.tematy) o.tematy = [o.temat];
    M.zakres = o.temat;   /* [D-312] widoczne dla sond i diagnostyki: co to konto ogląda */
    M.zakresy = o.tematy;
    /*  KOMENDY PRZEZ BROKER [D-267, Tomasz: „apka nie musi mieć uprawnień, bo
        serwis za PIN-em, a reszta dla klienta"]. fetch('/cmd?co=…') z makiety
        tłumaczymy jak dla AP (komendaNaZapisy → lista zapisów rejestrów) i
        publikujemy na `<prefiks>/komenda` w formacie sterownika:
          t=<unix>;pin=<gdy trzeba>;w=<adr>:<wart>,…
        Wynik wraca tematem `wynik` (kod + zdanie) — pokazujemy go w pasku.
        PIN: pytamy raz, gdy sterownik odpowie kodem 3 (rejestr serwisowy),
        i trzymamy do zamknięcia karty. Klient (temperatura, grzanie, światło,
        atrakcje) nigdy o PIN nie jest pytany. */
    let pinSerwis = null, czekaWynik = null, czekaWynikPref = null;   /* [PWA-7] wynik bez id: tylko od sterownika, ktorego pytalismy */
    /*  ID KOMENDY [D-289, audyt 3.8]: `wynik` nie mówił, na którą komendę odpowiada - dwie szybkie komendy
        i pierwsza dostawała „nie potwierdził w 5 s". Każda komenda niesie `id=`, sterownik odsyła je
        w `wynik` (i odsiewa powtórki - druga droga/dup QoS1 nie przestawia kanału dwa razy). Mapa
        oczekujących po id; `czekaWynik` zostaje dla starego firmware (wynik bez id).
        POMIAR W APCE (C6): czas komenda→wynik i komenda→pierwsza paczka zmian po nim idą do dziennika
        („PRZEZ CHMURĘ" na pasku) i do M.pomiar - żeby wiedzieć, jak jest NA TELEFONIE, nie na PC. */
    const oczekuja = new Map(); let idLicz = Math.floor(Math.random() * 9e5) * 1000;
    const nowyId = () => ++idLicz;
    M.pomiar = { wynik_ms: null, zmiana_ms: null, ile: 0 };
    let czekamZmiany = null;              /* {t0, co} - pierwsza paczka zm/blok po komendzie = jej skutek */
    const odnotujZmiane = () => { if (!czekamZmiany) return; const ms = Date.now() - czekamZmiany.t0;
      if (ms < 4000) { M.pomiar.zmiana_ms = ms; zapisz('zmiana po komendzie ' + czekamZmiany.co + ': ' + ms + ' ms'); } czekamZmiany = null; };
    /*  LUSTRO Z PEŁNEGO BLOKU I PACZEK ZMIAN [D-277, Tomasz: „jak Loxone - tylko rejestry, które
        uległy zmianie, co minutę wszystkie kontrolnie"]. Pełny blok (retained, co 60 s i na
        `zadanie`) niesie MB;/MN;/T; jak /blok.txt oraz R;<adr>,<ile>,<v>… (rejestry 3000+,
        4000+, 4300+, 4700+) i Z;<seq>,<unix>. Paczki `zm` {seq,t,mb:{i:v},mn:{i:v},r:{adr:v}}
        nakładamy na tablice obiektu. Luka w seq → prosimy o pełny (`zadanie`). Ekrany serwisu
        czytają /rej Z LUSTRA - bez pytania sterownika. */
    const HASLA_REJ = a => (a >= 4767 && a <= 4782) || (a >= 4800 && a <= 4815) || (a >= 4875 && a <= 4890) || (a >= 4970 && a <= 4985);
    /*  ILE WSTECZ TO JESZCZE „spóźniona kopia" [D-338 — liczba miała nazwę dopiero tutaj].
        Mniejszy skok numeru w tył = ta sama paczka, która przyszła drugą drogą później — pomijamy.
        Większy = restart sterownika albo przewinięcie licznika — wtedy to, co przyszło, JEST prawdą. */
    const SEQ_SKOK_RESTART = 1000;
    /*  PROŚBA O PEŁNY BLOK NIE CZĘŚCIEJ NIŻ CO TYLE [ms, D-338 cz. 2 — zmierzone na stanowisku].
        Przy zalewie (20 komend na sekundę) powstawała pętla sprzężenia: luka → prośba o pełny blok
        → blok 4,5–7 kB wchodzi do skrzynki numerowanej sterownika → opóźnia potwierdzenia
        → więcej luk → więcej próśb. Lekarstwo musi być rzadsze niż choroba.
        Dwie sekundy to ta sama liczba, po której zasłaniamy ekran przy nierozwiązanej luce —
        czyli prośba zdąży wrócić, zanim człowiek cokolwiek zauważy. */
    const PELNY_ODSTEP_MS = 2000;
    let _pelnyOst = 0;
    const prosPelny = (powod) => {
        const teraz = Date.now();
        if (teraz - _pelnyOst < PELNY_ODSTEP_MS) return false;   /* już prosiliśmy — blok jest w drodze */
        _pelnyOst = teraz;
        oglos('pelny');
        return true;
    };
    const zastosujPelny = (pref, w, txt) => {
      const mb = parsujLinie(txt, 'MB;'), mn = parsujLinie(txt, 'MN;');
      if (mb) w.mb = mb; if (mn) w.mn = mn;
      const r = {};
      for (const l of txt.split(/\r?\n/)) if (l.startsWith('R;')) {
        const p = l.slice(2).split(','); const a0 = +p[0], n = +p[1];
        for (let i = 0; i < n && 2 + i < p.length; i++) r[a0 + i] = +p[2 + i];
      }
      if (Object.keys(r).length) w.r = r;
      if (nazwyR[pref]) { if (!w.r) w.r = {}; Object.assign(w.r, nazwyR[pref]); }   /* nazwy kanałów spoza bloku [D-493] */
      const z = parsujLinie(txt, 'Z;');
      if (z && z.length) { w.seq = z[0]; if (z[1]) zegar[pref] = { czas: z[1], kiedy: Date.now() };
                           if (z.length > 2 && z[2] != null) w.u = z[2]; }   /* [D-481] numer uruchomienia sterownika */
      w.txt = txt;
    };
    const zegar = {};                       // prefiks -> { czas: unix sterownika, kiedy: Date.now() odbioru }
    /*  DOSTĘPNOŚĆ TYLKO Z DRÓG, KTÓRE ŻYJĄ [D-481, audyt Astry 20.09 „spójność" P2]. `statusy` trzyma
        ostatni `status` per broker; „online" liczy się, jeśli CHOĆ JEDEN broker tak mówi [D-314]. Ale wpis
        z drogi, która się ZERWAŁA, to „ostatnio online", nie „teraz online" — a przeważał nad świeżym
        „offline" z działającej drogi. Zerwany broker traci głos: jego wpis kasujemy przy zerwaniu
        (`statusBezDrogi`), a status liczymy na nowo z tego, co zostało. Gdy nie zostało nic — „?",
        nie „online" i nie „offline" (nie wiemy, więc nie udajemy). */
    const przeliczStatus = w0 => {
      const lista = Object.values(w0.statusy || {});
      w0.status = lista.indexOf('online') >= 0 ? 'online' : (lista.indexOf('offline') >= 0 ? 'offline' : '?');
    };
    const statusBezDrogi = nr => {
      for (const p in obiekty) { const w0 = obiekty[p]; if (w0 && w0.statusy && (nr in w0.statusy)) { delete w0.statusy[nr]; przeliczStatus(w0); } }
    };
    const f0 = window.fetch.bind(window);
    window.fetch = function (u, opt) {
      const s = String(u);
      if (s.startsWith('/rej')) {                                   /* rejestry z lustra [D-277] */
        const q = new URLSearchParams(s.slice(s.indexOf('?') + 1));
        const adr = +q.get('adr') || 0, ile = Math.max(1, +q.get('ile') || 1);
        const w = wybrany && obiekty[wybrany]; const out = []; let hasla = 1;
        for (let i = 0; i < ile; i++) { const v = (w && w.r) ? w.r[adr + i] : undefined; out.push(v === undefined ? null : v); if (HASLA_REJ(adr + i)) hasla = 0; }
        return Promise.resolve(new Response(JSON.stringify({ adr, ile, wartosci: out, hasla }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      /*  KARTA SD PRZEZ BROKER [D-297]: /pliki?kat= i /plik?kat=&nazwa=[&json=1] - to samo, co daje most po USB,
          tu przez `zadanie`=pliki:<kat> / plik:<kat>/<nazwa>:<od> i tematy `pliki`/`plik` (kawałki do końca). */
      if (s.startsWith('/pliki')) {
        const q = new URLSearchParams(s.slice(s.indexOf('?') + 1)); const kat = q.get('kat') || 'zdarzenia';
        const odp = o => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (!wybrany || !klGot(wybrany)) return Promise.resolve(odp({ karta: null, pliki: [] }));
        /*  [PWA-6, Astra 13] NOWA PROSBA KONCZY POPRZEDNIA - wynikiem „zastapiona", nie porzuceniem (porzucona
            obietnica = ekran na zawsze „odswiezam…"). */
        if (czekaPliki) { const st = czekaPliki; czekaPliki = null; clearTimeout(st.t); st.res(odp({ karta: null, pliki: [], blad: 'prośba zastąpiona nowszą' })); }
        return new Promise(res => { czekaPliki = { kat, res, pref: wybrany, t: setTimeout(() => { if (czekaPliki && czekaPliki.res === res) { czekaPliki = null; res(odp({ karta: null, pliki: [] })); } }, 8000) }; oglos('pliki:' + kat); }).then(r => r);
      }
      if (s.startsWith('/okres')) {               /* zdarzenia z okresu [D-298]: kawałki aż dalej=0 */
        const q = new URLSearchParams(s.slice(s.indexOf('?') + 1)); const kat = q.get('kat') || 'zdarzenia', od = +q.get('od') || 0, dok = +q.get('do') || 0;
        if (!wybrany || !klGot(wybrany)) return Promise.resolve(new Response(JSON.stringify({ blad: 'brak połączenia' }), { status: 200 }));
        const stara = czekaOkres[kat];      /* [D-348] ta sama kategoria pyta ponownie - zamknij poprzednia */
        if (stara) { clearTimeout(stara.t); delete czekaOkres[kat];
                     stara.res(new Response(JSON.stringify({ blad: 'prośba zastąpiona nowszą' }), { status: 200 })); }
        return new Promise(res => {
          const c = { kat, od, dok, poz: 0, linie: [], res, t: null, pref: wybrany };   /* pref: kogo pytamy [2026-09-26] */
          czekaOkres[kat] = c;
          const nastepny = () => { oglos('okres:' + kat + ':' + od + ':' + dok + ':' + c.poz);   /* poz = kursor z odpowiedzi [D-300] */
            c.t = setTimeout(() => { if (czekaOkres[kat] === c) { delete czekaOkres[kat]; res(new Response(JSON.stringify({ blad: 'sterownik nie odesłał okresu w 10 s' }), { status: 200 })); } }, 10000); };
          c.nastepny = nastepny; nastepny();
        });
      }
      if (s.startsWith('/plik?')) {
        const q = new URLSearchParams(s.slice(s.indexOf('?') + 1)); const kat = q.get('kat') || 'zdarzenia', nazwa = q.get('nazwa') || '', json = q.get('json') === '1';
        if (!wybrany || !klGot(wybrany) || !nazwa) return Promise.resolve(new Response(JSON.stringify({ blad: 'brak połączenia' }), { status: 200 }));
        /*  [PWA-6, Astra 13] drugie pobranie w trakcie pierwszego: pierwsze konczy sie bledem „zastapione" -
            dawniej `czekaPlik` byl po prostu nadpisywany, a obietnica pierwszego nie rozwiazywala sie nigdy. */
        if (czekaPlik) { const st = czekaPlik; czekaPlik = null; clearTimeout(st.t);
                         st.res(new Response(JSON.stringify({ blad: 'prośba zastąpiona nowszą' }), { status: 200 })); }
        return new Promise(res => {
          czekaPlik = { kat, nazwa, od: 0, tekst: '', res, json, t: null, pref: wybrany };
          const nastepny = () => { oglos('plik:' + kat + '/' + nazwa + ':' + czekaPlik.od);
            czekaPlik.t = setTimeout(() => { if (czekaPlik && czekaPlik.res === res) { czekaPlik = null; res(new Response(JSON.stringify({ blad: 'sterownik nie odesłał pliku w 10 s' }), { status: 200 })); } }, 10000); };
          czekaPlik.nastepny = nastepny; nastepny();
        });
      }
      if (!s.startsWith('/cmd')) return f0(u, opt);
      const q = new URLSearchParams(s.slice(s.indexOf('?') + 1));
      const co = q.get('co') || 'rej', wart = q.get('wart');
      const tr = komendaNaZapisy(co, wart, M.obieg);
      const odp = o => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (tr.blad) return Promise.resolve(odp({ ok: false, opis: tr.blad }));
      if (!wybrany || !klGot(wybrany)) return Promise.resolve(odp({ ok: false, opis: 'brak połączenia z brokerem' }));
      const wyslij = pin => new Promise(res => {
        /* ZEGAR STEROWNIKA, nie telefonu: DS3231 chodzi w czasie lokalnym, telefon
           liczy UTC - 2 h różnicy odbijało każdą komendę kodem 2 („sprawdź zegar").
           Sterownik nadaje `czas` w `stan`; liczymy od niego + ile minęło u nas. */
        const zg = zegar[wybrany];
        const tSter = zg ? Math.floor(zg.czas + (Date.now() - zg.kiedy) / 1000) : Math.floor(Date.now() / 1000);
        const id = nowyId(), t0 = Date.now(), coTxt = co + (wart != null ? '=' + wart : '');
        const tresc = 't=' + tSter + ';id=' + id + (pin ? ';pin=' + pin : '') + ';w=' + tr.zapisy.map(z => z[0] + ':' + z[1]).join(',');
        const msg = new Paho.Message(tresc); msg.destinationName = wybrany + '/komenda'; msg.qos = 1;
        const kk = klGot(wybrany);   /* [D-313] brokerem, którym ten obiekt nadaje; mógł paść między sprawdzeniem a wysyłką */
        if (!kk) { res({ ok: false, opis: 'brak połączenia z brokerem' }); return; }
        oczekuja.set(id, { res, t0, co: coTxt, pref: wybrany }); czekaWynik = res; czekaWynikPref = wybrany;   /* [PWA-7] {sterownik, id} */
        czekamZmiany = { t0, co: coTxt };
        kk.send(msg);
        setTimeout(() => { if (oczekuja.has(id)) { oczekuja.delete(id); if (czekaWynik === res) czekaWynik = null;
                                                   zapisz('bez wyniku 5 s: ' + coTxt); res({ ok: false, opis: 'sterownik nie potwierdził komendy w 5 s' }); } }, 5000);
      });
      return wyslij(pinSerwis).then(r => {
        if (r.kod === 3 && !pinSerwis) {           // rejestr serwisowy - raz zapytaj o PIN i powtórz
          const p = prompt('Ta zmiana wymaga PIN-u serwisowego sterownika:', '');
          if (!p) return odp({ ok: false, opis: 'bez PIN-u serwisowego' });
          pinSerwis = p;
          return wyslij(pinSerwis).then(r2 => { if (r2.kod === 3) pinSerwis = null; return odp(r2); });
        }
        return odp(r);
      });
    };
    const obiekty = {};                 /* prefiks -> {txt, kiedy, status} */
    /*  WŁASNE NAZWY KANAŁÓW [D-493]: temat `nazwy` (retained, „kanał;nazwa" w liniach) zamieniamy na słowa
        rejestrów 4140+ - te same, które strona na AP czyta z /rej - i doklejamy do lustra przy każdym pełnym
        bloku (blok podmienia całe `w.r`). Dekodowanie jest jedno: dodatki() → akc_naz. */
    const nazwyR = {};                  /* prefiks -> {adres: słowo} */
    const zdarzenia = {};               /* prefiks -> {ile, zgubione, wpisy[[czas,kat,kod,zr,ob,a,b,c]]} [D-295] */
    let czekaPliki = null, czekaPlik = null;                      /* prośby o listę / plik z karty SD [D-297] */
    let czekaZapas = null;                                        /* [D-412] kto czeka na meldunek o rezerwie */
    const _spisy = {};                            /* [D-429] obieg -> droga -> {s, kiedy, zastany} */
    /*  Ktoremu spisowi wierzyc, gdy drogi podaja rozne [D-429]:
        1. z drogi, ktora obiekt NADAJE - tylko ona jest z definicji swieza;
        2. najswiezszy NIEZASTANY (sterownik wlasnie go oglosil);
        3. w ostatniej kolejnosci najnowszy jakikolwiek - lepszy niz nic. */
    const _spisWybrany = pref => {
      const d = _spisy[pref]; if (!d) return null;
      const w = obiekty[pref];
      const nios = w && w.kl && w.kl.nr;
      if (nios && d[nios]) return d[nios].s;
      const lista = Object.keys(d).map(k => d[k]);
      const swieze = lista.filter(x => !x.zastany).sort((a, b) => b.kiedy - a.kiedy);
      if (swieze.length) return swieze[0].s;
      return lista.sort((a, b) => b.kiedy - a.kiedy)[0].s;
    };
    /*  PROSBA O OKRES - OSOBNA NA KAZDA KATEGORIE [D-348, 2026-09-12]
        ------------------------------------------------------------
        WEJSCIA:  zadania `/okres?kat=zdarzenia` i `/okres?kat=alarmy`; odpowiedzi z tematu `okres`.
        CO Z CZEGO WYNIKA: kazda kategoria ma WLASNY wpis w tej mapie, wiec dwie prosby moga biec
                  obok siebie; odpowiedz trafia do wlasciwej po nazwie kategorii z naglowka.
        WYJSCIA:  rozwiazana obietnica `fetch` - zawsze, takze gdy prosba zostaje porzucona.

        ⛔ DLACZEGO NIE JEDNA ZMIENNA, JAK BYLO: druga prosba nadpisywala pierwsza, a warownik
        przy jej liczniku czasu sprawdzal `czekaOkres.res === res` - po nadpisaniu rownosc juz nie
        zachodzila, wiec licznik MILCZAL i obietnica pierwszej prosby NIE ROZWIAZYWALA SIE NIGDY.
        Ekran zostawal z `laduje = true`, czyli z napisem „odswiezam..." bez „odswiez" i bez
        „pobierz CSV" - dokladnie to zglosil Tomasz o dzienniku zdarzen.
        ⚠ Wyszlo dopiero teraz, bo do D-346 historia alarmow NIE pytala sama - trzeba bylo kliknac.
        Odkad oba rejestry laduja 24 h same, wejscie w alarmy i zaraz w dziennik daje dwie prosby
        pod rzad i kolizja jest codziennoscia, a nie przypadkiem.
        ⚠ Gdy ta sama kategoria pyta drugi raz, STARA prosbe konczymy bledem zamiast ja porzucac -
        porzucona obietnica to zawieszony ekran, a blad ma przynajmniej przycisk „odswiez". */
    const czekaOkres = Object.create(null);
    /*  BEZPIECZNIK STRON JEDNEJ PROSBY [PWA-6, 29.09]: dziennik tygodnia to kilkadziesiat stron; 300 to zapas,
        ktory nigdy nie zatrzyma prawdziwej prosby, a zatrzyma kazda petle. */
    const OKRES_MAX_STRON = 300;
    let prosZdOst = 0;
    /* prośba o pamięć zdarzeń (RAM sterownika); przed połączeniem NIE liczy się jako próba - inaczej wstępne wczytanie
       ze startu apki (D-308) przepadało i dziennik czekał 15 s na kolejną */
    M.prosZdarzenia = () => { if (!wybrany || !klGot(wybrany)) return; const t = Date.now(); if (t - prosZdOst < 15000) return; prosZdOst = t; oglos('zdarzenia'); };
    /*  STAN BROKERA I WYDAWCÓW NA PASKU [Tomasz 2026-09-09: „apka powinna mieć na górze
        status połączenia z brokerem i status wydawców"]. Trzy rzeczy, trzy źródła:
        - broker: zdarzenia własnego klienta (łączę / połączony / odmowa / zerwane);
        - wydawca (sterownik): temat `status` z flagą retained - „online" pisze sterownik
          po połączeniu, „offline" pisze BROKER z testamentu, gdy sterownik zamilknie
          (20a4_siec_mqtt.h). „offline" jest więc wiarygodne także, gdy płyta padła;
        - świeżość: wiek ostatniego `blok` danego obiektu.
        Wszystko idzie w KAŻDYM podaj(): broker{stan,opis}, wydawcy{prefiks→{status,wiek_s}},
        żeby pasek nie musiał składać stanu z kilku różnych wywołań. */
    /*  DZIENNIK ZDARZEŃ KLIENTA [D-278, Tomasz 2026-09-09: „musimy śledzić, co się dzieje, logami"]:
        ostatnie 60 zdarzeń (połączenia, zerwania, żądania, pełne bloki, luki seq) - pasek pokazuje
        je po dotknięciu „PRZEZ CHMURĘ". Do tego znaczniki czasu ostatnich zdarzeń, bo „pakiet N s
        temu" nie mówi, CZEGO brak: bloku, paczki czy odpowiedzi na żądanie. */
    M.dziennik = [];
    const ost = { zm: 0, blok: 0, zadanie: 0 };
    const zapisz = txt => { M.dziennik.push({ t: Date.now(), txt }); if (M.dziennik.length > 60) M.dziennik.shift(); };
    zapisz('start klienta ' + (window.APKA_WERSJA || '(bez wersji)') + ' → ' + o.host);
    /* [D-312] w dzienniku łącza widać, CO to konto ogląda - inaczej „nie widzę obiektu" i „nie mam uprawnień" wyglądają tak samo */
    zapisz('zakres kont' + 'a: ' + o.tematy.join(' + ')
           + (o.temat.indexOf('+') >= 0 ? ' (serwisowe - wszystkie sterowniki)' : ' (jeden obiekt)'));
    const wydawcy = () => { const w = {}; for (const p in obiekty)
      w[p] = { status: obiekty[p].status || '?', wiek_s: obiekty[p].kiedy ? (Date.now() - obiekty[p].kiedy) / 1000 : null }; return w; };
    let czekamPoPowrocie = false;        /* od powrotu na ekran / zerwania do pierwszej paczki [D-279] */
    const wspolne = () => { const broker = brokerOgolem();
      /* [D-314] podglad dla sond i diagnostyki: kto niesie wybrany obiekt i w jakim stanie sa brokery */
      M.ostBrokery = POL.map(c => ({ nr: c.nr, host: c.host, stan: c.stan.stan, opis: c.stan.opis, niesie: klDla(wybrany) === c }));
      return ({ obiekty: Object.keys(obiekty), obiekt: wybrany, broker: broker,
                             /*  [D-366] KTO PATRZY: konto serwisowe czy klient. Apka chowa przed klientem
                                 dziennik lacza, czasy i liste serwerow - jemu ma wystarczyc „sterownik jest,
                                 broker jest". Zrodlo to ten sam ptaszek z logowania, ktory wyznacza zakres
                                 tematow [D-312], wiec nie ma drugiej prawdy o tym, kim jest patrzacy. */
                             serwis: !!serwisowe,
                             /*  [D-425] `slot` = numer slotu STEROWNIKA dla tej drogi (z tematu `serwery`,
                                 pole `ja`). Ekran nazywa wiersze „slot 1/2", wiec musi znac numer, ktorym
                                 posluguje sie sterownik - a nie kolejnosc na naszej liscie polaczen. */
                             brokery: POL.map(c => ({ nr: c.nr, slot: c.slot || 0, host: c.host, user: c.user, temat: c.temat, stan: c.stan.stan, opis: c.stan.opis, niesie: klDla(wybrany) === c })),
                             wydawcy: wydawcy(), ost: ost, dziennik: M.dziennik, wersja: window.APKA_WERSJA || '',
                             lacze: czekamPoPowrocie || broker.stan !== 'ok',
                             blad: (broker.stan === 'ok' || broker.stan === 'laczy') ? null : broker.opis }); };
    /* ostatnio wybrany obiekt pamietany w telefonie - przy dwu obiektach apka otwiera ten, na ktory patrzono */
    /*  KLUCZE PAMIĘCI TELEFONU Z PRZEDROSTKIEM APKI [izolacja TEST2, 23.09]: apka klienta i TEST2 siedzą
        pod jednym origin (GitHub Pages), a localStorage jest per origin - bez przedrostka logowanie
        w TEST2 nadpisywało konto klienta, a „ostatni obiekt" i bloki na zimny start były wspólne.
        `window.APKA_KLUCZ` ustawia zbuduj_pwa.py ('' klient, 'test2:' TEST2); most i strona na AP go nie
        mają - tam przedrostek jest pusty i nic się nie zmienia. */
    const KL = k => ((typeof window !== 'undefined' && window.APKA_KLUCZ) || '') + k;
    const pamiec = k => { try { return localStorage.getItem(KL(k)); } catch (e) { return null; } };
    let wybrany = o.obiekt || pamiec('mqtt_obiekt') || null;
    /*  [D-419] Czy wybor jest CZLOWIEKA (z adresu, z pamieci telefonu albo z listy na pasku),
        czy nasz - automatyczny. Tylko ten drugi wolno nam zmienic, gdy obiekt okaze sie martwy. */
    let wybranyRecznie = !!wybrany;
    /*  ZMIANA OBIEKTU - JEDNO MIEJSCE [2026-09-26, Tomasz: „alarmy w sadzawce sa takie same wraz z godzinami
        jak w basen warsztat" - dane z apki PWA]
        ------------------------------------------------------------
        WEJSCIA:  nowy prefiks (lista na pasku, pierwszy obiekt, automat przy martwym obiekcie).
        CO Z CZEGO WYNIKA: prosby o okres/pliki/plik czekajace na POPRZEDNI sterownik konczymy od razu
                  (inaczej jego spozniona odpowiedz wpadlaby do ekranu nowego), a strona dostaje sygnal
                  `okresZmianaObiektu` - jej tabele rejestrow byly jedne dla wszystkich obiektow.
        WYJSCIA:  `wybrany` = nowy prefiks.
        ⚠ Tylko przy PRAWDZIWEJ zmianie; pierwszy wybor (wybrany = null) niczego nie czysci. */
    const zmienWybrany = pref => {
      if (pref === wybrany) return;
      const byl = wybrany; wybrany = pref;
      const zamknij = (c, tresc) => { clearTimeout(c.t); c.res(new Response(JSON.stringify(tresc), { status: 200 })); };
      for (const k of Object.keys(czekaOkres)) { const c = czekaOkres[k]; delete czekaOkres[k]; zamknij(c, { blad: 'zmieniono obiekt' }); }
      if (czekaPliki) { const c = czekaPliki; czekaPliki = null; zamknij(c, { karta: null, pliki: [] }); }
      if (czekaPlik) { const c = czekaPlik; czekaPlik = null; zamknij(c, { blad: 'zmieniono obiekt' }); }
      if (byl && typeof window !== 'undefined' && typeof window.okresZmianaObiektu === 'function') {
        try { window.okresZmianaObiektu(pref); } catch (e) {}
      }
    };
    const cid = 'hmi-' + Math.random().toString(16).slice(2, 10);
    /*  UCHWYT DO GNIAZDA [D-310]: Paho nie udostępnia swojego WebSocketa, a po odmrożeniu karty trzeba móc zamknąć
        gniazdo, które zostało „w locie" - inaczej `connect()` odbija się aż do jego własnego limitu czasu (10 s),
        a po nim czeka jeszcze odstęp rosnący do 128 s. Opakowanie jest przezroczyste: tworzy prawdziwy WebSocket
        i tylko zapamiętuje ostatni. Strona nie ma innych WebSocketów (reszta to fetch i SSE). */
    try { const OWS = window.WebSocket;
      if (OWS && !OWS._opakowany) {
        const WSo = function (u, pr) { const s = (pr === undefined) ? new OWS(u) : new OWS(u, pr); M._gniazdo = s; return s; };
        WSo.prototype = OWS.prototype; WSo._opakowany = true;
        ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(n => { WSo[n] = OWS[n]; });
        window.WebSocket = WSo;
      }
    } catch (e) {}
    /*  DWA BROKERY NARAZ [D-313, Tomasz 2026-09-11: „no i co z obsługą 2 brokerów na raz?"].
        Sterownik ma serwer GŁÓWNY i AWARYJNY (rejestr 3225 mówi, którym nadaje) i komendy przyjmuje z obu.
        Apka trzyma teraz po jednym kliencie na broker: JEDNO lustro obiektów, osobne łączenie i osobne
        ponawianie na każdy, a `zadanie` i komendy idą do tego brokera, którym dany obiekt PRZYSZEDŁ
        (`obiekty[pref].kl`). Dzięki temu przełączenie sterownika na awaryjny jest dla patrzącego niewidoczne,
        a konto serwisowe widzi w jednej apce obiekty z HiveMQ i z własnego brokera naraz. */
    /*  PORT W ADRESIE [D-314, Tomasz 2026-09-11: „drugi na EMQX"]: brokery nie zgadzają się co do portu WebSocketu -
        HiveMQ Cloud słucha na 8884, EMQX Cloud na 8084. Dlatego adres wolno podać jako `host:port`; bez portu
        bierzemy 8884 (HiveMQ), a dla adresów EMQX (`*.emqxsl.com`) 8084, żeby nie trzeba było pamiętać liczby.
        ⚠ To port dla PRZEGLĄDARKI (WebSocket po TLS). Sterownik łączy się natywnym MQTT: HiveMQ i EMQX 8883. */
    const adres = (txt, domyslny) => { const s = String(txt || '').trim().replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
      const i = s.lastIndexOf(':');
      if (i > 0 && /^\d+$/.test(s.slice(i + 1))) return { host: s.slice(0, i), port: +s.slice(i + 1) };
      return { host: s, port: domyslny || (/emqxsl\.com$/i.test(s) ? 8084 : 8884) }; };
    const a1 = adres(o.host, o.port);
    const POL = [{ nr: 1, host: a1.host, port: a1.port, user: o.user, pass: o.pass, temat: o.temat, tematy: o.tematy }];
    /*  DRUGI SERWER MA SIE WYLICZYC SAM [D-350, 2026-09-13; objaw Tomasza: „sadzawka - nie widze jej…
        ani broker ani sterownik", przy dzialajacym basenie]
        ------------------------------------------------------------
        WEJSCIA:  zapis logowania z pamieci telefonu: `host2`, `user2`, `pass2` (dwa ostatnie bywaja PUSTE).
        CO Z CZEGO WYNIKA: puste pola znacza „to samo konto z dwojka na koncu i to samo haslo" - dokladnie
                  tak, jak obiecuje podpis pod polem na ekranie logowania („pusto = ten sam z dwojka na koncu").
        WYJSCIA:  drugie polaczenie na liscie POL - albo jego brak, gdy nie ma adresu.

        ⛔ CO BYLO ZLE: warunek brzmial `o.host2 && o.user2`, a ekran logowania zapisuje `user2` PUSTE,
        dopoki czlowiek nie wpisze go recznie. Wyliczenie „user + 2" istnialo WYLACZNIE w chwili proby
        logowania (index.html), nie w zapisie i nie tutaj. Skutek: apka NIGDY nie tworzyla drugiego
        polaczenia - cicho, bez zadnego komunikatu.
        ⚠ DLACZEGO BOLALO DOPIERO TERAZ: dopoki oba sterowniki trzymaly sie brokera glownego, drugiego
        nikt nie potrzebowal. Sadzawka stracila HiveMQ (134 nieudane proby powrotu) i przeszla na brokera
        AWARYJNEGO - nadaje „tematy tylko serwerem 2". Droga zapasowa w sterowniku zadzialala, ale po
        stronie apki nie bylo jej czym odebrac. Awaryjnosc, ktorej nikt nigdy nie sprawdzil na calej drodze,
        jest warta tyle, co jej brak.
        ⚠ Zakres tematow nadal z PIERWSZEGO konta [D-316] - patrz nizej. */
    /*  ⛔ ADRES DRUGIEGO SERWERA TEZ MA SIE WYLICZYC [D-351, 2026-09-13]
        Poprawka D-350 dolozyla wyliczanie KONTA, ale warunek nadal wymagal `o.host2` - a zapis
        logowania zrobiony PRZED wprowadzeniem drugiego serwera [D-314] w ogole tego pola nie ma.
        Zmierzone na telefonie Tomasza (dziennik lacza apki 04bd5b7f91): JEDNA linia „start klienta
        -> hivemq.cloud", zero drugiego polaczenia - przy sadzawce nadajacej wylacznie na EMQX
        (sprawdzone wlasnym klientem na brokerze zapasowym: paczki status/blok/opis/awaria docieraly).
        Efekt na ekranie: „sterownik offline (broker dostal testament)" - bo apka czytala status
        ze STAREGO brokera, gdzie lezy testament sadzawki, zamiast z tego, ktorym ona nadaje.
        ⚠ SPROSTOWANIE [D-373, 2026-09-16]: do 16.09 pusty napis w `host2` znaczyl tu „swiadomy wybor
        jednego serwera" i byl szanowany. TO ROZROZNIENIE BYLO FALSZYWE. Miedzy D-313 (11.09 09:05)
        a D-317 (11.09 11:50) formularz logowania zapisywal `host2: ''`, bo pole „Serwer 2" bylo
        wtedy domyslnie PUSTE - wiec kazdy zapis z tego okna WYGLADA na swiadomy wybor, a nim nie jest.
        Telefon Tomasza mial dokladnie taki zapis: po zdjeciu sterownikow z HiveMQ (D-369) przestal je
        widziec, a PC (zapis pozniejszy) widzial dalej.
        ⚠ CZEMU APKA SAMA SIE NIE URATOWALA: HiveMQ ZYJE i wpuszcza - nie ma na nim tylko zadnego
        sterownika. Zadna galaz awaryjna (zerwanie lacza, straznik ciszy, powrot sieci) nie patrzy na
        „broker odpowiada, ale jest pusty", wiec apka siedziala na zywym, pustym brokerze bez slowa.
        TERAZ: pusty napis znaczy to samo co brak pola - wstawiamy adres wbudowany. Kto naprawde chce
        jednego serwera, po prostu nie dostanie na drugim konta: proba konczy sie odmowa CONNACK,
        pierwszy broker dziala dalej, a w dzienniku lacza widac dlaczego. To jest tansze niz cisza. */
    /*  ⚠ SPROSTOWANIE DO SPROSTOWANIA [D-410, 17.09] — ADRES WBUDOWANY USUNIĘTY.
        D-373 (wyżej) kazało podstawiać wbudowany adres, bo pusty napis nie dawał się odróżnić od
        „nigdy nie ustawione", a apka siedziała cicho na ŻYWYM, ale PUSTYM brokerze. Powód był dobry,
        ale lekarstwo okazało się gorsze: 17.09 telefon Tomasza wskazywał brokera, na którym NIE MA
        KONTA apki — i apka co dwie sekundy budowała klienta od nowa, przy okazji zrywając połączenie,
        które DZIAŁAŁO („serwer 1: połączony ponownie, przerwa 4 s"), a obiegi znikały z ekranu.
        ⚠ Rozstrzygnięcie nie brzmi „zgadywać czy nie zgadywać": REZERWA MA POCHODZIĆ ZE STEROWNIKA,
        a nie ze stałej w kodzie apki. Brak rezerwy = brak rezerwy, ale POWIEDZIANY wprost
        (`rezerwaBrak` niżej), a nie zastąpiony zgadywanką ani przemilczany. To godzi obie lekcje:
        nie ma cichego siedzenia na pustym brokerze i nie ma burzy ponowień na cudzym.
        ⚠ Ponawianie i tak jest dziś odporne [D-407]: odstęp rośnie, a martwa droga nie każe
        sterownikowi wracać do nadawania równoległego. Ale to zabezpieczenie, nie powód, żeby zgadywać. */
    /*  KONTA ZAPASOWE: DO NAZWY DOKLEJA SIE NUMER SERWERA  [D-416, Tomasz 17.09]
        ------------------------------------------------------------
            nasz broker   `Master`   `wanna-gliczarow`      (bez cyfry = serwer glowny)
            HiveMQ        `Master2`  `wanna-gliczarow2`     (zapas)
            EMQX          `Master3`  `wanna-gliczarow3`     (rezerwa)
        Haslo jest TO SAMO na wszystkich trzech brokerach danego odbiorcy, wiec apka nie musi
        go liczyc - bierze haslo glowne, gdy rubryka zapasu zostala pusta.

        ⛔ BYLA TU PRZEZ POL GODZINY ZASADA „Z ZEREM" (`Master0` -> `Master`, `Master2`) i zostala
        cofnieta, bo WYMAGALA MYSLENIA: trzeba bylo wiedziec, ze zero znaczy „glowny", ze rdzen
        powstaje przez odciecie zera i ze serwis liczy sie inaczej niz klient. Tu nie ma czego
        wiedziec - jedna zasada dla wszystkich, ta sama w apce, w konsoli dostawcy i na kartce.
        Numeracja zgadza sie przy tym ze slotami sterownika: 1 glowny, 2 zapas, 3 rezerwa.
        ⚠ Wpisane recznie pole zawsze wygrywa z wyliczeniem - konwencja to udogodnienie, nie przymus. */
    const _kontoZap = nr => (o.user ? o.user + nr : '');
    const _host2 = (o.host2 || '').trim();
    const _user2 = o.user2 || _kontoZap(2);
    const _pass2 = o.pass2 || o.pass;
    if (_host2 && _user2) { const a2 = adres(_host2, o.port2);
      /*  ⚠ ZAKRES TEMATÓW BIERZEMY Z PIERWSZEGO KONTA, NIE Z DRUGIEGO [D-316, Tomasz 2026-09-11: konto klienta
          na drugim brokerze nazywa się inaczej niż na pierwszym]. To ten SAM obiekt i ten sam
          prefiks tematu w sterowniku - różnią się tylko konta u dwóch dostawców. Liczenie tematu z nazwy drugiego
          konta dawało `basen/wanna/gliczarow2`, czyli nasłuch w próżni. Nazwa konta na drugim brokerze może być
          dowolna; `temat2` zostaje furtką, gdyby kiedyś prefiks naprawdę się różnił. */
      POL.push({ nr: 2, host: a2.host, port: a2.port, user: _user2, pass: _pass2,
                 temat: o.temat2 || o.temat, tematy: o.temat2 ? [o.temat2] : o.tematy }); }
    /*  [D-410] DRUGA REZERWA — sterownik wybiera JEDNĄ z dwóch kandydatek [D-383] i apka nie wie,
        którą akurat wziął. Dlatego słucha obu: obiekt pokaże się niezależnie od tego, przez którą
        nadaje. Konto i hasło jak przy pierwszej rezerwie; zakres tematów ZAWSZE z konta głównego
        (ta sama zasada co w D-316 — to ten sam obiekt, różnią się tylko konta u dostawców). */
    const _host3 = (o.host3 || '').trim();
    const _user3 = o.user3 || _kontoZap(3);
    const _pass3 = o.pass3 || o.pass;
    if (_host3 && _user3) { const a3 = adres(_host3, o.port3);
      POL.push({ nr: 3, host: a3.host, port: a3.port, user: _user3, pass: _pass3,
                 temat: o.temat3 || o.temat, tematy: o.temat3 ? [o.temat3] : o.tematy }); }
    /*  ⚠ „REZERWY NIE MA" MÓWIMY WPROST (zasada 10) — to jest właśnie ta luka, przez którą D-373
        kazało zgadywać adres. Widoczny stan zamiast ciszy albo zgadywanki. */
    M.rezerwaBrak = (POL.length < 2);
    POL.forEach((c, i) => { c.kl = new Klient(c.host, c.port, '/mqtt', cid + (i ? '-' + (i + 1) : ''));
                            c.stan = { stan: 'laczy', opis: 'łączę z brokerem…' }; });
    /*  ILE BROKEROW NAPRAWDE MAMY - WPROST W DZIENNIKU [D-353, 2026-09-13]
        Wpis „start klienta ... -> host" jest JEDEN, niezaleznie od liczby brokerow (wyzej, przy `o.host`).
        Przez to ze zrzutu ekranu nie dalo sie odczytac, czy drugi serwer w ogole powstal - a wlasnie o to
        pytanie rozbila sie diagnostyka znikajacej sadzawki: obiekt nadawal brokerem zapasowym, a z dziennika
        nie wynikalo, czy apka ten broker ma. Teraz kazdy broker ma wlasna linie z numerem, adresem i kontem.
        ⚠ HASLA TU NIE MA I BYC NIE MOZE - dziennik ogląda sie na ekranie i wysyla na zrzutach. */
    zapisz('brokerow na liscie: ' + POL.length);
    POL.forEach(c => zapisz('  serwer ' + c.nr + ': ' + c.host + ':' + c.port + ' jako ' + (c.user || '(bez konta)')));
    const k = POL[0].kl;                    /* pierwszy broker = główny; skrót dla czytelności niżej */
    /*  KTÓRY KLIENT OBSŁUGUJE DANY OBIEKT: ten, którym przyszedł jego blok. Zanim cokolwiek przyjdzie -
        pierwszy połączony. `klGot` oddaje klienta TYLKO gdy jest połączony (inaczej komenda nie ma czym pojechać). */
    const klDla = pref => { const w = pref && obiekty[pref]; return (w && w.kl) || POL.find(c => c.kl.isConnected()) || POL[0]; };
    const klGot = pref => { const c = klDla(pref); return (c && c.kl.isConnected()) ? c.kl : null; };
    /*  STAN DLA PASKA: zielony, gdy broker niosący wybrany obiekt działa; przy dwóch brokerach opis wymienia oba,
        żeby w ustawieniach było widać, który padł. */
    const brokerOgolem = () => {
      const c = klDla(wybrany);
      const ok = POL.filter(x => x.stan.stan === 'ok');
      /*  ⛔ WSZYSTKIE DROGI ODMOWILY TEGO SAMEGO KONTA = JEDEN BLAD, NIE TRZY AWARIE [D-422].
          Konta na trzech brokerach wiaze jedna nazwa [D-416], wiec skasowane albo zle wpisane
          logowanie zabiera je razem. Trzy osobne „broker odmowil" kaza szukac trzech usterek;
          prawda jest jedna i da sie ja naprawic w dziesiec sekund - trzeba tylko ja napisac.
          ⚠ To NIE jest to samo, co „zaden broker nie odpowiada" (brak zasiegu): tam ponawianie
            ma sens, tutaj konta nie przybedzie samo, wiec apka prosi czlowieka, a nie czeka. */
      if (!ok.length && POL.length && POL.every(x => x.odmowaKonta)) {
        return { stan: 'blad', opis: 'żaden serwer nie zna konta „' + (o.user || '') + '" - '
                 + 'to nie awaria łącza, tylko logowanie. Otwórz „Zmień sterownik / hasło" '
                 + 'i wpisz konto jeszcze raz' };
      }
      if (POL.length === 1) return POL[0].stan;
      if (c && c.stan.stan === 'ok') return { stan: 'ok', opis: POL.map(x => 'serwer ' + x.nr + ': ' + x.stan.opis).join(' · ') };
      if (ok.length) return { stan: 'ok', opis: POL.map(x => 'serwer ' + x.nr + ': ' + x.stan.opis).join(' · ') };
      const zly = POL.find(x => x.stan.stan !== 'laczy') || POL[0];
      return { stan: zly.stan.stan, opis: POL.map(x => 'serwer ' + x.nr + ': ' + x.stan.opis).join(' · ') };
    };
    /*  `nowe` [D-280]: prawda tylko, gdy oddaj() woła świeża paczka (zm/blok) albo zmiana obiektu.
        Cykliczne oddaj() co 1 s liczy wiek i stan brokera, ale ekran NIE dostaje wtedy świata -
        stare lustro potwierdzało żądanie kafla (bylo=null) i światło mignęło „zgaszone". */
    const oddaj = (nowe) => {
      const w = wybrany && obiekty[wybrany];
      if (!w || !w.txt) { podaj(Object.assign({ polaczony: false, swiat: null, wiek_s: null }, wspolne())); return; }
      const mb = w.mb || parsujLinie(w.txt, 'MB;'), mn = w.mn || parsujLinie(w.txt, 'MN;');
      M.ost.rej = w.r || {};                 /* rejestry z lustra - harmonogram, wyłączniki, sieć, pilot */
      const wiek = (Date.now() - w.kiedy) / 1000;
      const ob = mb ? obiegZBloku(mb) : 0;
      M.ost.mb = mb; M.ost.mn = mn; M.obieg = ob;
      const swiat = mb ? M.swiatZ(mb, mn, M.ost.rej, ob) : null;
      if (swiat && zdarzenia[wybrany]) swiat.zdarzenia = zdarzenia[wybrany];   /* dziennik zdarzeń do ekranu serwisu [D-295] */
      /* zasiew = liczby z retained bloku (0-60 s stare): ekran je pokazuje pod zasłoną „pobieram stan…", nie pod ciemną planszą [D-281] */
      podaj(Object.assign({ polaczony: !!swiat && wiek < 3 * (o.okres_s || 30) && brokerOgolem().stan === 'ok', swiat, wiek_s: wiek, nowe: !!nowe, zasiew: !!(w && w.zasiew) }, wspolne()));
    };
    /*  OBECNOŚĆ: sterownik nadaje tylko, gdy ktoś patrzy — mówimy mu co 20 s,
        w jakim tempie (ms); po zamknięciu karty milczy sam po 60 s. Przy
        zamykaniu strony wysyłamy 0 = „przestaję patrzeć", żeby nie czekał. */
    const tempo = o.tempo_ms || 1000;
    /*  KTÓRĄ DROGĄ CIĘŻKIE TEMATY [D-321, Tomasz: „to robi apka - pełna zgoda"]: sterownik nadawał
        każdą paczkę na oba brokery, więc jego łącze i limity brokerów płaciły dwa razy. Kto niesie
        obiekt, wie tylko apka - z tego, którym połączeniem paczki naprawdę przychodzą (`w.kl`).
        Mówimy to przy każdym odnowieniu żądania: `1000;niesie=1`. Zero = „nadawaj równolegle" i tak samo
        rozumie to starszy sterownik, który tego dopisku w ogóle nie zna (czyta samą liczbę). */
    /*  ⛔ NUMER MUSI BYC Z JEZYKA STEROWNIKA, NIE Z NASZEGO [D-411, zmierzone 17.09 sonda
        `_sonda_pwa_spis`]. Apka numeruje polaczenia po swojemu (1 = pierwsze na liscie), a sterownik
        czyta `niesie=N` jako SWOJ slot N. W wariancie A te numery sie rozjechaly: nasz broker jest
        u sterownika slotem 2, wiec „niesie=1" kierowalo ciezkie tematy na brokera, ktorego apka
        w ogole nie sluchala. Objaw: obraz zywy, ale rwacy sie co kilka sekund - apka po 8 s ciszy
        prosila „nadawaj równolegle", dostawala dane, znowu wskazywala „serwer 1" i tak w kolko.
        Teraz kazde polaczenie wie, ktorym slotem sterownika jest (`c.slot` z tematu `serwery`,
        pole `ja` - przychodzi TA SAMA droga, ktorej dotyczy, wiec nazwy adresow nie musza pasowac).
        ⚠ STEROWNIK BEZ TEGO POLA (starsze wgranie) daje `slot` pusty - wtedy 0, czyli „nadawaj
        równolegle". Podwojny ruch zamiast rwacego obrazu; naprawia sie samo po wgraniu firmware. */
    const niesieNr = () => {
      if (POL.length < 2) return 0;
      const w = wybrany && obiekty[wybrany];
      const c = w && w.kl;
      if (!(c && c.kl && c.kl.isConnected() && c.stan.stan === 'ok')) return 0;
      const nr = c.slot || 0;
      if (!nr) return 0;
      /*  ⛔ NIE PROSIMY O DROGE, NA KTOREJ STEROWNIKA NIE MA [D-428]. Zastany `status` z brokera,
          z ktorego sterownik juz odszedl, potrafi zapisac te droge jako „niosaca". Wtedy prosimy
          o ciezkie tematy WLASNIE TAM, sterownik przestaje nadawac gdziekolwiek indziej i nie
          wysyla nic (bo go tam nie ma), a skoro nic nie przychodzi - apka nie ma jak zmienic
          zdania. Pat podtrzymywal sie sam: „sterownik online", zaslona „pobieram stan" bez konca
          i w dzienniku w kolko ta sama prosba.
          ⚠ Sprawdzamy to POLEM `pol` ze spisu [D-425] - wczesniej apka nie miala tego czym
            stwierdzic. Gdy `pol` nie ma (starsze firmware), nie zgadujemy: prosimy wszystkimi. */
      const sp = M.ostSpisSerwerow;
      const w2 = sp && (nr === 1 ? sp.glowny : nr === 2 ? sp.zapas1 : null);
      if (!w2 || w2.pol !== 1) return 0;
      return nr;
    };
    let niesieOst = -1;
    const oglos = (v, niesie) => { if (!wybrany) return;
      let tresc = String(v);
      if (typeof v === 'number') {                     /* dopisek tylko przy tempie, nie przy „pelny"/„okres:" */
        const nr = (niesie === undefined) ? niesieNr() : niesie;
        /*  ⛔ PROSBA `niesie=N` JEST OBIETNICA, ZE NA TEJ DRODZE SLUCHAMY  [D-424, trop Tomasza]
            Apka odpina ciezkie tematy od drogi nadmiarowej [D-315]. Gdy obiekt pozniej „przejdzie"
            na te wlasnie droge, prosilismy sterownik, zeby nadawal ciezkie WLASNIE TAM - a tam
            mielismy je odpiete. Sterownik slucha i przestaje wysylac gdziekolwiek indziej, wiec
            nikt nie dostaje ani bloku, ani zmian. `status` i `stan` sa lekkie i ida dalej, wiec
            wszystko wyglada zdrowo - tylko ekran stoi na „pobieram stan…". */
        if (nr) { const cel = POL.find(x => (x.slot || 0) === nr);
                  if (cel && cel.lekki) { wepnijCiezkie(cel); cel.bliz = 0; } }
        tresc += ';niesie=' + nr;
        if (nr !== niesieOst) { niesieOst = nr;
          /*  ⚠ SKUTEK, NIE MECHANIZM [D-428a, Tomasz: „zamiast «prosze o ciezkie tematy» to
              «odbieram tematy»"]. Pod spodem to nadal dopisek `niesie=N` w `zadanie`, ktory kaze
              sterownikowi kierowac tam `zm` i `blok` - ale czytajacy dziennik chce wiedziec, ktora
              droga PLYNA DANE, a nie jak sie o to prosi. */
          zapisz(nr ? 'odbieram dane przez ' + NAZWA_DROGI(nr) : 'odbieram dane równolegle'); }
      }
      /*  ŻĄDANIE IDZIE WSZYSTKIMI DROGAMI [D-327, uwaga z audytu]: dotąd szło tylko tą, którą uważamy
          za niosącą. Gdy sterownik straci WŁAŚNIE tego brokera, prośba leci w próżnię, a sterownik
          dowie się o stracie dopiero po swoim keepalive - i przez ten czas nie wie, że ma wrócić do
          nadawania równoległego. Powtórkę tej samej treści sterownik odsiewa w oknie 3 s [D-319], więc to
          nic nie kosztuje poza kilkudziesięcioma bajtami. */
      let poszlo = 0;
      POL.forEach(c => { if (!c.kl.isConnected()) return;
        try { const m = new Paho.Message(tresc); m.destinationName = wybrany + '/zadanie'; c.kl.send(m); poszlo++; } catch (e) {} });
      if (!poszlo) return;
      ost.zadanie = Date.now(); if (v === 'pelny') zapisz('żądanie pełnego bloku'); };
    setInterval(() => oglos(tempo), 20000);
    /* `zadanie`=0 przy pagehide ZDJĘTE [D-287]: jeden schodzący do tła podglądacz gasił strumień pozostałym; sterownik gaśnie sam 60 s po ostatnim odnowieniu */
    /*  WZNOWIENIE PODGLĄDU BEZ CZEKANIA [2026-09-09, Tomasz: „jak nie dostanie pakietu na czas,
        to brak połączenia"]. Telefon w tle dławi zegary JS: `zadanie` nie odnawia się, sterownik
        po 60 s milknie, a po powrocie apki najbliższe odnowienie było dopiero za ≤ 20 s -
        tyle trwało „nie nadaje". Teraz: powrót karty na ekran = `zadanie` od razu; a gdy
        broker jest, a blok wybranego obiektu spóźnia się > 4 s - też od razu (nie częściej
        niż co 4 s). */
    let ostOglos = 0;
    const oglosTeraz = () => { const t = Date.now(); if (t - ostOglos < 4000) return; ostOglos = t; oglos(tempo); };
    /*  SZYBKI POWRÓT PO TLE [D-279, Tomasz 2026-09-09: „po powrocie do okna jest rozłączony, ponowne
        łączenie trwa 5–10 s"]. Android zamyka gniazdo w tle; Paho po zerwaniu odczekuje odstęp, który
        po każdej nieudanej próbie w tle ROŚNIE (1→2→4… s), więc po powrocie czekało się na jego zegar.
        Teraz: powrót na ekran = jeśli nie połączony, connect() natychmiast (Paho odrzuci, gdy właśnie
        łączy — łapiemy), a do pierwszej paczki zasłona „łączę ponownie…" zamiast starych liczb bez
        słowa. Utrzymania połączenia w tle przeglądarka nie da - to granica PWA, nie nasza. */
    document.addEventListener('visibilitychange', () => {
      const widoczna = document.visibilityState === 'visible';
      zapisz(widoczna ? 'powrót na ekran' : 'w tle');
      if (!widoczna) return;
      czekamPoPowrocie = true; oddaj();
      const doZrobienia = POL.filter(c => !c.kl.isConnected());
      if (doZrobienia.length) { doZrobienia.forEach(c => {
        /* [D-354] czlowiek wrocil i czeka - jesli poprzednie proby padly, nie reanimujemy, tylko budujemy od zera */
        if (c.stan.stan === 'blad' || c.byloZerwane) odnowKlienta(c);
        c.stan = { stan: 'laczy', opis: 'łączę ponownie…' }; c.odstepNr = 0; c.polaczTeraz('powrót na ekran'); }); oddaj(); }
      /*  ⚠ POŁĄCZENIE, KTÓRE TWIERDZI, ŻE ŻYJE, A MILCZY — NIE CZEKAJ NA STRAŻNIKA [D-409,
          Tomasz 17.09: „wraca po zmianie okna już dłużej niż się uruchomił"].
          Powyższa pętla naprawia tylko te drogi, które SAME przyznają się, że padły. Gniazdo
          zamrożone razem z kartą nadal zgłasza gotowość, więc trafiało pod strażnika ciszy —
          a ten czeka 75 s. Efekt był absurdalny: powrót na ekran trwał dłużej niż uruchomienie
          apki od zera (~3 s), bo świeży start buduje klienta od razu.
          75 s zostaje dla PRACY W TLE (nie dobijamy brokera, gdy nikt nie patrzy), ale gdy człowiek
          wrócił i patrzy — 8 s ciszy wystarczy za dowód. Sterownik nadaje co 5 s, więc ośmiu sekund
          nie da się pomylić z normalną pracą. */
      const TERAZ = Date.now();
      POL.filter(c => c.kl.isConnected() && c.ostOdbior && (TERAZ - c.ostOdbior) > 8000).forEach(c => {
        zapisz(etyk(c) + 'powrót na ekran, a cisza ' + Math.round((TERAZ - c.ostOdbior) / 1000)
               + ' s mimo „połączony" - buduję klienta od nowa, zamiast czekać na strażnika');
        odnowKlienta(c);
        c.stan = { stan: 'laczy', opis: 'łączę ponownie…' }; c.odstepNr = 0; c.polaczTeraz('powrót - martwe gniazdo');
      });
      oddaj();
      if (POL.some(c => c.kl.isConnected())) oglosTeraz();
    });
    window.addEventListener('focus', oglosTeraz);
    /*  ⚠ W DZIENNIKU Z TELEFONU NIE BYŁO WPISU „w tle" [D-310], choć karta stała 7 min w tle: Chrome na Androidzie
        potrafi ZAMROZIĆ kartę (freeze) bez zdarzenia `visibilitychange` - wtedy nie wykona się żaden nasz kod.
        Te trzy zdarzenia zostawiają ślad, kiedy karta zasnęła i kiedy wstała; `resume` dodatkowo łączy od ręki,
        bo po zamrożeniu `visibilitychange` bywa nie do zobaczenia. */
    window.addEventListener('pagehide', () => zapisz('karta schowana (pagehide)'));
    document.addEventListener('freeze', () => zapisz('karta zamrożona przez przeglądarkę'));
    /*  ZERWANIE DROGI = OD RAZU „OBA" [D-321]: gdy padnie połączenie, którym obiekt do nas dociera,
        nie ma na co czekać - prosimy pozostałym, żeby sterownik wrócił do nadawania na oba serwery. */
    M.niesieReset = () => { if (niesieOst !== 0 && POL.some(c => c.kl.isConnected())) oglos(tempo, 0); };
    /*  PRÓBA BRZEGOWA [D-322]: sonda musi umieć zerwać JEDNĄ drogę, żeby zmierzyć, po ilu sekundach
        obraz wraca drugą. Zamykamy gniazdo dokładnie tak, jak robi to sieć - reszta dzieje się sama
        (Paho zgłasza zerwanie, apka prosi sterownik o nadawanie równoległe). Nie wystawiamy tu kont ani
        haseł - tylko tę jedną czynność. */
    M._zerwij = nr => { const c = POL.find(x => x.nr === nr); if (!c || !c.gniazdo) return false;
      try { c.gniazdo.close(); zapisz('próba brzegowa: zerwano serwer ' + nr); return true; } catch (e) { return false; } };
    document.addEventListener('resume', () => { zapisz('karta odmrożona'); czekamPoPowrocie = true;
      POL.filter(c => !c.kl.isConnected()).forEach(c => {
        odnowKlienta(c);   /* [D-354] karta byla zamrozona - gniazdo i sesja u brokera sa nie do odzyskania */
        c.stan = { stan: 'laczy', opis: 'łączę ponownie…' }; c.odstepNr = 0; c.polaczTeraz('odmrożenie'); }); oddaj(); });
    setInterval(() => { const w = wybrany && obiekty[wybrany];
      /*  [D-321] PROGI CISZY PODNIESIONE: sterownik nadaje heartbeat co 5 s (było 2 s), więc cztery
          sekundy bez paczki to teraz normalna praca, a nie kłopot. Dopytujemy po 10 s. */
      if (brokerOgolem().stan === 'ok' && w && w.kiedy && Date.now() - w.kiedy > 7000) oglosTeraz();
      /*  [D-315] cisza u niosącego (6 s) albo jego zerwanie = wpinamy ciężkie tematy z powrotem WSZĘDZIE.
          Lepiej przez chwilę odebrać dwa razy, niż nie odebrać wcale. */
      /*  [D-332] PROG CISZY 12 s -> 8 s. Przy awarii drogi to WLASNIE ten prog wyznacza dziure
          w obrazie, bo aplikacja prosi „nadawaj równolegle" szybciej, niz sterownik zdazy zauwazyc awarie
          (zmierzone: obraz wracal po 14,8-20,2 s, a sterownik wiedzial dopiero po 22,1 s). Heartbeat
          idzie co 5 s, wiec 8 s to poltora heartbeatu - falszywa prosba kosztuje chwile podwojnego
          odbioru i nic wiecej. */
      const cisza = !w || !w.kiedy || Date.now() - w.kiedy > 8000;
      if (POL.length > 1 && (cisza || POL.some(c => c.lekki && c.stan.stan !== 'ok'))) {
        POL.forEach(c => { c.bliz = 0; wepnijCiezkie(c); });
        /*  [D-321] i mówimy o tym STEROWNIKOWI od ręki: niech znowu nadaje równolegle. Bez tego czekałby
            na najbliższe odnowienie żądania, czyli do 20 s ciszy na ekranie. */
        if (niesieOst !== 0) oglos(tempo, 0);
      }
      /*  LUKA BEZ PEŁNEGO BLOKU = ZASŁONA [D-318, audyt etapu 3 pkt 3]: po dziurze w numeracji
          w lustrze brakuje zgubionych zmian, a następne paczki lecą dalej - ekran wyglądał więc
          na świeży, choć część liczb pochodziła sprzed dziury. Pełny blok przychodzi zwykle w pół
          sekundy, dlatego zasłaniamy dopiero po dwóch (bez migania przy jednej zgubionej paczce)
          i prosimy jeszcze raz. Zasłonę zdejmuje dopiero świeży pełny blok. */
      if (w && w.luka && w.lukaOd && Date.now() - w.lukaOd > 2000) {
        w.zasiew = true; w.lukaOd = Date.now();
        zapisz('luka bez pełnego bloku - zasłaniam ekran i proszę jeszcze raz');
        if (wybrany) prosPelny('zasłona');
        oddaj();
      }
    }, 1000);
    k.onMessageArrived = m => {
      const cz = m.destinationName.split('/');
      const rodzaj = cz[cz.length - 1];
      if (rodzaj === 'stan') {
        try { const s = JSON.parse(m.payloadString); if (s && s.czas) zegar[cz.slice(0, -1).join('/')] = { czas: s.czas, kiedy: Date.now() }; } catch (e) {}
        return;
      }
      if (rodzaj === 'serwery') { spisSerwerow(m.payloadString, cz.slice(0, -1).join('/'), m.retained); return; }   /* [D-411] */
      if (rodzaj === 'zapas') {                     /* [D-412] meldunek sterownika o rezerwie */
        const pref = cz.slice(0, -1).join('/');
        const txt = m.payloadString || '';
        /*  ⛔ TYLKO WYBRANY OBIEKT [poprawka po przegladzie]: `czekaZapas` to JEDNA zmienna, a konto
            serwisowe oglada kilka sterownikow naraz. Bez tego warunku nocna zamiana w sadzawce
            rozwiazywalaby obietnice kliknieta na basenie i czlowiek zobaczylby cudze zdanie jako
            odpowiedz na swoj rozkaz. Ten sam blad naprawialismy w D-348 przy prosbach o okres. */
        if (pref !== wybrany) return;
        /*  ⚠ RETAINED TO MELDUNEK ZASTANY, NIE ODPOWIEDZ NA NASZ ROZKAZ. Leci od razu po
            subskrypcji i potrafi byc sprzed tygodnia - gdyby liczyl sie jako odpowiedz, ekran
            pokazywalby „zrobione" zanim sterownik cokolwiek przeczytal. */
        /*  ⚠ TA SAMA TRESC DRUGA DROGA [D-315]: `zapas` jest tematem lekkim, wiec przy dwoch
            brokerach przychodzi dwa razy. Bez odsiewu dziennik lacza dostawal dwa takie same
            wpisy na jedno zdarzenie - a dziennik czyta sie na zrzucie ekranu. */
        const swiezo = M.ostZapas && M.ostZapas.txt === txt && (Date.now() - M.ostZapas.kiedy) < 3000;
        M.ostZapas = { obiekt: pref, txt, kiedy: Date.now(), zastany: !!m.retained };
        if (!m.retained && !swiezo) { zapisz('rezerwa: ' + txt); if (czekaZapas) czekaZapas(txt); }
        oddaj();
        return;
      }
      if (rodzaj === 'pliki') {                     /* lista plików z karty [D-297]: "#kat\nnazwa;rozmiar\n..." albo "!brak karty" */
        if (!czekaPliki || czekaPliki.pref !== cz.slice(0, -1).join('/')) return;   /* tylko od pytanego sterownika [2026-09-26] */
        const l = m.payloadString.split('\n').filter(x => x.trim()); const brak = l.some(x => x[0] === '!');
        /*  [PWA-6] odpowiedz o INNEJ kategorii (spozniona po zastapieniu) nie konczy biezacej prosby */
        const katOdp = (l[0] && l[0][0] === '#') ? l[0].slice(1).trim() : null;
        if (katOdp !== null && katOdp !== czekaPliki.kat) return;
        const c = czekaPliki; czekaPliki = null; clearTimeout(c.t);
        const pliki = l.filter(x => x[0] !== '#' && x[0] !== '!').map(x => { const [nazwa, rozmiar] = x.split(';'); return { nazwa, rozmiar: +rozmiar }; }).sort((a, b) => a.nazwa < b.nazwa ? 1 : -1);
        c.res(new Response(JSON.stringify({ karta: !brak, pliki }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        return;
      }
      if (rodzaj === 'okres') {                     /* "#kat;od;do;pomin;n;dalej\n<linie>" [D-298] */
        const nl = m.payloadString.indexOf('\n'); const nag = m.payloadString.slice(1, nl).split(';');
        /*  [D-348] kategoria z NAGLOWKA odpowiedzi wskazuje, ktora prosbe obslugujemy - dzieki temu
            odpowiedz o alarmach nie konczy prosby o zdarzenia (i odwrotnie). */
        const c = czekaOkres[nag[0]];
        if (!c) return;                             /* spozniona odpowiedz na porzucona prosbe - do kosza */
        /*  ⛔ TYLKO OD STEROWNIKA, KTOREGO PYTALISMY [2026-09-26]. Konto serwisowe slucha kilku obiektow naraz
            (TEMATY na kazdy prefiks), a kategoria z naglowka nie mowi, KTO odpowiada - odpowiedz sadzawki
            konczyla prosbe zadana warsztatowi i jej wiersze szly do tabeli warsztatu. Ten sam blad co przy
            `zapas` (tam naprawiony wczesniej warunkiem `pref !== wybrany`). */
        if (c.pref !== cz.slice(0, -1).join('/')) return;
        /*  ⛔ ODPOWIEDZ MUSI BYC NA PROSBE, KTORA JEST W DRODZE: od, do i kursor [PWA-6, Astra 02/13, 29.09]
            ------------------------------------------------------------
            WEJSCIA:  naglowek „#kat;od;do;pomin;n;dalej;nast" (sterownik odsyla pola prosby bez zmian,
                      21_karta_sd.h) i prosba w drodze `c` (od, dok, poz).
            CO Z CZEGO WYNIKA: tylko odpowiedz z tymi samymi od/do/pomin dopisuje linie, zatrzymuje licznik
                      czasu i prosi o nastepna strone. Duplikat z drugiego brokera (sterownik nadaje
                      odpowiedz na WSZYSTKIE drogi) albo spozniona strona nie zmienia NICZEGO.
            WYJSCIA:  kolejna prosba albo rozwiazana obietnica.
            ⛔ DLACZEGO: dawniej `c.nastepny()` szlo takze po odpowiedzi, ktora nie pasowala - kazdy duplikat
            dokladal prosbe o strone, ktora juz byla w drodze, i liczba prosb PODWAJALA SIE co strone.
            28.09 21:35 trzy apki wyslaly po 256 = 2^8 prosb w minute, a sterownik warsztatu dwa razy
            zatrzymal strażnik rdzenia 0 (dowody/2026-09-28, paczka 02). */
        if (+nag[1] !== c.od || +nag[2] !== c.dok || +nag[3] !== c.poz) return;
        clearTimeout(c.t);
        const n = +nag[4], dalej = +nag[5], nast = +nag[6] || 0;
        if (n < 0) { delete czekaOkres[c.kat]; c.res(new Response(JSON.stringify({ blad: 'brak karty' }), { status: 200 })); return; }
        c.linie = c.linie.concat(m.payloadString.slice(nl + 1).split('\n').filter(x => x.trim()));
        c.strony = (c.strony || 0) + 1;
        /*  kursor MUSI isc naprzod (ten sam = sterownik stoi w miejscu) i stron jest skonczenie wiele -
            bezpiecznik na wypadek bledu po drugiej stronie; ucieta odpowiedz mowi o tym wprost */
        if (dalej && nast && nast !== c.poz && c.strony < OKRES_MAX_STRON) { c.poz = nast; c.nastepny(); return; }
        if (dalej && nast) zapisz('okres ' + c.kat + ': zatrzymane po ' + c.strony + ' stronach (kursor ' + nast + ')');
        delete czekaOkres[c.kat];
        c.res(new Response(JSON.stringify({ kat: c.kat, od: c.od, do: c.dok, linie: c.linie }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        return;
      }
      if (rodzaj === 'plik') {                      /* kawałek pliku: "#kat/nazwa;rozmiar;od;n\n<linie>" */
        if (!czekaPlik || czekaPlik.pref !== cz.slice(0, -1).join('/')) return;   /* tylko od pytanego sterownika [2026-09-26] */
        const c = czekaPlik;
        const nl = m.payloadString.indexOf('\n'); const nag = m.payloadString.slice(1, nl).split(';');
        const rozmiar = +nag[1], od = +nag[2], n = +nag[3]; const dane = m.payloadString.slice(nl + 1);
        /*  [PWA-6, Astra 13] kawalek MUSI byc tego pliku (kat/nazwa z naglowka) i z tego miejsca (offset) -
            sprawdzone PRZED licznikiem czasu i buforem. Odpowiedz A.csv nie konczy pobierania B.csv, a duplikat
            z drugiego brokera nie prosi drugi raz o ten sam kawalek (ta sama petla co przy `okres`). */
        if (nag[0] !== c.kat + '/' + c.nazwa || od !== c.od) return;
        clearTimeout(c.t);
        if (n < 0) { czekaPlik = null; c.res(new Response(JSON.stringify({ blad: 'brak pliku albo karty' }), { status: 200 })); return; }
        c.tekst += dane; c.od = od + n;
        if (n > 0 && c.od < rozmiar) { c.nastepny(); return; }
        czekaPlik = null;
        if (c.json) c.res(new Response(JSON.stringify({ kat: c.kat, nazwa: c.nazwa, linie: c.tekst.split('\n').filter(x => x.trim()) }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        else c.res(new Response(c.tekst, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } }));
        return;
      }
      if (rodzaj === 'zdarzenia' || rodzaj === 'zd') {
        /*  DZIENNIK ZDARZEŃ [D-295]: `zdarzenia` = cały (na prośbę), `zd` = nowe wpisy na żywo; linie
            „czas,kat,kod,zrodlo,obieg,a,b,c" od najnowszego. Trzymamy do 200 na obiekt. */
        const pref = cz.slice(0, -1).join('/'); const z = zdarzenia[pref] || (zdarzenia[pref] = { ile: 0, zgubione: 0, wpisy: [] });
        const nowe = m.payloadString.split('\n').filter(l => l.trim()).map(l => l.split(',').map(Number)).filter(x => x.length === 8);
        if (rodzaj === 'zdarzenia') z.wpisy = nowe; else z.wpisy = nowe.concat(z.wpisy).slice(0, 200);
        z.ile = Math.max(z.ile, z.wpisy.length); z.kiedy = Date.now();
        if (pref === wybrany) oddaj(true);
        return;
      }
      if (rodzaj === 'nazwy') {                                       /* [D-493] */
        const pref = cz.slice(0, -1).join('/'); const r = {};
        for (const l of m.payloadString.split('\n')) {
          const i = l.indexOf(';'); if (i < 0) continue;
          const k = parseInt(l.slice(0, i), 10); if (!(k >= 0 && k < 16)) continue;
          nazwaNaSlowa(l.slice(i + 1)).forEach((s, j) => { r[AKC_NAZWY_REJ + k * AKC_NAZWA_SLOW + j] = s; });
        }
        nazwyR[pref] = r;
        const w = obiekty[pref]; if (w && w.r) Object.assign(w.r, r);
        if (pref === wybrany) oddaj(true);
        return;
      }
      if (rodzaj === 'wynik') {
        /*  [PWA-7, Astra 13] WYNIK = PARA {sterownik, id}, TYLKO SWIEZY.
            - retained to wynik zastany (sprzed subskrypcji) - nigdy odpowiedz na biezaca komende;
            - ten sam numer id od INNEGO sterownika (konto serwisowe slucha kilku) nie jest nasz;
            - wynik bez id (starsze firmware) konczy komende tylko od sterownika, ktorego pytalismy. */
        if (m.retained) return;
        const prefW = cz.slice(0, -1).join('/');
        let w = {}; try { w = JSON.parse(m.payloadString); } catch (e) { w = { kod: 1, opis: m.payloadString }; }
        const r = { ok: w.kod === 0, kod: w.kod, opis: w.opis || (w.kod === 0 ? 'wykonano' : 'odmowa') };
        if (w.id != null) {
          const p = oczekuja.get(w.id);
          if (!p || p.pref !== prefW) return;              /* cudza komenda, inny sterownik albo powtórka wyniku (dwie drogi) */
          oczekuja.delete(w.id); if (czekaWynik === p.res) czekaWynik = null;
          const ms = Date.now() - p.t0; M.pomiar.wynik_ms = ms; M.pomiar.ile++;
          zapisz('wynik ' + p.co + ': ' + ms + ' ms' + (w.kod ? ' kod ' + w.kod : ''));
          p.res(r); return;
        }
        if (czekaWynik && czekaWynikPref === prefW) { const f = czekaWynik; czekaWynik = null; f(r); }
        return;
      }
      if (rodzaj === 'zm') {
        const pref = cz.slice(0, -1).join('/');
        const w = obiekty[pref]; if (!w || !w.mb) return;          /* bez pełnego bloku nie ma na co nakładać */
        let d = null; try { d = JSON.parse(m.payloadString); } catch (e) { return; }
        if (!d) return;
        /*  NUMER URUCHOMIENIA `u` [D-481, audyt Astry 20.09 „spójność po restarcie" P1]. Sterownik dokłada
            do każdej paczki licznik restartów (ten sam, co w `awaria`), a do bloku trzecie pole linii Z;.
            Dotąd restart zgadywaliśmy ze skoku numeru o ≥1000 — i myliło się w OBIE strony: mały prawdziwy
            skok wstecz po restarcie (250 → 1) odrzucany jako „spóźniona kopia" (apka trzymała stare 28 °C,
            choć sterownik nadawał 31), a duży fałszywy (stary retained z zapasu) przyjmowany jako restart.
              • u < nasze  → paczka ze STAREGO uruchomienia (spóźniona, z drugiej drogi) — pomijamy;
              • u > nasze  → NOWE uruchomienie: lustro jest z poprzedniego życia, więc prosimy o pełny blok
                             i do jego przyjścia trzymamy zasłonę (luka); nowe wartości NAKŁADAMY — są
                             prawdziwsze niż to, co mamy;
              • u == nasze → zwykła numeracja niżej; spóźniona kopia = KAŻDY numer nie nowszy (bez progu 1000).
            Bez `u` (stary wsad sterownika) zostaje dawna heurystyka skoku 1000. */
        if (typeof d.u === 'number') {
          if (w.u != null && d.u < w.u) { zapisz('paczka z poprzedniego uruchomienia sterownika (u ' + d.u + ' < ' + w.u + ') - pomijam'); return; }
          if (w.u == null || d.u > w.u) {
            zapisz(w.u == null ? 'pierwsza paczka z numerem uruchomienia u ' + d.u + ' - proszę o pełny blok'
                               : 'sterownik uruchomiony na nowo (u ' + w.u + ' → ' + d.u + ') - proszę o pełny blok');
            w.u = d.u; w.seq = null; w.luka = true; w.lukaOd = Date.now();
            if (pref === wybrany) prosPelny('nowe uruchomienie');
          }
        }
        if (typeof d.seq === 'number') {
          /*  TA SAMA PACZKA DRUGĄ DROGĄ [D-313]: przy dwóch brokerach (i przy powtórce QoS 1) ten sam `seq`
              potrafi przyjść dwa razy. Bez tego wyglądało to jak dziura w numeracji i apka prosiła o pełny
              blok w kółko. Powtórkę po prostu pomijamy - lustro już ją ma. */
          /*  SPÓŹNIONA KOPIA TO TEŻ NIE LUKA [D-316]: przy dwóch brokerach ta sama paczka bywa dostarczona
              w innej kolejności (zmierzone: „luka seq 6213→6212"), a starą już mamy nałożoną. Odsiewamy każdy
              numer NIE NOWSZY od naszego - ale tylko gdy różnica jest mała; duży skok w dół to restart
              sterownika albo przewinięcie licznika i wtedy naprawdę trzeba poprosić o pełny blok. */
          if (w.seq != null && d.seq < w.seq && (typeof d.u === 'number' || w.seq - d.seq < SEQ_SKOK_RESTART)) return;   /* z `u` każdy numer nie nowszy = kopia [D-481] */
          if (w.seq === d.seq) {
            /*  DOWÓD, ŻE TEN BROKER JEST NADMIAROWY [D-315]: przyniósł paczkę, którą już mamy. Po pięciu takich
                z rzędu odpinamy od niego ciężkie tematy - ale tylko wtedy, gdy NIE jest tym, który niesie obiekt. */
            if (_zrodlo !== w.kl && ++_zrodlo.bliz >= 5) odepnijCiezkie(_zrodlo);
            return;
          }
          _zrodlo.bliz = 0;
          if (w.seq != null && d.seq !== w.seq + 1) { w.luka = true; w.lukaOd = Date.now(); if (pref === wybrany) { zapisz('luka seq ' + w.seq + '→' + d.seq); prosPelny('luka'); } }   /* luka → pełny blok od ręki; do niego lustro = zasiew [chwila luki: D-318] */
          w.seq = d.seq;
        }
        if (d.t) zegar[pref] = { czas: d.t, kiedy: Date.now() };
        if (d.mb) for (const k in d.mb) w.mb[+k] = d.mb[k];
        if (d.mn) { if (!w.mn) w.mn = []; for (const k in d.mn) w.mn[+k] = d.mn[k]; }
        if (d.r)  { if (!w.r) w.r = {};  for (const k in d.r)  w.r[+k]  = d.r[k]; }
        w.kiedy = Date.now(); w.kl = _zrodlo;   /* [D-314] paczki zmian też mówią, którym brokerem obiekt nadaje TERAZ */
        if (!w.luka) w.zasiew = false; if (pref === wybrany) { ost.zm = w.kiedy; czekamPoPowrocie = false; if (d.mn || d.r || d.mb) odnotujZmiane(); }
        if (pref === wybrany) oddaj(true);
        return;
      }
      if (rodzaj !== 'blok') return;
      const pref = cz.slice(0, -1).join('/');
      /*  SPÓŹNIONY PEŁNY BLOK TO TEŻ NIE PRAWDA [D-338]. `zm` odsiewa spóźnione kopie od D-316,
          a `blok` nie odsiewał nic — a bierze numer z tego samego licznika. Blok o numerze niższym
          niż nasze lustro wołał `zastosujPelny`, które cofało `w.seq` i podmieniało mb/mn/r STARSZĄ
          migawką: świeżo zapalone światło gasło na telefonie, a następna zmiana wyglądała jak luka
          i wymuszała kolejną prośbę o pełny blok. Przy dwóch brokerach blok i zmiana idą równolegle dwiema
          drogami i potrafią się wyminąć w drodze, więc sam porządek po stronie sterownika nie wystarcza.
          Duży skok w dół zostaje przyjęty — to restart sterownika albo przewinięcie licznika. */
      {
        const zS = parsujLinie(m.payloadString, 'Z;');
        const w0 = obiekty[pref];
        const wS = w0 && w0.seq, wU = w0 && w0.u;
        const zU = (zS && zS.length > 2 && zS[2] != null) ? zS[2] : null;
        if (zS && zS.length && wS != null) {
          if (zU != null && wU != null) {
            /*  [D-481] Z NUMEREM URUCHOMIENIA NIE MA ZGADYWANIA: starsze uruchomienie = stary blok
                (skądkolwiek przyszedł), to samo uruchomienie i niższy numer = spóźniona kopia. */
            if (zU < wU) { zapisz('pełny blok z poprzedniego uruchomienia sterownika (u ' + zU + ' < ' + wU + ') - pomijam'); return; }
            if (zU === wU && zS[0] < wS) { zapisz('spóźniony pełny blok seq ' + zS[0] + ' < ' + wS + ' (to samo uruchomienie) - pomijam, lustro nowsze'); return; }
          } else if (zS[0] < wS && wS - zS[0] < SEQ_SKOK_RESTART) {
            zapisz('spóźniony pełny blok seq ' + zS[0] + ' < ' + wS + ' - pomijam, lustro nowsze');
            return;
          }
        }
        /*  ZASTANY BLOK NIE ZASTĘPUJE ŻYWEGO LUSTRA [D-481, Astra „spójność" P1 przypadek 2]. Retained
            z brokera (np. z zapasu, na którym leży komplet sprzed godzin) wolno przyjąć, gdy nie mamy
            jeszcze żywego lustra (zasiew) ALBO gdy jest naprawdę nowszy: to samo uruchomienie i wyższy
            numer, albo nowsze uruchomienie. Dotąd duży skok w dół uchodził za restart i stary blok
            z zapasu nadpisywał świeży obraz z drogi głównej (30 °C → 21 °C, bez restartu sterownika). */
        if (m.retained && w0 && w0.mb && !w0.zasiew && wS != null && zS && zS.length) {
          const nowszy = (zU != null && wU != null) ? (zU > wU || (zU === wU && zS[0] > wS)) : (zS[0] > wS);
          if (!nowszy) { zapisz('zastany blok (seq ' + zS[0] + (zU != null ? ', u ' + zU : '') + ') nie nowszy niż żywe lustro - pomijam'); return; }
        }
      }
      /*  ⛔ ZASTANY BLOK NIE USTANAWIA, KTO NIESIE OBIEKT  [D-419b, objaw Tomasza: „basen sie
          polaczyl, ale niekompletny, jakby demo"]
          `kl` mowi, ktora droga obiekt NADAJE - stad ida zadania i komendy. Ustawialismy go przy
          KAZDYM pelnym bloku, takze `retained`. A retained lezy na brokerze i po zmianie ukladu
          potrafi byc sprzed godzin: na EMQX (dzis REZERWA, wiec sterownik tam nic nie nadaje)
          lezal caly stary komplet `blok`/`opis`/`status`. Apka brala go za biezacy stan i kierowala
          zadania w martwa droge - ekran mial liczby, ale nieruchome, jak demo.
          ⚠ Zasada: SWIEZE WYGRYWA NAD ZASTANYM. Zastany blok wolno przyjac jako zasiew lustra
            (to robi `zastosujPelny` nizej), ale nie wolno mu przestawiac drogi. */
      const _byl = obiekty[pref] && obiekty[pref].kl;
      obiekty[pref] = Object.assign(obiekty[pref] || {}, { kiedy: Date.now() },
                                    (m.retained && _byl) ? {} : { kl: _zrodlo });   // `kl` = broker, którym przyszedł [D-313]
      zastosujPelny(pref, obiekty[pref], m.payloadString);
      /*  RETAINED = ZASIEW, NIE ŚWIEŻY STAN [D-280]: blok z flagą retained ma od 0 do 60 s. Zasiewa
          lustro (rejestry, seq), ale nie zdejmuje planszy - świeży pełny blok przychodzi po `zadanie`
          w ~0,5 s. Bez tego dotknięcie w pierwszej sekundzie po otwarciu szło na starym stanie
          (sonda: dwa kliknięcia = jedno przełączenie, ekran odwrotnie niż sterownik). */
      if (m.retained) { obiekty[pref].kiedy = Date.now() - 100000; obiekty[pref].zasiew = true; zapisz('retained blok ' + pref.split('/').slice(1).join('/') + ' - czekam na świeży'); }
      else { obiekty[pref].zasiew = false; obiekty[pref].luka = false; try { localStorage.setItem(KL('blok_' + pref), m.payloadString); } catch (e) {}   /* pamięć na zimny start [C4] */
             if (pref === wybrany) { ost.blok = Date.now(); czekamPoPowrocie = false; odnotujZmiane(); } }
      zapisz('pełny blok ' + pref.split('/').slice(1).join('/') + ' ' + m.payloadString.length + ' B seq ' + obiekty[pref].seq + (m.retained ? ' (retained)' : ''));
      if (!wybrany) { zmienWybrany(pref); oglos(tempo); }
      if (pref === wybrany) oddaj(true);
    };
    /*  KODY PAHO PO POLSKU [D-309, Tomasz 2026-09-11: „AMQJS0007E pojawia się w dzienniku łącza jako błąd"]:
        surowy kod biblioteki wyglądał jak awaria. AMQJS0007E „Socket error" = system zamknął gniazdo WebSocket
        (telefon w tle, zmiana WiFi→LTE, chwilowy brak zasięgu) - Paho wraca sam, więc to informacja, nie błąd.
        Zapamiętujemy chwilę zerwania, żeby przy powrocie dopisać, ile trwała przerwa (dane do prób brzegowych). */
    const rcZ = r => { const m = /return code:\s*(\d)/i.exec((r && r.errorMessage) || ''); return m ? +m[1] : null; };
    const pahoTekst = r => { const m = (r && (r.errorMessage || r.message)) || String((r && r.errorCode) || r || '');
      if (/AMQJS0007E/.test(m)) return 'gniazdo zerwane przez system (tło / zmiana sieci / zasięg)';
      /* 0011E „Invalid state" = wyjątek z connect()/send() w złym stanie - u nas: connect() po powrocie na ekran, gdy Paho
         właśnie sam łączy ponownie [Tomasz 02:30: „albo z końcówką 11E"]; informacja, nie błąd */
      if (/AMQJS0011E/.test(m)) return /already connect/i.test(m) ? 'ponowne łączenie już trwa (Paho łączy sam)' : /not connect/i.test(m) ? 'jeszcze bez połączenia' : 'zły stan klienta: ' + m.replace(/^AMQJS0011E\s*/, '');
      if (/AMQJS0008I/.test(m)) return 'połączenie zamknięte' + (document.visibilityState === 'hidden' ? ' (telefon w tle)' : ' (telefon na ekranie: sieć albo broker)');
      if (/AMQJS0004E/.test(m)) return 'broker nie odpowiedział na ping (zasięg?)';
      if (/AMQJSC0001E/.test(m)) return 'brak odpowiedzi brokera (limit czasu)';
      if (/AMQJS0006E/.test(m)) return 'broker odrzucił połączenie' + (rcZ(r) !== null ? ' (kod ' + rcZ(r) + ')' : '');
      return m.replace(/^AMQJS[C]?\d+[EI]\s*/, '') || 'powód nieznany'; };
    /*  PONAWIANIE JEST NASZE, NIE PAHO [D-310] - `reconnect:false` w opcjach niżej.
        Dlaczego: z `reconnect:true` biblioteka po zamrożeniu karty zostaje ze stanem „łączę ponownie"
        i martwym gniazdem, z którego nie ma wyjścia jej własnym API (connect rzuca „already connected",
        zamknięcie gniazda jest wtedy ignorowane, a disconnect wywala się na pustym zegarze) - czekało się
        na jej limit czasu i odstęp, czyli kilkanaście sekund po każdym powrocie do apki.
        Teraz: każdy powód (zerwane, nieudana próba, powrót na ekran, odmrożenie) prowadzi do jednej
        drogi - `polaczTeraz`. Odstępy 1, 2, 5, 10, 20, 30, 60 s; powrót na ekran zeruje je i próbuje od razu.
        [D-313] KAŻDY BROKER MA SWÓJ komplet: stan, odstęp, zegar i gniazdo siedzą w jego wpisie `c` z POL;
        wspólne są tylko lustro obiektów, dziennik i ekran. */
    const ODSTEPY = [1, 2, 5, 10, 20, 30, 60];
    /*  GDY CZLOWIEK PATRZY, PROBUJEMY OD RAZU [D-345, Tomasz 2026-09-12: „od razu bez czekania"]
        ------------------------------------------------------------
        OBJAW: „na PC polaczona i widze, a na telefonie caly czas lacze ponownie" - i dalej:
        „musze zrestartowac i dziala". To nie bylo zerwane polaczenie, tylko ZABLOKOWANE PONAWIANIE:
        po kilku nieudanych probach odstep dochodzi do 60 s, wiec apka probuje raz na minute.
        Restart zerowal licznik, wiec laczyla od razu - stad zludzenie, ze pomaga tylko restart.
        Odstep zerowal sie przy POWROCIE NA EKRAN i po odmrozeniu karty, ale kto trzyma apke
        otwarta i patrzy, ten zadnego z tych momentow nie wywoluje.
        ⛔ ROZDZIELAMY DWIE SYTUACJE: gdy apka jest WIDOCZNA, czlowiek czeka i musi widziec proby -
        odstep nie ma prawa urosnac ponad kilka sekund. Gdy jest w tle, nikt nie patrzy i liczy sie
        oszczedzanie baterii oraz niedobijanie brokera - tam zostaja stare odstepy.
        ⚠ Brokera i tak nie dobijemy: `polaczTeraz` pilnuje 1,5 s miedzy probami niezaleznie od tego. */
    const ODSTEPY_PATRZY = [1, 2, 3, 5];
    /*  ⛔ ODMOWA KONTA TO NIE ZERWANE LACZE [21.09.2026, objaw z Gliczarowa].
        ------------------------------------------------------------
        OBJAW: „przeladowuje sie co sekunde, pokazuje OK, rozlacza sie i tak w kolko" - przy czym
        dwa pozostale serwery dzialaly. Dziennik apki: „serwery: 1:ok 2:zerwane 3:ok".
        PRZYCZYNA: po odmowie KONTA apka ponawiala z `ODSTEPY_PATRZY`, czyli co 5 s bez konca.
        ⚠ Tamta tabela powstala dla zerwanego lacza i tam jest sluszna - lacze wraca samo, wiec
          warto probowac czesto. **Konto, ktorego broker nie zna, nie pojawi sie od probowania.**
          Moze je stworzyc tylko czlowiek, a do tego potrzebuje spokojnego ekranu i komunikatu,
          nie migotania co piec sekund.
        ⚠ Znacznik `odmowaKonta` zdejmuje sie przy pierwszym udanym polaczeniu [D-422], wiec po
          poprawieniu konta apka wraca do normalnego rytmu sama - bez restartu. */
    const ODSTEPY_KONTO = [5, 15, 30, 60, 120, 300];
    /*  [D-427a] JEDNA NAZWA DROGI dla dziennika i dla ekranu. `slot` to numer slotu STEROWNIKA
        (z tematu `serwery`), a gdy go jeszcze nie znamy - pozycja na naszej liscie polaczen.
        Trzeci adres nie jest „slotem 3": to drugi kandydat do slotu 2. */
    const NAZWA_DROGI = nr => (nr === 1 ? 'slot 1' : nr === 2 ? 'slot 2 serwer 1'
                               : nr === 3 ? 'slot 2 serwer 2' : 'droga ' + nr);
    M.nazwaDrogi = NAZWA_DROGI;
    const etyk = c => (POL.length > 1 ? NAZWA_DROGI(c.slot || c.nr) + ': ' : '');
    /*  Komplet tematów obiektu; qos 1 tam, gdzie zgubiona wiadomość to zgubiona odpowiedź (paczki zmian,
        dziennik, karta SD), qos 0 tam, gdzie i tak przyjdzie następna (blok, stan, status, wynik). */
    const TEMATY = [['blok', 0], ['zm', 1], ['status', 0], ['wynik', 0], ['stan', 0],
                    ['zdarzenia', 1], ['zd', 1], ['pliki', 1], ['plik', 1], ['okres', 1],
                    ['serwery', 0], ['zapas', 0], ['nazwy', 1]];   /* [D-493] nazwy kanałów, retained */
    /*  [D-411] `serwery` = spis brokerow prosto ze sterownika (retained, przyjdzie od razu).
        [D-412] `zapas`  = MELDUNKI O REZERWIE, po polsku, pisane przez sterownik. To jedyna droga,
        ktora mowi, co sie stalo z rozkazem `zapas:...` - odpowiedzi NIE MA w temacie `wynik`
        (sprawdzone na sprzecie 17.09: rozkaz z blednym PIN-em odpowiedzial „zmiana rezerwy wymaga
        PIN" wylacznie tematem `zapas`). Bez tej subskrypcji ekran serwisu wysylalby rozkaz w cisze.
        ⚠ TEN KOMENTARZ MUSI SIE DOMYKAC. Przez pol dnia nie mial znaku konca i sklejal sie
        z nastepnym - kod dzialal przypadkiem, a kazda linia dopisana tutaj zostalaby po cichu
        zjedzona. Tak wygladala awaria z 17.09 rano: apka pokazywala demo i nie otwierala ustawien.
        ⚠ I JESZCZE JEDNO, ZMIERZONE NA WLASNEJ SKORZE minute pozniej: samo OSTRZEZENIE tez nie
        moze zawierac znaku konca komentarza w cudzyslowie - zamyka go w polowie zdania, a reszta
        zdania staje sie kodem. `sprawdz_apke.ps1` zlapal to numerem linii. */
    /*  CIĘŻKIE I LEKKIE [D-315]: sterownik nadaje każdą paczkę na WSZYSTKIE podłączone brokery (zmierzone:
        zgłoszenie na jednym włącza strumień na obu), więc przy dwóch brokerach telefon odbierał wszystko dwa razy.
        `zm` i `blok` to praktycznie cały ruch - te zostają tylko na brokerze, który NIESIE obiekt. Lekkie
        (`status`, `wynik`, `stan`, dziennik, karta) zostają na obu: są rzadkie, a `status` z obu jest nam potrzebny,
        żeby odróżnić „sterownik padł" od „ten broker już go nie obsługuje" (testament - D-314). */
    const CIEZKIE = ['zm', 'blok'];
    /*  ZAPISANIE SIE NA TEMAT, KTORE PRZEZYWA ODMOWE  [D-439]
        ─────────────────────────────────────────────────────────────────────────────────────
        WEJSCIA:   polaczenie · pelny temat ze wzorcem · jakosc uslugi
        CO Z CZEGO WYNIKA: od 18.09 apka zapisuje sie na DWIE postaci nazw (`obiekt/...` i stara
                   `basen/...`), bo flota przechodzi na nowy prefiks pojedynczo. Uprawnienia na
                   brokerze porownuja WZORZEC, nie tematy - wiec konto majace regule tylko na
                   jedna postac dostanie ODMOWE na druga. To jest normalne i ma przejsc bez
                   sladu na ekranie.
        WYJSCIA:   subskrypcja albo cicha linijka w dzienniku lacza.

        ⛔ BEZ WLASNEJ OBSLUGI NIEPOWODZENIA pierwsza odmowa przerywala petle `forEach` wyjatkiem
           i zabierala WSZYSTKIE pozostale tematy na tej drodze - czyli jedna odmowa na wzorzec,
           ktorego i tak nie potrzebujemy, uciszalaby cale polaczenie.
        ⚠ Odmowy NIE pokazujemy jako bledu uzytkownikowi: to nie usterka, tylko skutek tego, ze
          konto ma prawa do jednej postaci nazw. W dzienniku zostaje, bo serwis ma widziec, czym
          apka naprawde sie zapisala. */
    const _zapisz_sie = (c, temat, qos) => {
      try {
        c.kl.subscribe(temat, { qos: qos,
          onSuccess: () => { c.zakresOk = (c.zakresOk || 0) + 1; },
          onFailure: () => { c.zakresOdmowy = (c.zakresOdmowy || 0) + 1; (c.zakresOdmowyTematy || (c.zakresOdmowyTematy = [])).push(temat); } });
      } catch (e) { zapisz(etyk(c) + 'nie udało się zapisać na ' + temat); }
    };
    /*  JEDNO ZDANIE ZAMIAST LITANII [D-484, B.0z-38, zmierzone na PC Tomasza 19.09]. Konto KLIENCKIE
        z zaznaczonym ptaszkiem „serwisowe" zapisuje się wzorcami `obiekt/+/…` i `basen/+/+/…`, broker
        odrzuca każdy z osobna, a dziennik pisał dwadzieścia razy „bez dostępu do … - to konto ogląda
        inną postać nazw". Każde zdanie prawdziwe, całość myląca: człowiek szukał w NAZWACH obiektu,
        a przyczyną był ZAKRES KONTA (ptaszek). Teraz odmowy zbieramy i oceniamy po komplecie:
          • wszystkie odrzucone, a login ma myślnik (kliencki) → JEDNO zdanie, także na pasku
            (`c.stan`): „to konto jest klienckie - odznacz «serwisowe» i zaloguj się ponownie";
          • wszystkie odrzucone, login bez myślnika → to samo zdanie o zakresie, bez odsyłania do ptaszka;
          • część odrzucona, część przyjęta → dawne linie per temat (to naprawdę jest „inna postać nazw");
          • i odwrotnie [B.0z-38 druga strona]: konto BEZ myślnika (serwisowe) z odznaczonym ptaszkiem
            widzi jeden obiekt - jedna linia w dzienniku, żeby „zniknęły mi sterowniki" miało wyjaśnienie.
        Ocena po 3 s od kompletu zapisów: SUBACK-i wracają szybko, a broker, który milczy, i tak
        nie da żadnej odpowiedzi do oceny. */
    const ocenZakres = c => {
      const ok = c.zakresOk || 0, odm = c.zakresOdmowy || 0, tematy = c.zakresOdmowyTematy || [];
      c.zakresOk = 0; c.zakresOdmowy = 0; c.zakresOdmowyTematy = [];
      if (!odm) {
        if (!serwisowe && String(c.user || '').indexOf('-') < 0 && ok)
          zapisz(etyk(c) + 'konto „' + c.user + '" wygląda na serwisowe, a ptaszek „serwisowe" jest odznaczony - apka widzi tylko jeden obiekt; zaznacz go przy logowaniu, jeśli ma widzieć wszystkie');
        return;
      }
      if (ok) { tematy.forEach(t => zapisz(etyk(c) + 'bez dostępu do ' + t + ' - to konto ogląda inną postać nazw')); return; }
      const kliencki = String(c.user || '').indexOf('-') > 0;
      const zdanie = serwisowe && kliencki
        ? 'to konto („' + c.user + '") jest klienckie - odznacz „serwisowe" przy logowaniu i zaloguj się ponownie'
        : 'broker odrzucił wszystkie zapisy konta „' + c.user + '" (' + odm + ') - zakres konta nie pasuje do wybranej postaci nazw';
      zapisz(etyk(c) + zdanie);
      c.stan = { stan: 'blad', opis: zdanie };
      oddaj();
    };
    const odepnijCiezkie = c => { if (c.lekki) return; c.lekki = true;
      try { (c.tematy || [c.temat]).forEach(z => CIEZKIE.forEach(tm => c.kl.unsubscribe(z + '/' + tm)));
            zapisz(etyk(c) + 'nie odbieram danych - te same paczki idą drugą drogą'); } catch (e) {} };
    const wepnijCiezkie = c => { if (!c.lekki || !c.kl.isConnected()) return; c.lekki = false;
      try { (c.tematy || [c.temat]).forEach(z => TEMATY.filter(tm => CIEZKIE.indexOf(tm[0]) >= 0)
              .forEach(tm => _zapisz_sie(c, z + '/' + tm[0], tm[1])));
            zapisz(etyk(c) + 'odbieram dane tędy'); } catch (e) {} };
    const zrobDriver = c => {
      /*  ZDARZENIA TYLKO OD AKTUALNEGO KLIENTA [D-483, audyt Astry 20.09 „powrót łączności" P1].
          `odnowKlienta` buduje nowy obiekt Paho, ale stary ma nadal podpięte `onConnectionLost`,
          `onConnected`, `onSuccess/onFailure` i odbiór. Zmierzone przez Astrę na prawdziwym Paho:
          rozłączenie starego wołało jego `onConnectionLost` → `polaczTeraz` → stary łączył się
          PONOWNIE, potem powstawał nowy - dwa żywe klienty na jednej drodze, a błąd gniazda starego
          ustawiał wspólny `c.stan` na „zerwane", choć nowy działał i dostarczał świeże paczki
          (apka: „polaczony=false" przy wieku danych 0 s). Każda obsługa zapamiętuje, KTÓREGO klienta
          dotyczy, i milczy, gdy `c.kl` wskazuje już na innego. */
      const kl = c.kl;
      const moj = () => kl === c.kl;
      c.zerwaneOd = 0; c.byloWTle = false; c.byloZerwane = false; c.odstepNr = 0; c.ponowZegar = null; c.ostProba = 0;
      c.dzialaloOd = 0;   /* [D-407] kiedy to połączenie NAPRAWDĘ stanęło - stąd wiadomo, czy zerować odstęp */
      const ponowPozniej = powod => {
        /* [D-345] tablica zalezy od tego, czy ktos patrzy - patrz uzasadnienie przy ODSTEPY_PATRZY */
        const widac = (typeof document === 'undefined') || document.visibilityState !== 'hidden';
        /*  Kolejnosc ma znaczenie: odmowa konta bije nawet wtedy, gdy czlowiek patrzy -
            bo patrzenie nie zmienia faktu, ze tego konta broker nie zna. */
        const tab = c.odmowaKonta ? ODSTEPY_KONTO : (widac ? ODSTEPY_PATRZY : ODSTEPY);
        const sek = tab[Math.min(c.odstepNr, tab.length - 1)]; c.odstepNr++;
        if (c.ponowZegar) clearTimeout(c.ponowZegar);
        c.ponowZegar = setTimeout(() => { c.ponowZegar = null; c.polaczTeraz(powod); }, sek * 1000);
        return sek;
      };
      c.polaczTeraz = powod => {
        if (!c.kl || c.kl.isConnected()) return;
        /* ⚠ nie dobijamy brokera: seria zdarzeń (powrót + odmrożenie + zerwanie w tej samej chwili) ma dać JEDNĄ próbę */
        /*  ⛔ ODRZUCONA PROBA MUSI ZOSTAWIC ZAPLANOWANA KOLEJNA [D-359, audyt Astry 15.09]:
            pierwsza wersja robila samo `return`. Gdy blad wracal szybciej niz 1,5 s (np. odmowa gniazda
            po 100 ms), zaplanowane ponowienie trafialo w ogranicznik i GINELO - bez zegara, bez sladu.
            Zmierzone przez Astre: po 60 s jedna proba i zero zaplanowanych, mimo napisu „proba za 1 s".
            Teraz odraczamy do najblizszego dozwolonego terminu zamiast porzucac. */
        const teraz = Date.now();
        if (teraz - c.ostProba < 1500) {
            if (!c.ponowZegar) {
              const za = 1500 - (teraz - c.ostProba);
              c.ponowZegar = setTimeout(() => { c.ponowZegar = null; c.polaczTeraz(powod); }, za);
            }
            return;
        }
        c.ostProba = teraz;
        if (c.ponowZegar) { clearTimeout(c.ponowZegar); c.ponowZegar = null; }
        const sprobuj = () => { c.kl.connect(c.opcje); c.gniazdo = M._gniazdo; c.stan = { stan: 'laczy', opis: 'łączę z brokerem…' }; oddaj(); };
        try { sprobuj(); return; }
        catch (e) {
          /*  gniazdo poprzedniej próby wisi (zamrożone razem z kartą): zamykamy je i wołamy obsługę zamknięcia,
              którą Paho sam do niego podpiął - biblioteka od razu wie, że gniazda nie ma. Bez tego czekałaby
              pełny własny limit czasu. Przy `reconnect:false` ta droga zawsze działa. */
          try { const g = c.gniazdo;
            if (g) { try { g.close(); } catch (e2) {} if (typeof g.onclose === 'function') g.onclose({ code: 1006, wasClean: false }); }
          } catch (e3) {}
          try { sprobuj(); zapisz(etyk(c) + 'gniazdo w locie zamknięte - łączę (' + powod + ')'); return; }
          catch (e4) { const s = ponowPozniej(powod); zapisz(etyk(c) + 'próba za ' + s + ' s (' + pahoTekst(e4) + ')'); }
        }
      };
      c.kl.onConnectionLost = r => { const co = pahoTekst(r);
        if (!moj()) { zapisz(etyk(c) + 'zerwanie WYCOFANEGO klienta (' + co + ') - pomijam, nowy klient działa dalej'); return; }   /* [D-483] */
        c.zerwaneOd = Date.now(); c.byloZerwane = true;
        c.byloWTle = (document.visibilityState === 'hidden');
        c.stan = { stan: 'zerwane', opis: 'zerwane: ' + co + ' - łączę ponownie…' };
        statusBezDrogi(c.nr);            /* [D-481] zerwana droga traci głos w „online/offline" obiektów */
        const niosl = (klDla(wybrany) === c);   /* czy TĄ drogą przychodził wybrany obiekt [D-407] */
        if (niosl) czekamPoPowrocie = true;
        zapisz(etyk(c) + 'zerwane: ' + co); oddaj();
        /*  ⚠ TYLKO GDY TO BYŁA DROGA, KTÓRĄ OBIEKT DOCIERAŁ [D-407, objaw zmierzony 17.09].
            Dotąd KAŻDE zerwanie - także serwera, który nigdy nie działał - kazało sterownikowi wrócić
            do nadawania równoległego. Martwy serwer 2 robił to co dwie sekundy i szarpał tym pierwszym:
            w dzienniku „serwer 1: połączony ponownie (przerwa 4 s)", a w apce znikające obiegi. */
        if (niosl && M.niesieReset) M.niesieReset();
        /*  ⚠ ODSTĘP ZERUJEMY TYLKO PO POŁĄCZENIU, KTÓRE NAPRAWDĘ DZIAŁAŁO [D-407].
            Zerowanie przy każdym zerwaniu znaczyło, że serwer NIEOSIĄGALNY nigdy nie wchodzi
            w odstępy - bo każda nieudana próba wygląda jak „zerwane działające połączenie"
            i wraca na początek tablicy. Efekt: próba co 1-2 s w nieskończoność, bateria i broker
            dobijane bez sensu. Dziesięć sekund pracy = połączenie było prawdziwe. */
        if (c.dzialaloOd && (Date.now() - c.dzialaloOd) > 10000) c.odstepNr = 0;
        c.dzialaloOd = 0;
        c.polaczTeraz('zerwane');   /* od razu; gdy sieci nie ma, próba padnie i pójdą odstępy */
      };
      /*  PO KAŻDYM POŁĄCZENIU: `onSuccess` (subskrypcje - cleanSession je kasuje przy zerwaniu) leci przy KAŻDYM
          CONNACK, a `onConnected` podpisuje pasek. Czy to POWRÓT po zerwaniu, wiemy z własnej flagi `byloZerwane`
          - Paho przy `reconnect:false` zawsze podaje „pierwsze połączenie" [D-310]. */
      c.kl.onConnected = () => {
        if (!moj()) { zapisz(etyk(c) + 'połączył się WYCOFANY klient - rozłączam go, nowy ma pierwszeństwo'); try { kl.disconnect(); } catch (e) {} return; }   /* [D-483] */
        const ponownie = c.byloZerwane;
        const przerwa = (ponownie && c.zerwaneOd) ? ' (przerwa ' + Math.round((Date.now() - c.zerwaneOd) / 1000) + ' s' + (c.byloWTle ? ', telefon był w tle' : '') + ')' : '';
        c.zerwaneOd = 0; c.byloWTle = false; c.byloZerwane = false; c.odstepNr = 0; c.nieudane = 0;
        c.odmowaKonta = false;           /* [D-422] konto jednak jest - zdejmujemy znacznik */
        c.dzialaloOd = Date.now();       /* [D-407] połączenie NAPRAWDĘ stanęło - dopiero to pozwala zerować odstęp */
        /*  [D-408] meldunek do serwisu - po chwili, gdy subskrypcje i wybor obiektu juz stoja.
            [D-430] PO ZERWANIU idzie PELNY dziennik: wtedy jest po co, bo w nim siedzi przyczyna.
            Inaczej z telefonu widac tylko jedna linie skrotu i szuka sie na oslep - dokladnie tak
            zgubilem dzis wyjatek `m is not defined`, ktory zrywal polaczenie co sekunde.
            ⚠ Nie czesciej niz raz na minute: pelny dziennik to 2-3 kB, a apka ze zrywajacym sie
              laczem zalalaby brokera wlasnie wtedy, gdy lacze ledwo dycha. */
        setTimeout(() => { try {
          if (!M.wyslijDziennik) return;
          const teraz = Date.now();
          const pelny = ponownie && (!M._pelnyLog || teraz - M._pelnyLog > 60000);
          if (pelny) M._pelnyLog = teraz;
          M.wyslijDziennik(pelny);
        } catch (e) {} }, 4000);
        c.ostOdbior = Date.now();        /* [D-355] swiezo polaczony - strażnik ciszy liczy od teraz */
        if (c.ponowZegar) { clearTimeout(c.ponowZegar); c.ponowZegar = null; }
        c.stan = { stan: 'ok', opis: ponownie ? 'połączony ponownie' + przerwa : 'połączony' };
        zapisz(etyk(c) + (ponownie ? 'połączony ponownie' + przerwa : 'połączony'));
        if (ponownie && wybrany && klDla(wybrany) === c) { _pelnyOst = 0; prosPelny('powrót łącza'); }   /* w czasie przerwy paczki zmian przepadły, retained blok bywa 60 s stary [D-278] */
        oddaj();
      };
      c.opcje = { useSSL: true, userName: c.user, password: c.pass, timeout: 10, keepAliveInterval: 30, cleanSession: true, reconnect: false,
        onSuccess: () => { if (!moj()) return;   /* [D-483] */
                           c.lekki = false; c.bliz = 0;
                           c.zakresOk = 0; c.zakresOdmowy = 0; c.zakresOdmowyTematy = [];
                           (c.tematy || [c.temat]).forEach(z => TEMATY.forEach(tm => _zapisz_sie(c, z + '/' + tm[0], tm[1])));
                           setTimeout(() => { if (moj()) ocenZakres(c); }, 3000);   /* [D-484] jedno zdanie o zakresie konta */
                           if (wybrany) oglos(tempo); },
        onFailure: r => {
          if (!moj()) return;   /* [D-483] nieudana próba WYCOFANEGO klienta nie planuje ponowień ani nie zmienia stanu */
          const rc = rcZ(r);
          /* ZŁE DANE LOGOWANIA NIE PONAWIAJĄ SIĘ - to człowiek musi poprawić (inaczej broker blokuje konto za dobijanie) */
          /*  ⚠ POWIEDZ, JAKIM KONTEM PROBOWALES [17.09, zmierzone na stanowisku]. Konto na brokerze
              zapasowym powstaje u innego dostawcy i czlowiek nadaje mu nazwe recznie - u nas wyszlo
              `apka` przy apce szukajacej `apka2` (pusta rubryka znaczy „ten sam login z dwojka na
              koncu"). Bez nazwy w komunikacie wyglada to na zle HASLO i szuka sie nie tam, gdzie
              trzeba. Nazwa konta nie jest tajemnica - haslo nadal nigdzie nie jedzie. */
          /*  ⚠ TEKST MA PASOWAC DO KAZDEGO SERWERA, NIE TYLKO DO ZAPASU [17.09, wieczor].
              Pierwsza wersja pisala „popraw haslo ZAPASU" - a odmowa przyszla z serwera GLOWNEGO
              (skasowane konto `apka`, zostalo `Master`). Czlowiek czytal o zapasie i szukal bledu
              w rubryce, ktora akurat byla pusta i poprawna. Komunikat nazywa wiec konto i mowi,
              gdzie sie je zmienia - „Zmien sterownik / haslo" dla glownego, „zaawansowane" dla zapasow. */
          if (rc === 4 || rc === 5) {
            const gl = (c.nr === 1);
            c.stan = { stan: 'blad', opis: 'broker nie zna konta „' + (c.user || '(bez konta)') + '"'
                       + (gl ? ' - zaloguj sie jeszcze raz przyciskiem „Zmien sterownik / haslo"'
                             : ' - popraw konto zapasu w zaawansowanych') };
            c.odmowaKonta = true;                       /* [D-422] ta droga odpadla przez KONTO, nie przez lacze */
            zapisz(etyk(c) + 'odmowa: broker nie zna konta „' + c.user + '" (albo haslo inne)');
            oddaj(); return; }
          const powod = rc === 3 ? 'broker niedostępny' : rc === 1 || rc === 2 ? 'broker odrzucił klienta (kod ' + rc + ')'
                      : 'broker nie odpowiada (brak zasięgu?)';
          const sek = ponowPozniej('nieudana próba');
          c.stan = { stan: 'blad', opis: powod + ' - ponowna próba za ' + sek + ' s' }; zapisz(etyk(c) + 'odmowa: ' + powod + ' - próba za ' + sek + ' s'); oddaj();
          /*  [D-354] TRZY NIEUDANE PROBY POD RZAD = cos jest nie do odratowania w tym kliencie
              (utknieta biblioteka albo sesja o tym samym identyfikatorze wciaz zywa u brokera).
              Budujemy od zera; nastepna proba pojdzie juz nowym klientem. */
          c.nieudane = (c.nieudane || 0) + 1;
          if (c.nieudane >= 3) odnowKlienta(c);
        } };
    };
    /*  KLIENT OD ZERA, Z NOWYM IDENTYFIKATOREM [D-354, 2026-09-13]
        ------------------------------------------------------------
        WEJSCIA:  polaczenie `c`, ktore nie wstaje mimo kolejnych prob.
        CO Z CZEGO WYNIKA: zamykamy gniazdo, porzucamy stary obiekt biblioteki i budujemy NOWY,
                  z NOWO WYLOSOWANYM identyfikatorem; obsluge podpina ta sama `zrobDriver`.
        WYJSCIA:  `c.kl` wskazuje na swiezy obiekt gotowy do `polaczTeraz`.

        ⛔ PO CO, skoro `polaczTeraz` juz ponawia [objaw Tomasza 13.09: „nie mam nawet do basenu
        dostepu, robie restart i jest basen"; w dzienniku lacza szesc prob pod rzad, kazda
        „broker nie odpowiada", az do przeladowania strony]:
        1. IDENTYFIKATOR BYL STALY przez cale zycie strony (losowany raz). Telefon wraca z tla,
           a broker jeszcze trzyma STARA sesje z tym samym identyfikatorem - nowe polaczenie leci
           w konflikt i pada. Przeladowanie strony losowalo nowy identyfikator, wiec „restart
           pomagal, a ponawianie nie" - to ten sam mechanizm, nie przypadek.
        2. OBIEKT BIBLIOTEKI BYL TEN SAM. Paho potrafi utknac po zerwaniu w stanie, z ktorego
           `connect` juz nie wychodzi (znane z D-310, dlatego mamy `reconnect:false` i wlasne
           ponawianie). Zamkniecie gniazda w locie leczy tylko czesc przypadkow.
        ⚠ NIE ROBIMY TEGO PRZY KAZDEJ PROBIE - nowy identyfikator to dla brokera nowy klient
        i nowa sesja; przy `cleanSession:true` kosztuje to komplet subskrypcji od nowa. Odnawiamy
        przy POWROCIE NA EKRAN (czlowiek patrzy i czeka) oraz po serii nieudanych prob w tle. */
    const odnowKlienta = c => {
      /*  KOLEJNOŚĆ MA ZNACZENIE [D-483]: NAJPIERW nowy klient staje się `c.kl` i znika zaplanowane
          ponowienie, DOPIERO POTEM zamykamy starego. Wtedy jego `onConnectionLost` (Paho woła je
          także przy zwykłym `disconnect()`) trafia w straż `moj()` i nie robi nic - a dotąd
          uruchamiał drugie połączenie tego samego starego obiektu. */
      const nowy = 'hmi-' + Math.random().toString(16).slice(2, 10) + (c.nr > 1 ? '-' + c.nr : '');
      let nowyKl;
      try { nowyKl = new Klient(c.host, c.port, '/mqtt', nowy); }
      catch (e) { zapisz(etyk(c) + 'nie udalo sie zbudowac klienta: ' + e.message); return false; }
      const stary = c.kl, gniazdo = c.gniazdo;
      if (c.ponowZegar) { clearTimeout(c.ponowZegar); c.ponowZegar = null; }
      c.kl = nowyKl; c.gniazdo = null; c.nieudane = 0;
      try { if (gniazdo && gniazdo.close) gniazdo.close(); } catch (e) {}
      try { if (stary && stary.isConnected()) stary.disconnect(); } catch (e) {}
      zrobDriver(c);
      podepnijOdbior(c);        /* [D-359] bez tego nowy klient jest „polaczony", ale gluchy */
      c.odstepNr = 0;
      zapisz(etyk(c) + 'klient od nowa (identyfikator ' + nowy + ')');
      return true;
    };
    POL.forEach(zrobDriver);
    /*  ZIMNY START Z PAMIĘCI TELEFONU [D-289, C4]: ostatni pełny blok wybranego obiektu leży w localStorage.
        Otwarcie apki = liczby OD RAZU pod zasłoną „łączę…/pobieram stan…" (zasiew), nie ciemna plansza;
        świeży blok przychodzi po `zadanie`. Warunki brzegowe: blok z pamięci ma `seq` sprzed godzin →
        pierwsza paczka zm pokaże lukę → `pelny` od ręki, a do jego nadejścia zasłona zostaje (w.luka).
        Zły/obcięty wpis → parsujLinie zwraca null → oddaj() traktuje jak brak bloku. */
    if (wybrany) { const c = pamiec('blok_' + wybrany);
      if (c && c.indexOf('MB;') === 0 || (c && c.indexOf('\nMB;') >= 0)) { obiekty[wybrany] = { kiedy: Date.now() - 100000, zasiew: true, luka: true, status: '?' };
        zastosujPelny(wybrany, obiekty[wybrany], c); zapisz('blok z pamięci telefonu (zasiew)'); } }
    POL.forEach(c => { zapisz(etyk(c) + 'zakres: ' + (c.tematy || [c.temat]).join(' + ')); c.polaczTeraz('start'); });
    oddaj(!!(wybrany && obiekty[wybrany]));   /* od razu: liczby z pamięci pod zasłoną albo plansza „łączę z brokerem…" */
    /* wiek pakietu ma płynąć także między pakietami - kafel ma zblednąć, gdy obiekt zamilkł */
    setInterval(() => oddaj(false), 1000);
    /*  [D-408] DZIENNIK APKI WRACA DO SERWISU PO MQTT — temat `<obieg>/apka`.
        ⚠ PO CO: gdy klient mówi „nie działa", jedyną drogą do tego, co widzi jego telefon, był
          zrzut ekranu. Dziś apka sama odsyła wersję, stan obu serwerów i ostatnie linie dziennika —
          czyli dokładnie to, czego szukaliśmy dziś rano, przepisując ekran po ekranie.
        ⚠ DWA TRYBY, ŚWIADOMIE: KRÓTKI (jedna linia przy połączeniu — tanie, zawsze) i PEŁNY
          (na żądanie człowieka). Ciągłe nadawanie całego dziennika zjadałoby łącze i zamieniło
          temat diagnostyczny w drugi strumień stanu, którego nikt nie czyta.
        ⚠ Wysyłamy na temat WYBRANEGO obiegu: konto klienta ma prawo pisać tylko u siebie, więc
          diagnostyka jednego klienta nie trafi nigdy w cudze poddrzewo. */
    M.wyslijDziennik = pelny => {
      const c = klDla(wybrany);
      if (!wybrany || !c || !c.kl || !c.kl.isConnected()) return false;
      const gl = 'apka ' + (window.APKA_WERSJA || '?')
               + ' | serwery: ' + POL.map(x => (x.nr || 1) + ':' + ((x.stan && x.stan.stan) || '?')).join(' ')
               + ' | obiekt ' + wybrany;
      /*  ⚠ Znak nowej linii składamy z kodu, nie z literału [D-408a]: zapis `'\n'` w napisie
          padł ofiarą narzędzia, którym wstawiałem tę łatkę — ukośnik zniknął, w pliku został
          PRAWDZIWY przełam wiersza w środku napisu i CAŁY skrypt przestał się wykonywać.
          Objaw był mylący: apka pokazywała dane demonstracyjne i nie otwierała ustawień,
          bo nie wykonał się żaden kod, nie tylko ta funkcja. `String.fromCharCode(10)` jest
          odporny na taką pomyłkę i tak samo robi to reszta tego pliku. */
      const NL = String.fromCharCode(10);
      const dwa = n2 => (n2 < 10 ? '0' : '') + n2;
      const tresc = pelny
        ? gl + NL + M.dziennik.map(w => {
            const d = new Date(w.t);
            return dwa(d.getHours()) + ':' + dwa(d.getMinutes()) + ':' + dwa(d.getSeconds()) + ' ' + w.txt;
          }).join(NL)
        : gl;
      try {
        const m = new Paho.Message(tresc); m.destinationName = wybrany + '/apka'; m.qos = 0;
        c.kl.send(m); return true;
      } catch (e) { return false; }
    };

    M.wybierzObiekt = pref => { if (obiekty[pref]) { zmienWybrany(pref); wybranyRecznie = true;
      M.ostSpisSerwerow = _spisWybrany(pref);     /* [D-429] spis idzie za wybranym obiegiem */
      try { localStorage.setItem(KL('mqtt_obiekt'), pref); } catch (e) {} oglos(tempo); oddaj(true); } };
    /*  SPRAWDŹ PIN [2026-09-09, Tomasz: „PIN do serwisu taki, jaki jest ustawiony w sterowniku"]:
        publikuje `pin=` bez `w=` (sterownik nic nie zapisuje, tylko odpowiada, czy PIN pasuje).
        Kod 0 → PIN dobry, zapamiętujemy go do kolejnych zmian serwisowych (bez pytania drugi raz).
        Zwraca 'ok' | 'zle' | <komunikat>. Ekran serwisu w apce woła to przy wejściu, więc PIN
        jest JEDEN — ten ze sterownika. */
    /*  REZERWOWY BROKER — OGLADANIE I ZMIANA Z APKI  [D-412, Tomasz 2026-09-17: „tak brac"
        (na pytanie, czy robic zmiane rezerwy z apki za PIN-em)]
        ═══════════════════════════════════════════════════════════════════════════════════════
        WEJSCIA:   spis serwerow ze sterownika (`M.ostSpisSerwerow`, D-411), meldunki z tematu
                   `zapas`, PIN serwisowy sterownika (ten sam, ktory otwiera menu serwisowe).
        CO Z CZEGO WYNIKA: serwis widzi, co sterownik ma w rezerwie, i moze to zmienic bez
                   podchodzenia do szafy — jednym rozkazem w tym samym temacie `zadanie`,
                   ktorym apka i tak prosi o dane.
        WYJSCIA:   `M.rezerwa.test() / .ustaw() / .kasuj()` — kazda oddaje ZDANIE STEROWNIKA,
                   nie wlasne „wyslano".

        ⚠ ODPOWIEDZI NIE MA W TEMACIE `wynik`. `zapas:` nie idzie droga komend (tam jest `id`
          i kod liczbowy), tylko droga zadan — a sterownik melduje po polsku tematem `zapas`.
          Zmierzone 17.09: bledny PIN odpowiedzial „zmiana rezerwy wymaga PIN" wylacznie tam.
          Dlatego czekamy na meldunek, a nie na kod.

        ⚠ JEDNYM BROKEREM, NIE WSZYSTKIMI. Zwykle zadania apka rozsyla kazda droga [D-327], bo
          powtorka nic nie kosztuje. Tutaj kosztuje: rozkaz doszedlby dwa razy, sterownik dwa razy
          zapisalby NVS i dwa razy oglosil wynik, a czlowiek zobaczylby dwa meldunki na jedno
          klikniecie. Rozkaz idzie wiec TA droga, ktora obiekt naprawde dociera.

        ⚠ BRAMKI NA SKLADNIE SA PO NASZEJ STRONIE, BO STEROWNIK ICH NIE MA. Rozbiera rozkaz
          `strchr(':')` i `strstr(";pin=")`, wiec dwukropek w hasle rozjechalby pola, a srednik
          uciąłby PIN — i to bez zadnego bledu, po prostu zapisalaby sie bzdura. Zamiast tego
          mowimy wprost, czego nie wolno (zasada 10). Limit dlugosci z `char buf[240]` w firmware.

        ⛔ HASLO REZERWY TO HASLO STEROWNIKA DO CUDZEGO BROKERA, nie haslo klienta. Idzie tresci
          rozkazu, wiec wylacznie po szyfrowanym polaczeniu (apka z Pages laczy sie po wss) i
          NIGDY nie trafia do dziennika lacza — w `zapisz()` ponizej jedzie sam adres. */
    const REZ_ZLE_ZNAKI = /[:;\s]/;
    const rezRozkaz = (tresc, coTxt) => new Promise(res => {
      if (!wybrany) { res('nie wybrano sterownika'); return; }
      const kk = klGot(wybrany);
      if (!kk) { res('brak połączenia z brokerem'); return; }
      if (tresc.length > 200) { res('rozkaz za długi (' + tresc.length + ' znaków, mieści się 200)'); return; }
      let oddane = false, zegarek = null;
      const oddaj1 = t => { if (oddane) return; oddane = true;
                            if (zegarek) clearTimeout(zegarek);
                            if (czekaZapas === sluchaj) czekaZapas = null; res(t); };
      /*  ⛔ „SPRAWDZAM…" TO JESZCZE NIE ODPOWIEDZ [poprawka po przegladzie]. Sterownik na jeden
          rozkaz mowi dwa razy: najpierw „sprawdzam rezerwe <adres>", a werdykt dopiero po probie
          polaczenia - do 40 s pozniej (ZAP_PROBA_MS w firmware, podniesione tam z 15 na 40 s, bo
          uzgadnianie TLS przy zajetym stosie tyle potrafi trwac). Konczenie na pierwszym zdaniu
          oddawalo przyciski w srodku trwajacej proby: kolejne klikniecie w oknie 3 s ginelo
          w odsiewie powtorek sterownika, a po 3 s wracalo „sprawdzanie juz trwa". */
      const przejsciowy = t => /^sprawdzam /.test(t) || /- sprawdzam$/.test(t);
      const sluchaj = t => { if (!przejsciowy(t)) { oddaj1(t); return; }
                             if (zegarek) clearTimeout(zegarek);
                             zegarek = setTimeout(() => oddaj1('sterownik zaczął sprawdzać, ale nie podał wyniku'), 50000); };
      czekaZapas = sluchaj;
      try {
        const msg = new Paho.Message(tresc); msg.destinationName = wybrany + '/zadanie'; msg.qos = 1;
        kk.send(msg);
      } catch (e) { oddaj1('nie udało się wysłać: ' + e); return; }
      zapisz('rezerwa: ' + coTxt);
      /*  ⚠ TEN SAM ROZKAZ DWA RAZY W CIAGU 3 s STEROWNIK ODRZUCA W MILCZENIU (SIEC_ODB_DUBEL_MS -
          odsiew powtorki idacej druga droga [D-327]). Przyciski gasna na czas czekania, wiec czlowiek
          tego nie wywola; gdyby jednak doszlo do powtorki, skonczy sie ona naszym „sterownik nie
          odpowiedzial w 15 s" - i to jest uczciwa odpowiedz, bo rozkaz naprawde nie zostal wykonany. */
      /*  15 s, nie 5 jak przy komendach: `zapas:test` melduje „sprawdzam…" od razu, ale przy
          zajętym stosie pierwszy meldunek potrafi się spóźnić (uzgadnianie TLS - patrz
          ZAP_PROBA_MS w firmware, podniesione z 15 na 40 s z tego samego powodu). */
      zegarek = setTimeout(() => oddaj1('sterownik nie odpowiedział w 15 s'), 15000);
    });
    /*  PIN: ten sam, ktory otwiera menu serwisowe [2026-09-09, Tomasz: „PIN do serwisu taki, jaki
        jest ustawiony w sterowniku"]. Gdy juz byl podany w tej sesji - nie pytamy drugi raz. */
    const rezPin = () => {
      if (pinSerwis) return pinSerwis;
      const p = prompt('Zmiana rezerwy wymaga PIN-u serwisowego sterownika:', '');
      if (!p) return null;
      pinSerwis = p;      /* gdy zly - sterownik powie to wprost, a nastepna proba zapyta znowu */
      return p;
    };
    M.rezerwa = {
      spis: () => M.ostSpisSerwerow || null,
      ostatni: () => M.ostZapas || null,
      test: () => rezRozkaz('zapas:test', 'sprawdź teraz'),
      kasuj: () => { const p = rezPin(); if (!p) return Promise.resolve('bez PIN-u nic nie zmieniam');
                     return rezRozkaz('zapas:kasuj;pin=' + p, 'skasuj rezerwę')
                            .then(t => { if (/wymaga PIN/.test(t)) pinSerwis = null; return t; }); },
      ustaw: (host, port, user, haslo) => {
        const h = String(host || '').trim().replace(/^mqtts?:\/\//, '').replace(/\/.*$/, '');
        const u = String(user || '').trim(), p = String(haslo || '');
        const nr = parseInt(port, 10);
        /*  ⚠ DLUGOSCI Z FIRMWARE, NIE Z OKA [D-412]: sterownik trzyma adres w 64 znakach, konto
            i haslo w 32 (SIEC_TXT_DLUGI / SIEC_TXT_KROTKI), a caly rozkaz kopiuje do bufora 240
            znakow i TNIE BEZ SLOWA. Urwalby sie wtedy ogon z `;pin=`, a sterownik odpowiedzialby
            „zmiana rezerwy wymaga PIN" - przy PIN-ie, ktory przeciez zostal podany. Wolimy odmowic
            tutaj i nazwac prawdziwy powod. */
        if (!h) return Promise.resolve('podaj adres brokera rezerwowego');
        if (REZ_ZLE_ZNAKI.test(h)) return Promise.resolve('adres bez dwukropka, średnika i spacji - port wpisz w osobnym polu');
        if (h.length > 64) return Promise.resolve('adres dłuższy niż 64 znaki - sterownik tyle nie zapamięta');
        if (!(nr >= 1 && nr <= 65535)) return Promise.resolve('port poza zakresem 1-65535');
        if (!u) return Promise.resolve('podaj użytkownika, którym sterownik ma się logować');
        if (REZ_ZLE_ZNAKI.test(u)) return Promise.resolve('użytkownik bez dwukropka, średnika i spacji - sterownik rozbiera rozkaz po tych znakach');
        if (u.length > 32) return Promise.resolve('użytkownik dłuższy niż 32 znaki - sterownik tyle nie zapamięta');
        if (!p) return Promise.resolve('podaj hasło sterownika do brokera rezerwowego');
        if (REZ_ZLE_ZNAKI.test(p)) return Promise.resolve('hasło bez dwukropka, średnika i spacji - sterownik rozbiera rozkaz po tych znakach');
        if (p.length > 32) return Promise.resolve('hasło dłuższe niż 32 znaki - sterownik tyle nie zapamięta');
        const pin = rezPin(); if (!pin) return Promise.resolve('bez PIN-u nic nie zmieniam');
        return rezRozkaz('zapas:' + h + ':' + nr + ':' + u + ':' + p + ';pin=' + pin, 'ustaw ' + h + ':' + nr)
               .then(t => { if (/wymaga PIN/.test(t)) pinSerwis = null; return t; });
      },
    };
    M.sprawdzPin = pin => new Promise(res => {
      if (!wybrany || !klGot(wybrany)) { res('brak połączenia z brokerem'); return; }
      const zg = zegar[wybrany];
      const tSter = zg ? Math.floor(zg.czas + (Date.now() - zg.kiedy) / 1000) : Math.floor(Date.now() / 1000);
      const id = nowyId();
      const msg = new Paho.Message('t=' + tSter + ';id=' + id + ';pin=' + pin); msg.destinationName = wybrany + '/komenda'; msg.qos = 1;
      const mój = r => {
        if (r.kod === 0) { pinSerwis = pin; res('ok'); }
        else if (r.kod === 3) res('zle');
        else res(r.opis || 'sterownik nie przyjął PIN-u');
      };
      oczekuja.set(id, { res: mój, t0: Date.now(), co: 'PIN', pref: wybrany }); czekaWynik = mój; czekaWynikPref = wybrany;   /* [PWA-7] */
      const kk = klGot(wybrany); if (!kk) { res('brak połączenia z brokerem'); return; }
      kk.send(msg);
      setTimeout(() => { if (oczekuja.has(id)) { oczekuja.delete(id); if (czekaWynik === mój) czekaWynik = null; res('sterownik nie odpowiedział w 5 s'); } }, 5000);
    });
    /*  ⚠ Bez retained `blok` obiekt „nie istnieje" dla apki, dopóki sam nie nada —
        a nadaje dopiero po `zadanie`. Zamknięte koło rozcina parametr ?obiekt=
        (znany prefiks → ogłaszamy od razu) albo lista z tematu `status`
        (retained) — subskrybujemy ją, żeby poznać obiekty, które milczą. */
    /* (subskrypcja `status` siedzi w onSuccess razem z resztą - dawny setTimeout 500 ms strzelał
       PRZED CONNACK i padał po cichu w try/catch, więc bez ?obiekt= lista bywała pusta [2026-09-09]) */
    /*  [D-313] `_zrodlo` = wpis brokera, którym właśnie przyszła wiadomość. Paho nie podaje klienta w obsłudze,
        więc ustawiamy to tuż przed wejściem w nią - synchronicznie, więc jest prawdziwe przez cały jej przebieg. */
    let _zrodlo = POL[0];
    const _onMsg = k.onMessageArrived;
    const _obsluga = m => {
      const cz = m.destinationName.split('/');
      if (cz[cz.length - 1] === 'status') {
        const pref = cz.slice(0, -1).join('/');
        if (!obiekty[pref]) obiekty[pref] = { txt: '', kiedy: 0 };
        /*  ⚠ ZASTANY `status` NIE USTANAWIA DROGI [D-428]. Retained lezy na brokerze i przezywa
            odejscie sterownika - wiec „pierwszy, ktory sie odezwal" bywa brokerem, z ktorego
            sterownik dawno poszedl. Swiezy `status` owszem: to znaczy, ze wlasnie tam jest. */
        if (!obiekty[pref].kl && !m.retained) obiekty[pref].kl = _zrodlo;   /* [D-313] */
        /*  STATUS JEST PER BROKER [D-314, zmierzone przy przełączaniu]: gdy sterownik przestaje korzystać z jednego
            serwera, TEN broker ogłasza „offline" z testamentu - a sterownik w najlepsze nadaje drugim. Jeden wspólny
            `status` dawał wtedy czerwoną kropkę przy żywym obiekcie. Liczymy: online, jeśli CHOĆ JEDEN broker tak mówi. */
        const w0 = obiekty[pref]; const st = (m.payloadString || '').trim() || '?';
        (w0.statusy || (w0.statusy = {}))[_zrodlo.nr] = st;
        przeliczStatus(w0);                                  /* tylko z dróg, które żyją [D-481] */
        /*  ⛔ AUTOMATYCZNY WYBOR WOLI OBIEKT, KTORY ZYJE  [D-419, objaw Tomasza: „brak sterownika"
            przy dzialajacym basenie - apka otwarla sadzawke, ktora wlasnie padla]
            Dotad brany byl PIERWSZY obiekt, ktory ogłosil status, bez patrzenia, CO ten status mowi.
            Przy zapamietanym wyborze to bez znaczenia, ale po wyczyszczeniu danych albo na nowym
            telefonie decyduje kolejnosc pakietow retained - czyli nic sensownego. Czlowiek dostaje
            martwy ekran i wnioskuje, ze nie dziala CALOSC, choc drugi obieg nadaje.
            ⚠ TYLKO DOPOKI CZLOWIEK NIE WYBRAL SAM. Gdy wybral - recznie albo pamiecia telefonu -
              nie ruszamy mu ekranu, nawet jesli ten obiekt padnie: wtedy „offline" jest wlasnie ta
              informacja, po ktora siegnal. */
        if (!wybrany) { zmienWybrany(pref); oglos(tempo); }
        else if (!wybranyRecznie && st === 'online') {
          const teraz = obiekty[wybrany];
          if (teraz && teraz.status === 'offline' && pref !== wybrany) {
            zapisz('obiekt ' + wybrany.split('/').slice(1).join('/') + ' jest offline - pokazuje '
                   + pref.split('/').slice(1).join('/') + ', ktory nadaje');
            zmienWybrany(pref); oglos(tempo);
          }
        }
        oddaj(); return;
      }
      _onMsg(m);
    };
/*  OBSLUGA ODEBRANEJ WIADOMOSCI - JEDNO MIEJSCE, TAKZE PO ODNOWIENIU KLIENTA [D-359, audyt Astry 15.09]
    ------------------------------------------------------------
    ⛔ CO BYLO ZLE: `odnowKlienta` (D-354) budowal nowy obiekt biblioteki i wolal `zrobDriver`, ktora
    podpina `onConnectionLost`, `onConnected` i opcje - ALE NIE `onMessageArrived`. Ten byl przypisywany
    RAZ, przy starcie strony, na obiektach z pierwszej listy. Skutek: po kazdym odnowieniu klient melduje
    „polaczony", wykonuje komplet subskrypcji, a ZADNA wiadomosc nie dociera do aplikacji - ekran zostaje
    na ostatnim stanie i nic tego nie zglasza. Poprawka D-354 psula wiec to, co miala naprawic.
    ⚠ Dlatego podpiecie ma jedna nazwe i jest wolane w OBU drogach: przy starcie i w `odnowKlienta`. */
    const podepnijOdbior = c => { const kl = c.kl;
      c.kl.onMessageArrived = m => { if (kl !== c.kl) return;   /* [D-483] spóźniona paczka wycofanego klienta */
                                     _zrodlo = c; c.ostOdbior = Date.now(); _obsluga(m); }; };
    POL.forEach(podepnijOdbior);

    /*  ZAPASY BIERZEMY ZE STEROWNIKA, NIE ZGADUJEMY  [D-411, Tomasz 2026-09-17: „można w apce dać
        zapasowy, żeby kopiował się to, co ma w sterowniku 1 do 1"]
        ------------------------------------------------------------
        WEJSCIA:  retained temat `<prefiks>/serwery` - sterownik wypisuje, czym nadaje i co trzyma
                  w rezerwie (adresy, bez kont i bez hasel).
        CO Z CZEGO WYNIKA: pusty „Zapas 1" w ustawieniach przestaje znaczyc „nie masz rezerwy" -
                  znaczy „jeszcze nie wiem, zapytam sterownika". Po pierwszym polaczeniu apka zna
                  adresy i zapisuje je na nastepny raz.
        WYJSCIA:  nowe polaczenie na liscie POL + zapis w pamieci telefonu (`odbior_mqtt`).

        ⚠ TO JEST ZAMKNIECIE SPRAWY Z D-373/D-410. Adres wbudowany w kod apki byl zly (burza ponowien
          na cudzym brokerze), pusty bez slowa tez byl zly (cisza na zywym, ale pustym brokerze).
          Zrodlem prawdy jest ten, kto naprawde wie: STEROWNIK. Apka pyta, a nie zgaduje.

        ⚠ PORTU NIE PRZEPISUJEMY. Sterownik lapie sie natywnym MQTT (8883), przegladarka WebSocketem
          po TLS (HiveMQ 8884, EMQX 8084) - ta sama nazwa, inna liczba. Bierzemy stad SAM ADRES,
          a port dobiera `adres()` po dostawcy. Przepisanie 1:1 dalo by pukanie w gluchy port.

        ⚠ DZIALAJACEGO NIE ZRYWAMY. Gdy sterownik poda inny adres, a nasze polaczenie o tym numerze
          wlasnie dziala - zapisujemy na nastepne uruchomienie i mowimy o tym w dzienniku. Podmiana
          w locie dotyczy tylko polaczen, ktore i tak nie stoja. */
    /*  [Astra 12] ZAPIS TAM, SKĄD PRZYSZŁO LOGOWANIE: sesja bez „zapamiętaj" żyje w sessionStorage (ten sam klucz
        z przedrostkiem apki) - poprawka adresu trafia do niej i znika z kartą; zapamiętane - do localStorage. */
    const zapiszUstawienie = (pole, wart) => {
      try { const mag = sessionStorage.getItem(KL('odbior_mqtt')) ? sessionStorage : localStorage;
            const z = JSON.parse(mag.getItem(KL('odbior_mqtt')) || 'null');
            if (!z || z[pole] === wart) return false;
            z[pole] = wart; mag.setItem(KL('odbior_mqtt'), JSON.stringify(z)); return true;
      } catch (e) { return false; }
    };
    const dodajSerwer = (nr, host, powod) => {
      const a = adres(host);
      const user = nr === 2 ? (o.user2 || _kontoZap(2)) : (o.user3 || _kontoZap(3));
      if (!a.host || !user) return;
      const c = { nr, host: a.host, port: a.port, user,
                  pass: (nr === 2 ? (o.pass2 || o.pass) : (o.pass3 || o.pass)),
                  temat: (nr === 2 ? (o.temat2 || o.temat) : (o.temat3 || o.temat)),
                  tematy: (nr === 2 ? (o.temat2 ? [o.temat2] : o.tematy) : (o.temat3 ? [o.temat3] : o.tematy)) };
      c.kl = new Klient(c.host, c.port, '/mqtt', cid + '-' + nr);
      c.stan = { stan: 'laczy', opis: 'lacze z brokerem…' };
      POL.push(c); POL.sort((x, y) => x.nr - y.nr);
      zrobDriver(c); podepnijOdbior(c);
      M.rezerwaBrak = (POL.length < 2);
      zapisz('serwer ' + nr + ': ' + c.host + ':' + c.port + ' jako ' + user + ' (' + powod + ')');
      c.polaczTeraz(powod);
    };
    /*  ⚠ POZYCJA W SPISIE STEROWNIKA TO NIE POZYCJA W APCE [zmierzone 17.09, pierwsze ogloszenie
        spisu z basenu]: sterownik podal `glowny 192.168.1.39` i `zapas1 192.168.1.39` - oba adresy
        domowe, bo on siedzi w tej samej sieci co broker. Apka chodzi z Pages po HTTPS i z drogi
        zadnego z nich nie uzyje. Dlatego nie przepisujemy „slot na slot", tylko bierzemy z calego
        spisu te adresy, KTORYCH DA SIE UZYC (`lan:0`), i ustawiamy je po kolei jako Zapas 1 i 2.
        ⚠ STEROWNIK WYGRYWA Z WPISANYM RECZNIE - i tak ma byc [wytyczna: „zeby kopiowal sie to, co
        ma w sterowniku 1 do 1"]. Recznie wpisany zapas jest ziarnem na czas, zanim sterownik sie
        odezwie; potem obowiazuje to, co on mowi. Kazda taka zmiana idzie do dziennika lacza, zeby
        nie byla cicha. */
    const spisSerwerow = (tekst, pref, zastany) => {
      let s = null; try { s = JSON.parse(tekst); } catch (e) { return; }
      if (!s) return;
      /*  ⛔ SPIS JEST WLASNOSCIA OBIEGU, NIE APKI [D-426a]. Jedno wspolne pole znaczylo, ze ekran
          basenu pokazywal spis sadzawki - ten, ktory przyszedl ostatni. Konto serwisowe oglada
          kilka obiegow naraz, wiec to nie jest przypadek brzegowy, tylko codziennosc. */
      /*  [D-429] spis jest wlasnoscia OBIEGU I DROGI - kazdy broker ma wlasna kopie i wlasny wiek. */
      const nrD = (_zrodlo && _zrodlo.nr) || 0;
      (_spisy[pref] || (_spisy[pref] = {}))[nrD] = { s, kiedy: Date.now(), zastany: !!zastany };
      if (pref === wybrany) M.ostSpisSerwerow = _spisWybrany(pref);
      /*  ⚠ ZASTANY SPIS BYWA SPRZED ZMIANY FIRMWARE [D-426]. Gdy brakuje w nim pola, ktorego
          potrzebujemy do opisania slotow (`pol` = czy sterownik ma tam polaczenie), prosimy
          sterownik o swiezy - raz, zeby nie robic z tego petli. Milczenie o stanie slotu jest
          lepsze niz falsz, ale gorsze niz odpowiedz. */
      if (s.glowny && s.glowny.pol === undefined && !M._spisProszony) {
        M._spisProszony = true;
        try { const kk = klGot(wybrany); if (kk) { const m = new Paho.Message('serwery');
              m.destinationName = wybrany + '/zadanie'; kk.send(m);
              zapisz('spis serwerow bez stanu slotow - proszę sterownik o świeży'); } } catch (e) {}
      }
      /*  KTORYM SLOTEM STEROWNIKA JEST TA DROGA - patrz uzasadnienie przy `niesieNr`. */
      if (_zrodlo && s.ja) { _zrodlo.slot = s.ja;
        if (_zrodlo.slotOst !== s.ja) { _zrodlo.slotOst = s.ja;
          zapisz(etyk(_zrodlo) + 'to jest slot ' + s.ja + ' sterownika'); } }
      /*  [Astra 12] PUNKT KOŃCOWY = transport + host + port efektywny + ścieżka, nie sam host. Stary broker
          (8886/8887) i broker v5 (8888/8889) stoją pod TĄ SAMĄ nazwą - porównanie po hoście sklejało je w jeden
          serwer i drugi nigdy nie wchodził. Sterownik podaje port NATYWNY; apka łączy się WebSocketem po TLS, więc:
          znane pary naszych brokerów tłumaczymy wprost, reszta po dostawcy (adres()), a wpis bez TLS pomijamy
          (apka zna tylko wss - zwykłe TCP i tak by nie wstało). */
      const WS_Z_NATYWNEGO = { 8886: 8887, 8888: 8889 };
      const kluczPK = a => 'wss://' + String(a.host || '').toLowerCase() + ':' + a.port + '/mqtt';
      const nasz = kluczPK(adres(o.host, o.port));
      const kand = [], kandKl = [];
      ['glowny', 'zapas1', 'zapas2'].forEach(k => {
        const w = s[k]; const h = ((w && w.host) || '').trim();
        if (!h || (w && w.lan)) return;                       /* pusto albo adres domowy - nie dla apki */
        if (w && w.tls === 0) return;                         /* bez TLS - nie dla przeglądarki */
        const a = adres(h);
        if (w && WS_Z_NATYWNEGO[w.port]) a.port = WS_Z_NATYWNEGO[w.port];
        const kl = kluczPK(a);
        if (kl !== nasz && kandKl.indexOf(kl) < 0) { kandKl.push(kl); kand.push(a.host + ':' + a.port); }   /* glownego nie dublujemy */
      });
      [2, 3].forEach((nr, i) => {
        const host = kand[i];
        if (!host) return;                    /* sterownik nie ma tylu uzytecznych adresow */
        const nowy = adres(host);
        const c = POL.find(x => x.nr === nr);
        if (c && kluczPK(c) === kluczPK(nowy)) return;         /* juz to mamy - cisza */
        zapiszUstawienie(nr === 2 ? 'host2' : 'host3', host);
        if (!c) { dodajSerwer(nr, host, 'spis ze sterownika'); return; }
        if (c.stan.stan === 'ok') {
          zapisz('serwer ' + nr + ': sterownik podaje ' + nowy.host + ', a obecny (' + c.host
                 + ') dziala - zmieniam po ponownym uruchomieniu apki');
          return;
        }
        zapisz('serwer ' + nr + ': sterownik podaje ' + nowy.host + ' zamiast ' + c.host + ' - podmieniam');
        if (c.ponowZegar) { clearTimeout(c.ponowZegar); c.ponowZegar = null; }
        try { if (c.kl.isConnected()) c.kl.disconnect(); } catch (e) {}
        try { if (c.gniazdo) c.gniazdo.close(); } catch (e) {}
        Object.keys(obiekty).forEach(p => { if (obiekty[p].kl === c) obiekty[p].kl = null; });
        POL.splice(POL.indexOf(c), 1);
        dodajSerwer(nr, host, 'zmiana w sterowniku');
      });
    };

    /*  STRAZNIK CISZY - MARTWE GNIAZDO UDAJE POLACZENIE [D-355, 2026-09-13]
        ------------------------------------------------------------
        WEJSCIA:  czas ostatniej paczki z kazdego brokera (`c.ostOdbior`), stan biblioteki.
        CO Z CZEGO WYNIKA: gdy biblioteka TWIERDZI, ze jest polaczona, a od brokera nie przyszlo nic
                  przez STRAZNIK_CISZY_MS - uznajemy lacze za martwe i budujemy klienta OD ZERA.
        WYJSCIA:  wpis w dzienniku + nowe polaczenie.

        ⛔ PO CO, skoro mamy juz ponawianie [Tomasz 13.09: „apka laczy sie ok, ale podczas pracy jak
        straci internet, juz sie ponownie nie polaczy - trzeba PWA restartowac i laczy sie od razu";
        na ekranie stalo „sterownik online, ale ostatni pakiet 312 s temu"]:
        `polaczTeraz` zaczyna sie od `if (!c.kl || c.kl.isConnected()) return;`. Gdy telefon traci
        internet, gniazdo TCP NIE ZAMYKA SIE od razu - biblioteka dalej uwaza, ze jest polaczona,
        `onConnectionLost` nie przychodzi, wiec CALE ponawianie jest wylaczone. Apka wie, ze od pieciu
        minut nic nie dostala (pokazuje to na ekranie!), i nie robi z ta wiedza nic.
        ⚠ PROG MUSI BYC WIEKSZY NIZ KEEPALIVE (30 s), zeby nie zrywac lacza, ktore po prostu milczy,
        bo nikt nie prosi o ciezkie tematy. Liczymy KAZDA paczke, takze lekka - przy zywym brokerze
        cisza dluzsza niz minuta nie zdarza sie nawet wtedy, gdy sterownik nie nadaje: idzie keepalive
        i odpowiedzi na subskrypcje.
        ⚠ Strażnik chodzi tylko wtedy, gdy KARTA JEST WIDOCZNA - w tle przegladarka i tak dlawi
        liczniki, a telefon w kieszeni nie musi trzymac lacza. */
    const STRAZNIK_CISZY_MS = 75000;
    setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      const teraz = Date.now();
      POL.forEach(c => {
        if (!c.kl || !c.kl.isConnected()) return;
        /*  ⛔ CISZA NIE ZAWSZE ZNACZY AWARIE [D-359 -> D-363, dwa audyty Astry].
            `ostOdbior` rosnie WYLACZNIE od wiadomosci z tematow; PINGRESP i SUBACK go nie ruszaja -
            sprawdzone na samej bibliotece. Sa wiec trzy powody ciszy, przy ktorych lacze jest ZDROWE:
              1. sterownik jest WYLACZONY albo offline - wtedy nikt nic nie nadaje zadna droga;
              2. sterownik kieruje ciezkie tematy JEDNA droga [D-315] - druga milczy z zalozenia;
              3. dopiero co sie polaczylismy - nie zdazylo przyjsc nic.
            ⛔ PIERWSZA WERSJA PYTALA O `c.lekki` i to bylo zle [audyt Astry 15.09]: `lekki` staje sie
            falszem po KAZDYM polaczeniu (onSuccess), a prawda dopiero po pieciu duplikatach - wiec
            cicha rezerwa, ktora duplikatow nigdy nie zbierze, byla uznawana za „niosaca" i zrywana.
            Pytamy teraz o to, CO SAMI ZAMOWILISMY: `niesieOst` to ostatnie zadanie wyslane do
            sterownika - 0 znaczy „nadawaj równolegle" (wiec obie drogi maja co przynosic), a numer znaczy
            „nadawaj tym jednym". Do tego sprawdzamy, czy sterownik w ogole jest online. */
        const ob = wybrany && obiekty[wybrany];
        const sterownik_zywy = !!ob && ob.status !== 'offline';
        const ma_przynosic = (klDla(wybrany) === c) || (niesieOst === 0);
        if (!sterownik_zywy || !ma_przynosic) { c.ostOdbior = teraz; return; }
        if (!c.ostOdbior) { c.ostOdbior = teraz; return; }
        if (teraz - c.ostOdbior < STRAZNIK_CISZY_MS) return;
        zapisz(etyk(c) + 'cisza ' + Math.round((teraz - c.ostOdbior) / 1000) + ' s, choć połączenie zgłasza gotowość - dane nieaktualne, buduję klienta od nowa');
        if (odnowKlienta(c)) { c.stan = { stan: 'laczy', opis: 'łączę ponownie…' }; c.polaczTeraz('martwe łącze'); oddaj(); }
      });
    }, 15000);

    /*  POWROT SIECI - PROBUJEMY OD RAZU [D-355]
        Przegladarka mowi wprost, kiedy sieć wraca. Bez tego apka czekala na swoj odstep, a po serii
        nieudanych prob potrafil on urosnac - czlowiek patrzy na „laczę ponownie…", chociaz internet
        jest juz od kilkunastu sekund. */
    window.addEventListener('online', () => {
      zapisz('sieć wróciła - próbuję od razu');
      POL.filter(c => !c.kl.isConnected()).forEach(c => {
        c.odstepNr = 0; c.stan = { stan: 'laczy', opis: 'łączę ponownie…' }; c.polaczTeraz('powrót sieci'); });
      oddaj();
    });
    window.addEventListener('offline', () => zapisz('telefon zgłasza brak sieci'));
  };

  window.MOST_JS = M;
})();
