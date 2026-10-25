# GROUP-ON-VET — ewidencja czasu pracy (PWA)

Instalowalna aplikacja mobilna (PWA) do wpisywania godzin, urlopów i wyjść, z pracą offline
i panelem administratora. Składa się z:

- `pwa/` — aplikacja (statyczne pliki publikowane na GitHub Pages),
- `apps-script/api.gs` — API dodawane do istniejącego projektu Google Apps Script (nie zmienia istniejącego kodu),
- `dev/` — lokalny serwer z atrapą API do testów,
- `tests/` — testy automatyczne (Node).

## Polecenia

```
npm install        # jednorazowo (zależność testowa: fake-indexeddb)
npm test           # testy automatyczne
node dev/server.mjs   # lokalny podgląd na http://localhost:8080 z atrapą API
```

Dane logowania atrapy (tylko lokalnie): PIN `1111` — pracownik, PIN `9999` — administrator.
Zmienne: `PORT`, `MOCK_OFFLINE=1`, `MOCK_DELAY_MS`.

## Dokumentacja

- [Wdrożenie krok po kroku](docs/wdrozenie-apps-script.md) — Apps Script, GitHub Pages, bezpieczeństwo, wycofanie
- [Instalacja dla pracowników](docs/instalacja.md)
- [Testy akceptacyjne na prawdziwym arkuszu](docs/testy-akceptacyjne.md)

**Każda zmiana w `pwa/` wymaga podniesienia `VERSION` w `pwa/sw.js`**, inaczej telefony zostaną przy starych plikach.
Repozytorium jest publiczne; pliki `.docx` i `reference/` są w `.gitignore`.
