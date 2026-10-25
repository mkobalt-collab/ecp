import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../pwa/js/store.js';

beforeEach(() => store.clearAll());

const item = (clientId, createdAt) => ({ clientId, action: 'zapiszGodziny', args: {}, createdAt, status: 'pending' });

test('outboxList sortuje rosnąco po createdAt', async () => {
  await store.outboxAdd(item('c', 300));
  await store.outboxAdd(item('b', 200));
  await store.outboxAdd(item('a', 100));
  assert.deepEqual((await store.outboxList()).map(i => i.clientId), ['a', 'b', 'c']);
});

test('outboxPut zmienia status', async () => {
  await store.outboxAdd(item('a', 1));
  await store.outboxPut({ ...item('a', 1), status: 'error', error: 'zły zakres' });
  const [x] = await store.outboxList();
  assert.equal(x.status, 'error');
  assert.equal(x.error, 'zły zakres');
});

test('outboxRemove usuwa element', async () => {
  await store.outboxAdd(item('a', 1));
  await store.outboxAdd(item('b', 2));
  await store.outboxRemove('a');
  assert.deepEqual((await store.outboxList()).map(i => i.clientId), ['b']);
});

test('cacheSet/cacheGet zapisuje savedAt', async () => {
  assert.equal(await store.cacheGet('x'), undefined);
  const before = Date.now();
  await store.cacheSet('x', { a: 1 });
  const r = await store.cacheGet('x');
  assert.equal(r.key, 'x');
  assert.deepEqual(r.data, { a: 1 });
  assert.ok(r.savedAt >= before && r.savedAt <= Date.now());
});

test('kvSet/kvGet/kvDel', async () => {
  await store.kvSet('deviceId', 'abc');
  assert.equal(await store.kvGet('deviceId'), 'abc');
  await store.kvDel('deviceId');
  assert.equal(await store.kvGet('deviceId'), undefined);
});

test('clearAll czyści wszystkie magazyny', async () => {
  await store.outboxAdd(item('a', 1));
  await store.cacheSet('x', 1);
  await store.kvSet('k', 1);
  await store.clearAll();
  assert.deepEqual(await store.outboxList(), []);
  assert.equal(await store.cacheGet('x'), undefined);
  assert.equal(await store.kvGet('k'), undefined);
});
