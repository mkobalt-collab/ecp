# Ewidencja czasu pracy — aplikacja mobilna (PWA) zsynchronizowana z Apps Script

Data: 2026-10-25
Status: projekt do akceptacji

## 1. Cel

Pracownicy GROUP-ON-VET i administrator mają mieć aplikację zainstalowaną na telefonie
(iPhone i Android), która zapisuje i odczytuje dane z istniejącego systemu ewidencji
czasu pracy w Google Apps Script + Arkusz Google.

Kryteria sukcesu:

- aplikację można zainstalować na ekranie głównym telefonu z linku, bez sklepów;
- pracownik może zrobić wszystko, co dziś w `form` (godziny, NB/urlop, wyjścia, moje wpisy, korekty);
- administrator może zrobić w telefonie to, co dziś w `admin` (wnioski, wyjścia, nieobecności, raporty PDF);
- nowe wpisy pracownika zapisane bez zasięgu trafiają do arkusza automatycznie po odzyskaniu internetu, bez duplikatów;
- dane trafiają do tego samego arkusza co dziś; obecne strony `form`, `admin`, `karta` działają dalej bez zmian.

## 2. Ustalenia z rozmowy

| Pytanie | Decyzja |
|---|---|
| Kto używa | Pracownicy + administrator, jedna aplikacja |
| Platforma | PWA (instalacja z przeglądarki), hosting GitHub Pages |
| Logowanie admina | PIN jak pracownik + kolumna „Rola” = `admin` w arkuszu Pracownicy |
| Offline | Tak — kolejka nowych wpisów + podgląd ostatnio pobranych danych |

Poza zakresem (na teraz): powiadomienia push, logowanie kontem Google, edycja listy
pracowników z telefonu, publikacja w App Store / Google Play.

## 3. Stan obecny (z plików GS / FORM / ADMIN / KARTA)

- Projekt Apps Script powiązany z arkuszem (`getActiveSpreadsheet`, `onOpen`, `onEdit`).
- Arkusze: `Pracownicy` (ID, Imię, Nazwisko, Email, Stanowisko, PIN — kol. A–F; G = limit
  urlopu bieżący, H = limit urlopu zaległy — czytane przez `getUrlopySummary` / `getWnioskiOczekujace`),
  `Godziny`,
  `Urlopy` (kol. J = ID wniosku), `Wyjścia`, `Święta`.
- `doGet` serwuje `form` / `admin` / `karta` przez HtmlService; strony wołają funkcje
  przez `google.script.run`.
- PDF-y są generowane na serwerze i zwracane jako `{ ok, base64, nazwa }`.

**Luki bezpieczeństwa, które nowy API naprawia (dla aplikacji mobilnej):**

1. Panel admina nie ma logowania — każdy, kto zna `?page=admin`, może zatwierdzać wnioski.
2. Funkcje pracownika przyjmują `pracownikId` od klienta; PIN jest sprawdzany tylko przy
   logowaniu w przeglądarce. Przez `google.script.run` da się wywołać dowolną funkcję
   z dowolnym ID.

Nowy API nie pozwala na żadne z powyższych. Obecne strony HtmlService pozostają takie jak
są (ich zabezpieczenie to osobny temat — patrz §10).

## 4. Architektura

```
Telefon (PWA, GitHub Pages)                 Google Apps Script (ten sam projekt)
┌───────────────────────────────┐  HTTPS    ┌──────────────────────────────────────┐
│ index.html / app.js / sw.js   │──POST────▶│ doPost(e)  [api.gs]                   │
│ IndexedDB:                    │ text/plain│  1. parsuj JSON {action, token, args} │
│  - outbox (kolejka zapisów)   │  JSON     │  2. weryfikuj token (HMAC)            │
│  - cache odczytów             │◀──JSON────│  3. sprawdź uprawnienia akcji         │
│ service worker: pliki offline │           │  4. wywołaj istniejącą funkcję GS     │
└───────────────────────────────┘           └──────────────┬───────────────────────┘
                                                           ▼
                                                    Arkusz Google
```

Dlaczego tak: tylko statyczna strona na HTTPS spoza HtmlService może mieć manifest
i service worker (instalacja + offline). HtmlService działa w ramce sandbox Google,
w której PWA nie jest możliwa.

Żądania wysyłane są jako `POST` z `Content-Type: text/plain`, co nie wywołuje preflightu
CORS; Apps Script (`ContentService`, JSON) zwraca odpowiedź przez przekierowanie,
które `fetch` obsługuje.

## 5. Backend — `apps-script/api.gs`

Nowy plik dodawany do istniejącego projektu. Nie zmienia istniejących funkcji.

### 5.1 Kontrakt

Żądanie: `{ "action": "zapiszGodziny", "token": "…", "args": { … }, "clientId": "uuid" }`
Odpowiedź: `{ "ok": true, "data": … }` albo `{ "ok": false, "error": "komunikat", "code": "AUTH|FORBIDDEN|BAD_REQUEST|SERVER" }`

`code` = `AUTH` → aplikacja wylogowuje i prosi o PIN.

### 5.2 Logowanie i token

- `login { pin }` → `weryfikujPin` → token + `{ id, imie, nazwisko, rola }`.
- Token bezstanowy: `base64(payload).base64(HMAC-SHA256(payload, SECRET))`,
  payload = `{ id, exp }`, ważność 30 dni. `SECRET` generowany przy pierwszym użyciu
  i trzymany w Script Properties (`API_SECRET`).
- Przy każdym żądaniu: weryfikacja podpisu i `exp`, potem odczyt pracownika z arkusza.
  **Rola jest zawsze czytana z arkusza, nie z tokenu**, więc odebranie roli działa od razu;
  usunięcie pracownika z arkusza unieważnia jego token.
- Rotacja `API_SECRET` (funkcja `apiWylogujWszystkich()`) unieważnia wszystkie sesje.
- Rola jest w kolumnie `Pracownicy` z nagłówkiem „Rola” (wiersz 1, bez względu na wielkość
  liter / spacje; wartość `admin` lub puste). Kolumny G i H to limity urlopu — nie są używane.
  Funkcja `apiSetup()` dopisuje nagłówek „Rola”, jeśli żadna komórka wiersza 1 go nie ma,
  w kolumnie max(ostatnia zajęta + 1, I) — nigdy w A–H. Brak kolumny „Rola” = wszyscy są
  pracownikami.

### 5.3 Ochrona przed zgadywaniem PIN-u

Apps Script nie zna adresu IP klienta, więc blokada jest dwupoziomowa (CacheService):

- per urządzenie: aplikacja wysyła losowy `deviceId`; 5 błędnych prób → 15 min blokady
  tego urządzenia;
- globalnie: 30 błędnych prób w 15 min → logowanie wstrzymane dla wszystkich na 15 min
  (chroni przed atakiem z wielu „urządzeń” naraz).

Zalecenie dla Ciebie: PIN-y co najmniej 6-cyfrowe (4 cyfry to tylko 10 000 kombinacji).

### 5.4 Akcje

`pracownikId` zawsze pochodzi z tokenu — argument od klienta jest ignorowany.

Pracownik (i admin):

| Akcja | Funkcja GS | Offline (kolejka) |
|---|---|---|
| `init` | `getTypyNieobecnosci`, `getTypyWyjsc` + dane użytkownika | — |
| `zapiszGodziny` | `sprawdzDuplikat(id, data)` (jak FORM: drugi wpis na ten dzień → `REJECTED` „Masz już wpis na ten dzień…”), potem `zapiszGodziny` | tak |
| `zapiszUrlop` | `zapiszUrlop` | tak |
| `zapiszWyjscie` | `zapiszWyjscie` | tak |
| `getMojeWpisy` | `getMojeWpisy(id, rok, miesiac)` | cache |
| `getSaldoWyjsc` | `getSaldoWyjsc(id)` | cache |
| `getUrlopySummary` | `getUrlopySummary(id)` | cache |
| `getBrakujaceDni` | `getBrakujaceDni(id)` | cache |
| `korygujGodziny` | `korygujGodziny(id, wiersz, dane)` | nie (online) |
| `usunGodziny` / `usunNieobecnosc` / `usunWyjscie` | jak w GS | nie (online) |
| `mojaKarta` | `generujKartePracownika(id, rok, miesiac)` → PDF | nie |

Korekty i usunięcia są tylko online, bo operują na numerze wiersza, który zmienia się
po każdym usunięciu w arkuszu — wykonanie ich z opóźnieniem mogłoby trafić w zły wiersz.

Tylko admin:

| Akcja | Funkcja GS |
|---|---|
| `getWnioskiOczekujace` | `getWnioskiOczekujace` |
| `ustawStatusUrlopu` | `ustawStatusUrlopu(idWniosku, status)` + wpis imienia admina w kol. K |
| `pdfWniosku` | `generujPdfZPanelu(idWniosku)` |
| `getWyjsciaAdmin` / `zmienStatusWyjscia` / `adminUsunWyjscie` | jak w GS |
| `getNieobecnosciAdmin` / `adminUsunNieobecnosc` | jak w GS |
| `getPracownicy` / `getHistoriaPracownika` | jak w GS (bez PIN-ów) |
| `getRaportMiesieczny` | jak w GS |
| `pdfRaportMiesieczny` | `generujRaportMiesiecznyPdf` |
| `pdfKartyEwidencji` | `generujKartyEwidencji` |
| `pdfNadgodziny` | `generujRaportNadgodzinDoWeryfikacji` |
| `pdfWnioskiMiesiaca` | `generujPdfWnioskowMiesiaca` |
| `pdfKsiegowosc` | `generujRaportKsiegowosc` |
| `pdfZestawienie` | `generujZestawienieNadgodzinUrlopy` |
| `pdfKartaPracownika` | `generujKartePracownika(dowolne id)` |

(`ustawStatusUrlopu` z anonimowym wdrożeniem nie zna e-maila zatwierdzającego —
`Session.getActiveUser()` zwraca pusty tekst — więc API dopisuje imię i nazwisko admina.)

Każda nieznana akcja → `BAD_REQUEST`. Lista akcji jest jawna (whitelist); żadna inna
funkcja GS nie jest dostępna przez API.

Wyniki zwracające `Date` są serializowane do tekstu (`yyyy-MM-dd` / ISO) przed wysłaniem.

### 5.5 Brak duplikatów przy ponownej wysyłce

Każdy zapis z kolejki ma `clientId` (UUID nadany w telefonie). API trzyma ukryty arkusz
`API_Log` (clientId, czas, pracownik, akcja, wynik). Jeśli `clientId` już tam jest,
API zwraca zapisany wcześniej wynik i nic nie zapisuje drugi raz. Arkusz (a nie
CacheService, który trzyma max 6 h) wybrano, bo telefon może być offline dłużej.
Zapis jest objęty `LockService`, żeby dwa równoczesne żądania z tym samym `clientId`
nie przeszły oba. Wpisy starsze niż 60 dni są czyszczone przy okazji.

Dodatkowo działa dzisiejsza ochrona `zapiszUrlop` przed dublami wniosków.

## 6. Frontend — `pwa/`

Czysty HTML/CSS/JS, bez frameworka i bez etapu budowania. Styl jak obecne strony
(kolor główny `#1a56db`, Arial), zoptymalizowany pod telefon.

Pliki:

- `index.html` — szkielet, ekran logowania, zakładki;
- `config.js` — adres API (`…/exec`);
- `api.js` — wywołania `fetch`, obsługa `AUTH`;
- `store.js` — IndexedDB: `outbox`, `cache`, sesja;
- `sync.js` — wysyłanie kolejki (start aplikacji, zdarzenie `online`, co 60 s gdy są
  wpisy, przycisk „Synchronizuj”);
- `views/*.js` — ekrany pracownika i admina;
- `pdf.js` — PDF w dwóch krokach: generowanie trwa 5–60 s, a po tym czasie przeglądarka blokuje
  `navigator.share` / `window.open` (wygasła aktywacja), więc po nadejściu pliku pokazujemy pasek
  „Otwórz / Udostępnij PDF (nazwa)”; jego stuknięcie udostępnia plik albo otwiera go w nowej karcie;
- `sw.js` — service worker (pliki aplikacji w cache, wersjonowanie);
- `manifest.webmanifest`, `icons/` (192, 512, maskable, apple-touch-icon).

### 6.1 Ekrany

**Logowanie** — klawiatura numeryczna, PIN; sesja zapamiętana 30 dni; „Wyloguj” w menu.
Start z zapisaną sesją: powłoka i zakładki od razu z zapisanego `init`, świeży `init` w tle
(zmiana roli przebudowuje zakładki); bez zapisanego `init` — powłoka z „Wczytywanie...”.

**Pracownik** (dolny pasek):

1. **⏱ Godziny** — data (domyślnie dziś), od–do, projekt, uwagi; po zapisie
   przepracowane/nadgodziny („Zapisano — 8.00 h, nadgodziny 0.00 h”, gdy wysłano od razu).
   „Do” wcześniejsze niż „od” = praca przez północ (po potwierdzeniu; GS liczy +24 h), także w korekcie. Baner „Brakujące dni” — tap ustawia datę.
2. **🏖 NB/Urlop** — typ, zakres dat, uwagi; saldo urlopowe; lista wniosków ze statusem.
3. **🕐 Wyjścia** — wyjście prywatne / odpracowanie, data, od–do, uwagi; saldo.
4. **📋 Moje wpisy** — miesiąc ← →; godziny, nieobecności, wyjścia; korekta i usuwanie
   (online); „Moja karta PDF”.

**Admin** — dodatkowa zakładka **⚙ Panel** z sekcjami: Wnioski oczekujące
(Zatwierdź / Odrzuć / PDF), Wyjścia, Nieobecności, Raporty (wybór miesiąca + przyciski PDF),
Historia pracownika. Panel działa tylko online.

### 6.2 Offline i synchronizacja

- Zapis → wpis trafia do `outbox` z `clientId` i statusem ⏳, od razu widoczny w „Moje wpisy”
  jako „do wysłania”; jeśli jest internet, wysyłka rusza natychmiast.
- Licznik „Do wysłania: N” w nagłówku.
- Wysyłka po kolei, najstarsze najpierw. Błąd sieci → wpis zostaje, ponowienie później.
  Błąd merytoryczny z serwera (np. „godzina zakończenia wcześniejsza”) → wpis oznaczony ❗
  z komunikatem; pracownik może go poprawić albo usunąć z kolejki.
- `AUTH` w trakcie synchronizacji → kolejka zostaje nietknięta, prośba o PIN, potem wysyłka.
- Odczyty: najpierw cache (z datą „stan z …”), w tle odświeżenie z serwera.
- Wylogowanie z niewysłanymi wpisami → ostrzeżenie przed utratą danych.

### 6.3 Aktualizacje aplikacji

`sw.js` ma numer wersji. Po wgraniu nowej wersji telefon pobiera ją w tle i pokazuje
pasek „Nowa wersja — odśwież”.

## 7. Wdrożenie

1. **Apps Script**: dodaj plik `api.gs` (wkleić z `apps-script/api.gs`), uruchom raz
   `apiSetup()` (nagłówek „Rola”, arkusz `API_Log`, sekret), wpisz `admin` w kolumnie „Rola”
   (dopisanej przez `apiSetup`, najczęściej I) przy swoim wierszu. Wdrożenie: **osobne, nowe wdrożenie** (*Wdróż → Nowe wdrożenie →
   Aplikacja internetowa*, „Wykonaj jako: ja”, „Dostęp: każdy”) z własnym adresem `/exec`
   tylko dla aplikacji mobilnej. Istniejącego wdrożenia (link używany dziś przez
   pracowników) **nie edytujemy** — zostaje przypięte do swojej wersji i działa jak dotąd.

   Wpływ na obecny system (sprawdzone w kodzie):
   - `api.gs` dodaje wyłącznie nowe funkcje z prefiksem `api…` i `doPost` — w projekcie
     nie ma dziś `doPost` ani funkcji o tych nazwach; istniejące funkcje nie są zmieniane.
   - Nowa kolumna „Rola” w `Pracownicy` (za ostatnią zajętą, nie wcześniej niż I): obecny kod
     czyta tylko kolumny A–H po indeksie (G, H = limity urlopu), więc dodatkowa kolumna nic nie
     zmienia.
   - Ukryty arkusz `API_Log`: żaden istniejący kod nie przechodzi po wszystkich arkuszach;
     `onEdit` reaguje tylko na arkusz `Urlopy` i tylko na ręczne edycje.
   - Wspólne limity (czas wykonania, wysyłka maili) dzielone z obecnymi stronami —
     przy tej skali bez znaczenia.
   - Wycofanie: usunięcie wdrożenia mobilnego i pliku `api.gs` przywraca stan sprzed zmian
     (kolumna „Rola” i `API_Log` mogą zostać lub zostać usunięte ręcznie).
2. **GitHub Pages**: repozytorium z tym projektem; workflow GitHub Actions publikuje
   folder `pwa/`. Uwaga: przy darmowym koncie repozytorium z GitHub Pages musi być
   **publiczne** — dlatego do repozytorium trafia tylko `pwa/`, `apps-script/api.gs`
   i dokumentacja; pliki `.docx` są w `.gitignore`. W kodzie aplikacji nie ma żadnych
   haseł ani PIN-ów; adres `/exec` jest jawny, a ochronę zapewnia token.
3. **Instalacja**: iPhone — Safari → Udostępnij → „Do ekranu początkowego”;
   Android — Chrome → „Zainstaluj aplikację”. Instrukcja dla pracowników w `docs/instalacja.md`.

## 8. Obsługa błędów

- Każda akcja API w `try/catch`; wyjątek → `{ ok:false, code:"SERVER", error }`
  i wpis w logu Apps Script.
- Limit czasu `fetch` 30 s (PDF-y do 60 s); przekroczenie = błąd sieci.
- Czytelne komunikaty po polsku w aplikacji; brak „surowych” błędów technicznych.

## 9. Testy

- **Backend** (Node, `node:test`): `api.gs` ładowany w `vm` z atrapami
  `SpreadsheetApp`/`CacheService`/`PropertiesService`/`LockService`/`Utilities`.
  Testy: token (podpis, wygaśnięcie, podrobiony), uprawnienia (pracownik nie wywoła akcji
  admina, `pracownikId` z argumentów jest ignorowany), blokada PIN-u, idempotencja
  `clientId`, nieznana akcja, serializacja dat.
- **Frontend** (Node): logika kolejki i synchronizacji (kolejność, ponowienia, błąd
  merytoryczny vs sieciowy, `AUTH`) z atrapą `fetch` i IndexedDB (`fake-indexeddb`).
- **Ręcznie / w przeglądarce**: aplikacja uruchomiona lokalnie z atrapą API, widok
  telefonu, tryb offline (DevTools), instalowalność (manifest + SW).
- **Na prawdziwym arkuszu** (po Twoim wdrożeniu `api.gs`): lista kontrolna w
  `docs/testy-akceptacyjne.md` — logowanie, zapis online, zapis offline → synchronizacja,
  zatwierdzenie wniosku, PDF.

## 10. Ryzyka i uwagi

- Obecne strony HtmlService (`?page=admin`) nadal nie mają logowania. Rekomendacja na
  później: po przejściu na aplikację ukryć lub zabezpieczyć `?page=admin`.
- Limity Apps Script: jedno wywołanie trwa max 6 min, a równolegle obsługiwanych jest
  ok. 30 wywołań — wystarczające dla firmy tej skali. Generowanie PDF trwa kilka–kilkanaście
  sekund, stąd dłuższy limit czasu w aplikacji.
- iOS może wyczyścić dane PWA nieużywanej przez kilka tygodni; niewysłana kolejka
  jest więc wysyłana przy każdym uruchomieniu, a sesja wymaga wtedy ponownego PIN-u.
