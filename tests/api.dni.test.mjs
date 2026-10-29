import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApi } from './helpers/gas.mjs';

const T = Date.UTC(2026, 9, 25, 12, 0, 0);
const HEADER = ['ID', 'Imię', 'Nazwisko', 'Email', 'Stanowisko', 'PIN', 'Limit bieżący', 'Limit zaległy', 'Rola'];

function setup(gsFns) {
  return loadApi({
    now: T,
    sheets: {
      Pracownicy: [
        HEADER,
        [1, 'Jan', 'Kowalski', 'j@x.pl', 'DH', '1111', 26, 4, ''],
        [2, 'Ewa', 'Admin', 'e@x.pl', 'Kierownik', '2222', 20, 0, 'admin'],
      ],
    },
    gsFns: { getSwieta: () => [], ...gsFns },
  });
}
const tok = (api, id) => api.call('apiMakeToken_', id, T);

test('dni robocze wniosku w danym miesiącu (pon–pt)', () => {
  const api = setup();
  // 24.09.2026 (czw) – 02.10.2026 (pt): w październiku 1.10 (czw) i 2.10 (pt)
  assert.equal(api.call('apiDniWMiesiacu_', '2026-09-24', '2026-10-02', 2026, 10, []), 2);
  assert.equal(api.call('apiDniWMiesiacu_', '2026-09-24', '2026-10-02', 2026, 9, []), 5);
  // weekend nie liczy się
  assert.equal(api.call('apiDniWMiesiacu_', '2026-10-03', '2026-10-04', 2026, 10, []), 0);
  // wniosek spoza miesiąca
  assert.equal(api.call('apiDniWMiesiacu_', '2026-11-02', '2026-11-03', 2026, 10, []), 0);
});

test('święta z arkusza są pomijane', () => {
  const api = setup();
  assert.equal(api.call('apiDniWMiesiacu_', '2026-10-30', '2026-11-03', 2026, 11, ['2026-11-02']), 1);
});

test('format dd.MM.yyyy (historia admina) i błędne daty', () => {
  const api = setup();
  assert.equal(api.call('apiDniWMiesiacu_', '24.09.2026', '02.10.2026', 2026, 10, []), 2);
  assert.equal(api.call('apiDniWMiesiacu_', '', '02.10.2026', 2026, 10, []), null);
});

test('getMojeWpisy dostaje dniWMiesiacu dla miesiąca z wyniku', () => {
  const api = setup({
    getSwieta: () => ['2026-10-01'],
    getMojeWpisy: () => ({ rok: 2026, miesiac: 10, godziny: [], wyjscia: [],
      nieobecnosci: [{ typ: 'Urlop wypoczynkowy', dataOd: '2026-09-24', dataDo: '2026-10-02', dni: 7, status: 'Zatwierdzone' }] }),
  });
  const r = api.handle({ action: 'getMojeWpisy', token: tok(api, 1), args: {} });
  assert.equal(r.ok, true);
  assert.equal(r.data.nieobecnosci[0].dniWMiesiacu, 1);
  assert.equal(r.data.nieobecnosci[0].dni, 7);
});

test('getHistoriaPracownika dostaje dniWMiesiacu w urlopach', () => {
  const api = setup({
    getHistoriaPracownika: () => ({ godziny: [], urlopy: [{ typUrlopu: 'Urlop wypoczynkowy', dataOd: '24.09.2026', dataDo: '02.10.2026', dni: 7 }] }),
  });
  const r = api.handle({ action: 'getHistoriaPracownika', token: tok(api, 2), args: { pracownikId: 1, rok: 2026, miesiac: 10 } });
  assert.equal(r.ok, true);
  assert.equal(r.data.urlopy[0].dniWMiesiacu, 2);
});

test('brak nieobecności nie woła getSwieta', () => {
  let called = 0;
  const api = setup({
    getSwieta: () => { called++; return []; },
    getMojeWpisy: () => ({ rok: 2026, miesiac: 10, godziny: [], nieobecnosci: [], wyjscia: [] }),
  });
  assert.equal(api.handle({ action: 'getMojeWpisy', token: tok(api, 1), args: {} }).ok, true);
  assert.equal(called, 0);
});
