// Powłoka aplikacji: logowanie PIN, nagłówek, zakładki, synchronizacja, aktualizacje SW.
import * as store from './store.js';
import { createApi, NetworkError } from './api.js';
import { createSync } from './sync.js';
import { API_URL } from '../config.js';
import { el, toast, cachedLoad } from './ui.js';

const TABS = [
  { id: 'godziny', label: 'Godziny' },
  { id: 'urlop', label: 'Urlop' },
  { id: 'wyjscia', label: 'Wyjścia' },
  { id: 'wpisy', label: 'Wpisy' },
  { id: 'panel', label: 'Panel', admin: true },
];
const VIEWS = {
  godziny: () => import('./views/godziny.js'),
  urlop: () => import('./views/urlop.js'),
  wyjscia: () => import('./views/wyjscia.js'),
  wpisy: () => import('./views/wpisy.js'),
  panel: () => import('./views/panel.js'),
};

const root = document.getElementById('app');
let deviceId = null;
let pendingCount = 0;
let loginNote = '';
let current = null; // { tab, container }
let swReg = null;
let ui = {};        // referencje do elementów nagłówka

const ctx = {
  api: null, sync: null, store, user: null, init: null,
  online: () => navigator.onLine !== false,
  go: (tab, prefill) => go(tab, prefill),
};

async function getDeviceId() {
  if (!deviceId) {
    deviceId = await store.kvGet('deviceId');
    if (!deviceId) { deviceId = crypto.randomUUID(); await store.kvSet('deviceId', deviceId); }
  }
  return deviceId;
}

ctx.api = createApi({
  url: API_URL,
  getSession: async () => {
    const id = await getDeviceId();
    const s = await store.kvGet('session');
    return s && s.token ? { token: s.token, deviceId: id } : { deviceId: id };
  },
  onAuth: () => { handleAuthExpired().catch(() => {}); },
});

ctx.sync = createSync({ store, api: ctx.api, onChange: items => updateCounter(items) });
const flush = () => ctx.sync.flush().catch(() => {});

function updateCounter(items) {
  pendingCount = items.filter(i => i.status === 'pending' || i.status === 'error').length;
  if (ui.badge) {
    ui.badge.hidden = pendingCount === 0;
    ui.badge.textContent = `Do wysłania: ${pendingCount}`;
  }
}

// ---------- ekran PIN ----------
function showLogin(note = '') {
  current = null;
  ui = {};
  const msg = el('div', { class: note ? 'msg info' : '', role: 'alert' }, note);
  const input = el('input', { class: 'pin-input', type: 'password', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', maxlength: '8', 'aria-label': 'PIN', placeholder: '••••' });
  const btn = el('button', { class: 'btn', type: 'submit' }, 'Zaloguj');
  const form = el('form', { class: 'card', onsubmit: async e => {
    e.preventDefault();
    const pin = input.value.trim();
    if (!pin) return;
    btn.disabled = true;
    msg.className = '';
    msg.textContent = '';
    try {
      const res = await ctx.api.call('login', { pin });
      if (res.ok) { await onLoggedIn(res.data); return; }
      msg.className = 'msg err';
      msg.textContent = res.error || 'Nie udało się zalogować.';
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err instanceof NetworkError ? 'Brak połączenia. Logowanie wymaga internetu.' : 'Nie udało się zalogować.';
    }
    input.value = '';
    btn.disabled = false;
    input.focus();
  } }, el('div', { class: 'pin-label' }, 'Wpisz PIN'), input, btn, msg);
  root.replaceChildren(
    el('div', { class: 'login-head' }, el('h1', null, 'Ewidencja czasu pracy'), el('p', null, 'GROUP-ON-VET')),
    el('div', { class: 'login-wrap' }, form));
  input.focus();
}

async function onLoggedIn({ token, user }) {
  const last = await store.kvGet('lastUserId');
  if (last && last !== user.id) { // inny użytkownik na tym urządzeniu — nie mieszamy danych i kolejki
    const queued = await ctx.sync.list().catch(() => []);
    if (queued.length && !confirm(`Na urządzeniu są niewysłane wpisy innego użytkownika (${queued.length}). Zalogowanie usunie je. Kontynuować?`)) {
      showLogin('Logowanie anulowane — najpierw zaloguj się jako poprzedni użytkownik, aby wysłać wpisy.');
      return;
    }
    const id = await getDeviceId();
    await store.clearAll();
    await store.kvSet('deviceId', id);
  }
  await store.kvSet('session', { token, user });
  await store.kvSet('lastUserId', user.id);
  await startApp({ token, user });
  flush();
}

async function handleAuthExpired() {
  if (!(await store.kvGet('session'))) return;
  await store.kvDel('session'); // kolejka i cache zostają nietknięte
  showLogin('Sesja wygasła — wpisz PIN.');
}

async function logout() {
  const items = await ctx.sync.list();
  if (items.length && !confirm(`Masz ${items.length} niewysłanych wpisów. Wylogowanie je usunie. Kontynuować?`)) return;
  const id = await getDeviceId();
  await store.clearAll();
  await store.kvSet('deviceId', id);
  ctx.user = null; ctx.init = null;
  showLogin();
}

// ---------- ekran główny ----------
async function loadInit(session) {
  ctx.user = session.user;
  ctx.init = { user: session.user, typyNieobecnosci: [], typyWyjsc: [] };
  await cachedLoad({ key: 'init', action: 'init', ctx, render: data => {
    ctx.init = data;
    if (data.user) {
      ctx.user = data.user;
      if (data.user.imie !== session.user.imie || data.user.rola !== session.user.rola) {
        store.kvSet('session', { ...session, user: data.user }).catch(() => {});
        if (ui.who) ui.who.textContent = whoName();
      }
    }
  } }).catch(() => {});
}

const whoName = () => `${ctx.user.imie || ''} ${ctx.user.nazwisko || ''}`.trim();

async function startApp(session) {
  await loadInit(session);
  if (!(await store.kvGet('session'))) return; // AUTH w trakcie init -> ekran PIN już pokazany
  buildShell();
  updateCounter(await ctx.sync.list().catch(() => []));
  go(TABS[0].id);
}

function buildShell() {
  const isAdmin = ctx.user.rola === 'admin';
  ui.who = el('div', { class: 'who' }, whoName());
  ui.badge = el('span', { class: 'badge', hidden: true });
  ui.offline = el('span', { class: 'offline', hidden: ctx.online() }, 'Offline');
  ui.sync = el('button', { class: 'hbtn', type: 'button', onclick: manualSync }, 'Synchronizuj');
  const menu = el('div', { class: 'menu', hidden: true }, el('button', { type: 'button', onclick: () => { menu.hidden = true; logout().catch(() => toast('Nie udało się wylogować.', 'err')); } }, 'Wyloguj'));
  const menuBtn = el('button', { class: 'hbtn', type: 'button', 'aria-label': 'Menu', onclick: e => { e.stopPropagation(); menu.hidden = !menu.hidden; } }, '⋮');
  document.addEventListener('click', () => { menu.hidden = true; });
  ui.update = el('div', { class: 'update-bar', hidden: true });
  ui.main = el('main', { class: 'content' });
  ui.tabs = el('nav', { class: 'tabbar' }, TABS.filter(t => !t.admin || isAdmin).map(t =>
    el('button', { class: 'tab', type: 'button', 'data-tab': t.id, onclick: () => go(t.id) }, t.label)));
  root.replaceChildren(
    el('header', { class: 'header' }, ui.who, ui.offline, ui.badge, ui.sync, el('div', { class: 'menu-wrap' }, menuBtn, menu)),
    ui.update, ui.main, ui.tabs);
  offerUpdate();
}

async function go(tab, prefill) {
  if (!ui.main) return;
  const def = TABS.find(t => t.id === tab);
  if (!def || (def.admin && ctx.user.rola !== 'admin')) return;
  const container = el('div');
  current = { tab, container };
  ui.main.replaceChildren(container);
  ui.tabs.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  window.scrollTo(0, 0);
  try {
    const mod = await VIEWS[tab]();
    if (current && current.container === container) await mod.mount(container, ctx, prefill);
  } catch (e) {
    console.error(e);
    container.append(el('div', { class: 'empty-note' }, 'Nie udało się wczytać widoku.'));
  }
}

async function manualSync() {
  if (!ctx.online()) { toast('Brak połączenia.', 'err'); return; }
  ui.sync.disabled = true;
  try { await ctx.sync.flush(); } catch (e) { /* stan pokaże licznik */ }
  ui.sync.disabled = false;
  if (!ui.main) return;
  if (pendingCount === 0) toast('Wszystko wysłane.'); else toast('Część wpisów czeka na wysłanie.', 'err');
  if (current) go(current.tab);
}

// ---------- start ----------
function offerUpdate() {
  const waiting = swReg && swReg.waiting;
  if (!waiting || !navigator.serviceWorker.controller || !ui.update) return;
  ui.update.replaceChildren('Nowa wersja — odśwież ', el('button', { type: 'button', onclick: () => waiting.postMessage('skipWaiting') }, 'Odśwież'));
  ui.update.hidden = false;
}

function setupSw() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then(reg => {
    swReg = reg;
    offerUpdate();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') offerUpdate(); });
    });
  }).catch(e => console.warn('SW:', e));
}

async function main() {
  setupSw();
  window.addEventListener('online', () => { if (ui.offline) ui.offline.hidden = true; flush(); });
  window.addEventListener('offline', () => { if (ui.offline) ui.offline.hidden = false; });
  setInterval(() => { if (pendingCount > 0 && ui.main) flush(); }, 60000);
  try {
    const session = await store.kvGet('session');
    if (session && session.token && session.user) { await startApp(session); flush(); }
    else showLogin();
  } catch (e) {
    console.error(e);
    root.replaceChildren(el('div', { class: 'login-wrap' }, el('div', { class: 'msg err' }, 'Nie udało się uruchomić aplikacji (brak dostępu do pamięci przeglądarki).')));
  }
}
main();
