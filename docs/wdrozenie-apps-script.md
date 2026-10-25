# Wdrożenie krok po kroku

Ta instrukcja jest dla właściciela systemu. Nie wymaga programowania — wystarczy kopiuj-wklej.
Całość zajmuje ok. 20–30 minut. Istniejące strony (formularz, panel admina, karta) **nie są zmieniane** i działają dalej.

## Część A. Apps Script (część serwerowa)

1. Otwórz arkusz Google z danymi czasu pracy (ten, do którego jest przypięty obecny skrypt).
2. Wybierz z menu **Rozszerzenia → Apps Script**. Otworzy się edytor skryptu.
3. W lewym panelu kliknij **+** obok napisu „Pliki” i wybierz **Skrypt**. Nazwij nowy plik `api`
   (edytor sam doda `.gs`).
4. Otwórz na swoim komputerze plik `apps-script/api.gs` z tego projektu, zaznacz całą treść
   (Cmd+A / Ctrl+A), skopiuj i wklej w nowy plik `api` w edytorze (zastąp domyślną pustą funkcję). Kliknij ikonę dyskietki (**Zapisz**).
5. Nie zmieniaj żadnego z istniejących plików skryptu.
6. U góry edytora, na liście funkcji obok przycisku **Uruchom**, wybierz `apiSetup`, po czym kliknij **Uruchom**.
7. Przy pierwszym uruchomieniu Google poprosi o zgodę na uprawnienia:
   - kliknij **Sprawdź uprawnienia**,
   - wybierz swoje konto Google,
   - jeśli pojawi się ostrzeżenie „Ta aplikacja nie została zweryfikowana”, kliknij **Zaawansowane**, a potem **Otwórz: (nazwa projektu) (niebezpieczne)** — to Twój własny skrypt, więc to normalne,
   - kliknij **Zezwól**.
8. `apiSetup` robi trzy rzeczy (możesz je uruchomić ponownie bez szkody):
   - dopisuje nagłówek **Rola** w pierwszej wolnej kolumnie arkusza `Pracownicy` (za ostatnią zajętą, najwcześniej w kolumnie I — kolumn G i H z limitami urlopu nie rusza); jeśli kolumna „Rola” już jest, nic nie zmienia,
   - tworzy ukryty arkusz `API_Log` (dziennik zapisów chroniący przed duplikatami),
   - tworzy tajny klucz aplikacji i codzienny wyzwalacz czyszczący stare wpisy dziennika (starsze niż 60 dni).
9. W arkuszu `Pracownicy` znajdź kolumnę z nagłówkiem **Rola** (zwykle I) i przy swoim wierszu wpisz w niej `admin`
   (wielkość liter i spacje nie mają znaczenia). Osoby bez wpisu to zwykli pracownicy.
   **Nie wpisuj niczego w kolumny G i H** — to limity urlopu (bieżący i zaległy) używane przez obecny system.
   Rola jest sprawdzana przy każdym działaniu — usunięcie wpisu `admin` odbiera dostęp do panelu od razu.
10. Kliknij **Wdróż → Nowe wdrożenie**. Obok „Wybierz typ” kliknij zębatkę i wybierz **Aplikacja internetowa**. Ustaw:
    - Opis: np. „Aplikacja mobilna”,
    - **Wykonaj jako: Ja**,
    - **Kto ma dostęp: Każdy**.

    Kliknij **Wdróż** (jeśli zapyta o uprawnienia — zezwól jak w kroku 7).
11. Skopiuj **Adres URL aplikacji internetowej**. Kończy się na `/exec`. Zachowaj go.

> **Ważne: nie edytuj istniejącego wdrożenia** (tego, z którego korzystają dziś pracownicy).
> Zawsze twórz **Nowe wdrożenie** — stare zostaje przypięte do swojej wersji i działa jak dotąd.
> Wdrożenie dla aplikacji mobilnej ma własny adres `/exec`.

## Część B. Wklejenie adresu do aplikacji

1. Otwórz plik `pwa/config.js`.
2. Zamień tekst `WKLEJ_ADRES_EXEC` na skopiowany adres `/exec` (zostaw apostrofy dookoła):
   ```js
   ... : 'https://script.google.com/macros/s/XXXX/exec';
   ```
   Fragment `'/api'` wcześniej w tej linii służy tylko do testów lokalnych — nie ruszaj go.
3. Zapisz plik. Zatwierdź zmianę w git i przenieś kod na gałąź `main` — aplikacja powstała na gałęzi
   `feature/pwa`, a GitHub Pages publikuje tylko `main`. W terminalu, w folderze projektu:
   ```sh
   git checkout feature/pwa
   git add pwa/config.js
   git commit -m "Adres serwera aplikacji mobilnej"
   git checkout main
   git merge feature/pwa
   ```
   Wypchnięcie na GitHub — w części C, krok 2.

## Część C. Publikacja na GitHub Pages

1. Na github.com utwórz **publiczne** repozytorium (przy darmowym koncie GitHub Pages wymaga publicznego).
   W repozytorium nie ma żadnych haseł ani PIN-ów. Pliki `.docx` i folder `reference/` są w `.gitignore`
   i nie trafią do repozytorium.
2. Wypchnij gałąź `main` (z części B, krok 3) do repozytorium:
   ```sh
   git remote add origin <adres repozytorium>   # tylko za pierwszym razem
   git push -u origin main
   ```
   Przy kolejnych zmianach wystarczy: commit na `main` (albo merge `feature/pwa` → `main`) i `git push`.
3. W repozytorium wejdź w **Settings → Pages** i w polu **Source** wybierz **GitHub Actions**.
4. Zakładka **Actions** pokaże przebieg „Publikacja na GitHub Pages”. Po zielonym znaczniku
   adres aplikacji (`https://<twoja-nazwa>.github.io/<repozytorium>/`) widać w Settings → Pages. Ten link wysyłasz pracownikom razem z instrukcją `docs/instalacja.md`.
5. Workflow publikuje wyłącznie folder `pwa/`.

### Każda aktualizacja aplikacji: podnieś `VERSION` w `pwa/sw.js`

> **Przy każdej zmianie w folderze `pwa/` zmień numer w pierwszej linii pliku `pwa/sw.js`**,
> np. `const VERSION = 'v1';` → `const VERSION = 'v2';`.
> Aplikacja zapisuje swoje pliki w telefonie (pamięć podręczna). Bez zmiany numeru telefony
> będą dalej używać starych plików i nie zobaczą poprawek.

## Zalecenia bezpieczeństwa

- **Ustaw PIN-y co najmniej 6-cyfrowe.** Aplikacja blokuje zgadywanie (5 błędów z jednego urządzenia = blokada
  tego urządzenia na 30 minut; 20 błędów łącznie ze wszystkich urządzeń = logowanie wstrzymane dla
  wszystkich na godzinę — osoby już zalogowane pracują dalej normalnie), ale dłuższy PIN to dużo większa ochrona.
- **Wylogowanie wszystkich** (np. po zgubieniu telefonu): w edytorze Apps Script wybierz funkcję
  `apiWylogujWszystkich` i kliknij **Uruchom**. Tworzy nowy tajny klucz, więc wszystkie
  dotychczasowe sesje wygasają, a pracownicy muszą ponownie wpisać PIN. Niewysłane wpisy
  w telefonach pozostają w kolejce i wyślą się po zalogowaniu.
- Sesja sama wygasa po 30 dniach.
- **Uwaga:** stary link `?page=admin` (strona administratora w wersji sprzed aplikacji) **nadal nie ma logowania** — każdy, kto zna link, może ją otworzyć. Zalecamy w przyszłości
  ukryć lub zabezpieczyć tę stronę.

## Wycofanie zmian

Gdyby coś poszło nie tak:

1. W edytorze Apps Script: **Wdróż → Zarządzaj wdrożeniami**, wybierz wdrożenie aplikacji mobilnej (nie to, z którego korzystają pracownicy dziś) i je **zarchiwizuj/usuń**.
2. Usuń plik `api` z projektu (przy nazwie pliku trzy kropki → **Usuń**).
3. To przywraca stan sprzed zmian. Kolumna „Rola” i ukryty arkusz `API_Log` mogą zostać lub możesz je usunąć ręcznie.
   Codzienny wyzwalacz `apiLogCleanup` usuń w **Wyzwalacze** (ikona zegara w lewym panelu).

## Limity i uwagi

- Generowanie PDF trwa kilka–kilkanaście sekund — to normalne.
- Jedno wywołanie Apps Script trwa maksymalnie 6 minut, równolegle obsługiwanych jest ok. 30 — dla firmy tej skali w zupełności wystarcza.
- iPhone może usunąć dane aplikacji nieużywanej przez kilka tygodni. Wtedy trzeba ponownie podać PIN; niewysłane wpisy są wysyłane przy każdym uruchomieniu.
