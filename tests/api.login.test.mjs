import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApi } from './helpers/gas.mjs';

const T = Date.UTC(2026, 9, 25, 12, 0, 0);
const HEADER = ['ID', 'Imię', 'Nazwisko', 'Email', 'Stanowisko', 'PIN', 'Rola'];
const LOCKED_MSG = 'Zbyt wiele nieudanych prób. Spróbuj ponownie za 15 minut.';

function setup(extra = {}) {
  return loadApi({
    now: T,
    sheets: {
      Pracownicy: [
        HEADER,
        [1, 'Jan', 'Kowalski', 'j@x.pl', 'Montażysta', '1111', ''],
        [2, 'Ewa', 'Admin', 'e@x.pl', 'Kierownik', '2222', ' admin '],
      ],
    },
    gsFns: {
      weryfikujPin: (pin) => {
        if (pin === '1111') return { id: 1, imie: 'Jan', nazwisko: 'Kowalski' };
        if (pin === '2222') return { id: 2, imie: 'Ewa', nazwisko: 'Admin' };
        return null;
      },
      getMojeWpisy: () => ({ ok: false }),
      getTypyNieobecnosci: () => [],
      getTypyWyjsc: () => [],
      ...extra,
    },
  });
}
const login = (api, pin, deviceId) => api.handle({ action: 'login', args: { pin }, deviceId });
const fail = (api, n, deviceId) => { for (let i = 0; i < n; i++) login(api, '0000', deviceId); };

test('login ok (pracownik) with verifiable token', () => {
  const api = setup();
  const r = login(api, '1111', 'A');
  assert.equal(r.ok, true);
  assert.equal(r.data.user.rola, 'pracownik');
  assert.equal(r.data.user.id, 1);
  assert.equal(api.call('apiVerifyToken_', r.data.token, T + 1000), 1);
});

test('login ok (admin)', () => {
  const r = login(setup(), '2222', 'A');
  assert.equal(r.ok, true);
  assert.equal(r.data.user.rola, 'admin');
});

test('wrong pin', () => {
  assert.deepEqual(login(setup(), '9999', 'A'), { ok: false, code: 'REJECTED', error: 'Nieprawidłowy PIN.' });
});

test('non-string / missing pin is rejected', () => {
  const api = setup();
  assert.equal(api.handle({ action: 'login', deviceId: 'A' }).code, 'REJECTED');
});

test('device lock', () => {
  const api = setup();
  fail(api, 5, 'A');
  assert.deepEqual(login(api, '1111', 'A'), { ok: false, code: 'LOCKED', error: LOCKED_MSG });
  assert.equal(login(api, '1111', 'B').ok, true);
});

test('lock expires', () => {
  const api = setup();
  fail(api, 5, 'A');
  assert.equal(login(api, '1111', 'A').code, 'LOCKED');
  api.clock.now = T + 901 * 1000;
  assert.equal(login(api, '1111', 'A').ok, true);
});

test('success resets device counter', () => {
  const api = setup();
  fail(api, 4, 'A');
  assert.equal(login(api, '1111', 'A').ok, true);
  fail(api, 4, 'A');
  assert.equal(login(api, '1111', 'A').ok, true);
});

test('global lock', () => {
  const api = setup();
  for (let i = 0; i < 30; i++) login(api, '0000', 'dev' + i);
  assert.equal(login(api, '1111', 'fresh').code, 'LOCKED');
});

test('missing deviceId is shared device "brak"', () => {
  const api = setup();
  fail(api, 3, undefined);
  fail(api, 2, '');
  assert.equal(login(api, '1111', undefined).code, 'LOCKED');
  assert.equal(login(api, '1111', 'A').ok, true);
  assert.ok(api.cache.has('api_fail_dev_brak'));
});

test('long deviceId does not break cache keys', () => {
  const api = setup();
  const long = 'x'.repeat(500);
  fail(api, 5, long);
  assert.equal(login(api, '1111', long).code, 'LOCKED');
  for (const k of api.cache.keys()) assert.ok(k.length <= 250);
});

test('GS {ok:false} without error gets fallback message', () => {
  const api = setup();
  const t = api.call('apiMakeToken_', 1, T);
  assert.deepEqual(api.handle({ action: 'getMojeWpisy', token: t, args: {} }),
    { ok: false, code: 'REJECTED', error: 'Operacja odrzucona.' });
});
