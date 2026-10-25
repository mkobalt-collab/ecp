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
    // Pierwsze utworzenie (normalnie robi je apiSetup): odczyt po zapisie zawęża okno wyścigu
    // do wartości, która faktycznie została w Script Properties. Blokady tu nie biorę — apiSecret_
    // jest wołane także pod script lockiem (logowanie, zapisy), a ten nie jest reentrant.
    s = props.getProperty('API_SECRET') || s;
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

function apiUserAct_(fn) {
  // fn(user.id, args) — pracownikId zawsze z tokenu
  return { role: 'user', queued: false, run: function (user, args) { return fn(user.id, args); } };
}

function apiAdminAct_(fn) {
  return { role: 'admin', queued: false, run: function (user, args) { return fn(args, user); } };
}

function apiQueuedAct_(fn) {
  return {
    role: 'user',
    queued: true,
    run: function (user, args) {
      const d = {};
      Object.keys(args).forEach(function (k) { d[k] = args[k]; });
      d.pracownikId = user.id;
      return fn(d);
    },
  };
}

function apiWpisImieniaAdmina_(idWniosku, user) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Urlopy');
  if (!sheet) return;
  const last = sheet.getLastRow();
  if (last < 2) return;
  const ids = sheet.getRange(2, 10, last - 1, 1).getValues();
  const want = String(idWniosku).trim();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === want) {
      sheet.getRange(i + 2, 11).setValue((String(user.imie || '') + ' ' + String(user.nazwisko || '')).trim());
      return;
    }
  }
}

const API_ACTIONS_ = {
  login: { role: 'public', queued: false, run: null }, // obsługiwane w apiHandle_ (bez tokenu)
  init: {
    role: 'user',
    queued: false,
    run: function (user, args) {
      return { user: user, typyNieobecnosci: getTypyNieobecnosci(), typyWyjsc: getTypyWyjsc() };
    },
  },
  zapiszGodziny: apiQueuedAct_(function (d) { return zapiszGodziny(d); }),
  zapiszUrlop: apiQueuedAct_(function (d) { return zapiszUrlop(d); }),
  zapiszWyjscie: apiQueuedAct_(function (d) { return zapiszWyjscie(d); }),
  getMojeWpisy: apiUserAct_(function (id, a) { return getMojeWpisy(id, a.rok, a.miesiac); }),
  getSaldoWyjsc: apiUserAct_(function (id, a) { return getSaldoWyjsc(id); }),
  getUrlopySummary: apiUserAct_(function (id, a) { return getUrlopySummary(id); }),
  getBrakujaceDni: apiUserAct_(function (id, a) { return getBrakujaceDni(id); }),
  korygujGodziny: apiUserAct_(function (id, a) {
    return korygujGodziny(id, a.wiersz, { godzOd: a.godzOd, godzDo: a.godzDo, uwagi: a.uwagi });
  }),
  usunGodziny: apiUserAct_(function (id, a) { return usunGodziny(id, a.wiersz); }),
  usunNieobecnosc: apiUserAct_(function (id, a) { return usunNieobecnosc(id, a.wiersz); }),
  usunWyjscie: apiUserAct_(function (id, a) { return usunWyjscie(id, a.wiersz); }),
  mojaKarta: apiUserAct_(function (id, a) { return generujKartePracownika(id, a.rok, a.miesiac); }),

  getWnioskiOczekujace: apiAdminAct_(function (a) { return getWnioskiOczekujace(); }),
  ustawStatusUrlopu: apiAdminAct_(function (a, user) {
    const res = ustawStatusUrlopu(a.idWniosku, a.status);
    // anonimowe wdrożenie nie zna e-maila admina — wpisujemy imię i nazwisko z arkusza
    if (!res || res.ok !== false) apiWpisImieniaAdmina_(a.idWniosku, user);
    return res;
  }),
  pdfWniosku: apiAdminAct_(function (a) { return generujPdfZPanelu(a.idWniosku); }),
  getWyjsciaAdmin: apiAdminAct_(function (a) { return getWyjsciaAdmin(a.rok, a.miesiac); }),
  zmienStatusWyjscia: apiAdminAct_(function (a) { return zmienStatusWyjscia(a.wiersz, a.status); }),
  adminUsunWyjscie: apiAdminAct_(function (a) { return adminUsunWyjscie(a.wiersz); }),
  getNieobecnosciAdmin: apiAdminAct_(function (a) { return getNieobecnosciAdmin(a.rok, a.miesiac); }),
  adminUsunNieobecnosc: apiAdminAct_(function (a) { return adminUsunNieobecnosc(a.wiersz); }),
  getPracownicy: apiAdminAct_(function (a) { return getPracownicy(); }),
  getHistoriaPracownika: apiAdminAct_(function (a) { return getHistoriaPracownika(a.pracownikId, a.rok, a.miesiac); }),
  getRaportMiesieczny: apiAdminAct_(function (a) { return getRaportMiesieczny(a.rok, a.miesiac); }),
  pdfRaportMiesieczny: apiAdminAct_(function (a) { return generujRaportMiesiecznyPdf(a.rok, a.miesiac); }),
  pdfKartyEwidencji: apiAdminAct_(function (a) { return generujKartyEwidencji(a.rok, a.miesiac); }),
  pdfNadgodziny: apiAdminAct_(function (a) { return generujRaportNadgodzinDoWeryfikacji(a.rok, a.miesiac); }),
  pdfWnioskiMiesiaca: apiAdminAct_(function (a) { return generujPdfWnioskowMiesiaca(a.rok, a.miesiac, a.pracownikId); }),
  pdfKsiegowosc: apiAdminAct_(function (a) { return generujRaportKsiegowosc(a.rok, a.miesiac); }),
  pdfZestawienie: apiAdminAct_(function (a) { return generujZestawienieNadgodzinUrlopy(a.rok, a.miesiac); }),
  pdfKartaPracownika: apiAdminAct_(function (a) { return generujKartePracownika(a.pracownikId, a.rok, a.miesiac); }),
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

// ---------- idempotencja (API_Log: A clientId, B czas, C pracownikId, D akcja, E wynik JSON) ----------

const API_LOG_SHEET_ = 'API_Log';
const API_LOG_HEADER_ = ['clientId', 'czas', 'pracownikId', 'akcja', 'wynik'];
const API_LOG_MAX_AGE_MS_ = 60 * 24 * 60 * 60 * 1000;

function apiRunQueued_(clientId, action, user, run, nowMs) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(API_LOG_SHEET_);
  if (!sheet) throw new Error('Brak arkusza API_Log — uruchom apiSetup().');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000); // przy przekroczeniu rzuca wyjątek -> SERVER w routerze
  try {
    const last = sheet.getLastRow();
    if (last >= 2) {
      const ids = sheet.getRange(2, 1, last - 1, 1).getValues(); // tylko kolumna A
      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === clientId) return JSON.parse(sheet.getRange(i + 2, 5).getValue());
      }
    }
    const resp = run();
    sheet.appendRow([clientId, new Date(nowMs), user.id, action, JSON.stringify(resp)]);
    return resp;
  } finally {
    lock.releaseLock();
  }
}

// ---------- konfiguracja (uruchom ręcznie raz z edytora) ----------

function apiSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const prac = ss.getSheetByName(API_SHEET_PRAC_);
  if (prac && String(prac.getRange(1, 7).getValue()).trim() === '') prac.getRange(1, 7).setValue('Rola');
  let log = ss.getSheetByName(API_LOG_SHEET_);
  if (!log) log = ss.insertSheet(API_LOG_SHEET_);
  if (log.getLastRow() === 0) log.appendRow(API_LOG_HEADER_);
  log.hideSheet();
  apiSecret_();
  const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'apiLogCleanup'; });
  if (!has) ScriptApp.newTrigger('apiLogCleanup').timeBased().everyDays(1).atHour(3).create();
}

function apiLogCleanup(nowMs) {
  nowMs = typeof nowMs === 'number' ? nowMs : Date.now();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(API_LOG_SHEET_);
  if (!sheet) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const last = sheet.getLastRow();
    if (last < 2) return;
    const times = sheet.getRange(2, 2, last - 1, 1).getValues();
    const cutoff = nowMs - API_LOG_MAX_AGE_MS_;
    for (let i = times.length - 1; i >= 0; i--) { // od dołu, żeby numery wierszy się nie przesuwały
      const t = new Date(times[i][0]).getTime();
      if (!isNaN(t) && t < cutoff) sheet.deleteRow(i + 2);
    }
  } finally {
    lock.releaseLock();
  }
}

function apiWylogujWszystkich() {
  // nowy sekret unieważnia wszystkie wydane tokeny
  PropertiesService.getScriptProperties().setProperty('API_SECRET', Utilities.getUuid() + Utilities.getUuid());
}

// ---------- router ----------

function apiErr_(code, error) {
  return { ok: false, code: code, error: error };
}

function apiRunDef_(def, user, args) {
  const result = def.run(user, args);
  if (result && result.ok === false) return apiErr_('REJECTED', result.error || 'Operacja odrzucona.');
  return { ok: true, data: apiSerialize_(result) };
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

    if (def.queued) {
      // clientId = klucz idempotencji; nie trafia do funkcji GS
      const clientId = req.clientId !== undefined ? req.clientId : args.clientId;
      delete args.clientId;
      if (typeof clientId !== 'string' || !clientId.trim()) return apiErr_('BAD_REQUEST', 'Brak identyfikatora zapisu.');
      return apiRunQueued_(clientId.trim(), req.action, user, function () { return apiRunDef_(def, user, args); }, nowMs);
    }
    return apiRunDef_(def, user, args);
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
