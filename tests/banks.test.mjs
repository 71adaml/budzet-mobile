// Test rozpoznawania wyciągów z innych banków (pliki syntetyczne, dane fikcyjne).
// Użycie: node tests/banks.test.mjs
import assert from "node:assert/strict";
import { DEFAULT_PROFILES, MOBILE_PROFILES } from "../js/db.js";
import { parseWithBestProfile, detectProfile } from "../js/importer.js";
import { Categorizer } from "../js/categorizer.js";

const enc = (text, cp1250 = false) => {
  if (!cp1250) return new TextEncoder().encode(text);
  const map = { "ą": 0xb9, "ć": 0xe6, "ę": 0xea, "ł": 0xb3, "ń": 0xf1, "ó": 0xf3, "ś": 0x9c, "ź": 0x9f, "ż": 0xbf, "Ł": 0xa3, "Ś": 0x8c, "Ż": 0xaf };
  return Uint8Array.from([...text].map((ch) => map[ch] ?? ch.charCodeAt(0)));
};
const profiles = [...DEFAULT_PROFILES, ...MOBILE_PROFILES];
async function best(bytes) {
  const all = [...profiles];
  const d = detectProfile(bytes);
  if (d) all.push(d);
  return parseWithBestProfile(bytes, all);
}

const PKO = [
  '"Data operacji","Data waluty","Typ transakcji","Kwota","Waluta","Saldo po transakcji","Opis transakcji","","","",""',
  '"2026-10-15","2026-10-15","Płatność kartą","-25.99","PLN","+1234.56","Tytuł: 000498849 74230784015","Lokalizacja: Adres: BIEDRONKA 123 Miasto: WARSZAWA Kraj: POLSKA","Data wykonania operacji: 2026-10-13","Oryginalna kwota operacji: 25.99","Numer karty: 425125******1234"',
  '"2026-10-10","2026-10-10","Przelew na rachunek","+4500.00","PLN","+1260.55","Rachunek nadawcy: 12 3456 0000 0000 0000 0000 0000","Nazwa nadawcy: FIRMA SP. Z O.O.","Adres nadawcy: UL. TESTOWA 1","Tytuł: WYNAGRODZENIE 09/2026","",""',
  '"2026-10-05","2026-10-05","Zlecenie stałe","-1200.00","PLN","-3239.45","Rachunek odbiorcy: 98 7654 0000 0000 0000 0000 0000","Nazwa odbiorcy: Wspólnota Mieszkaniowa","Adres odbiorcy: UL. DOMOWA 5","Tytuł: czynsz","",""',
  '"2026-10-03","2026-10-03","Płatność web - kod mobilny","-49.99","PLN","-2039.45","Numer telefonu: 48500000000","Lokalizacja: Adres: www.netflix.com","Operacja: 00000081234567890","Numer referencyjny: 0000","",""',
].join("\r\n") + "\r\n";

for (const [label, bytes] of [["PKO utf-8", enc(PKO)], ["PKO cp1250", enc(PKO, true)],
  ["PKO ; i przecinek", enc(PKO.replace(/","/g, '";"').replace(/(-?\+?\d+)\.(\d\d)"/g, '$1,$2"'))]]) {
  const r = await best(bytes);
  assert.equal(r.profile.name, "PKO BP", label);
  assert.equal(r.result.rows.length, 4, label);
  const [card, salary, rent, netflix] = r.result.rows;
  assert.equal(card.amount, -2599, label);
  assert.equal(salary.amount, 450000, label);
  assert.equal(card.description, "BIEDRONKA 123, WARSZAWA · Płatność kartą", label);
  assert.equal(rent.description, "Wspólnota Mieszkaniowa · czynsz · Zlecenie stałe", label);
  assert.equal(salary.description, "FIRMA SP. Z O.O. · WYNAGRODZENIE 09/2026 · Przelew na rachunek", label);
  const cat = new Categorizer([{ keyword: "BIEDRONKA", category_id: 1 }, { keyword: "WSPOLNOTA", category_id: 2 },
    { keyword: "WYNAGRODZENIE", category_id: 3 }, { keyword: "NETFLIX", category_id: 4 }]);
  assert.deepEqual([card, rent, salary, netflix].map((x) => cat.categorize(x.description)), [1, 2, 3, 4], label);
  console.log("OK", label, "→", netflix.description);
}

// Inne banki – rozpoznanie po nagłówku.
const MBANK = ["mBank S.A. Bankowość Detaliczna;", "#Klient;", "JAN TESTOWY;", "", "#Data operacji;#Data księgowania;#Opis operacji;#Tytuł;#Nadawca/Odbiorca;#Numer konta;#Kwota;#Saldo po operacji;",
  "2026-10-14;2026-10-15;ZAKUP PRZY UŻYCIU KARTY;LIDL WROCLAW;  ;'';-45,20;1 954,80;",
  "2026-10-10;2026-10-10;PRZELEW PRZYCHODZĄCY;PENSJA;FIRMA;'12 3456';5 000,00;2 000,00;", ""].join("\n");
const ING = ['"Lista transakcji"', '"Dokument nr 0000"', "", '"Data transakcji";"Data księgowania";"Dane kontrahenta";"Tytuł";"Nr rachunku";"Nazwa banku";"Szczegóły";"Nr transakcji";"Kwota transakcji (waluta rachunku)";"Waluta";"Kwota blokady/zwolnienie blokady";"Waluta";"Kwota płatności w walucie";"Waluta";"Saldo po transakcji";"Waluta"',
  '2026-10-12;2026-10-13;"ORLEN STACJA 123 KRAKOW";"Płatność kartą";;;"";"20260001";-210,55;PLN;;;;;1 000,00;PLN',
  '2026-10-11;;"SKLEP";"Blokada";;;"";"";;;-10,00;PLN;;;;', ""].join("\n");
for (const [label, text] of [["mBank", MBANK], ["ING", ING]]) {
  const r = await best(enc(text, true));
  assert.equal(r.profile.name, "Rozpoznany automatycznie", label);
  assert.ok(r.result.rows.length >= 1, label);
  console.log("OK", label, r.result.rows.map((x) => `${x.date} ${x.amount} ${x.description}`).join(" | "));
}
