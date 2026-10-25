// Atrapa API Apps Script na potrzeby lokalnego dev. Kształty odpowiedzi jak w funkcjach GS.
// PIN 1111 = pracownik, 9999 = admin. Token: 'mock-<id>' (dowolny niepusty też przechodzi jako pracownik).
const MIESIACE = ['', 'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const TYPY_NIEOB = ['Urlop wypoczynkowy', 'Urlop na żądanie', 'Chorobowe (L4)', 'Chorobowe na dziecko (L4)', 'Opieka nad dzieckiem', 'Urlop okolicznościowy', 'Delegacja', 'Praca zdalna', 'Odebranie dnia wolnego', 'Inne'];
const TYPY_WYJ = ['Wyjście prywatne', 'Odpracowanie'];

const USERS = {
  '1111': { id: 'P001', imie: 'Anna', nazwisko: 'Kowalska', stanowisko: 'Technik weterynarii', rola: 'pracownik' },
  '2222': { id: 'P002', imie: 'Jan', nazwisko: 'Nowak', stanowisko: 'Lekarz weterynarii', rola: 'pracownik' },
  '9999': { id: 'A001', imie: 'Marcin', nazwisko: 'Admin', stanowisko: 'Kierownik', rola: 'admin' },
};
const byId = id => Object.values(USERS).find(u => u.id === id);

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => new Date();

const state = { godziny: [], nieob: [], wyj: [], seen: new Map(), nextRow: 100, nextId: 1 };
const attempts = new Map();

const ok = data => ({ ok: true, data });
const err = (code, error) => ({ ok: false, code, error });
const num = (v, d = 0) => parseFloat(v) || d;
const hm = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
const hours = (od, doo) => { let m = hm(doo) - hm(od); if (m < 0) m += 1440; return m / 60; };
const inMonth = (s, rok, mies) => { const d = new Date(s); return d.getFullYear() === +rok && d.getMonth() === +mies - 1; };
const NAD = 8;

function dniRobocze(od, doo) {
  let n = 0;
  const d = new Date(od), e = new Date(doo);
  while (d <= e) { const w = d.getDay(); if (w !== 0 && w !== 6) n++; d.setDate(d.getDate() + 1); }
  return n || 1;
}

const PDF_B64 = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
  'trailer<</Root 1 0 R/Size 4>>\n%%EOF\n').toString('base64');

function seed() {
  const t = today();
  const y = t.getFullYear(), m = t.getMonth();
  const mk = (day, od, doo, projekt = '', uwagi = '') => {
    const d = new Date(y, m, day);
    const h = hours(od, doo);
    return { wiersz: state.nextRow++, pid: 'P001', data: iso(d), od, do: doo, przepracowane: +h.toFixed(2), nadgodziny: +Math.max(0, h - NAD).toFixed(2), projekt, uwagi };
  };
  if (t.getDate() > 2) state.godziny.push(mk(1, '08:00', '16:00'), mk(2, '08:00', '17:30', 'Inwentaryzacja'));
  state.nieob.push({ wiersz: state.nextRow++, id: 'W-' + state.nextId++, pid: 'P001', pracownik: 'Anna Kowalska', typ: 'Urlop wypoczynkowy', dataOd: iso(new Date(y, m, 20)), dataDo: iso(new Date(y, m, 22)), dni: 3, uwagi: '', status: 'Oczekuje', zlozono: '01.01.' + y + ' 09:00' });
  state.wyj.push({ wiersz: state.nextRow++, pid: 'P001', pracownik: 'Anna Kowalska', rodzaj: 'Wyjście prywatne', data: iso(new Date(y, m, 1)), od: '10:00', do: '12:00', godziny: 2, uwagi: '', status: 'Zatwierdzone' });
  state.nieob.push({ wiersz: state.nextRow++, id: 'W-' + state.nextId++, pid: 'P002', pracownik: 'Jan Nowak', typ: 'Urlop wypoczynkowy', dataOd: iso(new Date(y, m, 5)), dataDo: iso(new Date(y, m, 13)), dni: 7, uwagi: 'Wyjazd rodzinny', status: 'Oczekuje', zlozono: '02.01.' + y + ' 10:30' });
  state.wyj.push({ wiersz: state.nextRow++, pid: 'P002', pracownik: 'Jan Nowak', rodzaj: 'Wyjście prywatne', data: iso(new Date(y, m, 2)), od: '14:00', do: '15:30', godziny: 1.5, uwagi: 'Wizyta u lekarza', status: 'Oczekuje' });
  state.godziny.push({ wiersz: state.nextRow++, pid: 'P002', data: iso(new Date(y, m, 1)), od: '08:00', do: '16:00', przepracowane: 8, nadgodziny: 0, projekt: '', uwagi: '' });
}
seed();

function login(args, deviceId) {
  const key = String(deviceId || 'x');
  const n = attempts.get(key) || 0;
  if (n >= 5) return err('LOCKED', 'Zbyt wiele nieudanych prób. Spróbuj ponownie za 30 minut.');
  const u = USERS[String(args && args.pin)];
  if (!u) { attempts.set(key, n + 1); return err('REJECTED', 'Nieprawidłowy PIN.'); }
  attempts.set(key, 0);
  return ok({ token: 'mock-' + u.id, user: u });
}

// check(a) -> komunikat błędu merytorycznego albo null (jak {ok:false,error} z GS)
function zapisz(req, user, run, check = defaultCheck) {
  const cid = req.clientId;
  if (typeof cid !== 'string' || !cid.trim()) return err('BAD_REQUEST', 'Brak identyfikatora zapisu.');
  const k = user.id + '|' + cid;
  if (state.seen.has(k)) return state.seen.get(k);
  const a = req.args || {};
  const msg = a.uwagi === 'ODRZUC' ? 'Godzina zakończenia musi być późniejsza niż rozpoczęcia.' : check(a, user);
  const res = msg ? err('REJECTED', msg) : ok(run(a));
  state.seen.set(k, res);
  return res;
}

function defaultCheck(a) {
  return a.godzOd && a.godzDo && a.godzOd >= a.godzDo ? 'Godzina zakończenia musi być późniejsza niż rozpoczęcia.' : null;
}
// Godziny jak GS: do < od = praca przez północ (+24 h); do == od odrzucone; jeden wpis na dzień (sprawdzDuplikat)
function godzinyCheck(a, u) {
  if (state.godziny.some(g => g.pid === u.id && g.data === a.data)) return 'Masz już wpis na ten dzień. Skontaktuj się z administratorem w celu korekty.';
  if (!(hours(a.godzOd, a.godzDo) > 0)) return 'Godzina zakończenia musi być późniejsza niż rozpoczęcia.';
  return null;
}

const ACTIONS = {
  init: { role: 'user', run: (u) => ({ user: u, typyNieobecnosci: TYPY_NIEOB, typyWyjsc: TYPY_WYJ }) },
  zapiszGodziny: { role: 'user', queued: true, run: (u, a, req) => zapisz(req, u, a => {
    const h = hours(a.godzOd, a.godzDo);
    state.godziny.push({ wiersz: state.nextRow++, pid: u.id, data: a.data, od: a.godzOd, do: a.godzDo, przepracowane: +h.toFixed(2), nadgodziny: +Math.max(0, h - NAD).toFixed(2), projekt: a.projekt || '', uwagi: a.uwagi || '' });
    return { przepracowane: h.toFixed(2), nadgodziny: Math.max(0, h - NAD).toFixed(2) };
  }, godzinyCheck) },
  zapiszUrlop: { role: 'user', queued: true, run: (u, a, req) => zapisz(req, u, a => {
    const dni = dniRobocze(a.dataOd, a.dataDo);
    const wiersz = state.nextRow++;
    state.nieob.push({ wiersz, id: 'W-' + state.nextId++, pid: u.id, pracownik: `${u.imie} ${u.nazwisko}`, typ: a.typ, dataOd: a.dataOd, dataDo: a.dataDo, dni, uwagi: a.uwagi || '', status: 'Oczekuje', zlozono: new Date().toLocaleString('pl-PL') });
    return { dni, wiersz };
  }) },
  zapiszWyjscie: { role: 'user', queued: true, run: (u, a, req) => zapisz(req, u, a => {
    const h = hours(a.godzOd, a.godzDo);
    const wiersz = state.nextRow++;
    const rodzaj = a.rodzaj === 'Odpracowanie' ? 'Odpracowanie' : 'Wyjście prywatne';
    state.wyj.push({ wiersz, pid: u.id, pracownik: `${u.imie} ${u.nazwisko}`, rodzaj, data: a.data, od: a.godzOd, do: a.godzDo, godziny: +h.toFixed(2), uwagi: a.uwagi || '', status: 'Oczekuje' });
    return { rodzaj, godziny: h.toFixed(2), wiersz };
  }) },
  getMojeWpisy: { role: 'user', run: (u, a) => {
    const t = today();
    const rok = parseInt(a.rok) || t.getFullYear(), miesiac = parseInt(a.miesiac) || t.getMonth() + 1;
    const godziny = state.godziny.filter(g => g.pid === u.id && inMonth(g.data, rok, miesiac)).sort((x, y) => x.data.localeCompare(y.data))
      .map(g => ({ wiersz: g.wiersz, data: g.data, od: g.od, do: g.do, przepracowane: g.przepracowane, nadgodziny: g.nadgodziny, projekt: g.projekt, uwagi: g.uwagi }));
    const nieobecnosci = state.nieob.filter(n => n.pid === u.id && (inMonth(n.dataOd, rok, miesiac) || inMonth(n.dataDo, rok, miesiac))).sort((x, y) => x.dataOd.localeCompare(y.dataOd))
      .map(n => ({ wiersz: n.wiersz, typ: n.typ, dataOd: n.dataOd, dataDo: n.dataDo, dni: n.dni, uwagi: n.uwagi, status: n.status }));
    const wyjscia = state.wyj.filter(w => w.pid === u.id && inMonth(w.data, rok, miesiac)).sort((x, y) => x.data.localeCompare(y.data))
      .map(w => ({ wiersz: w.wiersz, rodzaj: w.rodzaj, data: w.data, od: w.od, do: w.do, godziny: w.godziny, uwagi: w.uwagi, status: w.status }));
    const sum = k => +godziny.reduce((s, g) => s + g[k], 0).toFixed(2);
    return { rok, miesiac, miesiacNazwa: MIESIACE[miesiac] + ' ' + rok, godziny, nieobecnosci, wyjscia, sumaPrzepracowane: sum('przepracowane'), sumaNadgodziny: sum('nadgodziny') };
  } },
  getSaldoWyjsc: { role: 'user', run: (u) => {
    const rok = today().getFullYear();
    const rows = state.wyj.filter(w => w.pid === u.id && new Date(w.data).getFullYear() === rok);
    let wyj = 0, odp = 0, ow = 0, oo = 0;
    rows.forEach(r => {
      if (r.status === 'Zatwierdzone') { if (r.rodzaj === 'Odpracowanie') odp += r.godziny; else wyj += r.godziny; }
      else if (r.status === 'Oczekuje') { if (r.rodzaj === 'Odpracowanie') oo += r.godziny; else ow += r.godziny; }
    });
    const lista = rows.map(r => ({ rodzaj: r.rodzaj, data: r.data, od: r.od, do: r.do, godziny: r.godziny, uwagi: r.uwagi, status: r.status })).reverse().slice(0, 6);
    return { doOdrobienia: +(wyj - odp).toFixed(2), wyjsciaH: +wyj.toFixed(2), odpracowaneH: +odp.toFixed(2), oczekujeWyj: +ow.toFixed(2), oczekujeOdpr: +oo.toFixed(2), lista };
  } },
  getUrlopySummary: { role: 'user', run: (u) => {
    const rok = today().getFullYear();
    const map = {};
    let wyk = 0;
    state.nieob.filter(n => n.pid === u.id && new Date(n.dataOd).getFullYear() === rok).forEach(n => {
      const k = n.typ + '|' + n.status;
      (map[k] = map[k] || { typ: n.typ, dni: 0, status: n.status }).dni += n.dni;
      if ((n.typ === 'Urlop wypoczynkowy' || n.typ === 'Urlop na żądanie') && n.status === 'Zatwierdzone') wyk += n.dni;
    });
    const limitBiezacy = 26, limitZalegly = 3;
    const zz = Math.min(wyk, limitZalegly), zb = Math.max(0, wyk - limitZalegly);
    return { lista: Object.values(map).sort((a, b) => a.typ.localeCompare(b.typ)), limitBiezacy, limitZalegly, wykorzystaneUrlop: wyk, pozostalyZalegly: limitZalegly - zz, pozostalyBiezacy: limitBiezacy - zb };
  } },
  getBrakujaceDni: { role: 'user', run: (u) => {
    const t = today(), out = [];
    const have = new Set(state.godziny.filter(g => g.pid === u.id).map(g => g.data));
    const dn = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
    for (let d = new Date(t.getFullYear(), t.getMonth(), 1); d < new Date(t.getFullYear(), t.getMonth(), t.getDate()); d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0 || d.getDay() === 6 || have.has(iso(d))) continue;
      out.push({ iso: iso(d), label: `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} (${dn[d.getDay()]})` });
    }
    return out;
  } },
  korygujGodziny: { role: 'user', run: (u, a) => {
    const g = state.godziny.find(x => x.wiersz === a.wiersz && x.pid === u.id);
    if (!g) return { ok: false, error: 'Brak dostępu do tego wpisu.' };
    const h = hours(a.godzOd, a.godzDo);
    if (!(h > 0)) return { ok: false, error: 'Godzina zakończenia musi być późniejsza niż rozpoczęcia.' };
    Object.assign(g, { od: a.godzOd, do: a.godzDo, przepracowane: +h.toFixed(2), nadgodziny: +Math.max(0, h - NAD).toFixed(2), uwagi: a.uwagi || '' });
    return { ok: true, przepracowane: h.toFixed(2), nadgodziny: Math.max(0, h - NAD).toFixed(2) };
  } },
  usunGodziny: { role: 'user', run: (u, a) => del(state.godziny, a.wiersz, u.id) },
  usunNieobecnosc: { role: 'user', run: (u, a) => del(state.nieob, a.wiersz, u.id, 'Nie można usunąć — wniosek został już rozpatrzony. Zgłoś to przełożonemu.') },
  usunWyjscie: { role: 'user', run: (u, a) => del(state.wyj, a.wiersz, u.id, 'Nie można usunąć — zgłoszenie zostało już rozpatrzone. Zgłoś to przełożonemu.') },
  mojaKarta: { role: 'user', run: () => ({ ok: true, base64: PDF_B64, nazwa: 'Karta_ewidencji.pdf' }) },

  getWnioskiOczekujace: { role: 'admin', run: () => state.nieob.filter(n => n.status === 'Oczekuje').map(n => ({
    id: n.id, pracownikId: n.pid, pracownik: n.pracownik, typ: n.typ, od: n.dataOd.split('-').reverse().join('.'), do: n.dataDo.split('-').reverse().join('.'),
    dni: n.dni, uwagi: n.uwagi, zlozono: n.zlozono, limitInfo: 'Pozostało 20 dni (po zatwierdzeniu: ' + (20 - n.dni) + ')', konflikt: '' })) },
  ustawStatusUrlopu: { role: 'admin', run: (a, args) => {
    const n = state.nieob.find(x => x.id === args.idWniosku);
    if (!n) return { ok: false, error: 'Nie znaleziono wniosku' };
    if (!['Zatwierdzone', 'Odrzucone', 'Oczekuje'].includes(args.status)) return { ok: false, error: 'Nieprawidłowy status.' };
    n.status = args.status;
    const warn = args.status === 'Zatwierdzone' && n.dni > 5 ? `Uwaga: pracownik przekroczył limit urlopu o ${n.dni - 5} dni.` : '';
    return { ok: true, status: args.status, mailWyslany: true, ostrzezenie: warn };
  } },
  pdfWniosku: { role: 'admin', run: () => ({ ok: true, base64: PDF_B64, nazwa: 'Wniosek.pdf' }) },
  getWyjsciaAdmin: { role: 'admin', run: (a, args) => {
    const rok = parseInt(args.rok), mies = parseInt(args.miesiac);
    const lista = state.wyj.filter(w => inMonth(w.data, rok, mies)).map(w => ({ wiersz: w.wiersz, pracownikId: w.pid, pracownik: w.pracownik, rodzaj: w.rodzaj, data: w.data, od: w.od, do: w.do, godziny: w.godziny, uwagi: w.uwagi, status: w.status }))
      .sort((x, y) => (x.status === 'Oczekuje' ? 0 : 1) - (y.status === 'Oczekuje' ? 0 : 1) || y.data.localeCompare(x.data));
    const m = {};
    state.wyj.filter(w => w.status === 'Zatwierdzone' && new Date(w.data).getFullYear() === rok).forEach(w => {
      const s = m[w.pid] = m[w.pid] || { pracownikId: w.pid, pracownik: w.pracownik, wyjsciaH: 0, odpracowaneH: 0, zdarzenia: [] };
      if (w.rodzaj === 'Odpracowanie') s.odpracowaneH += w.godziny; else s.wyjsciaH += w.godziny;
      s.zdarzenia.push({ data: w.data, od: w.od, do: w.do, godziny: w.godziny, rodzaj: w.rodzaj });
    });
    const salda = Object.values(m).map(s => ({ ...s, doOdrobienia: +(s.wyjsciaH - s.odpracowaneH).toFixed(2) })).sort((a, b) => b.doOdrobienia - a.doOdrobienia);
    return { lista, salda };
  } },
  zmienStatusWyjscia: { role: 'admin', run: (a, args) => {
    const w = state.wyj.find(x => x.wiersz === args.wiersz);
    if (!w) return { ok: false, error: 'Nieprawidłowy wiersz.' };
    w.status = args.status;
    return { ok: true };
  } },
  adminUsunWyjscie: { role: 'admin', run: (a, args) => del(state.wyj, args.wiersz, null) },
  getNieobecnosciAdmin: { role: 'admin', run: (a, args) => ({ lista: state.nieob.filter(n => inMonth(n.dataOd, args.rok, args.miesiac) || inMonth(n.dataDo, args.rok, args.miesiac))
    .map(n => ({ wiersz: n.wiersz, pracownikId: n.pid, pracownik: n.pracownik, typ: n.typ, dataOd: n.dataOd, dataDo: n.dataDo, dni: n.dni, uwagi: n.uwagi, status: n.status }))
    .sort((x, y) => (x.status === 'Oczekuje' ? 0 : 1) - (y.status === 'Oczekuje' ? 0 : 1) || y.dataOd.localeCompare(x.dataOd)) }) },
  adminUsunNieobecnosc: { role: 'admin', run: (a, args) => del(state.nieob, args.wiersz, null) },
  getPracownicy: { role: 'admin', run: () => Object.values(USERS).map(u => ({ id: u.id, imie: u.imie, nazwisko: u.nazwisko })) },
  getHistoriaPracownika: { role: 'admin', run: (a, args) => {
    const fd = s => s.split('-').reverse().join('.');
    const godziny = state.godziny.filter(g => g.pid === args.pracownikId && inMonth(g.data, args.rok, args.miesiac))
      .map(g => ({ typ: 'praca', data: fd(g.data), od: g.od, do: g.do, godz: g.przepracowane, nadg: g.nadgodziny, uwagi: g.uwagi, dzienWolny: false, sobota: false }));
    const urlopy = state.nieob.filter(n => n.pid === args.pracownikId && (inMonth(n.dataOd, args.rok, args.miesiac) || inMonth(n.dataDo, args.rok, args.miesiac)))
      .map(n => ({ typ: 'urlop', typUrlopu: n.typ, dataOd: fd(n.dataOd), dataDo: fd(n.dataDo), dni: n.dni, uwagi: n.uwagi, status: n.status, wiersz: n.wiersz, id: n.id, decyzjaKto: '', decyzjaKiedy: '' }));
    return { godziny, urlopy };
  } },
  getRaportMiesieczny: { role: 'admin', run: (a, args) => {
    const m = {};
    state.godziny.filter(g => inMonth(g.data, args.rok, args.miesiac)).forEach(g => {
      const u = byId(g.pid);
      const r = m[g.pid] = m[g.pid] || { id: g.pid, name: `${u.imie} ${u.nazwisko}`, przepracowane: 0, nadgodziny: 0, dniPracy: 0, urlopyDni: 0, niepelneDni: 0, brakGodzin: 0 };
      r.przepracowane += g.przepracowane; r.nadgodziny += g.nadgodziny; r.dniPracy++;
      if (g.przepracowane > 0 && g.przepracowane < NAD) { r.niepelneDni++; r.brakGodzin += NAD - g.przepracowane; }
    });
    state.nieob.filter(n => n.status === 'Zatwierdzone' && (inMonth(n.dataOd, args.rok, args.miesiac) || inMonth(n.dataDo, args.rok, args.miesiac))).forEach(n => {
      const r = m[n.pid] = m[n.pid] || { id: n.pid, name: n.pracownik, przepracowane: 0, nadgodziny: 0, dniPracy: 0, urlopyDni: 0, niepelneDni: 0, brakGodzin: 0 };
      r.urlopyDni += n.dni;
    });
    return Object.values(m).sort((a, b) => a.name.localeCompare(b.name));
  } },
  pdfRaportMiesieczny: { role: 'admin', run: () => ({ ok: true, base64: PDF_B64, nazwa: 'Raport.pdf' }) },
  pdfKartyEwidencji: { role: 'admin', run: () => ({ ok: true, base64: PDF_B64, nazwa: 'Karty_ewidencji.pdf' }) },
  pdfNadgodziny: { role: 'admin', run: () => ({ ok: true, base64: PDF_B64, nazwa: 'Nadgodziny_do_weryfikacji.pdf' }) },
  pdfWnioskiMiesiaca: { role: 'admin', run: () => ({ ok: true, base64: PDF_B64, nazwa: 'Wnioski_miesiaca.pdf' }) },
  pdfKsiegowosc: { role: 'admin', run: () => ({ ok: true, base64: PDF_B64, nazwa: 'Ksiegowosc.pdf' }) },
  pdfZestawienie: { role: 'admin', run: () => ({ ok: true, base64: PDF_B64, nazwa: 'Zestawienie.pdf' }) },
  pdfKartaPracownika: { role: 'admin', run: (a, args) => byId(args.pracownikId) ? { ok: true, base64: PDF_B64, nazwa: 'Karta_' + args.pracownikId + '.pdf' } : { ok: false, error: 'Nie znaleziono pracownika' } },
};

function del(arr, wiersz, pid, lockedMsg) {
  const i = arr.findIndex(x => x.wiersz === wiersz && (pid === null || x.pid === pid));
  if (i < 0) return { ok: false, error: 'Brak dostępu do tego wpisu.' };
  if (lockedMsg && arr[i].status && arr[i].status !== 'Oczekuje') return { ok: false, error: lockedMsg };
  arr.splice(i, 1);
  return { ok: true };
}

export function handle(req) {
  if (!req || typeof req !== 'object' || typeof req.action !== 'string') return err('BAD_REQUEST', 'Nieprawidłowe żądanie.');
  if (req.action === 'login') return login(req.args, req.deviceId);
  const def = Object.prototype.hasOwnProperty.call(ACTIONS, req.action) ? ACTIONS[req.action] : null;
  if (!def) return err('BAD_REQUEST', 'Nieprawidłowe żądanie.');
  const tok = typeof req.token === 'string' ? req.token : '';
  if (!tok || tok === 'expired') return err('AUTH', 'Zaloguj się ponownie.');
  const user = byId(tok.replace(/^mock-/, '')) || USERS['1111'];
  if (def.role === 'admin' && user.rola !== 'admin') return err('FORBIDDEN', 'Brak uprawnień.');
  const args = { ...(req.args || {}) };
  if (def.role === 'user') delete args.pracownikId;
  const res = def.queued ? def.run(user, args, req) : def.run(def.role === 'admin' ? user : user, args, req);
  if (def.queued) return res;
  if (res && res.ok === false) return err('REJECTED', res.error || 'Operacja odrzucona.');
  return ok(res);
}
