// Otwieranie PDF z base64: udostępnienie (iOS/Android) lub pobranie/otwarcie w karcie.
export async function openPdf({ base64, nazwa }) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const name = nazwa || 'dokument.pdf';
  try {
    const file = new File([blob], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // użytkownik zamknął arkusz udostępniania
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
