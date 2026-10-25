import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../pwa/js/store.js';
import { createSync } from '../pwa/js/sync.js';
import { NetworkError } from '../pwa/js/api.js';

beforeEach(() => store.clearAll());

function setup(responder) {
  const calls = [];
  const changes = [];
  let n = 0;
  const api = {
    async call(action, args, { clientId }) {
      calls.push({ action, args, clientId });
      return responder(clientId, calls.length);
    },
  };
  const sync = createSync({ store, api, onChange: items => changes.push(items), newId: () => 'id' + (++n) });
  return { sync, calls, changes };
}
const seed = async () => {
  await store.outboxAdd({ clientId: 's1', action: 'zapiszGodziny', args: {}, createdAt: 1, status: 'pending' });
  await store.outboxAdd({ clientId: 's2', action: 'zapiszGodziny', args: {}, createdAt: 2, status: 'pending' });
};
const settle = async sync => { await sync.flush(); };

test('wysyła w kolejności createdAt i przekazuje clientId', async () => {
  const { sync, calls } = setup(() => ({ ok: true }));
  await store.outboxAdd({ clientId: 'b', action: 'zapiszUrlop', args: { x: 2 }, createdAt: 2, status: 'pending' });
  await store.outboxAdd({ clientId: 'a', action: 'zapiszGodziny', args: { x: 1 }, createdAt: 1, status: 'pending' });
  await sync.flush();
  assert.deepEqual(calls.map(c => c.clientId), ['a', 'b']);
  assert.equal(calls[0].action, 'zapiszGodziny');
  assert.deepEqual(calls[0].args, { x: 1 });
  assert.deepEqual(await sync.list(), []);
});

test('REJECTED oznacza błąd, kolejny element idzie dalej', async () => {
  const { sync, calls } = setup(id => id === 'id1' ? { ok: false, code: 'REJECTED', error: 'Od > do' } : { ok: true });
  await sync.enqueue('zapiszWyjscie', {});
  await sync.enqueue('zapiszGodziny', {});
  await settle(sync);
  const left = await sync.list();
  assert.equal(left.length, 1);
  assert.equal(left[0].clientId, 'id1');
  assert.equal(left[0].status, 'error');
  assert.equal(left[0].error, 'Od > do');
  assert.deepEqual(calls.map(c => c.clientId), ['id1', 'id2']);
});

test('BAD_REQUEST i FORBIDDEN też oznaczają błąd', async () => {
  const { sync } = setup(id => ({ ok: false, code: id === 'id1' ? 'BAD_REQUEST' : 'FORBIDDEN', error: 'm' + id }));
  await sync.enqueue('zapiszGodziny', {});
  await sync.enqueue('zapiszGodziny', {});
  await settle(sync);
  const l = await sync.list();
  assert.deepEqual(l.map(i => [i.status, i.error]), [['error', 'mid1'], ['error', 'mid2']]);
});

test('NetworkError przerywa, oba zostają pending', async () => {
  const { sync, calls } = setup(() => { throw new NetworkError(); });
  await seed();
  await settle(sync);
  assert.equal(calls.length, 1);
  assert.deepEqual((await sync.list()).map(i => i.status), ['pending', 'pending']);
});

for (const code of ['AUTH', 'SERVER', 'LOCKED']) {
  test(`${code} przerywa i zachowuje element`, async () => {
    const { sync, calls } = setup(() => ({ ok: false, code, error: 'x' }));
    await seed();
    await settle(sync);
    assert.equal(calls.length, 1);
    assert.deepEqual((await sync.list()).map(i => i.status), ['pending', 'pending']);
  });
}

test('elementy error są pomijane we flush', async () => {
  const { sync, calls } = setup(() => ({ ok: true }));
  await store.outboxAdd({ clientId: 'e', action: 'zapiszGodziny', args: {}, createdAt: 1, status: 'error', error: 'x' });
  await sync.flush();
  assert.equal(calls.length, 0);
  assert.equal((await sync.list()).length, 1);
});

test('równoległe flush() wysyłają element raz', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const { sync, calls } = setup(async () => { await gate; return { ok: true }; });
  await store.outboxAdd({ clientId: 'a', action: 'zapiszGodziny', args: {}, createdAt: 1, status: 'pending' });
  const p1 = sync.flush();
  const p2 = sync.flush();
  release();
  await Promise.all([p1, p2]);
  assert.equal(calls.length, 1);
});

test('enqueue w trakcie flush nie ginie (dirty -> ponowny przebieg)', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const { sync, calls } = setup(async id => { if (id === 'a') await gate; return { ok: true }; });
  await store.outboxAdd({ clientId: 'a', action: 'zapiszGodziny', args: {}, createdAt: 1, status: 'pending' });
  const p1 = sync.flush();
  await new Promise(r => setTimeout(r, 20)); // flush utknął na 'a'
  await sync.enqueue('zapiszUrlop', {});
  release();
  await p1;
  assert.deepEqual(calls.map(c => c.clientId), ['a', 'id1']);
  assert.deepEqual(await sync.list(), []);
});

test('enqueue zwraca item bez czekania na sieć', async () => {
  const never = new Promise(() => {});
  const { sync } = setup(() => never);
  const it = await sync.enqueue('zapiszGodziny', { a: 1 });
  assert.equal(it.clientId, 'id1');
  assert.equal(it.status, 'pending');
  assert.deepEqual(it.args, { a: 1 });
  assert.equal((await sync.list()).length, 1);
});

test('enqueue nie powoduje unhandled rejection gdy flush się wywali', async () => {
  const unhandled = [];
  const h = e => unhandled.push(e);
  process.on('unhandledRejection', h);
  const { sync } = setup(() => { throw new Error('boom'); });
  await sync.enqueue('zapiszGodziny', {});
  await new Promise(r => setTimeout(r, 50));
  process.off('unhandledRejection', h);
  assert.equal(unhandled.length, 0);
  assert.equal((await sync.list()).length, 1);
});

test('replace usuwa element error i kolejkuje nowy pending', async () => {
  const { sync } = setup(id => id === 'id1' ? { ok: false, code: 'REJECTED', error: 'zle' } : { ok: false, code: 'SERVER', error: 's' });
  await sync.enqueue('zapiszWyjscie', { v: 1 });
  await settle(sync);
  assert.equal((await sync.list())[0].status, 'error');
  const n = await sync.replace('id1', 'zapiszWyjscie', { v: 2 });
  await settle(sync);
  const l = await sync.list();
  assert.equal(l.length, 1);
  assert.equal(l[0].clientId, n.clientId);
  assert.equal(l[0].status, 'pending');
  assert.deepEqual(l[0].args, { v: 2 });
});

test('discard usuwa element', async () => {
  const { sync } = setup(() => ({ ok: false, code: 'SERVER' }));
  const it = await sync.enqueue('zapiszGodziny', {});
  await sync.discard(it.clientId);
  assert.deepEqual(await sync.list(), []);
});

test('onChange dostaje aktualną listę po każdej zmianie', async () => {
  const { sync, changes } = setup(() => ({ ok: true }));
  await sync.enqueue('zapiszGodziny', {});
  await settle(sync);
  assert.ok(changes.length >= 2);
  assert.equal(changes[0].length, 1);
  assert.equal(changes[0][0].status, 'pending');
  assert.deepEqual(changes.at(-1), []);
});

function gated(codeFor) {
  const gates = {};
  const calls = [];
  const api = {
    async call(action, args, { clientId }) {
      calls.push(clientId);
      if (clientId === 'a') await new Promise(r => { gates.release = r; gates.started = true; });
      return codeFor(clientId);
    },
  };
  return { api, gates, calls };
}
const seedAB = async () => {
  await store.outboxAdd({ clientId: 'a', action: 'zapiszGodziny', args: {}, createdAt: 1, status: 'pending' });
  await store.outboxAdd({ clientId: 'b', action: 'zapiszGodziny', args: {}, createdAt: 2, status: 'pending' });
};
const tick = () => new Promise(r => setTimeout(r, 20));

test('discard późniejszego pending w trakcie wysyłki wcześniejszego: nigdy wysłany', async () => {
  const { api, gates, calls } = gated(() => ({ ok: true }));
  const sync = createSync({ store, api, newId: () => 'x' });
  await seedAB();
  const p = sync.flush();
  await tick();
  await sync.discard('b');
  gates.release();
  await p;
  assert.deepEqual(calls, ['a']);
  assert.deepEqual(await sync.list(), []);
});

test('discard elementu w locie, potem REJECTED: nie wskrzesza', async () => {
  const { api, gates } = gated(() => ({ ok: false, code: 'REJECTED', error: 'zle' }));
  const sync = createSync({ store, api, newId: () => 'x' });
  await store.outboxAdd({ clientId: 'a', action: 'zapiszGodziny', args: {}, createdAt: 1, status: 'pending' });
  const p = sync.flush();
  await tick();
  await sync.discard('a');
  gates.release();
  await p;
  assert.deepEqual(await sync.list(), []);
});

test('replace elementu w locie, potem REJECTED: zostaje tylko nowy', async () => {
  const { api, gates } = gated(id => id === 'a' ? { ok: false, code: 'REJECTED', error: 'zle' } : { ok: false, code: 'SERVER' });
  const sync = createSync({ store, api, newId: () => 'new1' });
  await store.outboxAdd({ clientId: 'a', action: 'zapiszGodziny', args: {}, createdAt: 1, status: 'pending' });
  const p = sync.flush();
  await tick();
  await sync.replace('a', 'zapiszGodziny', { v: 2 });
  gates.release();
  await p;
  await sync.flush();
  assert.deepEqual((await sync.list()).map(i => i.clientId), ['new1']);
});
