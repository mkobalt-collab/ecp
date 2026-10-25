// Silnik synchronizacji: kolejka offline (outbox) -> API.
import { NetworkError } from './api.js';

const FATAL_ITEM = new Set(['REJECTED', 'BAD_REQUEST', 'FORBIDDEN']);

export function createSync({ store, api, onChange = () => {}, newId = () => crypto.randomUUID() }) {
  let inflight = null;
  let dirty = false;
  let lastTs = 0;
  const results = new Map(); // clientId -> data z odpowiedzi ok (dla komunikatu po zapisie); ostatnie 20

  const list = () => store.outboxList();
  async function notify() {
    try { await onChange(await list()); } catch (e) { /* UI nie może psuć synchronizacji */ }
  }

  async function runOnce() {
    const items = (await list()).filter(i => i.status === 'pending');
    for (const snap of items) {
      const it = await store.outboxGet(snap.clientId);
      if (!it || it.status !== 'pending') continue; // usunięty/zmieniony w międzyczasie
      let res;
      try {
        res = await api.call(it.action, it.args, { clientId: it.clientId });
      } catch (e) {
        if (e instanceof NetworkError) return false;
        throw e;
      }
      if (res && res.ok) {
        results.set(it.clientId, res.data);
        if (results.size > 20) results.delete(results.keys().next().value);
        await store.outboxRemove(it.clientId);
        await notify();
      } else if (res && FATAL_ITEM.has(res.code)) {
        const cur = await store.outboxGet(it.clientId);
        if (cur) await store.outboxPut({ ...cur, status: 'error', error: res.error || 'Błąd zapisu.' });
        await notify();
      } else {
        return false; // AUTH, SERVER, LOCKED, nieznany: zatrzymaj, element zostaje
      }
    }
    return true;
  }

  function flush() {
    if (inflight) { dirty = true; return inflight; }
    inflight = (async () => {
      try {
        do {
          dirty = false;
          const completed = await runOnce();
          if (!completed) break;
        } while (dirty);
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  async function enqueue(action, args) {
    lastTs = Math.max(Date.now(), lastTs + 1);
    const item = { clientId: newId(), action, args, createdAt: lastTs, status: 'pending' };
    await store.outboxAdd(item);
    await notify();
    flush().catch(() => {});
    return item;
  }

  async function discard(clientId) {
    await store.outboxRemove(clientId);
    await notify();
  }

  async function replace(clientId, action, args) {
    await discard(clientId);
    return enqueue(action, args);
  }

  // Dane odpowiedzi serwera dla wysłanego elementu (jednorazowo) albo undefined.
  function takeResult(clientId) {
    const data = results.get(clientId);
    results.delete(clientId);
    return data;
  }

  return { enqueue, replace, discard, flush, list, takeResult };
}
