// Baza SQLite w przeglądarce (sql.js) – ten sam format pliku co program na Windows
// (logic/database.py, wersja schematu 4). Kwoty w groszach.

import { Categorizer, normalize } from "./categorizer.js";

export const SCHEMA_VERSION = 4;
export const UNCATEGORIZED = -1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    is_income INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY,
    keyword TEXT NOT NULL UNIQUE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    amount INTEGER NOT NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT '',
    hash TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE TABLE IF NOT EXISTS budgets (
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    limit_amount INTEGER NOT NULL,
    PRIMARY KEY (category_id, month)
);
CREATE TABLE IF NOT EXISTS bank_profiles (
    name TEXT PRIMARY KEY,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transaction_splits (
    id INTEGER PRIMARY KEY,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    amount INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_splits_tx ON transaction_splits(transaction_id);
CREATE TABLE IF NOT EXISTS recurring_hidden (
    key TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS recurring_manual (
    keyword TEXT PRIMARY KEY
);
-- Pozycje do sum: transakcje niepodzielone oraz części transakcji podzielonych.
CREATE VIEW IF NOT EXISTS entries AS
    SELECT t.id AS tx_id, t.date, t.amount, t.category_id
    FROM transactions t
    WHERE NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)
    UNION ALL
    SELECT s.transaction_id, t.date, s.amount, s.category_id
    FROM transaction_splits s JOIN transactions t ON t.id = s.transaction_id;
`;

const DEFAULT_CATEGORIES = [
  ["Spożywcze", "expense"], ["Transport", "expense"], ["Mieszkanie", "expense"],
  ["Rachunki", "expense"], ["Rozrywka", "expense"], ["Zdrowie", "expense"],
  ["Restauracje", "expense"], ["Zakupy", "expense"], ["Gotówka", "expense"],
  ["Inne", "expense"],
  ["Wynagrodzenie", "income"], ["Inne przychody", "income"],
  ["Oszczędności i przelewy własne", "transfer"],
];

const DEFAULT_RULES = {
  "Spożywcze": ["BIEDRONKA", "LIDL", "ZABKA", "KAUFLAND", "CARREFOUR", "AUCHAN",
    "NETTO", "DINO", "STOKROTKA", "FRISCO", "SPAR", "PIEKARNIA", "LEWIATAN",
    "POLOMARKET", "INTERMARCHE"],
  "Transport": ["ORLEN", "ORLENPAY", "BP", "SHELL", "CIRCLE K", "MOYA", "AMIC",
    "JAKDOJADE", "MPK", "URBANCARD", "SKYCASH", "PARKING", "PKP",
    "INTERCITY", "KOLEJE", "UBER", "BOLT", "FREENOW", "AUTOSTRADA"],
  "Restauracje": ["MCDONALDS", "KFC", "BURGER KING", "PYSZNE", "GLOVO", "WOLT",
    "UBER EATS", "STARBUCKS", "COSTA COFFEE", "RESTAURANT", "RESTAURACJA",
    "PIZZERIA", "KAWIARNIA"],
  "Rozrywka": ["NETFLIX", "SPOTIFY", "HBO", "DISNEY", "STORYTEL", "CINEMA CITY",
    "HELIOS", "MULTIKINO", "STEAM", "TOTALIZATOR", "LOTTO", "MULTISPORT",
    "EMULTISPORT", "GOOGLE PLAY"],
  "Zdrowie": ["APTEKA", "LUXMED", "MEDICOVER", "ENEL-MED", "DOZ", "DR MAX"],
  "Zakupy": ["ALLEGRO", "ROSSMANN", "HEBE", "ZALANDO", "IKEA", "CASTORAMA",
    "LEROY MERLIN", "BRICOMARCHE", "OBI", "MEDIA EXPERT", "MEDIA MARKT",
    "RTV EURO AGD", "DECATHLON", "AMAZON", "ACTION", "PEPCO", "TEMU", "SHEIN"],
  "Mieszkanie": ["CZYNSZ", "WSPOLNOTA", "SPOLDZIELNIA"],
  "Rachunki": ["TAURON", "PGNIG", "PGE", "ENEA", "FORTUM", "ORANGE", "T-MOBILE",
    "PLAY", "P4 SP", "VECTRA", "UPC", "NETIA", "WODOCIAGI", "MPWIK"],
  "Gotówka": ["WYPLATA Z BANKOMATU", "WPLATOMACIE", "WPLATA GOTOWKOWA"],
  "Wynagrodzenie": ["WYNAGRODZENIE", "PENSJA"],
  "Oszczędności i przelewy własne": ["ZAOKRAGLENIE PRZEKAZANE", "CASAVER",
    "RACHUNKU OSZCZEDNOSCIOWEGO", "RACHUNEK OSZCZEDNOSCIOWY", "PRZELEW WLASNY"],
};

function profile(fields) {
  return {
    name: "", separator: ";", encoding: "utf-8-sig", skip_rows: 0, date_format: "auto",
    decimal_comma: true, invert_sign: false, date_col: 0, desc_cols: [1], amount_col: 2,
    income_desc_cols: [], date_fallback_col: -1, fallback_after_days: 0, ...fields,
  };
}

export const DEFAULT_PROFILES = [
  profile({ name: "Przykładowy wyciąg", amount_col: 4 }),
  // Eksport historii z CA24, 101 kolumn.
  profile({
    name: "Credit Agricole", encoding: "cp1250", skip_rows: 1,
    date_col: 69, date_fallback_col: 70, fallback_after_days: 14,
    desc_cols: [10, 17, 23, 85], income_desc_cols: [5, 17, 23, 85], amount_col: 81,
  }),
];

const IN_SPAN = "t.date BETWEEN ? AND ?";
const HAS_SPLITS = "EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)";
const EXPENSE_ROW = "((c.id IS NOT NULL AND c.is_income = 0) OR (c.id IS NULL AND t.amount < 0))";
const INCOME_ROW = "((c.id IS NOT NULL AND c.is_income = 1) OR (c.id IS NULL AND t.amount > 0))";
const NOT_TRANSFER = "COALESCE(c.is_transfer, 0) = 0";

export class UserError extends Error {}

export class Repository {
  /** SQL: moduł sql.js; bytes: zawartość pliku bazy albo undefined (nowa baza). */
  constructor(SQL, bytes) {
    if (bytes && !Repository.looksLikeSqlite(bytes)) {
      throw new UserError("To nie jest plik bazy programu Budżet domowy (oczekiwano pliku .db).");
    }
    this.db = new SQL.Database(bytes);
    this.db.exec("PRAGMA foreign_keys = ON");
    const tables = this.all("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
    if (bytes && tables.length && !tables.includes("transactions")) {
      this.db.close();
      throw new UserError("Ten plik SQLite nie pochodzi z programu Budżet domowy.");
    }
    this.db.exec(SCHEMA);
    this.newerVersion = this.schemaVersion() > SCHEMA_VERSION;
    this.migrate();
  }

  static looksLikeSqlite(bytes) {
    const head = new TextDecoder().decode(bytes.slice(0, 15));
    return head === "SQLite format 3";
  }

  close() { this.db.close(); }

  /** Zawartość pliku bazy do zapisu. */
  export() {
    const bytes = this.db.export();
    this.db.exec("PRAGMA foreign_keys = ON"); // export() zeruje ustawienia połączenia
    return bytes;
  }

  // ---------------------------------------------------------------- helpers
  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  one(sql, params = []) { return this.all(sql, params)[0] ?? null; }

  value(sql, params = []) {
    const row = this.db.exec(sql, params)[0];
    return row ? row.values[0][0] : null;
  }

  run(sql, params = []) {
    this.db.run(sql, params);
    return this.db.getRowsModified();
  }

  transaction(fn) {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (exc) {
      this.db.exec("ROLLBACK");
      throw exc;
    }
  }

  schemaVersion() { return this.value("PRAGMA user_version"); }

  migrate() {
    if (this.schemaVersion() >= SCHEMA_VERSION) return;
    const columns = this.all("PRAGMA table_info(categories)").map((r) => r.name);
    const txColumns = this.all("PRAGMA table_info(transactions)").map((r) => r.name);
    this.transaction(() => {
      if (!columns.includes("is_transfer")) {
        this.run("ALTER TABLE categories ADD COLUMN is_transfer INTEGER NOT NULL DEFAULT 0");
      }
      if (!txColumns.includes("note")) {
        this.run("ALTER TABLE transactions ADD COLUMN note TEXT NOT NULL DEFAULT ''");
      }
      for (const [name, kind] of DEFAULT_CATEGORIES) {
        this.run("INSERT OR IGNORE INTO categories(name, is_income, is_transfer) VALUES (?, ?, ?)",
          [name, kind === "income" ? 1 : 0, kind === "transfer" ? 1 : 0]);
      }
      const ids = Object.fromEntries(this.all("SELECT id, name FROM categories").map((r) => [r.name, r.id]));
      for (const [category, keywords] of Object.entries(DEFAULT_RULES)) {
        if (!(category in ids)) continue;
        for (const keyword of keywords) {
          this.run("INSERT OR IGNORE INTO rules(keyword, category_id) VALUES (?, ?)",
            [normalize(keyword), ids[category]]);
        }
      }
      for (const p of DEFAULT_PROFILES) {
        this.run("INSERT OR REPLACE INTO bank_profiles(name, data) VALUES (?, ?)", [p.name, JSON.stringify(p)]);
      }
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  }

  // ------------------------------------------------------------- categories
  listCategories() {
    return this.all(`SELECT id, name, is_income, is_transfer FROM categories
                     ORDER BY is_transfer, is_income, name COLLATE NOCASE`)
      .map((r) => ({ id: r.id, name: r.name, is_income: !!r.is_income, is_transfer: !!r.is_transfer }));
  }

  addCategory(name, kind = "expense") {
    name = name.trim();
    if (!name) throw new UserError("Nazwa kategorii nie może być pusta.");
    try {
      this.run("INSERT INTO categories(name, is_income, is_transfer) VALUES (?, ?, ?)",
        [name, kind === "income" ? 1 : 0, kind === "transfer" ? 1 : 0]);
    } catch {
      throw new UserError(`Kategoria „${name}” już istnieje.`);
    }
    return this.value("SELECT last_insert_rowid()");
  }

  // ------------------------------------------------------------------ rules
  listRules() {
    return this.all(`SELECT r.id, r.keyword, r.category_id, c.name AS category_name
                     FROM rules r JOIN categories c ON c.id = r.category_id ORDER BY r.keyword`);
  }

  addRule(keyword, categoryId) {
    keyword = normalize(keyword);
    if (!keyword) throw new UserError("Słowo kluczowe nie może być puste.");
    this.run(`INSERT INTO rules(keyword, category_id) VALUES (?, ?)
              ON CONFLICT(keyword) DO UPDATE SET category_id = excluded.category_id`, [keyword, categoryId]);
  }

  deleteRule(ruleId) { this.run("DELETE FROM rules WHERE id = ?", [ruleId]); }

  categorizer() { return new Categorizer(this.listRules()); }

  // ----------------------------------------------------------- transactions
  insertTransactions(rows, categorizer, source = "") {
    const report = { added: 0, duplicates: 0, uncategorized: 0 };
    this.transaction(() => {
      for (const row of rows) {
        const categoryId = categorizer.categorize(row.description);
        const changed = this.run(
          `INSERT OR IGNORE INTO transactions (date, description, amount, category_id, source, hash)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [row.date, row.description, row.amount, categoryId, source, row.hash]);
        if (changed === 1) {
          report.added += 1;
          if (categoryId === null) report.uncategorized += 1;
        } else {
          report.duplicates += 1;
        }
      }
    });
    return report;
  }

  /** Transakcje z zakresu dat; category: null = wszystkie, UNCATEGORIZED = bez kategorii. */
  listTransactions(start, end, { search = "", category = null } = {}) {
    let sql = `SELECT t.id, t.date, t.description, t.amount, t.category_id, t.source, t.note,
                      c.name AS category_name, COALESCE(c.is_transfer, 0) AS is_transfer,
                      COALESCE(c.is_income, 0) AS is_income
               FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
               WHERE ${IN_SPAN}`;
    const params = [start, end];
    if (category === UNCATEGORIZED) {
      sql += ` AND ((t.category_id IS NULL AND NOT ${HAS_SPLITS})
               OR EXISTS (SELECT 1 FROM transaction_splits s
                          WHERE s.transaction_id = t.id AND s.category_id IS NULL))`;
    } else if (category !== null) {
      sql += ` AND ((t.category_id = ? AND NOT ${HAS_SPLITS})
               OR EXISTS (SELECT 1 FROM transaction_splits s
                          WHERE s.transaction_id = t.id AND s.category_id = ?))`;
      params.push(category, category);
    }
    sql += " ORDER BY t.date DESC, t.id DESC";
    const rows = this.all(sql, params);
    const splits = this.splitsFor(rows.map((r) => r.id));
    const needle = normalize(search);
    const result = [];
    for (const r of rows) {
      const parts = splits.get(r.id) || [];
      if (needle) {
        const haystack = [r.description, r.note, ...parts.map((p) => p.note)].join(" ");
        if (!normalize(haystack).includes(needle)) continue;
      }
      result.push({ ...r, is_transfer: !!r.is_transfer && !parts.length, splits: parts });
    }
    return result;
  }

  splitsFor(ids) {
    const result = new Map();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const marks = chunk.map(() => "?").join(",");
      const rows = this.all(`SELECT s.transaction_id, s.category_id, s.amount, s.note, c.name AS category_name
                             FROM transaction_splits s LEFT JOIN categories c ON c.id = s.category_id
                             WHERE s.transaction_id IN (${marks}) ORDER BY s.id`, chunk);
      for (const r of rows) {
        if (!result.has(r.transaction_id)) result.set(r.transaction_id, []);
        result.get(r.transaction_id).push(r);
      }
    }
    return result;
  }

  getTransaction(id) {
    const row = this.one("SELECT date FROM transactions WHERE id = ?", [id]);
    if (!row) return null;
    return this.listTransactions(row.date, row.date).find((t) => t.id === id) || null;
  }

  setTransactionCategory(id, categoryId) {
    this.run("UPDATE transactions SET category_id = ? WHERE id = ?", [categoryId, id]);
  }

  setTransactionNote(id, note) {
    this.run("UPDATE transactions SET note = ? WHERE id = ?", [note.trim(), id]);
  }

  deleteTransaction(id) { this.run("DELETE FROM transactions WHERE id = ?", [id]); }

  /** Przypisuje kategorie transakcjom bez kategorii. Ręczne wybory nie są zmieniane. */
  applyRulesToUncategorized(categorizer = this.categorizer()) {
    const rows = this.all(`SELECT id, description FROM transactions t
                           WHERE category_id IS NULL AND NOT ${HAS_SPLITS}`);
    let updated = 0;
    this.transaction(() => {
      for (const r of rows) {
        const categoryId = categorizer.categorize(r.description);
        if (categoryId !== null) {
          this.run("UPDATE transactions SET category_id = ? WHERE id = ?", [categoryId, r.id]);
          updated += 1;
        }
      }
    });
    return updated;
  }

  transactionCount() { return this.value("SELECT COUNT(*) FROM transactions"); }
  earliestDate() { return this.value("SELECT MIN(date) FROM transactions"); }
  latestDate() { return this.value("SELECT MAX(date) FROM transactions"); }

  // ------------------------------------------------------------- aggregates
  /** { income, expenses } w groszach, obie dodatnie, bez przelewów własnych. */
  totals(start, end) {
    const row = this.one(
      `SELECT COALESCE(SUM(CASE WHEN ${INCOME_ROW} THEN t.amount END), 0) AS income,
              COALESCE(-SUM(CASE WHEN ${EXPENSE_ROW} THEN t.amount END), 0) AS expenses
       FROM entries t LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${IN_SPAN} AND ${NOT_TRANSFER}`, [start, end]);
    return { income: row.income, expenses: row.expenses };
  }

  spendingByCategory(start, end) {
    return this.all(
      `SELECT t.category_id, COALESCE(c.name, 'Bez kategorii') AS name, -SUM(t.amount) AS spent
       FROM entries t LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${IN_SPAN} AND ${NOT_TRANSFER} AND ${EXPENSE_ROW}
       GROUP BY t.category_id ORDER BY spent DESC`, [start, end]);
  }

  incomeByCategory(start, end) {
    return this.all(
      `SELECT t.category_id, COALESCE(c.name, 'Bez kategorii') AS name, SUM(t.amount) AS total
       FROM entries t LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${IN_SPAN} AND ${NOT_TRANSFER} AND ${INCOME_ROW}
       GROUP BY t.category_id ORDER BY total DESC`, [start, end]);
  }

  /** { 'RRRR-MM': { income, expenses } } dla podanych miesięcy. */
  totalsByMonth(months) {
    if (!months.length) return {};
    const marks = months.map(() => "?").join(",");
    const rows = this.all(
      `SELECT substr(t.date, 1, 7) AS m,
              COALESCE(SUM(CASE WHEN ${INCOME_ROW} THEN t.amount END), 0) AS income,
              COALESCE(-SUM(CASE WHEN ${EXPENSE_ROW} THEN t.amount END), 0) AS expenses
       FROM entries t LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${NOT_TRANSFER} AND substr(t.date, 1, 7) IN (${marks})
       GROUP BY m`, months);
    const found = Object.fromEntries(rows.map((r) => [r.m, r]));
    return Object.fromEntries(months.map((m) => [m, {
      income: found[m]?.income ?? 0, expenses: found[m]?.expenses ?? 0,
    }]));
  }

  // ---------------------------------------------------------------- budgets
  getBudgetLimits(month) {
    return Object.fromEntries(
      this.all("SELECT category_id, limit_amount FROM budgets WHERE month = ?", [month])
        .map((r) => [r.category_id, r.limit_amount]));
  }

  /** Limit w groszach; 0 usuwa limit. */
  setBudgetLimit(categoryId, month, limit) {
    if (limit <= 0) {
      this.run("DELETE FROM budgets WHERE category_id = ? AND month = ?", [categoryId, month]);
    } else {
      this.run(`INSERT INTO budgets(category_id, month, limit_amount) VALUES (?, ?, ?)
                ON CONFLICT(category_id, month) DO UPDATE SET limit_amount = excluded.limit_amount`,
      [categoryId, month, limit]);
    }
  }

  copyBudgetLimits(sourceMonth, targetMonth) {
    return this.run(`INSERT OR REPLACE INTO budgets(category_id, month, limit_amount)
                     SELECT category_id, ?, limit_amount FROM budgets WHERE month = ?`,
    [targetMonth, sourceMonth]);
  }

  // --------------------------------------------------------------- profiles
  listProfiles() {
    const result = [];
    for (const r of this.all("SELECT data FROM bank_profiles ORDER BY name")) {
      try {
        const data = JSON.parse(r.data);
        if ("desc_col" in data && !("desc_cols" in data)) data.desc_cols = [data.desc_col];
        result.push(profile(data));
      } catch { /* uszkodzony wpis – pomijamy */ }
    }
    return result;
  }
}
