// Odczyt wyciągów CSV – odpowiednik logic/importer.py.
// Skróty (hash) transakcji muszą być identyczne jak w programie na komputer,
// żeby ten sam wyciąg zaimportowany w obu miejscach nie dublował transakcji.

import { normalize } from "./categorizer.js";

const DATE_FORMATS = {
  "RRRR-MM-DD": ["Y", "-", "m", "-", "d"],
  "DD.MM.RRRR": ["d", ".", "m", ".", "Y"],
  "DD-MM-RRRR": ["d", "-", "m", "-", "Y"],
  "DD/MM/RRRR": ["d", "/", "m", "/", "Y"],
  "RRRR.MM.DD": ["Y", ".", "m", ".", "d"],
  "RRRR/MM/DD": ["Y", "/", "m", "/", "d"],
};

const ENCODINGS = { "utf-8-sig": "utf-8", "utf-8": "utf-8", cp1250: "windows-1250", "iso-8859-2": "iso-8859-2" };

export const DESCRIPTION_SEPARATOR = " · ";

export function decodeBytes(bytes, encoding) {
  if (encoding === "auto") return decodeAuto(bytes).text;
  const label = ENCODINGS[encoding] || encoding;
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Nie można odczytać pliku w wybranym kodowaniu.");
  }
}

/** Parser CSV zgodny z modułem csv Pythona (cudzysłowy, podwójne cudzysłowy, nowe linie w polach). */
export function parseCsv(text, separator) {
  const records = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === "") { inQuotes = true; i++; continue; }
    if (ch === separator) { row.push(field); field = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      row.push(field); records.push(row); row = []; field = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++; continue;
    }
    field += ch; i++;
  }
  if (field !== "" || row.length) { row.push(field); records.push(row); }
  return records;
}

/** Niepuste wiersze z numerami (od 1), z pominięciem skip_rows pierwszych. */
export function readRawRows(text, profile) {
  const rows = [];
  parseCsv(text, profile.separator).forEach((record, idx) => {
    const index = idx + 1;
    if (index <= profile.skip_rows) return;
    const cells = record.map((c) => c.trim());
    if (!cells.some(Boolean)) return;
    rows.push([index, cells]);
  });
  return rows;
}

/** "-1 234,56 PLN" -> -123456 (grosze). Rzuca Error przy błędzie. */
export function parseAmount(text, decimalComma) {
  let cleaned = text.toUpperCase();
  for (const token of ["PLN", "ZŁ", "ZL", " ", " ", "'"]) cleaned = cleaned.split(token).join("");
  if (decimalComma) cleaned = cleaned.split(".").join("").replace(",", ".");
  else cleaned = cleaned.split(",").join("");
  if (!cleaned) throw new Error("pusta kwota");
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!m || (m[2] === "" && !m[3])) throw new Error(`niepoprawna kwota „${text}”`);
  const sign = m[1] === "-" ? -1 : 1;
  const whole = parseInt(m[2] || "0", 10);
  const frac = (m[3] || "");
  let cents = parseInt((frac + "00").slice(0, 2), 10);
  if (frac.length > 2 && parseInt(frac[2], 10) >= 5) cents += 1; // zaokrąglenie do grosza
  return sign * (whole * 100 + cents);
}

function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function tryFormat(value, parts) {
  let pos = 0;
  const out = {};
  for (const part of parts) {
    if (part === "Y" || part === "m" || part === "d") {
      const re = part === "Y" ? /^\d{4}/ : /^\d{1,2}/;
      const m = re.exec(value.slice(pos));
      if (!m) return null;
      out[part] = parseInt(m[0], 10);
      pos += m[0].length;
    } else {
      if (value[pos] !== part) return null;
      pos += 1;
    }
  }
  if (pos !== value.length) return null;
  if (!validDate(out.Y, out.m, out.d)) return null;
  return `${String(out.Y).padStart(4, "0")}-${String(out.m).padStart(2, "0")}-${String(out.d).padStart(2, "0")}`;
}

/** Zwraca datę "RRRR-MM-DD"; rzuca Error, gdy nie pasuje. */
export function parseDate(text, formatKey) {
  const value = text.trim().slice(0, 10);
  const fmt = DATE_FORMATS[formatKey];
  const candidates = fmt ? [fmt] : Object.values(DATE_FORMATS);
  for (const parts of candidates) {
    const result = tryFormat(value, parts);
    if (result) return result;
  }
  throw new Error(`niepoprawna data „${text}”`);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

export function groszeToFixed(grosze) {
  const sign = grosze < 0 ? "-" : "";
  const abs = Math.abs(grosze);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

async function sha1Hex(text) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildDescription(cells, columns) {
  const parts = [];
  const seen = new Set();
  for (const column of columns) {
    if (column < 0 || column >= cells.length) continue;
    const value = cells[column].split(/\s+/).filter(Boolean).join(" ");
    const key = normalize(value);
    if (value && !seen.has(key)) { seen.add(key); parts.push(value); }
  }
  return parts.join(DESCRIPTION_SEPARATOR);
}

/** Zamienia surowe wiersze na transakcje; błędne wiersze trafiają do errors. */
export async function parseRows(rows, profile) {
  const result = { rows: [], errors: [] };
  const seen = new Map();
  if (!profile.desc_cols || !profile.desc_cols.length) {
    result.errors.push([0, "nie wybrano kolumn opisu"]);
    return result;
  }
  const needed = Math.max(profile.date_col, profile.amount_col);
  const fallbackCol = profile.date_fallback_col ?? -1;
  const fallbackAfter = profile.fallback_after_days ?? 0;
  for (const [lineNo, cells] of rows) {
    if (cells.length <= needed) { result.errors.push([lineNo, "za mało kolumn"]); continue; }
    let dateText = cells[profile.date_col];
    const fallbackText = fallbackCol >= 0 && fallbackCol < cells.length ? cells[fallbackCol] : "";
    if (!dateText) dateText = fallbackText;
    let when;
    let amount;
    try {
      if (!dateText) throw new Error("brak daty");
      when = parseDate(dateText, profile.date_format);
      if (fallbackAfter > 0 && fallbackText && dateText !== fallbackText) {
        let fallback;
        try { fallback = parseDate(fallbackText, profile.date_format); } catch { fallback = when; }
        if (daysBetween(when, fallback) > fallbackAfter) when = fallback;
      }
      amount = parseAmount(cells[profile.amount_col], profile.decimal_comma);
    } catch (exc) {
      result.errors.push([lineNo, exc.message]);
      continue;
    }
    if (profile.invert_sign) amount = -amount;
    const incomeCols = profile.income_desc_cols || [];
    const columns = amount > 0 && incomeCols.length ? incomeCols : profile.desc_cols;
    const source = profile.desc_clean === "pko" ? cells.map(cleanPkoCell) : cells;
    const description = buildDescription(source, columns) || "(brak opisu)";
    const fixed = groszeToFixed(amount);
    const key = `${when}|${fixed}|${normalize(description)}`;
    const occurrence = (seen.get(key) || 0) + 1;
    seen.set(key, occurrence);
    result.rows.push({
      lineNo, date: when, description, amount,
      hash: await sha1Hex(`${key}|${occurrence}`),
    });
  }
  return result;
}

/** Parsuje plik (bajty) wg profilu. Profil może mieć separator i przecinek dziesiętny "auto". */
export async function parseFile(bytes, profile) {
  const text = decodeBytes(bytes, profile.encoding);
  const resolved = { ...profile };
  if (resolved.separator === "auto") resolved.separator = guessSeparator(text);
  let rows = readRawRows(text, resolved);
  if (resolved.decimal_comma === "auto") {
    const sample = rows.slice(0, 50).map(([, c]) => (c[resolved.amount_col] || "").trim()).filter(Boolean);
    resolved.decimal_comma = sample.some((v) => /,\d{1,2}(\s*\D*)?$/.test(v))
      || !sample.some((v) => /\.\d{1,2}(\s*\D*)?$/.test(v));
  }
  return parseRows(rows, resolved);
}

// PKO BP: kolumny opisu mają przedrostki ("Tytuł: ", "Nazwa odbiorcy: ", "Lokalizacja: Adres: ")
// i sporo technicznych danych (numer karty, rachunki, oryginalna kwota) – zostawiamy to, co czytelne.
const PKO_DROP = /^(Data wykonania|Data i czas operacji|Oryginalna kwota|Kwota|Numer karty|Numer telefonu|Rachunek (odbiorcy|nadawcy)|Adres (odbiorcy|nadawcy)|Numer referencyjny|Referencje|Operacja:|Identyfikator)/i;

export function cleanPkoCell(value) {
  let v = String(value || "").trim();
  if (!v || PKO_DROP.test(v)) return "";
  v = v.replace(/^Lokalizacja:\s*/i, "").replace(/^Adres:\s*/i, "")
    .replace(/^(Tytuł|Tytul|Nazwa odbiorcy|Nazwa nadawcy|Odbiorca|Nadawca):\s*/i, "");
  v = v.replace(/\s+Kraj:.*$/i, "").replace(/\s+Miasto:\s*/i, ", ");
  if (/^[\d\s/-]+$/.test(v)) return ""; // sam numer (np. tytuł płatności kartą)
  return v;
}

/** Wybiera profil, z którym plik daje najwięcej poprawnych wierszy. */
export async function parseWithBestProfile(bytes, profiles) {
  let best = null;
  for (const profile of profiles) {
    let result;
    try { result = await parseFile(bytes, profile); } catch { continue; }
    if (!best || result.rows.length > best.result.rows.length) best = { profile, result };
  }
  return best;
}

// ------------------------------------------------- rozpoznawanie innych banków
// Gdy żaden zapisany profil nie pasuje, szukamy wiersza nagłówka (np. "Data operacji",
// "Kwota", "Opis") i na jego podstawie budujemy profil. Działa dla większości polskich banków.

const DESC_HEADER = /opis|tytu|odbiorc|nadawc|kontrahent|szczeg|nazwa|miejsce/;
const NOT_DESC = /nazwa banku|rachun|konta|numer|nr |adres|waluta|saldo|kwota|data|kategori/;

function headerKey(cell) {
  return normalize(cell.replace(/^#/, "")).toLowerCase();
}

function guessSeparator(text) {
  const sample = text.split(/\r?\n/).slice(0, 60).join("\n");
  const counts = [";", ",", "\t"].map((s) => [s, sample.split(s).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

function decodeAuto(bytes) {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8-sig" };
  } catch {
    return { text: new TextDecoder("windows-1250").decode(bytes), encoding: "cp1250" };
  }
}

/** Buduje profil na podstawie nagłówka pliku albo zwraca null. */
export function detectProfile(bytes) {
  const { text, encoding } = decodeAuto(bytes);
  const separator = guessSeparator(text);
  const records = parseCsv(text, separator).slice(0, 80);
  for (let i = 0; i < records.length; i++) {
    const keys = records[i].map(headerKey);
    const dateCols = keys.map((k, idx) => [k, idx]).filter(([k]) => /^data/.test(k));
    const amountCols = keys.map((k, idx) => [k, idx]).filter(([k]) => /kwota|obciazen|uznani|amount/.test(k) && !/saldo|blokad|walucie|oryginal/.test(k));
    if (!dateCols.length || !amountCols.length) continue;
    const data = records.slice(i + 1, i + 40).filter((r) => r.length >= keys.length - 1);
    const valid = (idx, test) => data.filter((r) => r[idx] && test(r[idx].trim())).length;
    const isDate = (v) => { try { parseDate(v, "auto"); return true; } catch { return false; } };
    const isAmount = (v) => /^[+-]?[\d\s .,']+\d(\s*(PLN|ZŁ|ZL))?$/i.test(v);
    // Data: najpierw data operacji/transakcji, potem księgowania.
    const rank = (k) => (/operacji|transakcji/.test(k) ? 0 : /ksiegow/.test(k) ? 1 : 2);
    const dates = dateCols.filter(([, idx]) => valid(idx, isDate) > 0).sort((a, b) => rank(a[0]) - rank(b[0]));
    const amounts = amountCols.filter(([, idx]) => valid(idx, isAmount) > 0)
      .sort((a, b) => valid(b[1], isAmount) - valid(a[1], isAmount));
    if (!dates.length || !amounts.length) continue;
    const amountCol = amounts[0][1];
    const sample = data.map((r) => (r[amountCol] || "").trim()).filter(Boolean);
    const decimalComma = sample.some((v) => /,\d{1,2}(\s*\D*)?$/.test(v)) || !sample.some((v) => /\.\d{1,2}(\s*\D*)?$/.test(v));
    const fallback = dates.find(([k]) => /ksiegow/.test(k) && k !== dates[0][0]);
    const descCols = keys.map((k, idx) => [k, idx])
      .filter(([k]) => DESC_HEADER.test(k) && !NOT_DESC.test(k)).map(([, idx]) => idx);
    if (!descCols.length) continue;
    return {
      name: "Rozpoznany automatycznie", separator, encoding, skip_rows: i + 1, date_format: "auto",
      decimal_comma: decimalComma, invert_sign: false, date_col: dates[0][1], desc_cols: descCols,
      amount_col: amountCol, income_desc_cols: [],
      date_fallback_col: fallback ? fallback[1] : -1, fallback_after_days: 0,
    };
  }
  return null;
}
