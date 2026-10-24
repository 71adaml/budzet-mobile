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
    const description = buildDescription(cells, columns) || "(brak opisu)";
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

/** Parsuje plik (bajty) wg profilu. */
export async function parseFile(bytes, profile) {
  const text = decodeBytes(bytes, profile.encoding);
  return parseRows(readRawRows(text, profile), profile);
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
