import { el, fill, field, fmtDate, fmtH, cachedLoad, statusBadge, todayIso, saveForm } from '../ui.js';

export function mount(container, ctx, prefill) {
  const a = (prefill && prefill.args) || {};
  const rodzaj = el('select', { class: 'field' },
    el('option', { value: 'Wyjście prywatne', selected: a.rodzaj !== 'Odpracowanie' }, '🚪 Wcześniejsze wyjście'),
    el('option', { value: 'Odpracowanie', selected: a.rodzaj === 'Odpracowanie' }, '↩️ Odpracowanie'));
  const data = el('input', { class: 'field', type: 'date', value: a.data || todayIso() });
  const od = el('input', { class: 'field', type: 'time', value: a.godzOd || '' });
  const doo = el('input', { class: 'field', type: 'time', value: a.godzDo || '' });
  const uwagi = el('textarea', { class: 'field', placeholder: 'np. wizyta u lekarza, sprawa urzędowa...' }, a.uwagi || '');
  const saldo = el('div', { class: 'card' }, el('div', { class: 'form-title' }, 'Saldo godzin'), el('div', { class: 'muted' }, 'Wczytywanie...'));

  const renderSaldo = (d, { note } = {}) => {
    const s = d.doOdrobienia || 0;
    const [cls, txt] = s > 0.001 ? ['bad', '⚠️ Do odrobienia: ' + fmtH(s)] : s < -0.001 ? ['good', '✓ Odpracowane z nadwyżką: ' + fmtH(-s)] : ['good', '✓ Wyrównane'];
    const oczek = [d.oczekujeWyj > 0.001 ? 'wyjścia ' + fmtH(d.oczekujeWyj) : '', d.oczekujeOdpr > 0.001 ? 'odpracowania ' + fmtH(d.oczekujeOdpr) : ''].filter(Boolean);
    const rows = (d.lista || []).map(r => {
      const plus = r.rodzaj === 'Odpracowanie';
      return el('div', { class: 'row' }, el('span', { class: 'grow' }, `${fmtDate(r.data)} · ${r.od}–${r.do}`),
        el('span', null, el('b', { style: `color:var(${plus ? '--green' : '--red'})` }, (plus ? '+' : '−') + fmtH(r.godziny)), ' ', statusBadge(r.status)));
    });
    fill(saldo, el('div', { class: 'form-title' }, 'Saldo godzin'), note || '', el('div', { class: 'pill ' + cls }, txt),
      oczek.length ? el('div', { class: 'status wait' }, '⏳ Oczekuje na zatwierdzenie: ' + oczek.join(', ')) : null, rows);
  };
  const load = () => cachedLoad({ key: 'saldoWyjsc', action: 'getSaldoWyjsc', ctx, render: renderSaldo, container: el('div') })
    .then(r => { if (!r.data) fill(saldo, el('div', { class: 'form-title' }, 'Saldo godzin'), el('div', { class: 'muted' }, 'Brak danych (offline).')); }).catch(() => {});

  const form = saveForm({
    ctx, prefill, action: 'zapiszWyjscie', title: 'Wcześniejsze wyjście / odpracowanie', submitLabel: 'Zgłoś do zatwierdzenia', color: 'var(--orange)',
    controls: [field('Rodzaj', rodzaj), field('Data', data), el('div', { class: 'row2' }, field('Godz. od', od), field('Godz. do', doo)), field('Powód / uwagi', uwagi)],
    collect: () => ({ rodzaj: rodzaj.value, data: data.value, godzOd: od.value, godzDo: doo.value, uwagi: uwagi.value.trim() }),
    validate: v => !v.data || !v.godzOd || !v.godzDo ? 'Wypełnij datę i godziny.' : v.godzDo <= v.godzOd ? 'Godzina „do” musi być późniejsza niż „od”.' : '',
    reset: () => { uwagi.value = ''; },
    onSaved: load,
  });
  container.append(el('div', { class: 'view' }, form, saldo));
  load();
}
