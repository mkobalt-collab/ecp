import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApi } from './helpers/gas.mjs';

const T = Date.UTC(2026, 9, 25, 12, 0, 0);
const HEADER = ['ID', 'Imię', 'Nazwisko', 'Email', 'Stanowisko', 'PIN', 'Limit bieżący', 'Limit zaległy', 'Rola'];
const d = (y, m, day) => new Date(y, m - 1, day);
const pt = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

function setup() {
  const sheets = {
    Pracownicy: [HEADER, [1, 'Jan', 'Kowalski', '', 'DH', '1111', 26, 4, ''], [2, 'Ewa', 'Admin', '', 'K', '2222', 20, 0, 'admin']],
    Godziny: [
      ['ts', 'ID', 'Pracownik', 'Data', 'Od', 'Do', 'Przepr', 'Nadg', 'Projekt', 'Uwagi'],
      [0, 1, 'Jan', d(2026, 10, 2), '08:00', '16:00', 8, 0, '', ''],
      [0, 3, 'Inny', d(2026, 10, 2), '08:00', '16:00', 8, 0, '', ''],
      [0, 1, 'Jan', d(2026, 10, 3), '08:00', '12:00', 4, 4, '', ''], // sobota
      [0, 1, 'Jan', d(2026, 9, 30), '08:00', '16:00', 8, 0, '', ''],
    ],
    'Wyjścia': [
      ['ts', 'ID', 'Pracownik', 'Rodzaj', 'Data', 'Od', 'Do', 'Godz', 'Uwagi', 'Status'],
      [0, 1, 'Jan', 'Wyjście prywatne', d(2026, 10, 5), '10:00', '12:00', 2, '', 'Oczekuje'],
    ],
    Urlopy: [
      ['ts', 'ID', 'Pracownik', 'Typ', 'Od', 'Do', 'Dni', 'Uwagi', 'Status', 'ID wniosku', 'Kto', 'Kiedy'],
      [0, 1, 'Jan', 'Urlop wypoczynkowy', d(2026, 10, 5), d(2026, 10, 9), 5, '', 'Zatwierdzone', 'u1', '', ''],
    ],
  };
  const api = loadApi({
    now: T,
    sheets,
    gsFns: {
      getSwieta: () => ['2026-11-11'],
      getTypyNieobecnosci: () => ['Urlop wypoczynkowy', 'Chorobowe (L4)'],
      godzinyMiedzy: (a, b) => { let m = pt(b) - pt(a); if (m < 0) m += 1440; return m / 60; },
      nadgodzinyDnia: (v, h) => new Date(v).getDay() === 6 ? h : Math.max(0, h - 8),
      matchMonth: (v, r, m) => { const x = new Date(v); return x.getFullYear() === +r && x.getMonth() === +m - 1; },
      getHistoriaPracownika: () => ({ godziny: [{ data: '02.10.2026' }, { data: '03.10.2026' }], urlopy: [] }),
    },
  });
  const call = (action, args) => api.handle({ action, token: api.call('apiMakeToken_', 2, T), args });
  return { api, call, sheets };
}

test('historia dostaje numery wierszy godzin', () => {
  const { call } = setup();
  const r = call('getHistoriaPracownika', { pracownikId: 1, rok: 2026, miesiac: 10 });
  assert.deepEqual(r.data.godziny.map(g => g.wiersz), [2, 4]);
});

test('korekta godzin przez admina, sobota = wszystkie godziny nadgodzinami', () => {
  const { call, sheets } = setup();
  let r = call('adminKorygujGodziny', { pracownikId: 1, wiersz: 2, data: '02.10.2026', godzOd: '07:00', godzDo: '16:30', uwagi: 'korekta' });
  assert.equal(r.ok, true);
  assert.deepEqual(sheets.Godziny[1].slice(4, 10), ['07:00', '16:30', 9.5, 1.5, '', 'korekta']);
  r = call('adminKorygujGodziny', { pracownikId: 1, wiersz: 4, data: '2026-10-03', godzOd: '08:00', godzDo: '13:00' });
  assert.equal(sheets.Godziny[3][7], 5);
});

test('zmieniony wiersz (inny pracownik albo data) jest odrzucany', () => {
  const { call, sheets } = setup();
  assert.equal(call('adminKorygujGodziny', { pracownikId: 1, wiersz: 3, data: '02.10.2026', godzOd: '08:00', godzDo: '16:00' }).code, 'REJECTED');
  assert.equal(call('adminUsunGodziny', { pracownikId: 1, wiersz: 2, data: '03.10.2026' }).code, 'REJECTED');
  assert.equal(call('adminKorygujGodziny', { pracownikId: 1, wiersz: 2, data: '02.10.2026', godzOd: '8', godzDo: '16:00' }).code, 'REJECTED');
  assert.equal(sheets.Godziny.length, 5);
  assert.equal(call('adminUsunGodziny', { pracownikId: 1, wiersz: 2, data: '02.10.2026' }).ok, true);
  assert.equal(sheets.Godziny.length, 4);
});

test('pracownik nie może używać akcji admina', () => {
  const { api } = setup();
  const r = api.handle({ action: 'adminUsunGodziny', token: api.call('apiMakeToken_', 1, T), args: { pracownikId: 1, wiersz: 2, data: '02.10.2026' } });
  assert.equal(r.code, 'FORBIDDEN');
});

test('wyjścia: edycja, status, usunięcie', () => {
  const { call, sheets } = setup();
  const k = { pracownikId: 1, wiersz: 2, data: '2026-10-05' };
  assert.equal(call('adminEdytujWyjscie', { ...k, rodzaj: 'Odpracowanie', godzOd: '15:00', godzDo: '16:30', uwagi: 'x' }).ok, true);
  assert.deepEqual(sheets['Wyjścia'][1].slice(3, 10), ['Odpracowanie', d(2026, 10, 5), '15:00', '16:30', 1.5, 'x', 'Oczekuje']);
  assert.equal(call('adminWyjscieStatus', { ...k, status: 'Zatwierdzone' }).ok, true);
  assert.equal(sheets['Wyjścia'][1][9], 'Zatwierdzone');
  assert.equal(call('adminUsunWyjscieH', { ...k, data: '2026-10-06' }).code, 'REJECTED');
  assert.equal(call('adminUsunWyjscieH', k).ok, true);
  assert.equal(sheets['Wyjścia'].length, 1);
});

test('urlop: edycja przelicza dni robocze bez świąt, usunięcie po ID', () => {
  const { call, sheets } = setup();
  const r = call('adminEdytujUrlop', { pracownikId: 1, idWniosku: 'u1', typ: 'Chorobowe (L4)', dataOd: '2026-11-09', dataDo: '2026-11-13', uwagi: 'zmiana' });
  assert.equal(r.ok, true);
  assert.equal(r.data.dni, 4); // 11.11 święto
  const row = sheets.Urlopy[1];
  assert.equal(row[3], 'Chorobowe (L4)');
  assert.equal(row[4].getDate(), 9);
  assert.deepEqual(row.slice(6, 9), [4, 'zmiana', 'Zatwierdzone']);
  assert.equal(call('adminEdytujUrlop', { pracownikId: 1, idWniosku: 'u1', typ: 'Zły', dataOd: '2026-11-09', dataDo: '2026-11-13' }).code, 'REJECTED');
  assert.equal(call('adminEdytujUrlop', { pracownikId: 1, idWniosku: 'u1', typ: 'Chorobowe (L4)', dataOd: '2026-11-14', dataDo: '2026-11-15' }).code, 'REJECTED');
  assert.equal(call('adminUsunUrlop', { pracownikId: 3, idWniosku: 'u1' }).code, 'REJECTED');
  assert.equal(call('adminUsunUrlop', { pracownikId: 1, idWniosku: 'u1' }).ok, true);
  assert.equal(sheets.Urlopy.length, 1);
});
