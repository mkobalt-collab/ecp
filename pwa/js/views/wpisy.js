import { el, fill, toast, fmtDate, fmtH, monthPicker, statusBadge, loadWpisy, p2 } from '../ui.js';
import { openPdf } from '../pdf.js';
import { NetworkError } from '../api.js';

const TAB_FOR = { zapiszGodziny: 'godziny', zapiszUrlop: 'urlop', zapiszWyjscie: 'wyjscia' };
const monthOf = it => (it.action === 'zapiszUrlop' ? it.args.dataOd : it.args.data || '').slice(0, 7);
const label = it => {
  const a = it.args;
  if (it.action === 'zapiszGodziny') return `Godziny ${fmtDate(a.data)} · ${a.godzOd}–${a.godzDo}`;
  if (it.action === 'zapiszUrlop') return `${a.typ} ${fmtDate(a.dataOd)} – ${fmtDate(a.dataDo)}`;
  return `${a.rodzaj} ${fmtDate(a.data)} · ${a.godzOd}–${a.godzDo}`;
};

export function mount(container, ctx, prefill) {
  const t = new Date();
  let { rok, miesiac } = { rok: t.getFullYear(), miesiac: t.getMonth() + 1 };
  let fresh = false, busy = 0, loadSeq = 0, queue = [], lastIds = new Set(), month = null, editing = null;
  const queueBox = el('div');
  const body = el('div');
  const needNet = () => !ctx.online();
  // Edycja/usuwanie tylko online, na świeżych danych (wiersz z cache mógłby być nieaktualny) i bez trwającej zmiany.
  const rowLocked = () => needNet() || !fresh || busy > 0;
  const netProps = () => ({ disabled: rowLocked(), title: needNet() ? 'Wymaga internetu' : rowLocked() ? 'Odświeżanie danych…' : null });
  const pdfProps = () => ({ disabled: needNet(), title: needNet() ? 'Wymaga internetu' : null });
  const sbtn = (txt, onclick, extra = {}, props = {}) => el('button', { class: 'sbtn ' + (extra.danger ? 'danger' : ''), type: 'button', onclick, ...props }, txt);

  // ---- kolejka ----
  function renderQueue() {
    const ym = `${rok}-${p2(miesiac)}`;
    const items = queue.filter(i => monthOf(i) === ym);
    fill(queueBox, items.length ? el('div', { class: 'sect' }, el('h3', null, 'Do wysłania'), items.map(it => el('div', { class: 'card queue' + (it.status === 'error' ? ' err' : '') },
      el('div', { class: 'row' }, el('span', { class: 'grow' }, (it.status === 'error' ? '❗ ' : '⏳ ') + label(it),
        it.status === 'error' ? el('div', { class: 'sub' }, it.error || 'Błąd zapisu.') : el('div', { class: 'sub' }, 'Czeka na wysłanie')),
      el('span', { class: 'edit' },
        it.status === 'error' ? sbtn('Popraw', () => ctx.go(TAB_FOR[it.action], { clientId: it.clientId, args: it.args, error: it.error })) : null,
        sbtn('Usuń z kolejki', () => ctx.sync.discard(it.clientId).catch(() => toast('Nie udało się usunąć.', 'err')), { danger: true })))))) : null);
  }
  ctx.onQueueChange(items => {
    if (!container.isConnected) return;
    const ids = new Set(items.map(i => i.clientId));
    const sent = [...lastIds].some(id => !ids.has(id));
    queue = items; lastIds = ids;
    renderQueue();
    if (sent) load();
  });

  // ---- operacje online ----
  async function run(action, args) {
    busy++; editing = null; renderMonth();
    try {
      const res = await ctx.api.call(action, args);
      if (res.ok) { fresh = false; return true; }
      if (res.code !== 'AUTH') toast(res.error || 'Operacja nie powiodła się.', 'err');
    } catch (e) {
      if (e instanceof NetworkError) toast('Wymaga internetu.', 'err'); else throw e;
    } finally {
      busy--;
      if (!fresh) load(); else renderMonth();
    }
    return false;
  }
  const remove = (action, wiersz) => { if (confirm('Usunąć ten wpis?')) run(action, { wiersz }).catch(() => toast('Nie udało się usunąć.', 'err')); };

  function editRow(g) {
    const od = el('input', { class: 'field', type: 'time', value: g.od });
    const doo = el('input', { class: 'field', type: 'time', value: g.do });
    const uw = el('input', { class: 'field', type: 'text', value: g.uwagi || '', placeholder: 'uwagi', style: 'flex-basis:100%' });
    const save = async () => {
      if (!od.value || !doo.value) { toast('Uzupełnij godziny.', 'err'); return; }
      if (doo.value <= od.value) { toast('Godzina „do” musi być późniejsza niż „od”.', 'err'); return; }
      editing = null;
      await run('korygujGodziny', { wiersz: g.wiersz, godzOd: od.value, godzDo: doo.value, uwagi: uw.value.trim() });
      renderMonth();
    };
    return el('div', { class: 'row' }, el('span', { class: 'grow' }, fmtDate(g.data)),
      el('div', { class: 'edit' }, od, doo, uw, sbtn('Zapisz', () => save().catch(() => toast('Nie udało się zapisać.', 'err')), {}, { disabled: rowLocked() }), sbtn('Anuluj', () => { editing = null; renderMonth(); })));
  }

  // ---- miesiąc ----
  function renderMonth(note) {
    if (note !== undefined) renderMonth.note = note;
    const d = month;
    if (!d) return;
    const g = d.godziny || [], n = d.nieobecnosci || [], w = d.wyjscia || [];
    const sect = (title, rows, empty) => el('div', { class: 'sect' }, el('h3', null, title), el('div', { class: 'card' }, rows.length ? rows : el('div', { class: 'muted' }, empty)));
    fill(body, renderMonth.note || '',
      el('div', { class: 'pill good' }, `⏱ ${g.length} dni · 🏖 ${n.length} nieob. · 🕐 ${w.length} wyjść` + (g.length ? ` · razem ${fmtH(d.sumaPrzepracowane || 0)}` + (d.sumaNadgodziny > 0.001 ? ` (nadg. ${fmtH(d.sumaNadgodziny)})` : '') : '')),
      sect('Godziny', g.map(x => editing === x.wiersz ? editRow(x) : el('div', { class: 'row' },
        el('span', { class: 'grow' }, `${fmtDate(x.data)} · ${x.od}–${x.do} · `, el('b', null, fmtH(x.przepracowane)), x.nadgodziny > 0.001 ? ` +${fmtH(x.nadgodziny)}` : '', x.projekt ? ` · ${x.projekt}` : '', x.uwagi ? el('div', { class: 'sub' }, x.uwagi) : null),
        sbtn('✏️', () => { editing = x.wiersz; renderMonth(); }, {}, { 'aria-label': 'Popraw', ...netProps() }),
        sbtn('🗑', () => remove('usunGodziny', x.wiersz), { danger: true }, { 'aria-label': 'Usuń', ...netProps() }))), 'Brak godzin w tym miesiącu.'),
      sect('Nieobecności', n.map(x => el('div', { class: 'row' },
        el('span', { class: 'grow' }, x.typ, el('div', { class: 'sub' }, `${fmtDate(x.dataOd)} – ${fmtDate(x.dataDo)} · ${x.dni} dni${x.uwagi ? ' · ' + x.uwagi : ''}`)), statusBadge(x.status),
        x.status === 'Oczekuje' ? sbtn('🗑', () => remove('usunNieobecnosc', x.wiersz), { danger: true }, { 'aria-label': 'Usuń', ...netProps() }) : null)), 'Brak nieobecności w tym miesiącu.'),
      sect('Wyjścia i odpracowania', w.map(x => {
        const plus = x.rodzaj === 'Odpracowanie';
        return el('div', { class: 'row' },
          el('span', { class: 'grow' }, `${fmtDate(x.data)} · ${x.od}–${x.do} `, el('b', { style: `color:var(${plus ? '--green' : '--red'})` }, (plus ? '+' : '−') + fmtH(x.godziny)), x.uwagi ? el('div', { class: 'sub' }, x.uwagi) : null), statusBadge(x.status),
          x.status === 'Oczekuje' ? sbtn('🗑', () => remove('usunWyjscie', x.wiersz), { danger: true }, { 'aria-label': 'Usuń', ...netProps() }) : null);
      }), 'Brak wyjść w tym miesiącu.'));
  }
  async function load() {
    const seq = ++loadSeq;
    fresh = false; editing = null; renderMonth();
    const mine = () => seq === loadSeq && container.isConnected;
    await loadWpisy(ctx, rok, miesiac, (d, { note, stale }) => { if (mine()) { month = d; fresh = !stale; renderMonth(note); } }, body).catch(() => {});
  }

  const pdf = el('button', { class: 'btn btn-pdf', type: 'button', ...pdfProps(), onclick: async () => {
    pdf.disabled = true;
    try {
      const res = await ctx.api.call('mojaKarta', { rok, miesiac });
      if (res.ok) await openPdf(res.data); else if (res.code !== 'AUTH') toast(res.error || 'Nie udało się wygenerować karty.', 'err');
    } catch (e) { toast(e instanceof NetworkError ? 'Wymaga internetu.' : 'Nie udało się otworzyć karty.', 'err'); }
    pdf.disabled = needNet();
  } }, 'Moja karta PDF');
  const syncNet = () => { if (container.isConnected) { pdf.disabled = needNet(); pdf.title = needNet() ? 'Wymaga internetu' : ''; if (!fresh && !needNet() && editing === null) load(); else if (editing === null) renderMonth(); } };
  window.addEventListener('online', syncNet); window.addEventListener('offline', syncNet);
  ctx.onLeave(() => { window.removeEventListener('online', syncNet); window.removeEventListener('offline', syncNet); });

  const picker = monthPicker({ rok, miesiac, onChange: v => { rok = v.rok; miesiac = v.miesiac; month = null; editing = null; fill(body); renderQueue(); load(); } });
  container.append(el('div', { class: 'view' }, picker, queueBox, body, pdf));
  ctx.sync.list().then(items => { queue = items; lastIds = new Set(items.map(i => i.clientId)); renderQueue(); }).catch(() => {});
  load();
}
