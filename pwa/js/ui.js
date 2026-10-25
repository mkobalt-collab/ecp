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
  const add = c => {
    if (Array.isArray(c)) c.forEach(add);
    else if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
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

const p2 = n => String(n).padStart(2, '0');
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
