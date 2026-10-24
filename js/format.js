// Formatowanie kwot (w groszach) i miesięcy po polsku – odpowiednik logic/formatting.py.

export const MONTHS_PL = [
  "Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec",
  "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień",
];
const MONTHS_SHORT = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];
const NBSP = " ";

/** 123456 -> "1 234,56" (grosze -> złote). */
export function formatNumber(grosze, signed = false) {
  const value = Math.round(grosze);
  const sign = value < 0 ? "-" : (signed && value > 0 ? "+" : "");
  const abs = Math.abs(value);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole},${frac}`;
}

export function formatPln(grosze, signed = false) {
  return `${formatNumber(grosze, signed)}${NBSP}zł`;
}

/** Kwota wpisana przez użytkownika ("1 234,5") -> grosze; null, gdy niepoprawna. */
export function parseUserAmount(text) {
  const cleaned = String(text).replace(/[\s zł]/gi, "").replace(",", ".");
  if (cleaned === "") return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

export function pad2(n) { return String(n).padStart(2, "0"); }

export function isoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayISO() { return isoDate(new Date()); }

export function monthOf(iso) { return iso.slice(0, 7); }

export function currentMonth() { return monthOf(todayISO()); }

export function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${pad2((index % 12) + 1)}`;
}

export function daysInMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function monthStart(month) { return `${month}-01`; }
export function monthEnd(month) { return `${month}-${pad2(daysInMonth(month))}`; }

export function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS_PL[m - 1]} ${y}`;
}

export function monthShortLabel(month) {
  const [y, m] = month.split("-").map(Number);
  const label = MONTHS_SHORT[m - 1];
  return m === 1 ? `${label} ${pad2(y % 100)}` : label;
}

/** "2026-10-15" -> "15.10.2026" */
export function displayDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Dzień tygodnia i data do nagłówków listy transakcji. */
export function dayHeader(iso) {
  const days = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${days[dt.getDay()]}, ${d} ${MONTHS_SHORT[m - 1]}`;
}

export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}
