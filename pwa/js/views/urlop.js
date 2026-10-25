import { el, fill, field, fmtDate, cachedLoad, loadWpisy, statusBadge, todayIso, saveForm } from '../ui.js';

function bar(label, used, limit, left) {
  const cls = left > 5 ? 'good' : left > 0 ? 'warn' : 'bad';
  return el('div', { class: 'pill ' + cls }, `${label} pozostało: ${left} dni (${used}/${limit} wyk.)`);
}

export function mount(container, ctx, prefill) {
  const a = (prefill && prefill.args) || {};
  const typy = (ctx.init && ctx.init.typyNieobecnosci) || [];
  const typ = el('select', { class: 'field' }, el('option', { value: '' }, '— wybierz —'),
    typy.map(t => el('option', { value: t, selected: t === a.typ }, t)));
  const od = el('input', { class: 'field', type: 'date', value: a.dataOd || todayIso() });
  const doo = el('input', { class: 'field', type: 'date', value: a.dataDo || a.dataOd || todayIso() });
  od.addEventListener('change', () => { if (doo.value < od.value) doo.value = od.value; });
  const uwagi = el('textarea', { class: 'field', placeholder: 'dodatkowe informacje...' }, a.uwagi || '');
  const saldo = el('div', { class: 'card' }, el('div', { class: 'form-title' }, 'Saldo urlopu'), el('div', { class: 'muted' }, 'Wczytywanie...'));
  const lista = el('div', { class: 'card' }, el('div', { class: 'form-title' }, 'Moje wnioski'), el('div', { class: 'muted' }, 'Wczytywanie...'));

  const renderSaldo = (d, { note } = {}) => {
    const rows = (d.lista || []).map(r => el('div', { class: 'row' }, el('span', { class: 'grow' }, r.typ), el('span', null, `${r.dni} dni `, statusBadge(r.status))));
    const bars = d.limitBiezacy === null || d.limitBiezacy === undefined ? [] : [
      d.limitZalegly > 0 ? bar('Zaległy urlop:', Math.min(d.wykorzystaneUrlop, d.limitZalegly), d.limitZalegly, d.pozostalyZalegly) : null,
      bar(`Bieżący urlop ${new Date().getFullYear()}:`, Math.max(0, d.wykorzystaneUrlop - d.limitZalegly), d.limitBiezacy, d.pozostalyBiezacy)];
    fill(saldo, el('div', { class: 'form-title' }, 'Saldo urlopu'), note || '', rows.length ? rows : el('div', { class: 'muted' }, 'Brak nieobecności w tym roku.'), bars);
  };
  const renderLista = d => {
    const rows = (d.nieobecnosci || []).map(n => el('div', { class: 'row' },
      el('span', { class: 'grow' }, n.typ, el('div', { class: 'sub' }, `${fmtDate(n.dataOd)} – ${fmtDate(n.dataDo)} · ${n.dni} dni`)), statusBadge(n.status)));
    fill(lista, el('div', { class: 'form-title' }, 'Moje wnioski'), rows.length ? rows : el('div', { class: 'muted' }, 'Brak wniosków w tym miesiącu.'));
  };
  const t = new Date();
  const load = () => {
    const none = (box, title) => r => { if (!r.data) fill(box, el('div', { class: 'form-title' }, title), el('div', { class: 'muted' }, 'Brak danych (offline).')); };
    cachedLoad({ key: 'saldoUrlop', action: 'getUrlopySummary', ctx, render: renderSaldo, container: el('div') }).then(none(saldo, 'Saldo urlopu')).catch(() => {});
    loadWpisy(ctx, t.getFullYear(), t.getMonth() + 1, renderLista, el('div')).then(none(lista, 'Moje wnioski')).catch(() => {});
  };

  const form = saveForm({
    ctx, prefill, action: 'zapiszUrlop', title: 'Zgłoś nieobecność', submitLabel: 'Wyślij wniosek', color: 'var(--green)',
    controls: [field('Typ nieobecności', typ), el('div', { class: 'row2' }, field('Data od', od), field('Data do', doo)), field('Uwagi', uwagi)],
    collect: () => ({ typ: typ.value, dataOd: od.value, dataDo: doo.value, uwagi: uwagi.value.trim() }),
    validate: v => !v.typ ? 'Wybierz typ nieobecności.' : !v.dataOd || !v.dataDo ? 'Wypełnij daty.' : v.dataDo < v.dataOd ? 'Data „do” nie może być wcześniejsza niż „od”.' : '',
    reset: () => { uwagi.value = ''; typ.value = ''; },
    onSaved: load,
  });
  container.append(el('div', { class: 'view' }, form, saldo, lista));
  load();
}
