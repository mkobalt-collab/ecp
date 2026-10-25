// PDF z base64 w dwóch krokach: generowanie trwa 5–60 s, a po tym czasie przeglądarka nie pozwala już
// na share / window.open (wygasła aktywacja użytkownika). Dlatego po nadejściu pliku pokazujemy pasek
// z przyciskiem — dopiero jego stuknięcie udostępnia (iOS/Android) albo otwiera plik w nowej karcie.
let currentBar = null; // { node, url }

function closeBar() {
  if (!currentBar) return;
  const { node, url } = currentBar;
  currentBar = null;
  node.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000); // karta mogła jeszcze nie wczytać pliku
}

function button(text, cls, onclick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', onclick);
  return b;
}

export function offerPdf({ base64, nazwa }) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const name = nazwa || 'dokument.pdf';
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const file = new File([blob], name, { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  closeBar();
  const node = document.createElement('div');
  node.className = 'pdf-bar';
  node.setAttribute('role', 'status');
  const open = button(`Otwórz / Udostępnij PDF (${name})`, 'pdf-open', async () => {
    let canShare = false;
    try { canShare = !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { canShare = false; }
    if (canShare) {
      try {
        await navigator.share({ files: [file], title: name });
        if (currentBar && currentBar.node === node) closeBar();
      } catch (e) {
        if (!e || e.name !== 'AbortError') console.warn('share:', e); // pasek zostaje — można spróbować ponownie
      }
      return;
    }
    window.open(url, '_blank'); // jedna akcja: tylko nowa karta, bez dodatkowego pobierania
    if (currentBar && currentBar.node === node) closeBar();
  });
  const close = button('✕', 'pdf-close', () => { if (currentBar && currentBar.node === node) closeBar(); });
  close.setAttribute('aria-label', 'Zamknij');
  node.append(open, close);
  document.body.append(node);
  currentBar = { node, url };
  open.focus({ preventScroll: true });
}
