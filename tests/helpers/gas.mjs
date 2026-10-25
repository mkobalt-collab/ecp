// Atrapy usług Google Apps Script + loadApi(): uruchamia apps-script/api.gs w node:vm.
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../apps-script/api.gs');

function toBuf(input) {
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  return Buffer.from(Array.from(input, (b) => b & 255));
}
// GAS zwraca bajty ze znakiem (-128..127)
function toSigned(buf) {
  return Array.from(buf, (b) => (b > 127 ? b - 256 : b));
}
const pad2 = (n) => String(n).padStart(2, '0');

function makeSheet(rows) {
  const sheet = {
    _rows: rows,
    _hidden: false,
    getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
    getLastRow: () => rows.length,
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValue: () => (rows[r - 1] || [])[c - 1] ?? '',
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) row.push((rows[r - 1 + i] || [])[c - 1 + j] ?? '');
            out.push(row);
          }
          return out;
        },
        setValue(v) {
          while (rows.length < r) rows.push([]);
          rows[r - 1][c - 1] = v;
        },
        setValues(vals) {
          vals.forEach((row, i) => {
            while (rows.length < r + i) rows.push([]);
            row.forEach((v, j) => { rows[r - 1 + i][c - 1 + j] = v; });
          });
        },
      };
    },
    appendRow: (row) => { rows.push(row.slice()); },
    hideSheet: () => { sheet._hidden = true; },
    deleteRow: (i) => { rows.splice(i - 1, 1); },
  };
  return sheet;
}

export function loadApi({ sheets = {}, gsFns = {}, props = {}, now = Date.UTC(2026, 9, 25, 12, 0, 0) } = {}) {
  const clock = { now };
  const calls = {};
  const triggers = [];
  const sheetObjs = {};
  for (const [name, rows] of Object.entries(sheets)) sheetObjs[name] = makeSheet(rows);
  const propStore = { ...props };
  const cacheStore = new Map(); // key -> {v, exp}
  const lockState = { held: false, failTry: false, failWait: false, events: [] };

  const ss = {
    getSheetByName: (n) => sheetObjs[n] || null,
    insertSheet(n) { sheetObjs[n] = makeSheet([]); return sheetObjs[n]; },
  };

  const sandbox = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in propStore ? propStore[k] : null),
        setProperty: (k, v) => { propStore[k] = String(v); },
        deleteProperty: (k) => { delete propStore[k]; },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get(k) {
          const e = cacheStore.get(k);
          if (!e) return null;
          if (e.exp <= clock.now) { cacheStore.delete(k); return null; }
          return e.v;
        },
        put(k, v, ttl = 600) { cacheStore.set(k, { v: String(v), exp: clock.now + ttl * 1000 }); },
        remove(k) { cacheStore.delete(k); },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: (ms) => {
          lockState.events.push('wait:' + ms);
          if (lockState.failWait) throw new Error('Lock timeout');
          lockState.held = true;
        },
        tryLock: (ms) => {
          lockState.events.push('try:' + ms);
          if (lockState.failTry) return false;
          lockState.held = true;
          return true;
        },
        releaseLock: () => { lockState.events.push('release'); lockState.held = false; },
        hasLock: () => lockState.held,
      }),
    },
    Utilities: {
      computeHmacSha256Signature: (value, key) =>
        toSigned(crypto.createHmac('sha256', toBuf(key)).update(toBuf(value)).digest()),
      base64EncodeWebSafe: (input) => toBuf(input).toString('base64url') + '=='.slice(0, (4 - (toBuf(input).toString('base64url').length % 4)) % 4),
      base64DecodeWebSafe: (s) => toSigned(Buffer.from(String(s), 'base64url')),
      newBlob: (bytes) => ({ getDataAsString: () => toBuf(bytes).toString('utf8') }),
      formatDate(date, tz, pattern) {
        const map = {
          yyyy: String(date.getFullYear()), MM: pad2(date.getMonth() + 1), dd: pad2(date.getDate()),
          HH: pad2(date.getHours()), mm: pad2(date.getMinutes()), ss: pad2(date.getSeconds()),
        };
        return pattern.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, (t, lit) => (lit !== undefined ? lit : map[t]));
      },
      getUuid: () => crypto.randomUUID(),
      sleep: () => {},
    },
    Session: { getScriptTimeZone: () => 'Europe/Warsaw' },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput(text) {
        return { _text: text, _mime: null, getContent() { return this._text; }, setMimeType(m) { this._mime = m; return this; } };
      },
    },
    ScriptApp: {
      newTrigger(fn) {
        const t = { fn, kind: null, getHandlerFunction: () => fn };
        const b = {
          timeBased() { t.kind = 'time'; return b; },
          everyDays(n) { t.days = n; return b; },
          atHour(h) { t.hour = h; return b; },
          create() { triggers.push(t); return t; },
        };
        return b;
      },
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger(t) { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
    },
  };
  for (const [name, fn] of Object.entries(gsFns)) {
    sandbox[name] = (...args) => { (calls[name] ||= []).push(args); return fn(...args); };
  }

  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(API_PATH, 'utf8'), ctx, { filename: 'api.gs' });

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  return {
    ctx, calls, triggers, clock, lock: lockState, sheets: sheetObjs, props: propStore, cache: cacheStore,
    eval: (code) => vm.runInContext(code, ctx),
    // woła globalną funkcję/const z api.gs; wynik klonowany do obiektów z głównego realmu
    call: (fn, ...args) => clone(vm.runInContext(fn, ctx)(...args)),
    raw: (fn, ...args) => vm.runInContext(fn, ctx)(...args),
    handle: (req, nowMs) => clone(vm.runInContext('apiHandle_', ctx)(req, nowMs ?? clock.now)),
  };
}
