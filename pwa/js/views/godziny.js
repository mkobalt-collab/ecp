import { el, fill, field, todayIso, cachedLoad, saveForm, confirmOvernight } from '../ui.js';

export function mount(container, ctx, prefill) {
  const a = (prefill && prefill.args) || {};
  const data = el('input', { class: 'field', type: 'date', value: a.data || todayIso() });
  const od = el('input', { class: 'field', type: 'time', value: a.godzOd || '08:00' });
  const doo = el('input', { class: 'field', type: 'time', value: a.godzDo || '16:00' });
  const uwagi = el('textarea', { class: 'field', placeholder: 'praca zdalna, wyjazd...' }, a.uwagi || '');
  const missing = el('div', { class: 'missing', hidden: true });
  const stale = el('div');

  const renderMissing = (days, { note } = {}) => {
    fill(stale, note || '');
    missing.hidden = !days || !days.length;
    if (missing.hidden) return;
    fill(missing, 'Brakujące dni w tym miesiącu — stuknij, aby uzupełnić:', el('br'),
      days.map(d => el('button', { type: 'button', onclick: () => { data.value = d.iso; window.scrollTo(0, 0); } }, d.label)));
  };
  const loadMissing = () => cachedLoad({ key: 'brakujaceDni', action: 'getBrakujaceDni', ctx, render: renderMissing, container: el('div') }).catch(() => {});

  const form = saveForm({
    ctx, prefill, action: 'zapiszGodziny', title: 'Zgłoś dzień pracy', submitLabel: 'Zapisz godziny',
    controls: [field('Data', data), el('div', { class: 'row2' }, field('Godz. od', od), field('Godz. do', doo)), field('Uwagi', uwagi)],
    collect: () => ({ data: data.value, godzOd: od.value, godzDo: doo.value, projekt: '', uwagi: uwagi.value.trim() }),
    validate: v => !v.data || !v.godzOd || !v.godzDo ? 'Wypełnij datę i godziny.' : v.godzDo === v.godzOd ? 'Godzina „do” musi być późniejsza niż „od”.' : '',
    confirmSave: v => confirmOvernight(v.godzOd, v.godzDo),
    reset: () => { uwagi.value = ''; },
    onSaved: () => { loadMissing(); },
  });
  container.append(el('div', { class: 'view' }, stale, missing, form));
  loadMissing();
}
