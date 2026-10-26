// Budżet domowy – wersja na iPhone. Interfejs aplikacji.

import { Repository, DEFAULT_PROFILES, MOBILE_PROFILES, UNCATEGORIZED, UserError } from "./db.js";
import { parseWithBestProfile, detectProfile } from "./importer.js";
import { suggestKeyword } from "./categorizer.js";
import * as store from "./store.js";
import {
  formatPln, monthLabel, monthShortLabel, shiftMonth, currentMonth, monthStart, monthEnd,
  monthOf, daysInMonth, todayISO, displayDate, dayHeader, escapeHtml as h, parseUserAmount,
  formatNumber,
} from "./format.js";

export const APP_VERSION = "1.3.0";

const state = {
  SQL: null,
  repo: null,
  view: "summary",
  month: currentMonth(),
  search: "",
  category: null,       // filtr transakcji: null | UNCATEGORIZED | id
  pendingImport: null,  // podgląd importu
  lastImport: null,
  meta: { dirty: false, savedToFileAt: null, openedFile: null },
};

const $ = (sel, root = document) => root.querySelector(sel);

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let installPrompt = null; // Android/Chrome: zdarzenie instalacji

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  if (state.repo && state.view === "more") render();
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  toast("Aplikacja zainstalowana – uruchamiaj ją z ikony „Budżet”.", "good");
  if (state.repo) render();
});

function installCard() {
  if (isInstalled()) return "";
  if (installPrompt) {
    return `<div class="card help"><b>Zainstaluj aplikację</b>
      <p class="sub">Dostaniesz ikonę „Budżet” na ekranie głównym, a dane będą trwale zapisane w telefonie.</p>
      <button class="btn primary" data-action="install">Zainstaluj aplikację</button></div>`;
  }
  const how = IS_IOS
    ? "W Safari stuknij Udostępnij (kwadrat ze strzałką) → „Dodaj do ekranu początkowego”."
    : "W Chrome stuknij menu ⋮ → „Zainstaluj aplikację” (albo „Dodaj do ekranu głównego”).";
  return `<div class="card help"><b>Zainstaluj aplikację</b><p class="sub">${how}
    Uruchamiaj ją potem z ikony „Budżet” – tylko wtedy dane są trwale zapisane.</p></div>`;
}

// ----------------------------------------------------------------- start
async function start() {
  try {
    state.SQL = await window.initSqlJs({ locateFile: (f) => `vendor/${f}` });
    const [bytes, meta] = await Promise.all([store.get("db"), store.get("meta")]);
    state.meta = { ...state.meta, ...(meta || {}) };
    state.repo = new Repository(state.SQL, bytes || undefined);
    if (!bytes) await persist(false);
    const latest = state.repo.latestDate();
    state.month = latest && monthOf(latest) < currentMonth() ? monthOf(latest) : currentMonth();
    if (!state.repo.transactionCount()) state.view = "more";
    store.requestPersistence();
  } catch (exc) {
    $("#view").innerHTML = `<div class="card error">Nie udało się uruchomić aplikacji: ${h(exc.message)}</div>`;
    console.error(exc);
    return;
  }
  document.addEventListener("click", onClick);
  render();
}

/** Zapisuje bazę w pamięci telefonu po każdej zmianie. */
async function persist(markDirty = true) {
  const bytes = state.repo.export();
  if (markDirty) state.meta.dirty = true;
  await store.set("db", bytes);
  await store.set("meta", state.meta);
}

function toast(text, kind = "") {
  const el = $("#toast");
  el.textContent = text;
  el.className = `toast show ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = "toast"; }, 3200);
}

function guarded(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (exc) {
      console.error(exc);
      toast(exc instanceof UserError ? exc.message : `Błąd: ${exc.message}`, "bad");
    }
  };
}

// ---------------------------------------------------------------- render
const TITLES = { summary: "Podsumowanie", transactions: "Transakcje", import: "Import", budgets: "Budżety", more: "Więcej" };

function render() {
  const withMonth = ["summary", "transactions", "budgets"].includes(state.view);
  $("#title").textContent = TITLES[state.view];
  $("#month-bar").hidden = !withMonth;
  $("#month-label").textContent = monthLabel(state.month);
  $("#sync-dot").hidden = !state.meta.dirty || !state.repo?.transactionCount();
  document.querySelectorAll(".tabbar button").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === state.view);
  });
  const view = { summary: renderSummary, transactions: renderTransactions, import: renderImport,
    budgets: renderBudgets, more: renderMore }[state.view];
  $("#view").innerHTML = view();
  bindView();
}

function categoryOptions(selected, { all = false } = {}) {
  const cats = state.repo.listCategories();
  const groups = [["Wydatki", cats.filter((c) => !c.is_income && !c.is_transfer)],
    ["Przychody", cats.filter((c) => c.is_income)], ["Przelewy własne", cats.filter((c) => c.is_transfer)]];
  let html = all ? `<option value="">Wszystkie kategorie</option>` : "";
  html += `<option value="${UNCATEGORIZED}" ${selected === UNCATEGORIZED ? "selected" : ""}>Bez kategorii</option>`;
  for (const [label, list] of groups) {
    if (!list.length) continue;
    html += `<optgroup label="${label}">${list.map((c) =>
      `<option value="${c.id}" ${selected === c.id ? "selected" : ""}>${h(c.name)}</option>`).join("")}</optgroup>`;
  }
  return html;
}

function amountClass(grosze) { return grosze < 0 ? "neg" : "pos"; }

// --------------------------------------------------------------- summary
function forecast(month, expenses) {
  if (month !== currentMonth()) return null;
  const day = Number(todayISO().slice(8, 10));
  if (day < 3) return null;
  return Math.round((expenses / day) * daysInMonth(month));
}

function renderSummary() {
  const repo = state.repo;
  const start = monthStart(state.month);
  const end = monthEnd(state.month);
  const { income, expenses } = repo.totals(start, end);
  const balance = income - expenses;
  const spending = repo.spendingByCategory(start, end);
  const limits = repo.getBudgetLimits(state.month);
  const uncategorized = repo.listTransactions(start, end, { category: UNCATEGORIZED }).length;
  const projected = forecast(state.month, expenses);

  if (!repo.transactionCount()) {
    return `<div class="empty">Brak danych. Zaimportuj wyciąg CSV albo wczytaj bazę z komputera.
      <button class="btn primary" data-action="go" data-view="import">Importuj CSV</button>
      <button class="btn" data-action="go" data-view="more">Wczytaj bazę z komputera</button></div>`;
  }

  const max = Math.max(1, ...spending.map((s) => Math.max(s.spent, limits[s.category_id] || 0)));
  const rows = spending.map((s) => {
    const limit = limits[s.category_id] || 0;
    const over = limit && s.spent > limit;
    const pct = Math.max(0, (s.spent / max) * 100);
    const limitMark = limit ? `<i class="limit" style="left:${(limit / max) * 100}%"></i>` : "";
    const catValue = s.category_id === null ? UNCATEGORIZED : s.category_id;
    return `<button class="cat-row" data-action="filter-cat" data-cat="${catValue}">
      <div class="cat-line"><span>${h(s.name)}</span><b>${formatPln(s.spent)}</b></div>
      <div class="bar"><span class="${over ? "over" : ""}" style="width:${pct}%"></span>${limitMark}</div>
      ${limit ? `<div class="sub ${over ? "bad" : ""}">limit ${formatPln(limit)}${over ? ` · przekroczony o ${formatPln(s.spent - limit)}` : ""}</div>` : ""}
    </button>`;
  }).join("");

  // Ostatnie 6 miesięcy
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(state.month, i - 5));
  const byMonth = repo.totalsByMonth(months);
  const top = Math.max(1, ...months.map((m) => Math.max(byMonth[m].income, byMonth[m].expenses)));
  const chart = months.map((m) => `
    <button class="col ${m === state.month ? "current" : ""}" data-action="month" data-month="${m}"
      aria-label="${monthLabel(m)}: przychody ${formatPln(byMonth[m].income)}, wydatki ${formatPln(byMonth[m].expenses)}">
      <div class="bars"><span class="inc" style="height:${(byMonth[m].income / top) * 100}%"></span><span class="exp" style="height:${(byMonth[m].expenses / top) * 100}%"></span></div>
      <small>${monthShortLabel(m)}</small>
    </button>`).join("");

  return `
    <div class="stats">
      <div class="stat"><small>Przychody</small><b class="pos">${formatPln(income)}</b></div>
      <div class="stat"><small>Wydatki</small><b class="neg">${formatPln(expenses)}</b></div>
      <div class="stat"><small>Saldo</small><b class="${balance < 0 ? "neg" : "pos"}">${formatPln(balance, true)}</b></div>
    </div>
    ${projected !== null ? `<div class="note">Prognoza wydatków na koniec miesiąca: <b>${formatPln(projected)}</b></div>` : ""}
    ${uncategorized ? `<button class="banner" data-action="filter-cat" data-cat="${UNCATEGORIZED}">
      ${uncategorized} ${plural(uncategorized, "transakcja", "transakcje", "transakcji")} bez kategorii – przypisz ›</button>` : ""}
    <h2>Wydatki wg kategorii</h2>
    <div class="card list">${rows || `<div class="empty small">Brak wydatków w tym miesiącu.</div>`}</div>
    <h2>Ostatnie 6 miesięcy</h2>
    <div class="card chart">${chart}</div>
    <div class="legend"><span class="inc"></span>przychody <span class="exp"></span>wydatki</div>`;
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10, t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}

// ---------------------------------------------------------- transactions
function renderTransactions() {
  const list = state.repo.listTransactions(monthStart(state.month), monthEnd(state.month),
    { search: state.search, category: state.category });
  let html = `
    <div class="filters">
      <input type="search" id="search" placeholder="Szukaj w opisach i notatkach" value="${h(state.search)}" enterkeyhint="search">
      <select id="cat-filter">${categoryOptions(state.category, { all: true })}</select>
    </div>`;
  if (!list.length) return html + `<div class="empty">Brak transakcji${state.search || state.category !== null ? " dla tych filtrów" : " w tym miesiącu"}.</div>`;
  const total = list.reduce((s, t) => s + t.amount, 0);
  html += `<div class="sub center">${list.length} ${plural(list.length, "transakcja", "transakcje", "transakcji")} · razem ${formatPln(total, true)}</div>`;
  let day = null;
  html += `<div class="card list">`;
  for (const t of list) {
    if (t.date !== day) {
      day = t.date;
      html += `<div class="day">${dayHeader(t.date)}</div>`;
    }
    const cat = t.splits.length
      ? `<span class="chip">podzielona (${t.splits.length})</span>`
      : `<span class="chip ${t.category_id === null ? "none" : ""}">${h(t.category_name || "Bez kategorii")}</span>`;
    html += `<button class="tx" data-action="tx" data-id="${t.id}">
      <div class="tx-main"><div class="desc">${h(t.description)}</div>
        <div class="meta">${cat}${t.note ? `<span class="note-ico" title="notatka">✎ ${h(t.note)}</span>` : ""}</div></div>
      <b class="${amountClass(t.amount)} ${t.is_transfer ? "muted" : ""}">${formatPln(t.amount, true)}</b>
    </button>`;
  }
  return html + `</div>`;
}

function openTransaction(id) {
  const t = state.repo.getTransaction(id);
  if (!t) return;
  const split = t.splits.length > 0;
  const keyword = suggestKeyword(t.description);
  const body = `
    <div class="sheet-amount ${amountClass(t.amount)}">${formatPln(t.amount, true)}</div>
    <div class="sub center">${displayDate(t.date)}</div>
    <p class="full-desc">${h(t.description)}</p>
    ${split ? `<div class="card list">${t.splits.map((p) => `<div class="split-row"><span>${h(p.category_name || "Bez kategorii")}${p.note ? ` – ${h(p.note)}` : ""}</span><b>${formatPln(p.amount, true)}</b></div>`).join("")}</div>
      <p class="sub">Transakcja podzielona na części – podział zmienisz w programie na komputerze.</p>`
    : `<label class="field">Kategoria<select id="tx-cat">${categoryOptions(t.category_id ?? UNCATEGORIZED)}</select></label>
      <label class="check"><input type="checkbox" id="tx-rule"> Zapamiętaj regułę dla podobnych transakcji</label>
      <label class="field" id="rule-box" hidden>Słowo w opisie<input id="tx-keyword" value="${h(keyword)}" autocapitalize="characters"></label>`}
    <label class="field">Notatka<textarea id="tx-note" rows="2">${h(t.note)}</textarea></label>
    <div class="row-buttons">
      <button class="btn danger" data-action="tx-delete" data-id="${t.id}">Usuń</button>
      <button class="btn primary" data-action="tx-save" data-id="${t.id}">Zapisz</button>
    </div>`;
  openSheet("Transakcja", body);
  const rule = $("#tx-rule");
  if (rule) rule.addEventListener("change", () => { $("#rule-box").hidden = !rule.checked; });
}

const saveTransaction = guarded(async (id) => {
  const repo = state.repo;
  const t = repo.getTransaction(id);
  let message = "Zapisano.";
  repo.setTransactionNote(id, $("#tx-note").value);
  if (!t.splits.length) {
    const value = Number($("#tx-cat").value);
    const categoryId = value === UNCATEGORIZED ? null : value;
    repo.setTransactionCategory(id, categoryId);
    if ($("#tx-rule").checked) {
      if (categoryId === null) throw new UserError("Wybierz kategorię, żeby zapisać regułę.");
      repo.addRule($("#tx-keyword").value, categoryId);
      const updated = repo.applyRulesToUncategorized();
      message = updated ? `Zapisano regułę. Przypisano też ${updated} innych transakcji.` : "Zapisano regułę.";
    }
  }
  await persist();
  closeSheet();
  render();
  toast(message, "good");
});

const deleteTransaction = guarded(async (id) => {
  if (!confirm("Usunąć tę transakcję? Ponowny import tego samego wyciągu doda ją z powrotem.")) return;
  state.repo.deleteTransaction(id);
  await persist();
  closeSheet();
  render();
  toast("Usunięto transakcję.");
});

// ---------------------------------------------------------------- import
function renderImport() {
  const p = state.pendingImport;
  const r = state.lastImport;
  let html = "";
  if (r) {
    html += `<div class="card ok">
      <b>Zaimportowano ${r.added} ${plural(r.added, "transakcję", "transakcje", "transakcji")}.</b>
      <div class="sub">${r.duplicates ? `Pominięto ${r.duplicates} już zapisanych. ` : ""}${r.uncategorized ? `${r.uncategorized} bez kategorii.` : ""}</div>
      <div class="row-buttons">
        ${r.uncategorized ? `<button class="btn" data-action="filter-cat" data-cat="${UNCATEGORIZED}" data-month="${r.month}">Przypisz kategorie</button>` : ""}
        <button class="btn primary" data-action="month" data-month="${r.month}" data-view="summary">Zobacz podsumowanie</button>
      </div></div>`;
  }
  if (p) {
    const dates = p.result.rows.map((x) => x.date).sort();
    const preview = p.result.rows.slice(0, 8).map((x) => {
      const cid = p.categorizer.categorize(x.description);
      return `<div class="tx static"><div class="tx-main"><div class="desc">${h(x.description)}</div>
        <div class="meta"><span class="chip ${cid === null ? "none" : ""}">${h(cid === null ? "Bez kategorii" : p.names[cid])}</span> <small>${displayDate(x.date)}</small></div></div>
        <b class="${amountClass(x.amount)}">${formatPln(x.amount, true)}</b></div>`;
    }).join("");
    const errors = p.result.errors;
    html += `<div class="card">
      <b>${h(p.fileName)}</b>
      <div class="sub">Profil: ${h(p.profile.name)} · ${p.result.rows.length} ${plural(p.result.rows.length, "transakcja", "transakcje", "transakcji")}
      ${dates.length ? ` · ${displayDate(dates[0])} – ${displayDate(dates[dates.length - 1])}` : ""}</div>
      ${errors.length ? `<details class="sub"><summary>Pominięte wiersze: ${errors.length}</summary>${errors.slice(0, 30).map(([n, e]) => `<div>linia ${n}: ${h(e)}</div>`).join("")}</details>` : ""}
    </div>
    ${preview ? `<h2>Podgląd</h2><div class="card list">${preview}</div>` : ""}
    <div class="row-buttons">
      <button class="btn" data-action="import-cancel">Anuluj</button>
      <button class="btn primary" data-action="import-do" ${p.result.rows.length ? "" : "disabled"}>Importuj ${p.result.rows.length}</button>
    </div>`;
    return html;
  }
  html += `
    <label class="btn primary big file-btn">Wybierz plik CSV<input type="file" id="csv-file"></label>
    <div class="card help">
      <b>Jak pobrać wyciąg na telefonie</b>
      <ol>
        <li>Otwórz w ${IS_IOS ? "Safari" : "Chrome"} stronę swojego banku i zaloguj się.</li>
        <li>Wejdź w historię rachunku, wybierz okres i eksport (pobranie) do pliku CSV.</li>
        <li>Plik zapisze się ${IS_IOS ? "w aplikacji Pliki (folder Pobrane)" : "w folderze Pobrane (Download)"}.</li>
        <li>Wróć tutaj, stuknij „Wybierz plik CSV” i wskaż ten plik.</li>
      </ol>
      <p class="sub">Aplikacja sama rozpoznaje plik z Credit Agricole i z większości innych banków (po nazwach kolumn). Możesz importować ten sam wyciąg wiele razy – transakcje, które już są w bazie, zostaną pominięte (także te zaimportowane na komputerze).</p>
    </div>`;
  return html;
}

const pickCsv = guarded(async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const repo = state.repo;
  const saved = repo.listProfiles();
  const names = new Set(saved.map((x) => x.name));
  const profiles = [...saved, ...DEFAULT_PROFILES.filter((x) => !names.has(x.name)), ...DEFAULT_PROFILES,
    ...MOBILE_PROFILES];
  const detected = detectProfile(bytes);
  if (detected) profiles.push(detected);
  const best = await parseWithBestProfile(bytes, profiles);
  if (!best || !best.result.rows.length) {
    throw new UserError("Nie rozpoznano transakcji w tym pliku. Czy to eksport historii rachunku do CSV?");
  }
  const names2 = Object.fromEntries(repo.listCategories().map((c) => [c.id, c.name]));
  state.pendingImport = { fileName: file.name, profile: best.profile, result: best.result,
    categorizer: repo.categorizer(), names: names2 };
  state.lastImport = null;
  render();
});

const doImport = guarded(async () => {
  const p = state.pendingImport;
  const report = state.repo.insertTransactions(p.result.rows, p.categorizer, p.fileName);
  const latest = p.result.rows.map((x) => x.date).sort().pop();
  state.lastImport = { ...report, month: monthOf(latest) };
  state.pendingImport = null;
  state.month = monthOf(latest);
  await persist(report.added > 0);
  render();
});

// --------------------------------------------------------------- budgets
function renderBudgets() {
  const repo = state.repo;
  const limits = repo.getBudgetLimits(state.month);
  const spentBy = Object.fromEntries(repo.spendingByCategory(monthStart(state.month), monthEnd(state.month))
    .map((s) => [s.category_id, s.spent]));
  const cats = repo.listCategories().filter((c) => !c.is_income && !c.is_transfer);
  let totalLimit = 0, totalSpent = 0;
  const isCurrent = state.month === currentMonth();
  const day = Number(todayISO().slice(8, 10));
  const left = daysInMonth(state.month) - day + 1;
  const rows = cats.map((c) => {
    const limit = limits[c.id] || 0;
    const spent = spentBy[c.id] || 0;
    if (limit) { totalLimit += limit; totalSpent += spent; }
    const ratio = limit ? spent / limit : 0;
    const perDay = isCurrent && limit && spent < limit ? Math.floor((limit - spent) / left) : null;
    return `<div class="budget-row" data-action="budget-cat" data-cat="${c.id}">
      <div class="cat-line"><span class="cat-link">${h(c.name)} ›</span>
        <input class="limit-input" inputmode="decimal" data-cat="${c.id}" placeholder="bez limitu"
          value="${limit ? formatNumber(limit).replace(/ /g, " ") : ""}" aria-label="Limit ${h(c.name)}"></div>
      <div class="bar"><span class="${ratio > 1 ? "over" : ratio > 0.85 ? "warn" : ""}" style="width:${Math.min(100, ratio * 100)}%"></span></div>
      <div class="sub">wydano ${formatPln(spent)}${limit ? ` z ${formatPln(limit)}${spent > limit ? ` · <span class="bad">ponad limit o ${formatPln(spent - limit)}</span>` : ` · zostało ${formatPln(limit - spent)}`}` : ""}${perDay !== null ? ` · ${formatPln(perDay)}/dzień` : ""}</div>
    </div>`;
  }).join("");
  return `
    <div class="stats two">
      <div class="stat"><small>Suma limitów</small><b>${formatPln(totalLimit)}</b></div>
      <div class="stat"><small>Wydano (w limitach)</small><b class="${totalSpent > totalLimit && totalLimit ? "neg" : ""}">${formatPln(totalSpent)}</b></div>
    </div>
    <button class="btn" data-action="copy-budgets">Kopiuj limity z poprzedniego miesiąca</button>
    <div class="card list">${rows}</div>
    <p class="sub">Stuknij kategorię, żeby zobaczyć jej wydatki w tym miesiącu. Wpisz limit w złotych; puste pole lub 0 usuwa limit.</p>`;
}

function openCategoryEntries(categoryId) {
  const repo = state.repo;
  const category = repo.listCategories().find((c) => c.id === categoryId);
  if (!category) return;
  const entries = repo.categoryEntries(categoryId, monthStart(state.month), monthEnd(state.month));
  const spent = -entries.reduce((s, e) => s + e.amount, 0);
  let body = `<div class="sheet-amount">${formatPln(spent)}</div>
    <div class="sub center">${monthLabel(state.month)} · ${entries.length} ${plural(entries.length, "pozycja", "pozycje", "pozycji")}</div>`;
  if (!entries.length) {
    body += `<div class="empty">Brak wydatków w tej kategorii w tym miesiącu.</div>`;
  } else {
    let day = null;
    body += `<div class="card list">`;
    for (const e of entries) {
      if (e.date !== day) {
        day = e.date;
        body += `<div class="day">${dayHeader(e.date)}</div>`;
      }
      const meta = [e.part ? `<span class="chip">część podzielonej</span>` : "",
        e.note ? `<span class="note-ico">✎ ${h(e.note)}</span>` : ""].join("");
      body += `<button class="tx" data-action="tx" data-id="${e.id}">
        <div class="tx-main"><div class="desc">${h(e.description)}</div>${meta ? `<div class="meta">${meta}</div>` : ""}</div>
        <b class="${amountClass(e.amount)}">${formatPln(e.amount, true)}</b>
      </button>`;
    }
    body += `</div>`;
  }
  body += `<div class="row-buttons">
    <button class="btn" data-action="close-sheet">Zamknij</button>
    <button class="btn primary" data-action="filter-cat" data-cat="${categoryId}" data-month="${state.month}">Pokaż w Transakcjach</button>
  </div>`;
  openSheet(category.name, body);
}

const saveLimit = guarded(async (input) => {
  const value = parseUserAmount(input.value);
  if (value === null) { toast("Niepoprawna kwota.", "bad"); return; }
  state.repo.setBudgetLimit(Number(input.dataset.cat), state.month, value);
  await persist();
  render();
});

const copyBudgets = guarded(async () => {
  const count = state.repo.copyBudgetLimits(shiftMonth(state.month, -1), state.month);
  if (!count) { toast("Poprzedni miesiąc nie ma limitów."); return; }
  await persist();
  render();
  toast(`Skopiowano ${count} ${plural(count, "limit", "limity", "limitów")}.`, "good");
});

// ------------------------------------------------------------------ more
function renderMore() {
  const repo = state.repo;
  const count = repo.transactionCount();
  const first = repo.earliestDate();
  const last = repo.latestDate();
  const saved = state.meta.savedToFileAt ? new Date(state.meta.savedToFileAt).toLocaleString("pl-PL") : "nigdy";
  const rules = repo.listRules();
  const cats = repo.listCategories();
  return `
    ${!count ? `<div class="card help"><b>Witaj!</b><p>Możesz zacząć od pliku bazy z programu na komputerze
      (wtedy masz tu wszystkie transakcje, kategorie, reguły i budżety) albo od razu zaimportować wyciąg CSV.</p>
      <button class="btn primary" data-action="go" data-view="import">Importuj wyciąg CSV</button></div>` : ""}
    ${installCard()}
    <h2>Synchronizacja z komputerem</h2>
    <div class="card">
      <div class="sub">W telefonie: ${count} ${plural(count, "transakcja", "transakcje", "transakcji")}${first ? ` (${displayDate(first)} – ${displayDate(last)})` : ""}.<br>
      Ostatni zapis do pliku: ${saved}${state.meta.dirty && count ? ` · <span class="bad">są niezapisane zmiany</span>` : ""}</div>
      ${repo.newerVersion ? `<div class="sub bad">Ta baza pochodzi z nowszej wersji programu – zaktualizuj aplikację.</div>` : ""}
      <button class="btn primary" data-action="export-db">Zapisz kopię bazy (budget.db)</button>
      <label class="btn file-btn">Wczytaj bazę z pliku<input type="file" id="db-file"></label>
      <details class="sub"><summary>Jak to działa</summary>
        <p>Obie wersje używają tego samego pliku bazy <b>budget.db</b>. Na komputerze leży on w folderze
        <code>.budzet_domowy</code> w Twoim katalogu użytkownika.</p>
        <p><b>Z komputera na telefon:</b> skopiuj budget.db do ${IS_IOS ? "iCloud Drive lub OneDrive" : "Google Drive lub OneDrive"} (albo przez kabel USB do folderu Pobrane), a tutaj stuknij „Wczytaj bazę z pliku”.</p>
        <p><b>Z telefonu na komputer:</b> stuknij „Zapisz kopię bazy”, wybierz ${IS_IOS ? "„Zachowaj w Plikach” (iCloud Drive/OneDrive)" : "Dysk Google lub OneDrive (albo plik trafi do Pobranych)"},
        a na komputerze zamknij program i podmień plik budget.db.</p>
        <p>Pracuj w jednym miejscu naraz – wczytanie pliku zastępuje dane w telefonie.</p>
      </details>
    </div>
    <h2>Reguły kategorii (${rules.length})</h2>
    <div class="card">
      <div class="inline-form">
        <input id="rule-keyword" placeholder="Słowo w opisie, np. ZABKA" autocapitalize="characters">
        <select id="rule-cat">${categoryOptions(null).replace(/<option value="-1"[^>]*>Bez kategorii<\/option>/, "")}</select>
        <button class="btn primary" data-action="add-rule">Dodaj</button>
      </div>
      <button class="btn" data-action="apply-rules">Zastosuj reguły do transakcji bez kategorii</button>
      <details><summary class="sub">Pokaż wszystkie reguły</summary>
        <div class="list">${rules.map((r) => `<div class="rule-row"><span><b>${h(r.keyword)}</b> → ${h(r.category_name)}</span>
          <button class="icon-btn" data-action="del-rule" data-id="${r.id}" aria-label="Usuń regułę ${h(r.keyword)}">✕</button></div>`).join("")}</div>
      </details>
    </div>
    <h2>Kategorie (${cats.length})</h2>
    <div class="card">
      <div class="inline-form">
        <input id="cat-name" placeholder="Nowa kategoria">
        <select id="cat-kind"><option value="expense">wydatek</option><option value="income">przychód</option><option value="transfer">przelew własny</option></select>
        <button class="btn primary" data-action="add-cat">Dodaj</button>
      </div>
      <div class="sub">${cats.map((c) => h(c.name)).join(" · ")}</div>
    </div>
    <h2>O aplikacji</h2>
    <div class="card sub">
      Budżet domowy na telefon (iPhone i Android), wersja ${APP_VERSION}. Dane są zapisane tylko w tym telefonie i nigdzie nie są wysyłane.
      Aplikacja działa także bez internetu.
      <button class="btn danger" data-action="wipe">Usuń wszystkie dane z telefonu</button>
    </div>`;
}

const exportDb = guarded(async () => {
  const bytes = state.repo.export();
  const file = new File([bytes], "budget.db", { type: "application/octet-stream" });
  let done = false;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "budget.db" });
      done = true;
    } catch (exc) {
      if (exc.name === "AbortError") return; // anulowano
    }
  }
  if (!done) {
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement("a"), { href: url, download: "budget.db" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  state.meta.dirty = false;
  state.meta.savedToFileAt = Date.now();
  await store.set("meta", state.meta);
  render();
  toast("Kopia bazy gotowa.", "good");
});

const loadDb = guarded(async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const repo = new Repository(state.SQL, bytes); // sprawdza, czy to właściwy plik
  const count = repo.transactionCount();
  const current = state.repo.transactionCount();
  if (current && !confirm(`Zastąpić dane w telefonie (${current} transakcji) zawartością pliku „${file.name}” (${count} transakcji)?`)) {
    repo.close();
    return;
  }
  state.repo.close();
  state.repo = repo;
  state.meta = { dirty: false, savedToFileAt: state.meta.savedToFileAt, openedFile: file.name };
  await persist(false);
  const latest = repo.latestDate();
  state.month = latest ? monthOf(latest) : currentMonth();
  state.view = "summary";
  render();
  toast(`Wczytano bazę: ${count} transakcji.`, "good");
});

const addRule = guarded(async () => {
  state.repo.addRule($("#rule-keyword").value, Number($("#rule-cat").value));
  await persist();
  render();
  toast("Dodano regułę.", "good");
});

const applyRules = guarded(async () => {
  const n = state.repo.applyRulesToUncategorized();
  if (n) await persist();
  render();
  toast(n ? `Przypisano kategorie ${n} transakcjom.` : "Żadna reguła nie pasuje do transakcji bez kategorii.");
});

const deleteRule = guarded(async (id) => {
  state.repo.deleteRule(id);
  await persist();
  render();
});

const addCategory = guarded(async () => {
  state.repo.addCategory($("#cat-name").value, $("#cat-kind").value);
  await persist();
  render();
  toast("Dodano kategorię.", "good");
});

const wipe = guarded(async () => {
  if (!confirm("Usunąć wszystkie dane z tego telefonu? Zapisz wcześniej kopię bazy, jeśli jej potrzebujesz.")) return;
  state.repo.close();
  state.repo = new Repository(state.SQL);
  state.meta = { dirty: false, savedToFileAt: null, openedFile: null };
  await persist(false);
  render();
  toast("Dane usunięte.");
});

async function install() {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  render();
}

// ----------------------------------------------------------------- sheet
// Okienko dodaje wpis do historii, więc przycisk Wstecz (Android) je zamyka.
function openSheet(title, body) {
  $("#sheet-title").textContent = title;
  $("#sheet-body").innerHTML = body;
  if ($("#sheet").hidden) history.pushState({ sheet: true }, "");
  $("#sheet").hidden = false;
  requestAnimationFrame(() => $("#sheet").classList.add("open"));
}

function hideSheet() {
  $("#sheet").classList.remove("open");
  $("#sheet").hidden = true;
}

function closeSheet() {
  if ($("#sheet").hidden) return;
  hideSheet();
  if (history.state?.sheet) history.back();
}

window.addEventListener("popstate", () => { if (!$("#sheet").hidden) hideSheet(); });

// ---------------------------------------------------------------- events
function bindView() {
  const search = $("#search");
  if (search) {
    search.addEventListener("input", () => {
      state.search = search.value;
      clearTimeout(bindView.timer);
      bindView.timer = setTimeout(() => {
        const pos = search.selectionStart;
        render();
        const s = $("#search");
        s.focus();
        s.setSelectionRange(pos, pos);
      }, 300);
    });
  }
  const catFilter = $("#cat-filter");
  if (catFilter) {
    catFilter.addEventListener("change", () => {
      state.category = catFilter.value === "" ? null : Number(catFilter.value);
      render();
    });
  }
  const csv = $("#csv-file");
  if (csv) csv.addEventListener("change", () => csv.files[0] && pickCsv(csv.files[0]));
  const dbFile = $("#db-file");
  if (dbFile) dbFile.addEventListener("change", () => dbFile.files[0] && loadDb(dbFile.files[0]));
  document.querySelectorAll(".limit-input").forEach((input) => {
    input.addEventListener("change", () => saveLimit(input));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  });
}

function onClick(event) {
  const el = event.target.closest("[data-action], .tabbar button");
  if (!el) return;
  if (el.matches(".tabbar button")) {
    state.view = el.dataset.view;
    if (state.view === "import") state.lastImport = state.lastImport && null;
    render();
    window.scrollTo(0, 0);
    return;
  }
  const { action } = el.dataset;
  const id = Number(el.dataset.id);
  if (action === "budget-cat" && event.target.closest("input")) return;
  switch (action) {
    case "prev-month": state.month = shiftMonth(state.month, -1); render(); break;
    case "next-month": state.month = shiftMonth(state.month, 1); render(); break;
    case "go": state.view = el.dataset.view; render(); break;
    case "month":
      state.month = el.dataset.month;
      if (el.dataset.view) state.view = el.dataset.view;
      render();
      break;
    case "filter-cat":
      closeSheet();
      state.category = Number(el.dataset.cat);
      if (el.dataset.month) state.month = el.dataset.month;
      state.search = "";
      state.view = "transactions";
      render();
      window.scrollTo(0, 0);
      break;
    case "tx": openTransaction(id); break;
    case "tx-save": saveTransaction(id); break;
    case "tx-delete": deleteTransaction(id); break;
    case "close-sheet": closeSheet(); break;
    case "import-cancel": state.pendingImport = null; render(); break;
    case "import-do": doImport(); break;
    case "copy-budgets": copyBudgets(); break;
    case "budget-cat": openCategoryEntries(Number(el.dataset.cat)); break;
    case "export-db": exportDb(); break;
    case "add-rule": addRule(); break;
    case "apply-rules": applyRules(); break;
    case "del-rule": deleteRule(id); break;
    case "add-cat": addCategory(); break;
    case "wipe": wipe(); break;
    case "install": install(); break;
    default: break;
  }
}

// Nowa wersja aplikacji: przeładuj, gdy nowy service worker przejmie kontrolę.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded || !navigator.serviceWorker.controller) return;
    reloaded = true;
    if ($("#sheet").hidden && !state.pendingImport) location.reload();
  });
}

start();
