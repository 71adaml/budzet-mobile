# Budżet domowy – wersja na iPhone

Aplikacja webowa do programu **Budżet domowy** (wersja na Windows). Instalujesz ją z Safari
na ekranie początkowym i działa jak zwykła aplikacja, także bez internetu.

**Twoje dane zostają w telefonie.** Ta strona zawiera tylko kod aplikacji – transakcje,
kategorie i budżety są zapisane w pamięci iPhone'a i nigdzie nie są wysyłane.

## Instalacja na iPhonie

1. Otwórz w **Safari**: https://71adaml.github.io/budzet-mobile/
2. Stuknij **Udostępnij** (kwadrat ze strzałką) → **Dodaj do ekranu początkowego**.
3. Uruchamiaj aplikację z ikony „Budżet” (nie z Safari – tylko wtedy dane są trwale zapisane).

## Co potrafi

- Import wyciągu CSV z Credit Agricole (CA24) z automatycznymi kategoriami (te same reguły co na komputerze).
- Podsumowanie miesiąca, wydatki wg kategorii, prognoza na koniec miesiąca, wykres 6 miesięcy.
- Lista transakcji z wyszukiwaniem, zmiana kategorii, notatki, nowe reguły.
- Budżety (limity na kategorie) z kopiowaniem z poprzedniego miesiąca.
- Ten sam plik bazy `budget.db` co program na Windows – można przenosić dane w obie strony.

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

Test zgodności z programem na Windows (wymaga Node i kodu programu):

```
python3 tests/compat_check.py ścieżka/do/budget_app
```
