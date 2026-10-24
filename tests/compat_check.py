"""Sprawdza zgodność: baza z aplikacji webowej otwiera się w programie na Windows,
skróty transakcji są identyczne, a ponowny import w Pythonie nie dodaje duplikatów."""
import json, subprocess, sys, tempfile
from pathlib import Path
DESKTOP = Path(sys.argv[1])
sys.path.insert(0, str(DESKTOP))
sys.path.insert(0, str(DESKTOP / "tests"))
from ca_fixture import write_ca_file
from logic.database import Repository, CREDIT_AGRICOLE_PROFILE
from logic.importer import parse_file

ROOT = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    for csv_path, profile in [(write_ca_file(tmp / "ca.csv"), CREDIT_AGRICOLE_PROFILE),
                              (DESKTOP / "sample_data" / "przyklad_wyciag.csv", None)]:
        db = tmp / f"{csv_path.stem}.db"
        out = subprocess.run(["node", str(ROOT / "tests/compat_js.mjs"), str(csv_path), str(db)],
                             check=True, capture_output=True, text=True).stdout
        js = json.loads(out)
        repo = Repository(db)
        profile = profile or next(p for p in repo.list_profiles() if p.name == js["profile"])
        parsed = parse_file(csv_path, profile)
        py_hashes = sorted(r.hash for r in parsed.rows)
        js_hashes = sorted(r[0] for r in repo.conn.execute("SELECT hash FROM transactions"))
        assert py_hashes == js_hashes, (csv_path.name, len(py_hashes), len(js_hashes))
        report = repo.insert_transactions(parsed.rows, repo.categorizer())
        assert report.added == 0 and report.duplicates == len(parsed.rows), report
        # Kategorie przypisane przez JS = kategorie z Pythona.
        cat = repo.categorizer()
        for desc, cid in repo.conn.execute("SELECT description, category_id FROM transactions"):
            assert cat.categorize(desc) == cid, (desc, cid)
        income, expenses = repo.month_totals(__import__("logic.period", fromlist=["Period"]).Period.custom(
            __import__("datetime").date(2020, 1, 1), __import__("datetime").date(2029, 12, 31)))
        assert int(income * 100) == js["totals"]["income"] and int(expenses * 100) == js["totals"]["expenses"]
        assert repo.conn.execute("PRAGMA user_version").fetchone()[0] == 4
        assert repo.conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        print("OK", csv_path.name, js["profile"], js["report"], "błędy:", len(js["errors"]))
        repo.close()
    # Kierunek odwrotny: baza utworzona w Pythonie, import w JS -> same duplikaty.
    py_db = tmp / "py.db"
    repo = Repository(py_db)
    ca = tmp / "ca.csv"
    repo.insert_transactions(parse_file(ca, CREDIT_AGRICOLE_PROFILE).rows, repo.categorizer())
    repo.close()
    out = json.loads(subprocess.run(["node", str(ROOT / "tests/compat_js.mjs"), str(ca), str(tmp / "py2.db"), str(py_db)],
                                    check=True, capture_output=True, text=True).stdout)
    assert out["report"]["added"] == 0, out
    print("OK baza z Pythona -> import w JS:", out["report"])
