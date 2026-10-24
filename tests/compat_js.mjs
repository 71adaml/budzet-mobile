// Node: importuje plik CSV do nowej bazy (logika aplikacji webowej) i zapisuje plik .db.
// Użycie: node tests/compat_js.mjs wejscie.csv wyjscie.db [istniejaca.db]
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Repository, DEFAULT_PROFILES } from "../js/db.js";
import { parseWithBestProfile } from "../js/importer.js";

const require = createRequire(import.meta.url);
const initSqlJs = require("../vendor/sql-wasm.js");
const SQL = await initSqlJs({ locateFile: (f) => new URL(`../vendor/${f}`, import.meta.url).pathname });
const [csvPath, outPath, existing] = process.argv.slice(2);
const repo = new Repository(SQL, existing ? new Uint8Array(readFileSync(existing)) : undefined);
const bytes = new Uint8Array(readFileSync(csvPath));
const best = await parseWithBestProfile(bytes, [...repo.listProfiles(), ...DEFAULT_PROFILES]);
const report = repo.insertTransactions(best.result.rows, repo.categorizer(), "test.csv");
console.log(JSON.stringify({ profile: best.profile.name, errors: best.result.errors, report,
  totals: repo.totals("2020-01-01", "2029-12-31") }));
writeFileSync(outPath, repo.export());
