import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApi } from './helpers/gas.mjs';

const T = Date.UTC(2026, 9, 25, 12, 0, 0);
const DAY = 864e5;
const HEADER = ['ID', 'Imię', 'Nazwisko', 'Email', 'Stanowisko', 'PIN', 'Limit bieżący', 'Limit zaległy', 'Rola'];
const LOG_HEADER = ['clientId', 'czas', 'pracownikId', 'akcja', 'wynik'];

function setup({ gsFns = {}, sheets = {}, props } = {}) {
  return loadApi({
    now: T,
    props,
    sheets: {
      Pracownicy: [
        HEADER,
        [1, 'Jan', 'Kowalski', 'j@x.pl', 'Montażysta', '1111', 26, 4, ''],
        [2, 'Ewa', 'Admin', 'e@x.pl', 'Kierownik', '2222', 20, 0, '  Admin '],
      ],
      API_Log: [LOG_HEADER],
      ...sheets,
    },
    gsFns: { sprawdzDuplikat: () => false, ...gsFns },
  });
}
const plain = (v) => JSON.parse(JSON.stringify(v)); // wynik z realmu vm -> zwykłe obiekty
const tok = (api, id) => api.call('apiMakeToken_', id, T);
const req = (api, id, action, args, extra = {}) => ({ action, token: tok(api, id), args, ...extra });

test('same clientId twice → one call, identical responses, one log row', () => {
  const api = setup({ gsFns: { zapiszGodziny: () => ({ ok: true, wiersz: 5 }) } });
  const r = req(api, 1, 'zapiszGodziny', { data: '2026-10-25', godzOd: '08:00', godzDo: '16:00', pracownikId: 99 }, { clientId: 'c-1' });
  const a = api.handle(r);
  const b = api.handle(r);
  assert.equal(a.ok, true);
  assert.deepEqual(b, a);
  assert.equal(api.calls.zapiszGodziny.length, 1);
  assert.equal(api.calls.zapiszGodziny[0][0].pracownikId, 1);
  assert.equal(api.sheets.API_Log._rows.length, 2);
  assert.equal(api.sheets.API_Log._rows[1][0], 'c-1');
  assert.equal(api.sheets.API_Log._rows[1][2], 1);
  assert.equal(api.sheets.API_Log._rows[1][3], 'zapiszGodziny');
  assert.equal(api.lock.held, false);
});

test('different clientId → two calls', () => {
  const api = setup({ gsFns: { zapiszUrlop: () => ({ ok: true }) } });
  api.handle(req(api, 1, 'zapiszUrlop', {}, { clientId: 'a' }));
  api.handle(req(api, 1, 'zapiszUrlop', {}, { clientId: 'b' }));
  assert.equal(api.calls.zapiszUrlop.length, 2);
  assert.equal(api.sheets.API_Log._rows.length, 3);
});

test('queued without clientId → BAD_REQUEST', () => {
  const api = setup({ gsFns: { zapiszWyjscie: () => ({ ok: true }) } });
  for (const cid of [undefined, '', 5]) {
    const res = api.handle(req(api, 1, 'zapiszWyjscie', {}, cid === undefined ? {} : { clientId: cid }));
    assert.equal(res.code, 'BAD_REQUEST');
  }
  assert.equal(api.calls.zapiszWyjscie, undefined);
});

test('REJECTED is remembered', () => {
  const api = setup({ gsFns: { zapiszWyjscie: () => ({ ok: false, error: 'Od musi być przed Do' }) } });
  const r = req(api, 1, 'zapiszWyjscie', {}, { clientId: 'x' });
  const a = api.handle(r);
  const b = api.handle(r);
  assert.equal(a.code, 'REJECTED');
  assert.deepEqual(b, a);
  assert.equal(api.calls.zapiszWyjscie.length, 1);
});

test('lock timeout → SERVER and nothing written', () => {
  const api = setup({ gsFns: { zapiszGodziny: () => ({ ok: true }) } });
  api.lock.failWait = true;
  const res = api.handle(req(api, 1, 'zapiszGodziny', {}, { clientId: 'z' }));
  assert.equal(res.code, 'SERVER');
  assert.equal(api.calls.zapiszGodziny, undefined);
  assert.equal(api.lock.held, false);
});

test('GS throwing releases lock and is not logged', () => {
  const api = setup({ gsFns: { zapiszGodziny: () => { throw new Error('boom'); } } });
  const res = api.handle(req(api, 1, 'zapiszGodziny', {}, { clientId: 'z' }));
  assert.equal(res.code, 'SERVER');
  assert.equal(api.lock.held, false);
  assert.equal(api.sheets.API_Log._rows.length, 1);
});

test('ustawStatusUrlopu writes admin name to column K of matching row', () => {
  const urlopy = [
    ['h'],
    [1, 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'W-1', ''],
    [1, 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'W-2', ''],
  ];
  const api = setup({ sheets: { Urlopy: urlopy }, gsFns: { ustawStatusUrlopu: () => ({ ok: true }) } });
  const res = api.handle(req(api, 2, 'ustawStatusUrlopu', { idWniosku: 'W-2', status: 'Zatwierdzone' }));
  assert.equal(res.ok, true);
  assert.deepEqual(plain(api.calls.ustawStatusUrlopu[0]), ['W-2', 'Zatwierdzone']);
  assert.equal(urlopy[2][10], 'Ewa Admin');
  assert.equal(urlopy[1][10], '');
});

test('ustawStatusUrlopu rejected → no name written', () => {
  const urlopy = [['h'], [1, 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'W-2', '']];
  const api = setup({ sheets: { Urlopy: urlopy }, gsFns: { ustawStatusUrlopu: () => ({ ok: false, error: 'nie' }) } });
  const res = api.handle(req(api, 2, 'ustawStatusUrlopu', { idWniosku: 'W-2', status: 'x' }));
  assert.equal(res.code, 'REJECTED');
  assert.equal(urlopy[1][10], '');
});

test('ustawStatusUrlopu forbidden for non-admin', () => {
  const api = setup({ gsFns: { ustawStatusUrlopu: () => ({ ok: true }) } });
  assert.equal(api.handle(req(api, 1, 'ustawStatusUrlopu', { idWniosku: 'W-2', status: 'x' })).code, 'FORBIDDEN');
});

const USER_ACTIONS = ['init', 'zapiszGodziny', 'zapiszUrlop', 'zapiszWyjscie', 'getMojeWpisy', 'getSaldoWyjsc',
  'getUrlopySummary', 'getBrakujaceDni', 'korygujGodziny', 'usunGodziny', 'usunNieobecnosc', 'usunWyjscie', 'mojaKarta'];
const ADMIN_ACTIONS = ['getWnioskiOczekujace', 'ustawStatusUrlopu', 'pdfWniosku', 'getWyjsciaAdmin', 'zmienStatusWyjscia',
  'adminUsunWyjscie', 'getNieobecnosciAdmin', 'adminUsunNieobecnosc', 'getPracownicy', 'getHistoriaPracownika',
  'getRaportMiesieczny', 'pdfRaportMiesieczny', 'pdfKartyEwidencji', 'pdfNadgodziny', 'pdfWnioskiMiesiaca',
  'pdfKsiegowosc', 'pdfZestawienie', 'pdfKartaPracownika', 'getUrlopyZakres', 'pdfUrlopyZakres', 'adminKorygujGodziny', 'adminUsunGodziny', 'adminEdytujWyjscie', 'adminWyjscieStatus', 'adminUsunWyjscieH', 'adminEdytujUrlop', 'adminUsunUrlop'];

test('every spec action is registered with the right role', () => {
  const api = setup();
  const t = api.eval('API_ACTIONS_');
  for (const n of USER_ACTIONS) assert.equal(t[n]?.role, 'user', n);
  for (const n of ADMIN_ACTIONS) assert.equal(t[n]?.role, 'admin', n);
  const queued = Object.keys(t).filter((k) => t[k].queued).sort();
  assert.deepEqual(queued, ['zapiszGodziny', 'zapiszUrlop', 'zapiszWyjscie']);
  assert.equal(Object.keys(t).length, USER_ACTIONS.length + ADMIN_ACTIONS.length + 1); // + login
});

test('user actions map to GS with token id; client pracownikId ignored', () => {
  const rec = {};
  const fn = (n) => (...a) => { (rec[n] ||= []).push(a); return { ok: true }; };
  const names = ['getSaldoWyjsc', 'getUrlopySummary', 'getBrakujaceDni', 'korygujGodziny', 'usunGodziny',
    'usunNieobecnosc', 'usunWyjscie', 'generujKartePracownika'];
  const api = setup({ gsFns: Object.fromEntries(names.map((n) => [n, fn(n)])) });
  const run = (a, args) => assert.equal(api.handle(req(api, 1, a, { pracownikId: 2, ...args })).ok, true, a);
  run('getSaldoWyjsc', {}); run('getUrlopySummary', {}); run('getBrakujaceDni', {});
  run('korygujGodziny', { wiersz: 4, godzOd: '08:00', godzDo: '16:00', uwagi: 'u' });
  run('usunGodziny', { wiersz: 4 }); run('usunNieobecnosc', { wiersz: 5 }); run('usunWyjscie', { wiersz: 6 });
  run('mojaKarta', { rok: 2026, miesiac: 9 });
  assert.deepEqual(plain(rec.getSaldoWyjsc[0]), [1]);
  assert.deepEqual(plain(rec.korygujGodziny[0]), [1, 4, { godzOd: '08:00', godzDo: '16:00', uwagi: 'u' }]);
  assert.deepEqual(plain(rec.usunNieobecnosc[0]), [1, 5]);
  assert.deepEqual(plain(rec.generujKartePracownika[0]), [1, 2026, 9]);
});

test('admin actions map to GS arguments', () => {
  const rec = {};
  const names = ['getWnioskiOczekujace', 'generujPdfZPanelu', 'getWyjsciaAdmin', 'zmienStatusWyjscia', 'adminUsunWyjscie',
    'getNieobecnosciAdmin', 'adminUsunNieobecnosc', 'getPracownicy', 'getHistoriaPracownika', 'getRaportMiesieczny',
    'generujRaportMiesiecznyPdf', 'generujKartyEwidencji', 'generujRaportNadgodzinDoWeryfikacji',
    'generujPdfWnioskowMiesiaca', 'generujRaportKsiegowosc', 'generujZestawienieNadgodzinUrlopy', 'generujKartePracownika'];
  const gsFns = Object.fromEntries(names.map((n) => [n, (...a) => { (rec[n] ||= []).push(a); return { ok: true }; }]));
  const api = setup({ gsFns });
  const run = (a, args) => assert.equal(api.handle(req(api, 2, a, args)).ok, true, a);
  run('getWnioskiOczekujace', {}); run('pdfWniosku', { idWniosku: 'W-1' });
  run('getWyjsciaAdmin', { rok: 2026, miesiac: 10 }); run('zmienStatusWyjscia', { wiersz: 3, status: 'S' });
  run('adminUsunWyjscie', { wiersz: 3 }); run('getNieobecnosciAdmin', { rok: 2026, miesiac: 10 });
  run('adminUsunNieobecnosc', { wiersz: 3 }); run('getPracownicy', {});
  run('getHistoriaPracownika', { pracownikId: 1, rok: 2026, miesiac: 10 });
  run('getRaportMiesieczny', { rok: 2026, miesiac: 10 }); run('pdfRaportMiesieczny', { rok: 2026, miesiac: 10 });
  run('pdfKartyEwidencji', { rok: 2026, miesiac: 10 }); run('pdfNadgodziny', { rok: 2026, miesiac: 10 });
  run('pdfWnioskiMiesiaca', { rok: 2026, miesiac: 10, pracownikId: 1 }); run('pdfKsiegowosc', { rok: 2026, miesiac: 10 });
  run('pdfZestawienie', { rok: 2026, miesiac: 10 }); run('pdfKartaPracownika', { pracownikId: 1, rok: 2026, miesiac: 10 });
  assert.deepEqual(plain(rec.generujPdfZPanelu[0]), ['W-1']);
  assert.deepEqual(plain(rec.zmienStatusWyjscia[0]), [3, 'S']);
  assert.deepEqual(plain(rec.getHistoriaPracownika[0]), [1, 2026, 10]);
  assert.deepEqual(plain(rec.generujPdfWnioskowMiesiaca[0]), [2026, 10, 1]);
  assert.deepEqual(plain(rec.generujKartePracownika[0]), [1, 2026, 10]);
  assert.deepEqual(plain(rec.generujRaportKsiegowosc[0]), [2026, 10]);
});

test('apiSetup is idempotent', () => {
  const api = loadApi({ now: T, sheets: { Pracownicy: [['ID', 'Imię', 'Nazwisko', 'Email', 'Stanowisko', 'PIN', 'Limit bieżący', 'Limit zaległy'], [1, 'J', 'K', '', '', '1', 26, 4]] } });
  api.raw('apiSetup'); api.raw('apiSetup');
  assert.equal(api.triggers.length, 1);
  assert.equal(api.triggers[0].getHandlerFunction(), 'apiLogCleanup');
  assert.equal(api.triggers[0].days, 1);
  assert.equal(api.triggers[0].hour, 3);
  const prac = api.sheets.Pracownicy._rows;
  assert.deepEqual(plain(prac[0]), ['ID', 'Imię', 'Nazwisko', 'Email', 'Stanowisko', 'PIN', 'Limit bieżący', 'Limit zaległy', 'Rola']);
  assert.deepEqual(plain(prac[1]), [1, 'J', 'K', '', '', '1', 26, 4]); // limity nietknięte
  assert.equal(api.sheets.API_Log._hidden, true);
  assert.deepEqual(plain(api.sheets.API_Log._rows), [LOG_HEADER]);
  assert.ok(api.props.API_SECRET);
});

test('apiSetup writes "Rola" never into A–H (column max(last+1, 9))', () => {
  // tylko A–F wypełnione -> I (9), G/H zostają puste
  let api = loadApi({ now: T, sheets: { Pracownicy: [['ID', 'Imię', 'Nazwisko', 'Email', 'Stanowisko', 'PIN']] } });
  api.raw('apiSetup');
  assert.equal(api.sheets.Pracownicy.getRange(1, 9).getValue(), 'Rola');
  assert.equal(api.sheets.Pracownicy.getRange(1, 7).getValue(), '');
  assert.equal(api.sheets.Pracownicy.getRange(1, 8).getValue(), '');
  // 10 wypełnionych kolumn -> K (11)
  api = loadApi({ now: T, sheets: { Pracownicy: [['ID', 'Imię', 'Nazwisko', 'Email', 'Stanowisko', 'PIN', 'L1', 'L2', 'X', 'Y']] } });
  api.raw('apiSetup');
  assert.equal(api.sheets.Pracownicy.getRange(1, 11).getValue(), 'Rola');
});

test('apiSetup keeps existing Rola header, secret and foreign triggers', () => {
  const api = setup({ props: { API_SECRET: 'keep' } });
  api.sheets.Pracownicy._rows[0][8] = ' ROLA ';
  api.triggers.push({ getHandlerFunction: () => 'inna' });
  api.raw('apiSetup');
  assert.equal(api.sheets.Pracownicy._rows[0].length, 9);
  assert.equal(api.sheets.Pracownicy.getRange(1, 9).getValue(), ' ROLA ');
  assert.equal(api.props.API_SECRET, 'keep');
  assert.equal(api.triggers.length, 2);
});

test('apiLogCleanup removes rows older than 60 days', () => {
  const api = setup();
  const rows = api.sheets.API_Log._rows;
  rows.push(['old', new Date(T - 61 * DAY), 1, 'a', '{}'], ['new', new Date(T - 59 * DAY), 1, 'a', '{}']);
  api.raw('apiLogCleanup', T);
  assert.deepEqual(rows.map((r) => r[0]), ['clientId', 'new']);
});

test('apiWylogujWszystkich invalidates tokens', () => {
  const api = setup({ gsFns: { getTypyNieobecnosci: () => [], getTypyWyjsc: () => [] } });
  const t = tok(api, 1);
  assert.equal(api.handle({ action: 'init', token: t }).ok, true);
  api.raw('apiWylogujWszystkich');
  assert.equal(api.handle({ action: 'init', token: t }).code, 'AUTH');
});

test('ustawStatusUrlopu Oczekuje does not write admin name', () => {
  const urlopy = [['h'], [1, 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'W-2', '']];
  const api = setup({ sheets: { Urlopy: urlopy }, gsFns: { ustawStatusUrlopu: () => ({ ok: true }) } });
  assert.equal(api.handle(req(api, 2, 'ustawStatusUrlopu', { idWniosku: 'W-2', status: 'Oczekuje' })).ok, true);
  assert.equal(urlopy[1][10], '');
});

test('GS function taking the script lock itself works (no lock held during GS call)', () => {
  const api = setup();
  const g = api.ctx;
  g.zapiszUrlop = () => { const l = g.LockService.getScriptLock(); l.waitLock(15000); l.releaseLock(); return { ok: true, id: 'W-9' }; };
  const r = req(api, 1, 'zapiszUrlop', {}, { clientId: 'n1' });
  const a = api.handle(r);
  assert.equal(a.ok, true);
  assert.deepEqual(plain(api.handle(r)), plain(a));
  assert.equal(api.sheets.API_Log._rows.length, 2);
  assert.equal(api.sheets.API_Log._rows[1][4], JSON.stringify(plain(a)));
});

test('fresh pending claim → SERVER "w toku", no GS call', () => {
  const api = setup({ gsFns: { zapiszGodziny: () => ({ ok: true }) } });
  api.sheets.API_Log._rows.push(['p', new Date(T - 60 * 1000), 1, 'zapiszGodziny', '']);
  const res = api.handle(req(api, 1, 'zapiszGodziny', {}, { clientId: 'p' }));
  assert.equal(res.code, 'SERVER');
  assert.match(res.error, /w toku/);
  assert.equal(api.calls.zapiszGodziny, undefined);
});

test('stale pending claim is reclaimed', () => {
  const api = setup({ gsFns: { zapiszGodziny: () => ({ ok: true, wiersz: 3 }) } });
  api.sheets.API_Log._rows.push(['p', new Date(T - 8 * 60 * 1000), 1, 'zapiszGodziny', '']);
  const res = api.handle(req(api, 1, 'zapiszGodziny', {}, { clientId: 'p' }));
  assert.equal(res.ok, true);
  assert.equal(api.calls.zapiszGodziny.length, 1);
  assert.equal(api.sheets.API_Log._rows.length, 2);
  assert.equal(api.sheets.API_Log._rows[1][1].getTime(), T);
  assert.ok(api.sheets.API_Log._rows[1][4]);
});

test('GS throws → claim removed, retry re-runs GS', () => {
  let n = 0;
  const api = setup({ gsFns: { zapiszGodziny: () => { if (n++ === 0) throw new Error('boom'); return { ok: true }; } } });
  const r = req(api, 1, 'zapiszGodziny', {}, { clientId: 'q' });
  assert.equal(api.handle(r).code, 'SERVER');
  assert.equal(api.sheets.API_Log._rows.length, 1);
  assert.equal(api.handle(r).ok, true);
  assert.equal(api.calls.zapiszGodziny.length, 2);
});

test('same clientId from a different user is not replayed', () => {
  const api = setup({ gsFns: { zapiszGodziny: () => ({ ok: true }) } });
  api.handle(req(api, 1, 'zapiszGodziny', {}, { clientId: 'same' }));
  api.handle(req(api, 2, 'zapiszGodziny', {}, { clientId: 'same' }));
  assert.equal(api.calls.zapiszGodziny.length, 2);
  assert.equal(api.sheets.API_Log._rows.length, 3);
});

test('lock not held while GS runs', () => {
  let heldDuring;
  const api = setup();
  api.ctx.zapiszGodziny = () => { heldDuring = api.lock.held; return { ok: true }; };
  api.handle(req(api, 1, 'zapiszGodziny', {}, { clientId: 'h' }));
  assert.equal(heldDuring, false);
});

const DUP_MSG = 'Masz już wpis na ten dzień. Skontaktuj się z administratorem w celu korekty.';

function dupSetup() {
  const saved = []; // [pracownikId, data] jak w arkuszu Godziny
  return setup({
    gsFns: {
      sprawdzDuplikat: (id, data) => saved.some(([i, d]) => String(i) === String(id) && d === data),
      zapiszGodziny: (d) => { saved.push([d.pracownikId, d.data]); return { ok: true, przepracowane: 8, nadgodziny: 0 }; },
    },
  });
}

test('zapiszGodziny: second entry for the same day (other clientId) → REJECTED, logged', () => {
  const api = dupSetup();
  const args = { data: '2026-10-20', godzOd: '08:00', godzDo: '16:00' };
  assert.equal(api.handle(req(api, 1, 'zapiszGodziny', args, { clientId: 'd1' })).ok, true);
  const r2 = api.handle(req(api, 1, 'zapiszGodziny', { ...args, godzDo: '17:00' }, { clientId: 'd2' }));
  assert.deepEqual(r2, { ok: false, code: 'REJECTED', error: DUP_MSG });
  assert.equal(api.calls.zapiszGodziny.length, 1);
  assert.deepEqual(plain(api.calls.sprawdzDuplikat[1]), [1, '2026-10-20']); // id z tokenu
  const logged = api.sheets.API_Log._rows.find((r) => r[0] === 'd2');
  assert.deepEqual(JSON.parse(logged[4]), r2);
  // inny pracownik ten sam dzień — ok
  assert.equal(api.handle(req(api, 2, 'zapiszGodziny', args, { clientId: 'd3' })).ok, true);
});

test('zapiszGodziny: replay of the same clientId returns the stored ok (not the duplicate error)', () => {
  const api = dupSetup();
  const r = req(api, 1, 'zapiszGodziny', { data: '2026-10-20', godzOd: '08:00', godzDo: '16:00' }, { clientId: 'same-day' });
  const a = api.handle(r);
  assert.equal(a.ok, true);
  assert.deepEqual(api.handle(r), a);
  assert.equal(api.calls.zapiszGodziny.length, 1);
});
