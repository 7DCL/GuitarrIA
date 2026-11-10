"""Prepara casos de evaluación con grabaciones REALES de guitarra (GuitarSet, Xi et al. 2018).

GuitarSet: 360 fragmentos tocados por 6 guitarristas, con notas y acordes anotados a mano.
https://zenodo.org/records/3371780 (licencia CC BY 4.0). Se usa solo para medir, no se distribuye.

Uso: python3 eval/guitarset.py <carpeta con annotation.zip y audio_mono-mic.zip> [jugadores]
Deja los audios y eval/data-gs/cases.json listos para: DATA=data-gs node scripts/eval.cjs
"""
import io
import json
import re
import sys
import zipfile
from pathlib import Path

NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
ROOT = {n: i for i, n in enumerate(NAMES)}
ROOT.update({"Db": 1, "Eb": 3, "Gb": 6, "Ab": 8, "Bb": 10, "Cb": 11, "Fb": 4, "E#": 5, "B#": 0})
QUALITY = {
    "maj": "", "min": "m", "7": "7", "maj7": "maj7", "min7": "m7", "hdim7": "m7b5", "dim": "dim",
    "dim7": "dim7", "aug": "aug", "sus2": "sus2", "sus4": "sus4", "maj6": "6", "min6": "m6", "9": "9",
    "5": "5", "": "",
    # Extendidos: se comparan con su acorde de séptima (GuitarrIA no los distingue).
    "min9": "m7", "maj9": "maj7", "11": "7", "13": "7", "min11": "m7", "minmaj7": "m", "7sus4": "7sus4",
}
DEGREE = {"1": 0, "b2": 1, "2": 2, "b3": 3, "3": 4, "4": 5, "b5": 6, "5": 7, "#5": 8, "6": 9, "b7": 10, "7": 11, "9": 2}


def chord_name(label):
    """'A:min7/b3' (notación Harte) → 'Am7/C' (notación de GuitarrIA). None si no se puede representar."""
    if label in ("N", "X"):
        return "N"
    root, _, rest = label.partition(":")
    quality, _, bass = rest.partition("/")
    # Extensiones entre paréntesis (7(11), maj(#11), (1,5)…): se compara con el acorde base.
    ext = re.search(r"\((.*)\)", quality)
    quality = re.sub(r"\(.*\)", "", quality)
    if not quality and ext and set(ext.group(1).split(",")) <= {"1", "5"}:
        quality = "5"
    if root not in ROOT or quality not in QUALITY:
        return None
    r = ROOT[root]
    name = NAMES[r] + QUALITY[quality]
    if bass:
        if bass not in DEGREE:
            return None
        if DEGREE[bass]:
            name += "/" + NAMES[(r + DEGREE[bass]) % 12]
    return name


def main():
    src = Path(sys.argv[1])
    players = (sys.argv[2] if len(sys.argv) > 2 else "00").split(",")
    out = Path(__file__).parent / "data-gs"
    out.mkdir(exist_ok=True)
    ann = zipfile.ZipFile(src / "annotation.zip")
    audio = zipfile.ZipFile(src / "audio_mono-mic.zip")
    audio_names = {Path(n).name: n for n in audio.namelist() if n.endswith(".wav")}
    cases = []
    skipped = 0
    unknown = set()
    for name in sorted(ann.namelist()):
        stem = Path(name).stem
        if not name.endswith(".jams") or stem[:2] not in players:
            continue
        wav = audio_names.get(f"{stem}_mic.wav")
        if not wav:
            continue
        jams = json.loads(ann.read(name))
        notes = []
        for a in jams["annotations"]:
            if a["namespace"] == "note_midi":
                notes += [{"start": round(d["time"], 3), "midi": round(d["value"])} for d in a["data"]]
        notes.sort(key=lambda n: n["start"])
        case = {"name": "gs_" + stem, "notes": notes}
        if stem.endswith("_comp"):
            chord_anns = [a for a in jams["annotations"] if a["namespace"] == "chord"]
            # GuitarSet trae dos: la de la partitura y la "tocada" (inferida de lo que suena). Se usa la tocada.
            data = chord_anns[-1]["data"]
            chords = []
            for d in data:
                n = chord_name(d["value"])
                if n is None:
                    skipped += 1
                    unknown.add(d["value"])
                    continue
                chords.append({"start": round(d["time"], 3), "end": round(d["time"] + d["duration"], 3), "name": n})
            case["chords"] = chords
        # Se normaliza a wav PCM 16 bits mono (algunos originales no los decodifica el navegador).
        import soundfile as sf

        data, sr = sf.read(io.BytesIO(audio.read(wav)), dtype="float32", always_2d=True)
        sf.write(out / f"{case['name']}.wav", data.mean(axis=1), sr, subtype="PCM_16")
        cases.append(case)
    (out / "cases.json").write_text(json.dumps(cases))
    comp = sum(1 for c in cases if "chords" in c)
    print(f"{len(cases)} casos ({comp} de acordes, {len(cases) - comp} de punteo); {skipped} acordes sin equivalente omitidos: {sorted(unknown)[:20]}")


if __name__ == "__main__":
    main()
