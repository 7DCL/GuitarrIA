"""Aísla la guitarra de una mezcla con Demucs (htdemucs_6s: voz, batería, bajo, guitarra, piano y otros).

Lo usa GuitarrIA Local Pro: con banda, transcribir solo la pista de guitarra da muchas menos notas falsas.
Necesita torch + demucs + imageio-ffmpeg (ver requirements-pro.txt). Todo corre en la CPU del usuario.
"""
import os
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

SR = 44100


def available():
    try:
        import demucs  # noqa: F401
        import torch  # noqa: F401
        import imageio_ffmpeg  # noqa: F401

        return True
    except ImportError:
        return False


def _setup_model_cache():
    # En el .exe el modelo viaja dentro (carpeta "hub"); así no se baja nada al usarlo.
    base = getattr(sys, "_MEIPASS", None)
    if base and (Path(base) / "hub").exists():
        os.environ.setdefault("TORCH_HOME", base)


def decode(path):
    """Cualquier audio (m4a, webm, mp3, wav…) → float32 estéreo (2, n) a 44,1 kHz."""
    import imageio_ffmpeg

    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"]
    flags = 0x08000000 if os.name == "nt" else 0  # sin ventana de consola en Windows
    raw = subprocess.run(cmd, capture_output=True, check=True, creationflags=flags).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.copy()


def write_wav(path, mono):
    pcm = (np.clip(mono, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


_model = None


def guitar(src, dst, stems=("guitar",)):
    """Separa `src` y guarda en `dst` (wav mono) la suma de `stems`. Devuelve la duración en segundos."""
    global _model
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    _setup_model_cache()
    torch.set_num_threads(max(1, os.cpu_count() or 1))
    if _model is None:
        _model = get_model("htdemucs_6s")
        _model.eval()
    audio = torch.from_numpy(decode(src))
    ref = audio.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        out = apply_model(_model, ((audio - mean) / std)[None], device="cpu", split=True, overlap=0.25, progress=False)[0]
    out = out * std + mean
    mix = sum(out[_model.sources.index(s)] for s in stems).mean(0).numpy()
    peak = np.abs(mix).max()
    if peak > 0:
        mix = mix * min(1.0, 0.9 / peak) if peak > 0.9 else mix
    write_wav(dst, mix)
    return mix.shape[-1] / SR


if __name__ == "__main__":
    # Uso: python separate.py entrada.(wav|m4a|mp3) salida.wav
    print(f"{guitar(sys.argv[1], sys.argv[2]):.1f} s separados")
