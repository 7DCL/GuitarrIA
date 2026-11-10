"""Crea casos "<caso>_aislada" pasando el audio por la separación de GuitarrIA Local Pro (Demucs).

Uso: python3 eval/separate_case.py punteo_con_banda [otro_caso…]   (tras eval/make_data.py)
Luego: ONLY=punteo_con_banda node scripts/eval.cjs  → compara el audio completo con la guitarra aislada.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "local"))
import separate  # noqa: E402

data = Path(__file__).parent / "data"
cases = json.loads((data / "cases.json").read_text())
for name in sys.argv[1:]:
    case = next(c for c in cases if c["name"] == name)
    out = f"{name}_aislada"
    secs = separate.guitar(data / f"{name}.wav", data / f"{out}.wav")
    cases = [c for c in cases if c["name"] != out] + [{**case, "name": out}]
    print(f"{name}: {secs:.1f} s separados → {out}")
(data / "cases.json").write_text(json.dumps(cases))
