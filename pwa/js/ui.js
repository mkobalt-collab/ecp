// Wspólne pomocniki UI.
const MIESIACE = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];

export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') node.value = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  appendAll(node, children);
  return node;
}

function appendAll(node, children) {
  for (const c of children) {
    if (Array.isArray(c)) appendAll(node, c);
    else if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// Zastępuje zawartość węzła (tablice spłaszczane, null/false pomijane, tekst jako text node).
export function fill(node, ...children) {
  node.replaceChildren();
  appendAll(node, children);
  return node;
}

export function toast(msg, type = 'ok') {
  const t = el('div', { class: 'toast ' + type, role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), type === 'err' ? 5000 : 3000);
}

// 'yyyy-MM-dd...' -> 'dd.MM.yyyy'
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
}

export const p2 = n => String(n).padStart(2, '0');
function fmtStamp(ts) {
  const d = new Date(ts);
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function monthPicker({ rok, miesiac, onChange }) {
  let r = rok, m = miesiac;
  const label = el('span', { class: 'label' });
  const paint = () => { label.textContent = `${MIESIACE[m - 1]} ${r}`; };
  const shift = d => {
    m += d;
    if (m < 1) { m = 12; r--; } else if (m > 12) { m = 1; r++; }
    paint();
    if (onChange) onChange({ rok: r, miesiac: m });
  };
  paint();
  const node = el('div', { class: 'month-picker' },
    el('button', { type: 'button', 'aria-label': 'Poprzedni miesiąc', onclick: () => shift(-1) }, '‹'),
    label,
    el('button', { type: 'button', 'aria-label': 'Następny miesiąc', onclick: () => shift(1) }, '›'));
  node.get = () => ({ rok: r, miesiac: m });
  return node;
}

/**
 * Ładuje dane z cache (jeśli są), potem z serwera; świeże dane zapisuje do cache.
 * render(data, {stale, note}) — `note` to gotowy element „Stan z … (offline)” (tylko dla danych z cache) lub null.
 * Gdy podano `container`, komunikat „Brak połączenia…” trafia do niego; inaczej toast.
 * Zwraca {data, fresh} (data = null gdy nic nie ma).
 */
export async function cachedLoad({ key, action, args = {}, ctx, render, container }) {
  const cached = await ctx.store.cacheGet(key).catch(() => undefined);
  let data = null;
  if (cached) {
    data = cached.data;
    const note = el('div', { class: 'stale-note' }, `Stan z ${fmtStamp(cached.savedAt)} (offline)`);
    render(data, { stale: true, note });
  }
  try {
    const res = await ctx.api.call(action, args);
    if (res.ok) {
      data = res.data;
      await ctx.store.cacheSet(key, data).catch(() => {});
      render(data, { stale: false, note: null });
      return { data, fresh: true };
    }
    if (res.code !== 'AUTH') toast(res.error || 'Nie udało się pobrać danych.', 'err');
  } catch (e) {
    if (e && e.name === 'NetworkError') {
      if (!cached) {
        const msg = 'Brak połączenia — brak zapisanych danych.';
        if (container) container.append(el('div', { class: 'empty-note' }, msg)); else toast(msg, 'err');
      }
    } else throw e;
  }
  return { data, fresh: false };
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

// 1.5 -> '1h 30min'
export function fmtH(h) {
  const neg = h < 0;
  h = Math.abs(Number(h) || 0);
  let g = Math.floor(h), m = Math.round((h - g) * 60);
  if (m === 60) { g++; m = 0; }
  return (neg ? '-' : '') + g + 'h' + (m ? ' ' + m + 'min' : '');
}

// Pole formularza: etykieta + kontrolka (label otacza kontrolkę).
export const field = (label, control) => el('label', { class: 'fgroup' }, el('span', { class: 'flabel' }, label), control);

export function statusBadge(status) {
  const [txt, cls] = status === 'Zatwierdzone' ? ['✓ zatw.', 'ok'] : status === 'Odrzucone' ? ['✕ odrz.', 'bad'] : ['⏳ oczek.', 'wait'];
  return el('span', { class: 'status ' + cls }, txt);
}

// getMojeWpisy z cache per miesiąc (wspólne dla widoków Urlop i Wpisy).
export const loadWpisy = (ctx, rok, miesiac, render, container) =>
  cachedLoad({ key: `wpisy:${rok}-${miesiac}`, action: 'getMojeWpisy', args: { rok, miesiac }, ctx, render, container });

/**
 * Zapis przez kolejkę: save(args) -> 'sent' | 'queued' | 'error'. Pokazuje toast.
 * Decyzja online/offline: czy element nadal czeka po próbie natychmiastowej wysyłki.
 * prefill = {clientId} (poprawa wpisu ❗) -> sync.replace; po błędzie serwera kolejny zapis znów zastępuje ten element.
 */
export function createSaver(ctx, action, prefill) {
  let clientId = prefill ? prefill.clientId : null;
  return async function save(args) {
    let item;
    try {
      item = clientId ? await ctx.sync.replace(clientId, action, args) : await ctx.sync.enqueue(action, args);
    } catch (e) { toast('Nie udało się zapisać w telefonie.', 'err'); return 'error'; }
    clientId = null;
    try { await ctx.sync.flush(); } catch (e) { /* element zostaje w kolejce */ }
    const cur = (await ctx.sync.list().catch(() => [])).find(i => i.clientId === item.clientId);
    if (!cur) { toast('Zapisano'); return 'sent'; }
    if (cur.status === 'error') { clientId = cur.clientId; toast(cur.error || 'Nie udało się zapisać.', 'err'); return 'error'; }
    toast('Zapisano w telefonie — wyślę po odzyskaniu internetu');
    return 'queued';
  };
}

// Wspólny szkielet formularza zapisu: przycisk blokowany na czas zapisu, powrót do Wpisów po poprawie wpisu z kolejki.
export function saveForm({ ctx, prefill, action, title, submitLabel, color, controls, collect, validate, reset, onSaved }) {
  const save = createSaver(ctx, action, prefill);
  const msg = el('div', { class: 'msg err', role: 'alert', hidden: true });
  const btn = el('button', { class: 'btn', type: 'submit', style: color ? `background:${color}` : null }, submitLabel);
  const form = el('form', { class: 'card', novalidate: true, onsubmit: async e => {
    e.preventDefault();
    const args = collect();
    const bad = validate(args);
    msg.hidden = !bad;
    msg.textContent = bad || '';
    if (bad) return;
    btn.disabled = true;
    const out = await save(args);
    btn.disabled = false;
    if (out === 'error') return;
    if (prefill) { ctx.go('wpisy'); return; }
    reset();
    if (onSaved) onSaved(out);
  } },
  el('div', { class: 'form-title' }, title),
  prefill && prefill.error ? el('div', { class: 'msg err' }, `Serwer odrzucił wpis: ${prefill.error}`) : null,
  controls, btn, msg);
  return form;
}
