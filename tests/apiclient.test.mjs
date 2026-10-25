import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, NetworkError } from '../pwa/js/api.js';

const okResp = (obj, status = 200) => ({ ok: status === 200, status, json: async () => obj, text: async () => JSON.stringify(obj) });
const session = async () => ({ token: 'tok', deviceId: 'dev' });

test('żądanie: POST text/plain z pełnym body', async () => {
  const calls = [];
  const fetchFn = async (url, init) => { calls.push([url, init]); return okResp({ ok: true, data: 1 }); };
  const api = createApi({ url: '/api', fetchFn, getSession: session, onAuth() {} });
  const r = await api.call('zapiszGodziny', { a: 1 }, { clientId: 'cid' });
  assert.deepEqual(r, { ok: true, data: 1 });
  const [url, init] = calls[0];
  assert.equal(url, '/api');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.deepEqual(JSON.parse(init.body), { action: 'zapiszGodziny', args: { a: 1 }, token: 'tok', deviceId: 'dev', clientId: 'cid' });
});

test('brak sesji i clientId: pola pominięte, args domyślnie {}', async () => {
  let body;
  const fetchFn = async (u, init) => { body = JSON.parse(init.body); return okResp({ ok: true }); };
  const api = createApi({ url: '/api', fetchFn, getSession: async () => null, onAuth() {} });
  await api.call('ping');
  assert.deepEqual(body, { action: 'ping', args: {} });
});

test('login dostaje deviceId bez tokenu', async () => {
  let body;
  const fetchFn = async (u, init) => { body = JSON.parse(init.body); return okResp({ ok: true }); };
  const api = createApi({ url: '/api', fetchFn, getSession: async () => ({ deviceId: 'dev' }), onAuth() {} });
  await api.call('login', { pin: '1' });
  assert.equal(body.deviceId, 'dev');
  assert.equal('token' in body, false);
});

for (const [action, ms] of [['zapiszGodziny', 30000], ['pdfRaportMiesieczny', 60000], ['mojaKarta', 60000]]) {
  test(`timeout ${ms} ms dla ${action}`, async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const fetchFn = (u, init) => new Promise((_, rej) => {
        init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
      const api = createApi({ url: '/api', fetchFn, getSession: session, onAuth() {} });
      const p = api.call(action);
      await new Promise(r => setImmediate(r));
      mock.timers.tick(ms - 1);
      let settled = false;
      p.catch(() => {}).then(() => { settled = true; });
      await new Promise(r => setImmediate(r));
      assert.equal(settled, false);
      mock.timers.tick(1);
      await assert.rejects(p, e => e instanceof NetworkError && /czas/.test(e.message));
    } finally { mock.timers.reset(); }
  });
}

test('odrzucony fetch -> NetworkError', async () => {
  const api = createApi({ url: '/api', fetchFn: async () => { throw new TypeError('fail'); }, getSession: session, onAuth() {} });
  await assert.rejects(api.call('x'), NetworkError);
});

test('HTML zamiast JSON -> NetworkError', async () => {
  const fetchFn = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); }, text: async () => '<html>' });
  const api = createApi({ url: '/api', fetchFn, getSession: session, onAuth() {} });
  await assert.rejects(api.call('x'), NetworkError);
});

test('HTTP != 200 -> NetworkError', async () => {
  const api = createApi({ url: '/api', fetchFn: async () => okResp({ ok: true }, 500), getSession: session, onAuth() {} });
  await assert.rejects(api.call('x'), NetworkError);
});

test('AUTH -> onAuth raz i zwraca odpowiedź', async () => {
  let n = 0;
  const resp = { ok: false, code: 'AUTH', error: 'x' };
  const api = createApi({ url: '/api', fetchFn: async () => okResp(resp), getSession: session, onAuth: () => n++ });
  assert.deepEqual(await api.call('x'), resp);
  assert.equal(n, 1);
});

test('inny błąd (REJECTED) nie woła onAuth', async () => {
  let n = 0;
  const api = createApi({ url: '/api', fetchFn: async () => okResp({ ok: false, code: 'REJECTED' }), getSession: session, onAuth: () => n++ });
  await api.call('x');
  assert.equal(n, 0);
});
