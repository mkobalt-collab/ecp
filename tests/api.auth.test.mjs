import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApi } from './helpers/gas.mjs';

const T = Date.UTC(2026, 9, 25, 12, 0, 0);
const DAY = 864e5;
const HEADER = ['ID', 'Imię', 'Nazwisko', 'Email', 'Stanowisko', 'PIN', 'Limit bieżący', 'Limit zaległy', 'Rola'];

function setup(extra = {}) {
  const wpisy = { rok: 2026, miesiac: 10, godziny: [] };
  return loadApi({
    now: T,
    sheets: {
      Pracownicy: [
        HEADER,
        [1, 'Jan', 'Kowalski', 'j@x.pl', 'Montażysta', '1111', 26, 4, ''],
        [2, 'Ewa', 'Admin', 'e@x.pl', 'Kierownik', '2222', 20, 0, '  Admin '],
      ],
    },
    gsFns: {
      getMojeWpisy: () => wpisy,
      getTypyNieobecnosci: () => ['Urlop wypoczynkowy'],
      getTypyWyjsc: () => ['Prywatne'],
      ...extra,
    },
  });
}
const tok = (api, id) => api.call('apiMakeToken_', id, T);

test('token roundtrip', () => {
  const api = setup();
  assert.equal(api.call('apiVerifyToken_', tok(api, 7), T + 1000), 7);
});

test('token expired', () => {
  const api = setup();
  const t = tok(api, 7);
  assert.equal(api.call('apiVerifyToken_', t, T + 30 * DAY), 7);
  assert.equal(api.call('apiVerifyToken_', t, T + 30 * DAY + 1), null);
});

test('token forged', () => {
  const api = setup();
  const t = tok(api, 7);
  const [p, s] = t.split('.');
  const flip = (x, i) => x.slice(0, i) + (x[i] === 'A' ? 'B' : 'A') + x.slice(i + 1);
  assert.equal(api.call('apiVerifyToken_', flip(p, 3) + '.' + s, T), null);
  assert.equal(api.call('apiVerifyToken_', p + '.' + flip(s, 3), T), null);
  assert.equal(api.call('apiVerifyToken_', 'abc', T), null);
  assert.equal(api.call('apiVerifyToken_', '', T), null);
  assert.equal(api.call('apiVerifyToken_', undefined, T), null);
});

test('apiSecret_ tworzy sekret raz', () => {
  const api = setup();
  assert.equal(api.props.API_SECRET, undefined);
  const s = api.call('apiSecret_');
  assert.ok(s.length >= 64);
  assert.equal(api.call('apiSecret_'), s);
  assert.equal(api.props.API_SECRET, s);
});

test('no token -> AUTH', () => {
  const api = setup();
  assert.equal(api.handle({ action: 'getMojeWpisy' }).code, 'AUTH');
});

test('deleted employee -> AUTH', () => {
  const api = setup();
  const r = api.handle({ action: 'getMojeWpisy', token: tok(api, 9) });
  assert.deepEqual(r, { ok: false, code: 'AUTH', error: r.error });
});

test('unknown action -> BAD_REQUEST', () => {
  const api = setup();
  assert.equal(api.handle({ action: 'usunDuplikaty', token: tok(api, 1) }).code, 'BAD_REQUEST');
  assert.equal(api.handle({ action: 'constructor', token: tok(api, 1) }).code, 'BAD_REQUEST');
  assert.equal(api.handle({}).code, 'BAD_REQUEST');
});

test('pracownikId from token', () => {
  const api = setup();
  const r = api.handle({ action: 'getMojeWpisy', token: tok(api, 1), args: { pracownikId: 99, rok: 2026, miesiac: 10 } });
  assert.equal(r.ok, true);
  assert.deepEqual(api.calls.getMojeWpisy, [[1, 2026, 10]]);
});

test('init returns user and dictionaries', () => {
  const api = setup();
  const r = api.handle({ action: 'init', token: tok(api, 1) });
  assert.deepEqual(r, {
    ok: true,
    data: {
      user: { id: 1, imie: 'Jan', nazwisko: 'Kowalski', stanowisko: 'Montażysta', rola: 'pracownik' },
      typyNieobecnosci: ['Urlop wypoczynkowy'],
      typyWyjsc: ['Prywatne'],
    },
  });
});

test('admin action as employee -> FORBIDDEN, admin ok', () => {
  const api = setup();
  api.eval("API_ACTIONS_.testAdmin = { role: 'admin', queued: false, run: (user, args) => ({ who: user.id, rola: user.rola, args }) }");
  assert.equal(api.handle({ action: 'testAdmin', token: tok(api, 1) }).code, 'FORBIDDEN');
  const r = api.handle({ action: 'testAdmin', token: tok(api, 2), args: { pracownikId: 5 } });
  assert.equal(r.ok, true);
  assert.equal(r.data.rola, 'admin');
  assert.equal(r.data.args.pracownikId, 5); // admin może wskazać pracownika
});

test('REJECTED passthrough', () => {
  const api = setup({ getMojeWpisy: () => ({ ok: false, error: 'X' }) });
  assert.deepEqual(api.handle({ action: 'getMojeWpisy', token: tok(api, 1), args: {} }), { ok: false, code: 'REJECTED', error: 'X' });
});

test('SERVER on throw', () => {
  const api = setup({ getMojeWpisy: () => { throw new Error('sekret-stack'); } });
  const orig = console.error; console.error = () => {};
  let r;
  try { r = api.handle({ action: 'getMojeWpisy', token: tok(api, 1), args: {} }); } finally { console.error = orig; }
  assert.equal(r.code, 'SERVER');
  assert.equal(r.error, 'Błąd serwera. Spróbuj ponownie.');
  assert.ok(!JSON.stringify(r).includes('sekret'));
});

test('serialize dates and nesting', () => {
  const api = setup();
  const out = api.call('apiSerialize_', {
    d: new Date(2026, 9, 25),
    t: new Date(2026, 9, 25, 8, 30),
    arr: [new Date(2026, 0, 2), { x: new Date(2026, 0, 2, 23, 59), n: 1, s: 'a', z: null }],
  });
  assert.deepEqual(out, {
    d: '2026-10-25',
    t: '2026-10-25T08:30:00',
    arr: ['2026-01-02', { x: '2026-01-02T23:59:00', n: 1, s: 'a', z: null }],
  });
});

test('serialize works for Dates from outside the vm realm via handle', () => {
  const api = setup({ getMojeWpisy: () => ({ godziny: [{ data: new Date(2026, 9, 25) }] }) });
  const r = api.handle({ action: 'getMojeWpisy', token: tok(api, 1), args: { rok: 2026, miesiac: 10 } });
  assert.equal(r.data.godziny[0].data, '2026-10-25');
});

test('doPost bad JSON -> BAD_REQUEST', () => {
  const api = setup();
  const out = api.raw('doPost', { postData: { contents: '{nie json' } });
  assert.equal(JSON.parse(out.getContent()).code, 'BAD_REQUEST');
  assert.equal(out._mime, 'JSON');
});

test('doPost dispatches', () => {
  const api = setup();
  const body = JSON.stringify({ action: 'init', token: tok(api, 1) });
  const out = api.raw('doPost', { postData: { contents: body } });
  assert.equal(JSON.parse(out.getContent()).ok, true);
});

test('role read from header-named "Rola" column, never from G (limit urlopu)', () => {
  const rows = (header, r2) => ({ Pracownicy: [header, r2] });
  const base = ['ID', 'Imię', 'Nazwisko', 'Email', 'Stanowisko', 'PIN', 'Limit bieżący', 'Limit zaległy'];
  // Rola w dalszej kolumnie (J), nagłówek z inną wielkością liter i spacjami
  let api = loadApi({ now: T, sheets: rows([...base, 'Uwagi', ' rola '], [5, 'A', 'B', '', 'S', '1', 26, 4, 'x', 'ADMIN']) });
  assert.equal(api.call('apiGetUser_', 5).rola, 'admin');
  // brak kolumny "Rola" -> wszyscy pracownik, nawet gdy w G jest tekst "admin"
  api = loadApi({ now: T, sheets: rows(base, [5, 'A', 'B', '', 'S', '1', 'admin', 4]) });
  assert.equal(api.call('apiGetUser_', 5).rola, 'pracownik');
});
