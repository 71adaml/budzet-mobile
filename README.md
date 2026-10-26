# Budżet domowy – wersja na telefon (iPhone i Android)

Aplikacja webowa do programu **Budżet domowy** (wersja na Windows). Instalujesz ją z Safari (iPhone)
albo z Chrome (Android) na ekranie głównym i działa jak zwykła aplikacja, także bez internetu.

**Twoje dane zostają w telefonie.** Ta strona zawiera tylko kod aplikacji – transakcje,
kategorie i budżety są zapisane w pamięci iPhone'a i nigdzie nie są wysyłane.

## Instalacja na iPhonie

1. Otwórz w **Safari**: https://71adaml.github.io/budzet-mobile/
2. Stuknij **Udostępnij** (kwadrat ze strzałką) → **Dodaj do ekranu początkowego**.
3. Uruchamiaj aplikację z ikony „Budżet” (nie z Safari – tylko wtedy dane są trwale zapisane).

## Instalacja na Androidzie

1. Otwórz w **Chrome**: https://71adaml.github.io/budzet-mobile/
2. Stuknij **Zainstaluj** na pasku u dołu albo menu **⋮ → Zainstaluj aplikację**
   (w aplikacji jest też przycisk w zakładce *Więcej*).
3. Uruchamiaj aplikację z ikony „Budżet”.

## Co potrafi

- Import wyciągu CSV z Credit Agricole (CA24) i PKO BP; inne banki (np. mBank, ING) rozpoznawane automatycznie po nazwach kolumn.
- Automatyczne kategorie (te same reguły co na komputerze).
- Podsumowanie miesiąca, wydatki wg kategorii, prognoza na koniec miesiąca, wykres 6 miesięcy.
- Lista transakcji z wyszukiwaniem, zmiana kategorii, notatki, nowe reguły.
- Budżety (limity na kategorie) z kopiowaniem z poprzedniego miesiąca; stuknięcie kategorii pokazuje jej wydatki w danym miesiącu.
- Ten sam plik bazy `budget.db` co program na Windows – można przenosić dane w obie strony.

## Dla innej osoby

Wystarczy wysłać link. Każdy telefon ma własną, osobną bazę – nikt nie widzi cudzych transakcji.

## Synchronizacja z komputerem

Plik bazy na komputerze: `C:\Users\<nazwa>\.budzet_domowy\budget.db`.

- **Komputer → telefon:** skopiuj `budget.db` do iCloud Drive / OneDrive, w aplikacji: Więcej → *Wczytaj bazę z pliku*.
- **Telefon → komputer:** Więcej → *Zapisz kopię bazy* → *Zachowaj w Plikach*; na komputerze zamknij program i podmień `budget.db`.

Pracuj w jednym miejscu naraz: wczytanie pliku zastępuje dane. Pomarańczowa kropka w nagłówku
oznacza zmiany w telefonie, których jeszcze nie zapisano do pliku.

## Dla programisty

Czysty HTML/CSS/JS bez kompilacji, baza SQLite przez [sql.js](https://github.com/sql-js/sql.js) (MIT, w `vendor/`).
Logika w `js/` odpowiada modułom `logic/` programu na Windows (schemat bazy w wersji 4).
Przy każdej zmianie plików podbij `VERSION` w `sw.js` i `APP_VERSION` w `js/app.js`.

Test innych banków: `node tests/banks.test.mjs`.

Test zgodności z programem na Windows (wymaga Node i kodu programu):

```
python3 tests/compat_check.py ścieżka/do/budget_app
```
