#!/usr/bin/env python3
"""Genera audios de prueba con notas conocidas para medir la precisión de la transcripción.

Sintetiza guitarra con armónicos que decaen como una cuerda real y crea casos
difíciles: mezcla con bajo y acordes, ruido, y temas desafinados respecto a 440 Hz.
Uso: python3 eval/make_data.py  ->  eval/data/<caso>.wav + eval/data/cases.json
"""
import json
import math
import random
import wave
from pathlib import Path

import numpy as np

SR = 22050
OUT = Path(__file__).parent / "data"
rng = random.Random(7)


def ks(freq, dur, amp, bright=0.5):
    """Cuerda pulsada: armónicos que decaen (los agudos antes) + golpe de púa. Afinación exacta."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in range(1, 16):
        f = freq * k * (1 + 0.0002 * k * k)  # leve inarmonicidad de cuerda de acero
        if f > SR / 2:
            break
        a = (bright ** (k - 1)) / k * rng.uniform(0.6, 1.0)
        out += a * np.exp(-t * (1.2 + 0.5 * k)) * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28))
    pick = np.array([rng.gauss(0, 1) for _ in range(int(0.004 * SR))]) * 0.3
    out[: len(pick)] += pick
    out *= np.minimum(1, t / 0.002)
    fade = min(n, int(0.02 * SR))
    out[-fade:] *= np.linspace(1, 0, fade)
    return out * amp / (np.max(np.abs(out)) + 1e-9)


def midi_hz(m, cents=0.0):
    return 440 * 2 ** ((m - 69 + cents / 100) / 12)


def render(events, length, cents=0.0):
    audio = np.zeros(int(length * SR))
    for t, m, d, a in events:
        s = ks(midi_hz(m, cents), d, a)
        i = int(t * SR)
        audio[i : i + len(s)] += s[: len(audio) - i]
    return audio


def lick(start=0.5, bars=4, bpm=120):
    """Punteo en La menor pentatónica con ritmos variados (semicorcheas a negras)."""
    scale = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81]
    notes, t, pos = [], start, 5
    beat = 60 / bpm
    while t < start + bars * 4 * beat - 1e-6:
        dur = rng.choice([0.25, 0.5, 0.5, 0.75, 1.0]) * beat
        pos = max(0, min(len(scale) - 1, pos + rng.choice([-2, -1, -1, 1, 1, 2, 0])))
        notes.append((round(t, 4), scale[pos], dur, 0.5))
        t += dur
    return notes


def backing(start=0.5, bars=4):
    bass, chords = [], []
    prog = [(45, [57, 60, 64]), (41, [53, 57, 60]), (43, [55, 59, 62]), (40, [52, 56, 59])]
    for i in range(bars):
        root, ch = prog[i % 4]
        t = start + i * 2
        for k in range(4):
            bass.append((t + k * 0.5, root, 0.45, 0.45))
        for k in (0, 1):
            for j, m in enumerate(ch):
                chords.append((t + k + j * 0.01, m, 0.9, 0.18))
    return bass, chords


VOICINGS = {
    "C": [48, 52, 55, 60, 64], "G": [43, 47, 50, 55, 59, 67], "Am": [45, 52, 57, 60, 64],
    "F": [41, 48, 53, 57, 60, 65], "Dm": [50, 57, 62, 65], "E7": [40, 47, 50, 56, 59, 64],
    "Em": [40, 47, 52, 55, 59, 64], "D": [50, 57, 62, 66], "A7": [45, 52, 55, 61, 64],
    "Cmaj7": [48, 52, 55, 59, 64], "Bm": [47, 54, 59, 62, 66], "Bdim": [47, 53, 59, 62],
    "Dsus2": [50, 57, 62, 64], "Asus4": [45, 52, 57, 62, 64], "Am7": [45, 52, 55, 60, 64],
    "Fmaj7": [53, 57, 60, 64], "C/E": [40, 48, 52, 55, 60, 64], "D/F#": [42, 50, 57, 62, 66],
    "G7": [43, 47, 50, 55, 59, 65], "E": [40, 47, 52, 56, 59, 64], "A": [45, 52, 57, 61, 64],
    "Bm7b5": [47, 53, 57, 62], "Bdim7": [47, 53, 56, 62], "C6": [48, 52, 57, 60, 64],
    "Am6": [45, 52, 57, 60, 66], "Cadd9": [48, 52, 55, 62, 64], "A7sus4": [45, 52, 55, 62, 64],
    "E9": [40, 47, 50, 56, 59, 66],
}
ROOTS = {"C": 48, "D": 50, "E": 40, "F": 41, "G": 43, "A": 45, "B": 47}


def strum(prog, start=0.5, bar=2.0, pattern="DDUUDU", arpeggio=False):
    """Rasguea (o arpegia) una progresión. Devuelve notas y segmentos de acordes verdaderos."""
    notes, segs = [], []
    for i, name in enumerate(prog):
        t0 = start + i * bar
        segs.append({"start": round(t0, 3), "end": round(t0 + bar, 3), "name": name})
        v = VOICINGS[name]
        if arpeggio:
            order = v + v[-2:0:-1]
            step = bar / 8
            for k in range(8):
                notes.append((t0 + k * step, order[k % len(order)], step * 2.5, 0.45))
            continue
        step = bar / len(pattern)
        for k, d in enumerate(pattern):
            if d == "-":
                continue
            strings = v if d == "D" else list(reversed(v[-4:]))
            for j, m in enumerate(strings):
                notes.append((t0 + k * step + j * 0.012, m, step * 1.6, (0.4 if d == "D" else 0.25) * rng.uniform(0.8, 1.1)))
    return notes, segs


def save(name, audio, truth, notes):
    """`audio` mono (n,) o estéreo (n, 2)."""
    peak = np.max(np.abs(audio)) or 1
    pcm = (audio / peak * 0.9 * 32767).astype("<i2")
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1 if audio.ndim == 1 else 2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    truth.append({"name": name, "notes": [{"start": t, "midi": m} for t, m, _, _ in notes]})


def main():
    OUT.mkdir(exist_ok=True)
    truth = []
    length = 9.5

    solo = lick()
    save("punteo_limpio", render(solo, length), truth, solo)

    bass, chords = backing()
    mix = render(solo, length) + render(bass, length) + render(chords, length)
    save("punteo_con_banda", mix, truth, solo)

    noisy = render(solo, length)
    t = np.arange(len(noisy)) / SR
    noisy = noisy + 0.06 * np.array([rng.gauss(0, 1) for _ in range(len(noisy))]) + 0.1 * np.sin(2 * math.pi * 50 * t)
    save("punteo_con_ruido", noisy, truth, solo)

    save("punteo_desafinado_-35c", render(solo, length, cents=-35), truth, solo)
    save("punteo_desafinado_+40c", render(solo, length, cents=40), truth, solo)

    # Acordes: la verdad es la secuencia de acordes, no las notas.
    chord_cases = {
        "acordes_rasgueo": (["C", "G", "Am", "F", "Dm", "E7", "Am", "G"], {}),
        "acordes_arpegio": (["Am", "C", "D", "F", "Em", "G", "Am", "E"], {"arpeggio": True}),
        "acordes_variados": (["Cmaj7", "Am7", "Dsus2", "Asus4", "Fmaj7", "G7", "Bdim", "Bm"], {}),
        "acordes_inversiones": (["C", "C/E", "F", "G", "D", "D/F#", "G", "A7"], {}),
        "acordes_extendidos": (["Cadd9", "C6", "Am6", "Bm7b5", "E9", "A7sus4", "Bdim7", "Am"], {}),
    }
    for name, (prog, kw) in chord_cases.items():
        notes, segs = strum(prog, **kw)
        L = 0.5 + len(prog) * 2 + 1
        audio = render(notes, L)
        if name == "acordes_rasgueo":  # con bajo y melodía encima, como en una canción
            bass = [(sg["start"] + k * 0.5, ROOTS[sg["name"][0]] - 12 if ROOTS[sg["name"][0]] >= 45 else ROOTS[sg["name"][0]], 0.45, 0.35)
                    for sg in segs for k in range(4)]
            audio = audio + render(bass, L)
        save(name, audio, truth, [])
        truth[-1]["chords"] = segs

    # Ritmo: tempo, compás y posición de cada nota en la cuadrícula (semicorcheas desde el primer tiempo).
    def rhythm(case, bpm, beats_per_bar, downbeat, notes, mode="lead"):
        q = 60 / bpm / 4
        case["rhythm"] = {"bpm": bpm, "beatsPerBar": beats_per_bar, "downbeat": downbeat, "mode": mode,
                          "notes": [{"start": t, "midi": m, "tick": round((t - downbeat) / q)} for t, m, _, _ in notes]}

    by_name = {c["name"]: c for c in truth}
    rhythm(by_name["punteo_limpio"], 120, 4, 0.5, solo)
    rhythm(by_name["punteo_con_banda"], 120, 4, 0.5, solo)

    slow = lick(start=0.8, bars=4, bpm=72)
    L = 0.8 + 16 * 60 / 72 + 1.5
    save("ritmo_lento_72", render(slow, L), truth, [])
    rhythm(truth[-1], 72, 4, 0.8, slow)

    # Vals: bajo en el 1, acorde en el 2 y el 3, un acorde por compás.
    waltz, beat = [], 60 / 150
    prog = ["C", "Am", "F", "G", "C", "Em", "Dm", "G"]
    for i, name in enumerate(prog):
        t0 = 0.3 + i * 3 * beat
        v = VOICINGS[name]
        waltz.append((round(t0, 4), v[0], beat * 0.95, 0.5))
        for k in (1, 2):
            for j, m in enumerate(v[1:4]):
                waltz.append((round(t0 + k * beat + j * 0.008, 4), m, beat * 0.9, 0.22))
    L = 0.3 + len(prog) * 3 * beat + 1.5
    save("ritmo_vals_3x4", render(waltz, L), truth, [])
    rhythm(truth[-1], 150, 3, 0.3, [n for k, n in enumerate(waltz) if k % 7 in (0, 1, 4)], mode="chords")

    notes, segs = strum(["G", "D", "Em", "C", "G", "D", "C", "C"], start=0.6, bar=2.4, pattern="D-DU-UDU")
    L = 0.6 + 8 * 2.4 + 1.5
    save("ritmo_rasgueo_100", render(notes, L), truth, [])
    # Para la cuadrícula basta con la nota más grave de cada golpe (el rasgueo arpegia unos milisegundos).
    hits = {}
    for t, m, d, a in notes:
        k = round((t - 0.6) / 0.3)
        if k not in hits or m < hits[k][1]:
            hits[k] = (0.6 + k * 0.3, m, d, a)
    rhythm(truth[-1], 100, 4, 0.6, sorted(hits.values()), mode="chords")

    # Canción completa en estéreo: punteo a la izquierda; voz, bajo y batería en el centro.
    # Mide cuánto ayuda «Separar guitarra» (los casos banda_* se informan aparte).
    L = 9.5
    n = int(L * SR)
    t = np.arange(n) / SR
    guitar = render(solo, L)
    bass_line, chord_pad = backing()
    bass_audio = render(bass_line, L)
    voice = np.zeros(n)
    for k, m in enumerate([64, 67, 69, 67, 64, 62, 60, 62]):  # voz: senos con vibrato, notas largas
        i0, i1 = int((0.5 + k) * SR), int((1.45 + k) * SR)
        tt = t[i0:i1] - t[i0]
        f = midi_hz(m) * (1 + 0.006 * np.sin(2 * np.pi * 5.5 * tt))
        ph = 2 * np.pi * np.cumsum(f) / SR
        voice[i0:i1] += (np.sin(ph) + 0.4 * np.sin(2 * ph) + 0.2 * np.sin(3 * ph)) * np.minimum(1, tt / 0.05) * 0.25
    drums = np.zeros(n)
    for k in range(int((L - 0.5) / 0.25)):  # bombo en 1 y 3, caja en 2 y 4, charles en corcheas
        i0 = int((0.5 + k * 0.25) * SR)
        seg = np.arange(min(int(0.2 * SR), n - i0)) / SR
        if k % 8 in (0, 4):
            drums[i0 : i0 + len(seg)] += np.sin(2 * np.pi * (50 + 80 * np.exp(-seg * 30)) * seg) * np.exp(-seg * 18) * 0.9
        if k % 8 in (2, 6):
            drums[i0 : i0 + len(seg)] += np.array([rng.gauss(0, 1) for _ in seg]) * np.exp(-seg * 25) * 0.45
        if k % 2 == 0:
            m = min(int(0.05 * SR), n - i0)
            drums[i0 : i0 + m] += np.array([rng.gauss(0, 1) for _ in range(m)]) * np.exp(-np.arange(m) / SR * 80) * 0.15
    center = bass_audio * 0.8 + voice + drums
    stereo = np.stack([center + guitar * 0.9, center + guitar * 0.25], axis=1)
    save("banda_estereo", stereo, truth, solo)

    (OUT / "cases.json").write_text(json.dumps(truth, indent=1))
    print(f"{len(truth)} casos en {OUT}")


if __name__ == "__main__":
    main()
