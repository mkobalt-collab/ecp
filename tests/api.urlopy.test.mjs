import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApi } from './helpers/gas.mjs';

const T = Date.UTC(2026, 9, 25, 12, 0, 0);
const HEADER = ['ID', 'Imię', 'Nazwisko', 'Email', 'Stanowisko', 'PIN', 'Limit bieżący', 'Limit zaległy', 'Rola'];
const d = (y, m, day) => new Date(y, m - 1, day);
const U = (id, typ, od, doo, dni, status, uwagi = '') => [d(2026, 1, 1), id, 'X', typ, od, doo, dni, uwagi, status, 'abc', '', ''];

function setup(gsFns = {}) {
  return loadApi({
    now: T,
    sheets: {
      Pracownicy: [HEADER, [1, 'Jan', 'Kowalski', 'j@x.pl', 'DH', '1111', 26, 4, ''], [2, 'Ewa', 'Admin', 'e@x.pl', 'K', '2222', 20, 0, 'admin']],
      Urlopy: [
        ['Data', 'ID', 'Pracownik', 'Typ', 'Od', 'Do', 'Dni', 'Uwagi', 'Status', 'ID wniosku', 'Kto', 'Kiedy'],
        U(1, 'Urlop wypoczynkowy', d(2025, 12, 29), d(2026, 1, 2), 4, 'Zatwierdzone'), // 29–31.12 + 2.01 (1.01 święto)
        U(1, 'Urlop wypoczynkowy', d(2026, 3, 2), d(2026, 3, 6), 5, 'Zatwierdzone'),
        U(1, 'Chorobowe (L4)', d(2026, 4, 1), d(2026, 4, 3), 3, 'Zatwierdzone'),
        U(1, 'Urlop na żądanie', d(2026, 5, 4), d(2026, 5, 4), 1, 'Odrzucone'),
        U(2, 'Urlop wypoczynkowy', d(2026, 3, 2), d(2026, 3, 3), 2, 'Zatwierdzone'),
        U(1, 'Urlop wypoczynkowy', d(2027, 1, 4), d(2027, 1, 5), 2, 'Oczekuje'),
      ],
    },
    gsFns: { getSwieta: () => ['2026-01-01'], ...gsFns },
  });
}
const tok = (api, id) => api.call('apiMakeToken_', id, T);

test('zestawienie urlopów pracownika za okres', () => {
  const api = setup({ getUrlopySummary: () => ({ limitBiezacy: 26, limitZalegly: 4, wykorzystaneUrlop: 6, pozostalyBiezacy: 24, pozostalyZalegly: 0 }) });
  const r = api.handle({ action: 'getUrlopyZakres', token: tok(api, 2), args: { pracownikId: 1, od: '2026-01-01', do: '2026-12-31' } });
  assert.equal(r.ok, true);
  const z = r.data;
  assert.equal(z.pracownik, 'Jan Kowalski');
  assert.deepEqual(z.lista.map(x => [x.typ, x.dataOd, x.dniWOkresie, x.status]), [
    ['Urlop wypoczynkowy', '2025-12-29', 1, 'Zatwierdzone'],
    ['Urlop wypoczynkowy', '2026-03-02', 5, 'Zatwierdzone'],
    ['Chorobowe (L4)', '2026-04-01', 3, 'Zatwierdzone'],
    ['Urlop na żądanie', '2026-05-04', 1, 'Odrzucone'],
  ]);
  assert.deepEqual(z.suma, [{ typ: 'Chorobowe (L4)', dni: 3 }, { typ: 'Urlop wypoczynkowy', dni: 6 }]);
  assert.equal(z.limit.pozostalyBiezacy, 24);
});

test('zestawienie: tylko admin, walidacja dat', () => {
  const api = setup();
  assert.equal(api.handle({ action: 'getUrlopyZakres', token: tok(api, 1), args: { pracownikId: 1, od: '2026-01-01', do: '2026-12-31' } }).code, 'FORBIDDEN');
  const bad = api.handle({ action: 'getUrlopyZakres', token: tok(api, 2), args: { pracownikId: 1, od: '2026-12-31', do: '2026-01-01' } });
  assert.equal(bad.code, 'REJECTED');
  assert.equal(api.handle({ action: 'getUrlopyZakres', token: tok(api, 2), args: { pracownikId: 1, od: '', do: '2026-01-01' } }).code, 'REJECTED');
  assert.equal(api.handle({ action: 'getUrlopyZakres', token: tok(api, 2), args: { pracownikId: 99, od: '2026-01-01', do: '2026-02-01' } }).code, 'REJECTED');
  const r = api.handle({ action: 'getUrlopyZakres', token: tok(api, 2), args: { pracownikId: 1, od: '2026-06-01', do: '2026-06-30' } });
  assert.deepEqual(r.data.lista, []);
  assert.equal(r.data.limit, null);
});
