// Klient API Apps Script (POST text/plain JSON).
export class NetworkError extends Error {
  constructor(message = 'Brak połączenia z serwerem.') {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * @param {object} o
 * @param {string} o.url
 * @param {typeof fetch} [o.fetchFn]
 * @param {() => Promise<{token?: string, deviceId?: string}|null>} o.getSession
 *   Może zwrócić null (niezalogowany); `login` potrzebuje deviceId także bez tokenu,
 *   więc getSession ma zwracać deviceId nawet gdy tokenu jeszcze nie ma.
 * @param {() => void} o.onAuth wołane po odpowiedzi code:'AUTH'
 */
export function createApi({ url, fetchFn = (...a) => fetch(...a), getSession, onAuth }) {
  async function call(action, args = {}, { clientId } = {}) {
    const s = (await getSession()) || {};
    const body = { action, args, token: s.token, deviceId: s.deviceId, clientId };
    const ms = action.startsWith('pdf') || action === 'mojaKarta' ? 60000 : 30000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    let res;
    try {
      res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (res.status !== 200) throw new NetworkError();
      res = await res.json();
    } catch (e) {
      if (e instanceof NetworkError) throw e;
      throw new NetworkError(e && e.name === 'AbortError' ? 'Przekroczono czas oczekiwania.' : 'Brak połączenia z serwerem.');
    } finally {
      clearTimeout(timer);
    }
    if (!res || typeof res !== 'object') throw new NetworkError();
    if (res.code === 'AUTH') onAuth && onAuth();
    return res;
  }
  return { call };
}
