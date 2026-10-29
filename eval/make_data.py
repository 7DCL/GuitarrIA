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


def lick(start=0.5, bars=4):
    """Punteo en La menor pentatónica con ritmos variados."""
    scale = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81]
    notes, t, pos = [], start, 5
    while t < start + bars * 2:
        dur = rng.choice([0.125, 0.25, 0.25, 0.375, 0.5])
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
            strings = v if d == "D" else list(reversed(v[-4:]))
            for j, m in enumerate(strings):
                notes.append((t0 + k * step + j * 0.012, m, step * 1.6, (0.4 if d == "D" else 0.25) * rng.uniform(0.8, 1.1)))
    return notes, segs


def save(name, audio, truth, notes):
    peak = np.max(np.abs(audio)) or 1
    pcm = (audio / peak * 0.9 * 32767).astype("<i2")
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
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

    (OUT / "cases.json").write_text(json.dumps(truth, indent=1))
    print(f"{len(truth)} casos en {OUT}")


if __name__ == "__main__":
    main()
