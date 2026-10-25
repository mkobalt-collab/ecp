/**
 * api.gs — JSON API (doPost) dla aplikacji PWA "Ewidencja czasu pracy".
 * Dodaje tylko doPost i nazwy z prefiksem "api" / "API_". Istniejący kod GS pozostaje bez zmian.
 * Wszystkie pliki projektu GAS dzielą jeden zakres globalny — nie redeklarować nazw z GS.
 */

const API_SHEET_PRAC_ = 'Pracownicy';
const API_TOKEN_TTL_MS_ = 30 * 24 * 60 * 60 * 1000;
const API_MSG_SERVER_ = 'Błąd serwera. Spróbuj ponownie.';

// ---------- sekret i token ----------

function apiSecret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('API_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('API_SECRET', s);
  }
  return s;
}

function apiSign_(payloadB64) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payloadB64, apiSecret_()));
}

function apiMakeToken_(id, nowMs) {
  // JSON z liczbami jest czysto ASCII
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ id: id, exp: nowMs + API_TOKEN_TTL_MS_ }));
  return payload + '.' + apiSign_(payload);
}

function apiSafeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function apiVerifyToken_(token, nowMs) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    if (!apiSafeEqual_(apiSign_(parts[0]), parts[1])) return null;
    const json = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    const p = JSON.parse(json);
    if (!p || typeof p.exp !== 'number' || nowMs > p.exp) return null;
    return p.id === undefined ? null : p.id;
  } catch (err) {
    return null;
  }
}

// ---------- użytkownik (rola czytana z arkusza przy każdym żądaniu) ----------

function apiGetUser_(id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(API_SHEET_PRAC_);
  if (!sheet) return null;
  const rows = sheet.getDataRange().getValues();
  const want = String(id).trim();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]).trim() === want && want !== '') {
      return {
        id: r[0],
        imie: r[1],
        nazwisko: r[2],
        stanowisko: r[4],
        rola: String(r[6] === undefined || r[6] === null ? '' : r[6]).trim().toLowerCase() === 'admin' ? 'admin' : 'pracownik',
      };
    }
  }
  return null;
}

// ---------- serializacja ----------

function apiIsDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function apiSerialize_(v) {
  if (v === null || v === undefined) return null;
  if (apiIsDate_(v)) {
    if (isNaN(v.getTime())) return null;
    const tz = Session.getScriptTimeZone();
    const midnight = v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0 && v.getMilliseconds() === 0;
    return Utilities.formatDate(v, tz, midnight ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss");
  }
  if (Array.isArray(v)) return v.map(apiSerialize_);
  if (typeof v === 'object') {
    const out = {};
    Object.keys(v).forEach(function (k) { out[k] = apiSerialize_(v[k]); });
    return out;
  }
  return v;
}

// ---------- akcje ----------
// nazwa -> { role: 'user'|'admin', queued: boolean, run: (user, args) => any }
// role 'user': pracownikId z klienta jest ignorowany (zawsze z tokenu).
// role 'admin': dozwolone tylko dla admina, może przekazać docelowy pracownikId.

const API_ACTIONS_ = {
  login: { role: 'public', queued: false, run: null }, // obsługiwane w apiHandle_ (bez tokenu)
  init: {
    role: 'user',
    queued: false,
    run: function (user, args) {
      return { user: user, typyNieobecnosci: getTypyNieobecnosci(), typyWyjsc: getTypyWyjsc() };
    },
  },
  getMojeWpisy: {
    role: 'user',
    queued: false,
    run: function (user, args) {
      return getMojeWpisy(user.id, args.rok, args.miesiac);
    },
  },
};

// ---------- logowanie i blokada PIN ----------

const API_FAIL_LIMIT_DEV_ = 5;
const API_FAIL_LIMIT_ALL_ = 30;
const API_FAIL_TTL_S_ = 900;
const API_MSG_LOCKED_ = 'Zbyt wiele nieudanych prób. Spróbuj ponownie za 15 minut.';

function apiCacheInt_(cache, key) {
  const n = parseInt(cache.get(key), 10);
  return isNaN(n) ? 0 : n;
}

function apiNormDevice_(deviceId) {
  // klucze CacheService mają limit 250 znaków
  const d = typeof deviceId === 'string' ? deviceId.trim() : '';
  return d ? d.substring(0, 100) : 'brak';
}

function apiLogin_(args, deviceId, nowMs) {
  // sekcja krytyczna: żądania GAS idą równolegle, a liczniki muszą być atomowe
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return apiErr_('SERVER', 'Serwer jest zajęty. Spróbuj ponownie.');
  try {
    return apiLoginLocked_(args, deviceId, nowMs);
  } finally {
    lock.releaseLock();
  }
}

function apiLoginLocked_(args, deviceId, nowMs) {
  const cache = CacheService.getScriptCache();
  const devKey = 'api_fail_dev_' + apiNormDevice_(deviceId);
  const allKey = 'api_fail_all';
  // blokada sprawdzana przed weryfikacją PIN-u
  if (apiCacheInt_(cache, devKey) >= API_FAIL_LIMIT_DEV_ || apiCacheInt_(cache, allKey) >= API_FAIL_LIMIT_ALL_) {
    return apiErr_('LOCKED', API_MSG_LOCKED_);
  }
  const pin = args && args.pin !== undefined && args.pin !== null ? String(args.pin) : '';
  const row = pin ? weryfikujPin(pin) : null;
  const user = row ? apiGetUser_(row.id) : null;
  if (!user) {
    cache.put(devKey, String(apiCacheInt_(cache, devKey) + 1), API_FAIL_TTL_S_);
    cache.put(allKey, String(apiCacheInt_(cache, allKey) + 1), API_FAIL_TTL_S_);
    return apiErr_('REJECTED', 'Nieprawidłowy PIN.');
  }
  cache.remove(devKey);
  return { ok: true, data: { token: apiMakeToken_(user.id, nowMs), user: apiSerialize_(user) } };
}

// ---------- router ----------

function apiErr_(code, error) {
  return { ok: false, code: code, error: error };
}

function apiHandle_(req, nowMs) {
  nowMs = nowMs === undefined ? Date.now() : nowMs;
  if (!req || typeof req !== 'object' || typeof req.action !== 'string' ||
      !Object.prototype.hasOwnProperty.call(API_ACTIONS_, req.action)) {
    return apiErr_('BAD_REQUEST', 'Nieprawidłowe żądanie.');
  }
  const def = API_ACTIONS_[req.action];
  try {
    if (req.action === 'login') return apiLogin_(req.args, req.deviceId, nowMs);
    const id = apiVerifyToken_(req.token, nowMs);
    if (id === null) return apiErr_('AUTH', 'Zaloguj się ponownie.');
    const user = apiGetUser_(id);
    if (!user) return apiErr_('AUTH', 'Zaloguj się ponownie.');
    if (def.role === 'admin' && user.rola !== 'admin') return apiErr_('FORBIDDEN', 'Brak uprawnień.');

    const args = {};
    if (req.args && typeof req.args === 'object') {
      Object.keys(req.args).forEach(function (k) { args[k] = req.args[k]; });
    }
    if (def.role === 'user') delete args.pracownikId;

    const result = def.run(user, args);
    if (result && result.ok === false) return apiErr_('REJECTED', result.error || 'Operacja odrzucona.');
    return { ok: true, data: apiSerialize_(result) };
  } catch (err) {
    console.error('apiHandle_ ' + req.action + ': ' + (err && err.stack ? err.stack : err));
    return apiErr_('SERVER', API_MSG_SERVER_);
  }
}

function apiJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return apiJson_(apiErr_('BAD_REQUEST', 'Nieprawidłowe żądanie.'));
  }
  return apiJson_(apiHandle_(req));
}
