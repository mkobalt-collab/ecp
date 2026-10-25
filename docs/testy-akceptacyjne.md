# Testy akceptacyjne na prawdziwym arkuszu

Wykonaj po wdrożeniu `api.gs` i opublikowaniu aplikacji (patrz `docs/wdrozenie-apps-script.md`).
Użyj konta testowego pracownika i swojego konta z rolą `admin`. Odhaczaj `[x]`.

## Logowanie
- [ ] Poprawny PIN loguje i pokazuje ekrany pracownika.
- [ ] Błędny PIN pokazuje czytelny komunikat (bez informacji technicznych).
- [ ] 5 błędnych PIN-ów z jednego telefonu blokuje logowanie na 15 minut (komunikat o blokadzie).
- [ ] Po upływie blokady poprawny PIN działa.
- [ ] Po `apiWylogujWszystkich` aplikacja prosi o PIN, a niewysłane wpisy z kolejki zostają.

## Zapis online
- [ ] Zapis godzin online: wiersz pojawia się w arkuszu w poprawnej kolumnie i dacie.
- [ ] Zapis urlopu online: wiersz pojawia się w arkuszu `Urlopy`.
- [ ] Zapis wyjścia online: wiersz pojawia się w arkuszu wyjść.
- [ ] Wpis jest widoczny w zakładce **Wpisy** (z sumami przepracowanych godzin i nadgodzin).

## Offline i synchronizacja
- [ ] Tryb samolotowy: zapis godzin pokazuje ⏳ i licznik **Do wysłania**.
- [ ] Po wyłączeniu trybu samolotowego wpis sam trafia do arkusza, ⏳ znika.
- [ ] Dwukrotna synchronizacja tego samego wpisu (szybkie dwa dotknięcia **Zapisz** albo wymuszona ponowna wysyłka) daje **jeden** wiersz w arkuszu (brak duplikatu).
- [ ] Wpis offline z błędem merytorycznym (np. wyjście z „od” późniejszym niż „do”) dostaje ❗ z komunikatem; pozostałe wpisy z kolejki dochodzą.
- [ ] **Popraw** na ❗ otwiera formularz z danymi; po poprawce wpis zapisuje się poprawnie.
- [ ] Korekta i usuwanie wpisu działają tylko online (offline pokazują komunikat, że wymagają internetu).

## Panel administratora
- [ ] Pracownik bez roli `admin` nie widzi zakładki **Panel**.
- [ ] Admin widzi **Panel** i listę wniosków.
- [ ] Zatwierdzenie wniosku urlopowego: status zmienia się w arkuszu i w aplikacji, a pracownik dostaje mail.
- [ ] Odrzucenie wniosku działa analogicznie.
- [ ] Odebranie roli: usuń `admin` z kolumny G admina; kolejna akcja panelu kończy się odmową dostępu (`FORBIDDEN`), bez ponownego logowania.
- [ ] Pracownik usunięty z arkusza `Pracownicy` traci dostęp od razu (kolejna akcja wymaga PIN-u i się nie udaje).

## PDF
- [ ] Pobranie karty pracownika (PDF): generuje się w ciągu kilkunastu sekund i otwiera poprawnie.
- [ ] Pobranie PDF raportu z panelu admina: otwiera się poprawnie, dane zgadzają się z arkuszem.

## Istniejące strony
- [ ] Dotychczasowy link do formularza działa jak wcześniej i zapisuje do arkusza.
- [ ] Dotychczasowy link `?page=admin` i strona karty działają jak wcześniej.
- [ ] Arkusz `Pracownicy`: dodatkowa kolumna G „Rola” nie zepsuła niczego w istniejących funkcjach.

## Instalacja i aktualizacje
- [ ] Instalacja na iPhonie (Safari → Do ekranu początkowego) i na Androidzie (Chrome → Zainstaluj aplikację) zgodnie z `docs/instalacja.md`.
- [ ] Po zmianie `VERSION` w `pwa/sw.js` i publikacji telefon dostaje nową wersję aplikacji (po ponownym uruchomieniu).
