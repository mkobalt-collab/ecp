import { el, fill, toast, fmtDate, fmtH, monthPicker, statusBadge, field, dniOpis, plural, confirmOvernight } from '../ui.js';
import { offerPdf } from '../pdf.js';
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
        if (res.data && res.data.ok !== false && res.data.base64) offerPdf(res.data);
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

// Nadgodziny z wpisów historii: suma za miesiąc (osobno soboty) i lista dni z nadgodzinami.
function nadgodzinyCard(godziny) {
  const dni = godziny.filter(x => (parseFloat(x.nadg) || 0) > 0.001);
  const suma = dni.reduce((s, x) => s + (parseFloat(x.nadg) || 0), 0);
  const soboty = dni.filter(x => x.sobota).reduce((s, x) => s + (parseFloat(x.nadg) || 0), 0);
  const tag = x => x.sobota ? ' · sobota' : x.dzienWolny ? ' · dzień wolny' : '';
  return card(el('div', { class: 'flabel' }, 'Nadgodziny'),
    dni.length
      ? [el('div', { class: 'row' }, el('span', { class: 'grow' }, 'Razem w miesiącu: ', el('b', null, fmtH(suma)),
          soboty > 0.001 ? el('div', { class: 'sub' }, `w tym soboty: ${fmtH(soboty)}`) : null)),
        ...dni.map(x => el('div', { class: 'row' },
          el('span', { class: 'grow' }, `${x.data}${tag(x)}`, el('div', { class: 'sub' }, `przepracowane ${fmtH(x.godz)}`)),
          el('b', null, '+' + fmtH(x.nadg))))]
      : note('Brak nadgodzin w tym miesiącu.'));
}

// Wyjścia i odpracowania wybranego pracownika (z getWyjsciaAdmin): lista z miesiąca + saldo roczne zatwierdzonych.
// edit(x) -> formularz edycji zamiast wiersza albo null; tools(x) -> przyciski pod wierszem.
function wyjsciaCard(d, pracownikId, { edit = () => null, tools = () => null } = {}) {
  const label = el('div', { class: 'flabel' }, 'Wyjścia i odpracowania');
  if (!d) return card(label, note('Nie udało się wczytać wyjść.'));
  const lista = (d.lista || []).filter(x => String(x.pracownikId) === String(pracownikId))
    .sort((a, b) => a.data.localeCompare(b.data));
  const saldo = (d.salda || []).find(s => String(s.pracownikId) === String(pracownikId));
  const odpr = x => x.rodzaj === 'Odpracowanie';
  return card(label,
    saldo ? el('div', { class: 'row' }, el('span', { class: 'grow' }, 'Saldo w roku (zatwierdzone): ',
      el('b', null, saldo.doOdrobienia > 0.001 ? `${fmtH(saldo.doOdrobienia)} do odrobienia` : saldo.doOdrobienia < -0.001 ? `${fmtH(-saldo.doOdrobienia)} nadwyżki` : 'rozliczone'),
      el('div', { class: 'sub' }, `wyjścia ${fmtH(saldo.wyjsciaH)} · odpracowane ${fmtH(saldo.odpracowaneH)}`))) : null,
    lista.length ? lista.map(x => edit(x) || el('div', { class: 'row' },
      el('span', { class: 'grow' }, `${odpr(x) ? '🔄' : '🚪'} ${fmtDate(x.data)} · ${x.od}–${x.do} · `,
        el('b', { style: `color:var(${odpr(x) ? '--green' : '--red'})` }, (odpr(x) ? '+' : '−') + fmtH(x.godziny)),
        el('div', { class: 'sub' }, x.rodzaj + (x.uwagi ? ' · ' + x.uwagi : ''))),
      statusBadge(x.status), tools(x))) : note('Brak wyjść i odpracowań w tym miesiącu.'));
}

// Zestawienie wszystkich urlopów pracownika za wybrany okres (domyślnie rok oglądanego miesiąca) + PDF.
function zestawienieUrlopow(ctx, alive, getId, getMonth) {
  const od = el('input', { class: 'field', type: 'date' }), doo = el('input', { class: 'field', type: 'date' });
  const out = el('div');
  let seq = 0;
  const args = () => ({ pracownikId: getId(), od: od.value, do: doo.value });
  const bad = () => !od.value || !doo.value ? 'Podaj daty od i do.' : od.value > doo.value ? 'Data „od” musi być przed datą „do”.' : null;
  const dni = n => `${n} ${plural(n, ['dzień', 'dni', 'dni'])}`;
  function paint(z) {
    const zatw = z.lista.filter(x => x.status === 'Zatwierdzone');
    fill(out,
      z.suma.length ? el('div', { class: 'pill good' }, el('div', null, el('b', null, 'Zatwierdzone w okresie:')),
        z.suma.map(s => el('div', null, `• ${s.typ}: ${dni(s.dni)}`))) : note('Brak zatwierdzonych urlopów w tym okresie.'),
      z.limit ? el('div', { class: 'sub' }, `Limit ${z.limit.rok}: zostało ${dni(z.limit.pozostalyBiezacy)} bieżącego` +
        (z.limit.limitZalegly ? ` + ${dni(z.limit.pozostalyZalegly)} zaległego` : '') + ` (wykorzystano ${z.limit.wykorzystane})`) : null,
      z.lista.length ? z.lista.map(x => el('div', { class: 'row' },
        el('span', { class: 'grow' }, x.typ, el('div', { class: 'sub' }, `${fmtDate(x.dataOd)} – ${fmtDate(x.dataDo)}`, el('br'),
          (x.dniWOkresie !== x.dni ? `${dni(x.dniWOkresie)} w okresie (cały wniosek: ${dni(x.dni)})` : dni(x.dni)) + (x.uwagi ? ' · ' + x.uwagi : ''))),
        statusBadge(x.status))) : note('Brak wniosków w tym okresie.'),
      z.lista.length ? el('div', { class: 'sub' }, `Wniosków: ${z.lista.length}, w tym zatwierdzonych: ${zatw.length}`) : null);
  }
  async function show() {
    const msg = bad();
    if (msg) { toast(msg, 'err'); return; }
    const mine = ++seq;
    fill(out, note('Wczytywanie…'));
    const res = await call(ctx, 'getUrlopyZakres', args());
    if (mine !== seq || !alive()) return;
    if (res) paint(res.data); else fill(out, note('Nie udało się wczytać.'));
  }
  const pdf = pdfButton(ctx, 'PDF zestawienia', 'pdfUrlopyZakres', args);
  const node = card(el('div', { class: 'flabel' }, 'Zestawienie urlopów'),
    el('div', { class: 'row', style: 'border:0;gap:8px;flex-wrap:wrap' }, field('Od', od), field('Do', doo)),
    el('div', { class: 'row', style: 'border:0;padding-top:0' }, sbtn('Pokaż', show), pdf), out);
  // nowy pracownik albo zmiana roku: okres = cały rok oglądanego miesiąca, wynik od nowa
  function reset() {
    const { rok } = getMonth();
    od.value = `${rok}-01-01`; doo.value = `${rok}-12-31`;
    seq++; fill(out);
  }
  return { node, reset };
}

// Kontrolki edycji wpisu w historii
const ddmm2iso = v => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(v || '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(v || ''); };
const czasInput = v => el('input', { class: 'field', type: 'time', value: v || '' });
const dataInput = v => el('input', { class: 'field', type: 'date', value: ddmm2iso(v) });
const uwagiInput = v => el('input', { class: 'field', type: 'text', value: v || '', placeholder: 'uwagi', style: 'flex-basis:100%' });
const wybor = (opcje, v) => el('select', { class: 'field' }, [...new Set([...opcje, v].filter(Boolean))].map(o => el('option', { value: o, selected: o === v }, o)));
const zlyCzas = (od, doo) => !od || !doo ? 'Uzupełnij godziny.' : od === doo ? 'Godzina „do” musi być inna niż „od”.' : null;
const TYPY_WYJ = ['Wyjście prywatne', 'Odpracowanie'];

// Historia pracownika z edycją wpisów (godziny, urlopy, wyjścia). onChanged — odświeżenie pozostałych sekcji panelu.
function historia(ctx, alive, getMonth, onChanged) {
  const select = el('select', { class: 'field' }, el('option', { value: '' }, 'Wczytywanie…'));
  const body = el('div');
  let seq = 0, lastId = null, lastRok = null, lastKey = null, data = null, editing = null, busy = 0;
  const pdf = pdfButton(ctx, 'Karta PDF', 'pdfKartaPracownika', () => ({ pracownikId: select.value, ...getMonth() }), 'btn btn-pdf');
  pdf.hidden = true;
  const zest = zestawienieUrlopow(ctx, alive, () => select.value, getMonth);
  zest.node.hidden = true;
  const lp = () => lockProps(busy > 0);
  const startEdit = key => { editing = key; paint(); };
  const cancel = sbtn('Anuluj', () => { editing = null; paint(); });

  // Zmiana w arkuszu; po niej zawsze świeże dane (numery wierszy mogły się przesunąć).
  async function act(action, args, { confirmMsg, okMsg = 'Zapisano.' } = {}) {
    if (busy > 0 || (confirmMsg && !confirm(confirmMsg))) return;
    busy++; paint();
    try {
      const res = await call(ctx, action, { pracownikId: select.value, ...args });
      if (res) { editing = null; toast(typeof okMsg === 'function' ? okMsg(res.data) : okMsg); if (onChanged) onChanged(); }
    } finally { busy--; }
    load();
  }

  function godzRow(x) {
    if (editing === 'g' + x.wiersz) {
      const od = czasInput(x.od), doo = czasInput(x.do), uw = uwagiInput(x.uwagi);
      const save = () => {
        const bad = zlyCzas(od.value, doo.value);
        if (bad) { toast(bad, 'err'); return; }
        if (!confirmOvernight(od.value, doo.value)) return;
        act('adminKorygujGodziny', { wiersz: x.wiersz, data: x.data, godzOd: od.value, godzDo: doo.value, uwagi: uw.value.trim() },
          { okMsg: d => `Poprawiono — ${fmtH(d.przepracowane)}` + (d.nadgodziny > 0.001 ? `, nadgodziny ${fmtH(d.nadgodziny)}` : '') });
      };
      return el('div', { class: 'row' }, el('span', { class: 'grow' }, el('b', null, x.data)),
        el('div', { class: 'edit' }, od, doo, uw, sbtn('Zapisz', save, lp()), cancel));
    }
    return el('div', { class: 'row' },
      el('span', { class: 'grow' }, `${x.data} · ${x.od}–${x.do} · `, el('b', null, fmtH(x.godz)), x.nadg > 0.001 ? ` +${fmtH(x.nadg)}` : '', x.uwagi ? el('div', { class: 'sub' }, x.uwagi) : null),
      x.wiersz ? [sbtn('✏️', () => startEdit('g' + x.wiersz), { 'aria-label': 'Popraw', ...lp() }),
        sbtn('🗑', () => act('adminUsunGodziny', { wiersz: x.wiersz, data: x.data }, { confirmMsg: `Usunąć godziny z ${x.data}?`, okMsg: 'Usunięto.' }), { 'aria-label': 'Usuń', ...lp() }, true)] : null);
  }

  function urlopRow(x) {
    if (x.id && editing === 'u' + x.id) {
      const typ = wybor((ctx.init && ctx.init.typyNieobecnosci) || [], x.typUrlopu), od = dataInput(x.dataOd), doo = dataInput(x.dataDo), uw = uwagiInput(x.uwagi);
      const save = () => {
        if (!od.value || !doo.value) { toast('Podaj daty od i do.', 'err'); return; }
        if (od.value > doo.value) { toast('Data „od” musi być przed datą „do”.', 'err'); return; }
        act('adminEdytujUrlop', { idWniosku: x.id, typ: typ.value, dataOd: od.value, dataDo: doo.value, uwagi: uw.value.trim() },
          { okMsg: d => `Zapisano — ${d.dni} ${plural(d.dni, ['dzień', 'dni', 'dni'])} roboczych` });
      };
      return el('div', { class: 'row' }, el('span', { class: 'grow' }, el('b', null, 'Edycja nieobecności'), ' ', statusBadge(x.status)),
        el('div', { class: 'edit' }, typ, od, doo, uw, sbtn('Zapisz', save, lp()), cancel));
    }
    const decyzja = st => act('ustawStatusUrlopu', { idWniosku: x.id, status: st },
      { confirmMsg: `${st === 'Zatwierdzone' ? 'Zatwierdzić' : 'Odrzucić'}: ${x.typUrlopu}, ${x.dataOd} – ${x.dataDo}? Pracownik dostanie e-mail.`, okMsg: st === 'Zatwierdzone' ? 'Zatwierdzono.' : 'Odrzucono.' });
    return el('div', { class: 'row' },
      el('span', { class: 'grow' }, x.typUrlopu, el('div', { class: 'sub' }, `${x.dataOd} – ${x.dataDo}`, el('br'), dniOpis(x, getMonth().miesiac) + (x.uwagi ? ' · ' + x.uwagi : ''))),
      statusBadge(x.status),
      x.id ? el('span', { class: 'edit' },
        x.status !== 'Zatwierdzone' ? sbtn('✓ Zatwierdź', () => decyzja('Zatwierdzone'), lp()) : null,
        x.status !== 'Odrzucone' ? sbtn('✕ Odrzuć', () => decyzja('Odrzucone'), lp(), true) : null,
        sbtn('✏️ Edytuj', () => startEdit('u' + x.id), lp()),
        sbtn('🗑 Usuń', () => act('adminUsunUrlop', { idWniosku: x.id }, { confirmMsg: `Usunąć: ${x.typUrlopu}, ${x.dataOd} – ${x.dataDo}?`, okMsg: 'Usunięto.' }), lp(), true)) : null);
  }

  const wyjKey = x => ({ wiersz: x.wiersz, data: x.data });
  const wyjEdit = x => {
    if (editing !== 'w' + x.wiersz) return null;
    const rodzaj = wybor(TYPY_WYJ, x.rodzaj), od = czasInput(x.od), doo = czasInput(x.do), uw = uwagiInput(x.uwagi);
    const save = () => {
      const bad = zlyCzas(od.value, doo.value);
      if (bad) { toast(bad, 'err'); return; }
      if (!confirmOvernight(od.value, doo.value)) return;
      act('adminEdytujWyjscie', { ...wyjKey(x), rodzaj: rodzaj.value, godzOd: od.value, godzDo: doo.value, uwagi: uw.value.trim() }, { okMsg: d => `Zapisano — ${fmtH(d.godziny)}` });
    };
    return el('div', { class: 'row' }, el('span', { class: 'grow' }, el('b', null, fmtDate(x.data)), ' ', statusBadge(x.status)),
      el('div', { class: 'edit' }, rodzaj, od, doo, uw, sbtn('Zapisz', save, lp()), cancel));
  };
  const wyjTools = x => el('span', { class: 'edit' },
    x.status !== 'Zatwierdzone' ? sbtn('✓ Zatwierdź', () => act('adminWyjscieStatus', { ...wyjKey(x), status: 'Zatwierdzone' }, { okMsg: 'Zatwierdzono.' }), lp()) : null,
    x.status !== 'Odrzucone' ? sbtn('✕ Odrzuć', () => act('adminWyjscieStatus', { ...wyjKey(x), status: 'Odrzucone' }, { okMsg: 'Odrzucono.' }), lp(), true) : null,
    sbtn('✏️ Edytuj', () => startEdit('w' + x.wiersz), lp()),
    sbtn('🗑 Usuń', () => act('adminUsunWyjscieH', wyjKey(x), { confirmMsg: `Usunąć: ${x.rodzaj}, ${fmtDate(x.data)}?`, okMsg: 'Usunięto.' }), lp(), true));

  function paint() {
    if (!data) return;
    const g = data.h.godziny || [], u = data.h.urlopy || [];
    fill(body,
      card(el('div', { class: 'flabel' }, 'Godziny'), g.length ? g.map(godzRow) : note('Brak godzin w tym miesiącu.')),
      nadgodzinyCard(g),
      card(el('div', { class: 'flabel' }, 'Urlopy i nieobecności'), u.length ? u.map(urlopRow) : note('Brak nieobecności w tym miesiącu.')),
      wyjsciaCard(data.wyj, data.id, { edit: wyjEdit, tools: wyjTools }));
  }

  async function load() {
    const id = select.value, mine = ++seq, m = getMonth();
    pdf.hidden = !id;
    zest.node.hidden = !id;
    if (id && (id !== lastId || m.rok !== lastRok)) zest.reset();
    lastId = id; lastRok = m.rok;
    const key = `${id}|${m.rok}-${m.miesiac}`;
    if (key !== lastKey) { editing = null; data = null; lastKey = key; }
    if (!id) { fill(body); return; }
    if (!data) fill(body, note('Wczytywanie…'));
    const [res, wyj] = await Promise.all([
      call(ctx, 'getHistoriaPracownika', { pracownikId: id, ...m }),
      call(ctx, 'getWyjsciaAdmin', m),
    ]);
    if (mine !== seq || !alive()) return;
    if (!res) { data = null; fill(body, note('Nie udało się wczytać.')); return; }
    data = { id, h: res.data, wyj: wyj && wyj.data };
    paint();
  }
  select.addEventListener('change', load);
  call(ctx, 'getPracownicy', {}).then(res => {
    if (!alive()) return;
    const list = res ? res.data : [];
    select.replaceChildren(el('option', { value: '' }, res ? 'Wybierz pracownika…' : 'Nie udało się wczytać listy'),
      ...list.map(p => el('option', { value: p.id }, `${p.imie} ${p.nazwisko}`)));
  });
  const node = el('div', { class: 'sect' }, el('h3', null, 'Historia pracownika'), field('Pracownik', select), zest.node, body, pdf);
  return { node, load };
}

function buildPanel(ctx, alive) {
  const t = new Date();
  let month = { rok: t.getFullYear(), miesiac: t.getMonth() + 1 };
  const getMonth = () => ({ ...month });
  const w = wnioski(ctx, alive), wy = wyjscia(ctx, alive, getMonth), n = nieobecnosci(ctx, alive, getMonth);
  const h = historia(ctx, alive, getMonth, () => { w.load(); wy.load(); n.load(); });
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
