// Automatyczna kategoryzacja – odpowiednik logic/categorizer.py (musi działać identycznie).

const STOP_WORDS = new Set([
  "PLATNOSC", "KARTA", "KARTY", "KARTA:", "ZAKUP", "PRZY", "UZYCIU", "TRANSAKCJA",
  "BLIK", "DATA", "TRANSAKCJI", "PLN", "OPERACJA", "PRZELEW", "ZEWNETRZNY",
  "WYCHODZACY", "PRZYCHODZACY", "NA", "DLA", "OD", "DO", "TYTUL", "TYTULEM",
  "POL", "POLSKA", "WROCLAW", "WARSZAWA", "KRAKOW", "POZNAN", "GDANSK", "SP", "Z",
  "O.O.", "OO", "SA", "S.A.", "INTERNET", "MOBILNY", "ELIXIR", "ZAKUPU", "SKLEP",
]);

/** Wielkie litery, bez polskich znaków diakrytycznych, pojedyncze spacje. */
export function normalize(text) {
  const stripped = String(text ?? "")
    .replace(/ł/g, "l").replace(/Ł/g, "L")
    .normalize("NFKD").replace(/\p{M}/gu, "");
  return stripped.toUpperCase().split(/\s+/).filter(Boolean).join(" ");
}

/** Postać do dopasowania reguł: jak normalize, ale bez interpunkcji. */
export function matchText(text) {
  const t = normalize(text).replace(/['’]/g, "");
  return t.replace(/[^A-Z0-9]+/g, " ").split(" ").filter(Boolean).join(" ");
}

/** Proponuje słowo kluczowe reguły na podstawie opisu transakcji. */
export function suggestKeyword(description) {
  for (const word of normalize(description).split(" ")) {
    const cleaned = word.replace(/^[.,:;/*#-]+|[.,:;/*#-]+$/g, "");
    if (cleaned.length < 3 || /\d/.test(cleaned)) continue;
    if (STOP_WORDS.has(cleaned)) continue;
    return cleaned;
  }
  return "";
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Dopasowuje opis do kategorii. Przy kilku trafieniach wygrywa najdłuższe słowo. */
export class Categorizer {
  constructor(rules) {
    const compiled = [];
    for (const rule of rules) {
      const keyword = matchText(rule.keyword);
      if (!keyword) continue;
      // Brak litery przed i po słowie (cyfry dozwolone): "BIEDRONKA1234" pasuje, "BPH" do "BP" nie.
      const pattern = new RegExp(`(?<![A-Z])${escapeRegex(keyword)}(?![A-Z])`);
      compiled.push([keyword.length, pattern, rule.category_id]);
    }
    // Sortowanie stabilne, jak w Pythonie.
    compiled.sort((a, b) => b[0] - a[0]);
    this.rules = compiled;
  }

  categorize(description) {
    const text = matchText(description);
    for (const [, pattern, categoryId] of this.rules) {
      if (pattern.test(text)) return categoryId;
    }
    return null;
  }
}
