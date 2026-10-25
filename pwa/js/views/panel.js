import { el, fill, toast, fmtDate, fmtH, monthPicker, statusBadge, field } from '../ui.js';
import { openPdf } from '../pdf.js';
import { NetworkError } from '../api.js';

const OFFLINE_MSG = 'Panel administratora wymaga internetu.';
const RAPORTY = [
  ['Raport miesięczny', 'pdfRaportMiesieczny'], ['Karty ewidencji', 'pdfKartyEwidencji'], ['Nadgodziny do weryfikacji', 'pdfNadgodziny'],
  ['Wnioski miesiąca', 'pdfWnioskiMiesiaca'], ['Księgowość', 'pdfKsiegowosc'], ['Zestawienie', 'pdfZestawienie'],
];
const sbtn = (txt, onclick, props = {}, danger = false) => el('button', { class: 'sbtn' + (danger ? ' danger' : ''), type: 'button', onclick, ...props }, txt);
const note = txt => el('div', { class: 'muted' }, txt);

// Wywołanie API z komunikatem błędu; zwraca odpowiedź ok albo null.
async function call(ctx, action, args) {
  try {
    const res = await ctx.api.call(action, args);
    if (res.ok) return res;
    if (res.code !== 'AUTH') toast(res.error || 'Operacja nie powiodła się.', 'err');
  } catch (e) {
    if (e instanceof NetworkError) toast('Brak połączenia z serwerem.', 'err');
    else { console.error(e); toast('Nie udało się wykonać operacji.', 'err'); }
  }
  return null;
}

// Przycisk PDF: na czas generowania zablokowany z napisem „Generowanie…”.
function pdfButton(ctx, label, action, getArgs, cls = 'sbtn') {
  const btn = el('button', { class: cls, type: 'button', onclick: async () => {
    btn.disabled = true;
    btn.textContent = 'Generowanie…';
    try {
      const res = await call(ctx, action, getArgs());
      if (res) {
        if (res.data && res.data.ok !== false && res.data.base64) await openPdf(res.data);
        else toast((res.data && res.data.error) || 'Nie udało się wygenerować pliku.', 'err');
      }
    } catch (e) { console.error(e); toast('Nie udało się otworzyć pliku.', 'err'); }
    finally { btn.disabled = false; btn.textContent = label; }
  } }, label);
  return btn;
}

/**
 * Sekcja z listą z serwera. Akcje na wierszach (numery wierszy arkusza!) są zablokowane, dopóki lista nie jest świeża:
 * w trakcie zmiany i po niej aż do ponownego pobrania listy.
 */
function section(ctx, alive, { title, action, args = () => ({}), render }) {
  let data = null, fresh = false, busy = 0, seq = 0;
  const body = el('div');
  const locked = () => busy > 0 || !fresh;
  const paint = () => fill(body, data ? render(data, locked(), mutate) : note('Wczytywanie…'));
  async function load() {
    const mine = ++seq;
    fresh = false;
    paint();
    const res = await call(ctx, action, args());
    if (mine !== seq || !alive()) return;
    if (res) { data = res.data; fresh = true; } else if (!data) fill(body, note('Nie udało się wczytać.'));
    if (data) paint();
  }
  async function mutate(act, a, { confirmMsg, done } = {}) {
    if (locked() || (confirmMsg && !confirm(confirmMsg))) return;
    busy++;
    paint();
    try {
      const res = await call(ctx, act, a);
      if (res && done) done(res.data);
    } finally { busy--; }
    load(); // numery wierszy mogły się przesunąć — do czasu odświeżenia akcje są wyłączone
  }
  const node = el('div', { class: 'sect' },
    el('div', { class: 'row', style: 'border:0;padding:0' }, el('h3', { class: 'grow' }, title), sbtn('Odśwież', load)), body);
  return { node, load };
}

const lockProps = locked => ({ disabled: locked, title: locked ? 'Odświeżanie danych…' : null });
const card = (...c) => el('div', { class: 'card' }, ...c);

function wnioski(ctx, alive) {
  return section(ctx, alive, { title: 'Wnioski oczekujące', action: 'getWnioskiOczekujace', render: (list, locked, mutate) => {
    if (!list.length) return card(note('Brak wniosków oczekujących.'));
    const decide = (w, status) => mutate('ustawStatusUrlopu', { idWniosku: w.id, status }, {
      confirmMsg: `${status === 'Zatwierdzone' ? 'Zatwierdzić' : 'Odrzucić'} wniosek: ${w.pracownik}, ${w.typ}, ${w.od} – ${w.do}?`,
      done: d => toast(`Wniosek ${status === 'Zatwierdzone' ? 'zatwierdzony' : 'odrzucony'}.` + (d && d.ostrzezenie ? ' ' + d.ostrzezenie : ''), d && d.ostrzezenie ? 'err' : 'ok') });
    return list.map(w => card(
      el('div', null, el('b', null, w.pracownik), ` · ${w.typ}`),
      el('div', { class: 'sub' }, `${w.od} – ${w.do} · ${w.dni} dni`),
      w.uwagi ? el('div', { class: 'sub' }, w.uwagi) : null,
      w.limitInfo ? el('div', { class: 'sub' }, w.limitInfo) : null,
      w.konflikt ? el('div', { class: 'msg err' }, 'Nakłada się z: ' + w.konflikt) : null,
      w.zlozono ? el('div', { class: 'sub' }, 'Złożono: ' + w.zlozono) : null,
      el('div', { class: 'row', style: 'border:0;padding-bottom:0' },
        sbtn('Zatwierdź', () => decide(w, 'Zatwierdzone'), lockProps(locked)),
        sbtn('Odrzuć', () => decide(w, 'Odrzucone'), lockProps(locked), true),
        pdfButton(ctx, 'PDF', 'pdfWniosku', () => ({ idWniosku: w.id })))));
  } });
}

function wyjscia(ctx, alive, getMonth) {
  return section(ctx, alive, { title: 'Wyjścia i odpracowania', action: 'getWyjsciaAdmin', args: getMonth, render: (d, locked, mutate) => {
    const lista = d.lista || [], salda = d.salda || [];
    const status = (r, st) => mutate('zmienStatusWyjscia', { wiersz: r.wiersz, status: st },
      { done: () => toast(st === 'Zatwierdzone' ? 'Zatwierdzono.' : 'Odrzucono.') });
    return [
      card(lista.length ? lista.map(r => el('div', { class: 'row' },
        el('span', { class: 'grow' }, el('b', null, r.pracownik), ` · ${r.rodzaj === 'Odpracowanie' ? '↩️ odpracowanie' : '🚪 wyjście'}`,
          el('div', { class: 'sub' }, `${fmtDate(r.data)} · ${r.od}–${r.do} · ${fmtH(r.godziny)}${r.uwagi ? ' · ' + r.uwagi : ''}`)),
        statusBadge(r.status),
        el('span', { class: 'edit' },
          r.status !== 'Zatwierdzone' ? sbtn('✓ Zatwierdź', () => status(r, 'Zatwierdzone'), lockProps(locked)) : null,
          r.status !== 'Odrzucone' ? sbtn('✕ Odrzuć', () => status(r, 'Odrzucone'), lockProps(locked), true) : null,
          sbtn('🗑 Usuń', () => mutate('adminUsunWyjscie', { wiersz: r.wiersz }, { confirmMsg: `Usunąć wpis: ${r.pracownik}, ${fmtDate(r.data)}?`, done: () => toast('Usunięto.') }), lockProps(locked), true))))
        : note('Brak zgłoszeń w tym miesiącu.')),
      salda.length ? card(el('div', { class: 'flabel' }, 'Saldo roczne (zatwierdzone)'), salda.map(s => el('div', { class: 'row' },
        el('span', { class: 'grow' }, s.pracownik, el('div', { class: 'sub' }, `wyjścia ${fmtH(s.wyjsciaH)} · odpracowane ${fmtH(s.odpracowaneH)}`)),
        el('b', null, s.doOdrobienia > 0 ? 'do odrobienia ' + fmtH(s.doOdrobienia) : 'rozliczone')))) : null,
    ];
  } });
}

function nieobecnosci(ctx, alive, getMonth) {
  return section(ctx, alive, { title: 'Nieobecności', action: 'getNieobecnosciAdmin', args: getMonth, render: (d, locked, mutate) => {
    const lista = d.lista || [];
    return card(lista.length ? lista.map(r => el('div', { class: 'row' },
      el('span', { class: 'grow' }, el('b', null, r.pracownik), ` · ${r.typ}`,
        el('div', { class: 'sub' }, `${fmtDate(r.dataOd)} – ${fmtDate(r.dataDo)} · ${r.dni} dni${r.uwagi ? ' · ' + r.uwagi : ''}`)),
      statusBadge(r.status),
      sbtn('🗑 Usuń', () => mutate('adminUsunNieobecnosc', { wiersz: r.wiersz }, { confirmMsg: `Usunąć nieobecność: ${r.pracownik}, ${r.typ}, ${fmtDate(r.dataOd)}?`, done: () => toast('Usunięto.') }), lockProps(locked), true)))
      : note('Brak nieobecności w tym miesiącu.'));
  } });
}

function historia(ctx, alive, getMonth) {
  const select = el('select', { class: 'field' }, el('option', { value: '' }, 'Wczytywanie…'));
  const body = el('div');
  let seq = 0;
  const pdf = pdfButton(ctx, 'Karta PDF', 'pdfKartaPracownika', () => ({ pracownikId: select.value, ...getMonth() }), 'btn btn-pdf');
  pdf.hidden = true;
  async function load() {
    const id = select.value, mine = ++seq;
    pdf.hidden = !id;
    if (!id) { fill(body); return; }
    fill(body, note('Wczytywanie…'));
    const res = await call(ctx, 'getHistoriaPracownika', { pracownikId: id, ...getMonth() });
    if (mine !== seq || !alive()) return;
    if (!res) { fill(body, note('Nie udało się wczytać.')); return; }
    const g = res.data.godziny || [], u = res.data.urlopy || [];
    fill(body,
      card(el('div', { class: 'flabel' }, 'Godziny'), g.length ? g.map(x => el('div', { class: 'row' },
        el('span', { class: 'grow' }, `${x.data} · ${x.od}–${x.do} · `, el('b', null, fmtH(x.godz)), x.nadg > 0.001 ? ` +${fmtH(x.nadg)}` : '', x.uwagi ? el('div', { class: 'sub' }, x.uwagi) : null))) : note('Brak godzin w tym miesiącu.')),
      card(el('div', { class: 'flabel' }, 'Urlopy i nieobecności'), u.length ? u.map(x => el('div', { class: 'row' },
        el('span', { class: 'grow' }, x.typUrlopu, el('div', { class: 'sub' }, `${x.dataOd} – ${x.dataDo} · ${x.dni} dni${x.uwagi ? ' · ' + x.uwagi : ''}`)), statusBadge(x.status))) : note('Brak nieobecności w tym miesiącu.')));
  }
  select.addEventListener('change', load);
  call(ctx, 'getPracownicy', {}).then(res => {
    if (!alive()) return;
    const list = res ? res.data : [];
    select.replaceChildren(el('option', { value: '' }, res ? 'Wybierz pracownika…' : 'Nie udało się wczytać listy'),
      ...list.map(p => el('option', { value: p.id }, `${p.imie} ${p.nazwisko}`)));
  });
  const node = el('div', { class: 'sect' }, el('h3', null, 'Historia pracownika'), field('Pracownik', select), body, pdf);
  return { node, load };
}

function buildPanel(ctx, alive) {
  const t = new Date();
  let month = { rok: t.getFullYear(), miesiac: t.getMonth() + 1 };
  const getMonth = () => ({ ...month });
  const w = wnioski(ctx, alive), wy = wyjscia(ctx, alive, getMonth), n = nieobecnosci(ctx, alive, getMonth), h = historia(ctx, alive, getMonth);
  const picker = monthPicker({ ...month, onChange: v => { month = v; wy.load(); n.load(); h.load(); } });
  const raporty = el('div', { class: 'sect' }, el('h3', null, 'Raporty PDF'),
    el('div', { class: 'card' }, el('div', { class: 'row', style: 'border:0' }, RAPORTY.map(([label, action]) => pdfButton(ctx, label, action, getMonth)))));
  [w, wy, n, h].forEach(s => s.load());
  return el('div', { class: 'view' }, el('h2', null, 'Panel administratora'), w.node,
    el('div', { class: 'sect' }, el('h3', null, 'Miesiąc'), picker), wy.node, n.node, raporty, h.node);
}

export function mount(container, ctx) {
  let stop = null;
  const render = () => {
    if (stop) stop();
    const live = { dead: false };
    stop = () => { live.dead = true; };
    if (!ctx.online()) { fill(container, el('div', { class: 'empty-note' }, OFFLINE_MSG)); return; }
    fill(container, buildPanel(ctx, () => !live.dead && container.isConnected));
  };
  const onOnline = () => { if (container.isConnected && container.querySelector('.empty-note')) render(); };
  window.addEventListener('online', onOnline);
  ctx.onLeave(() => { window.removeEventListener('online', onOnline); if (stop) stop(); });
  render();
}
