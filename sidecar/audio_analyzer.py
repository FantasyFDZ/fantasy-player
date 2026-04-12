#!/usr/bin/env python3
"""
Melody 音频分析 sidecar。

调用约定：
    stdin: {"audio_path": "/path/to/file.wav"}  (single JSON line)
    stdout: {"ok": true, "data": {...}} | {"ok": false, "error": "..."}

Rust 侧 spawn 本脚本，一次处理一首歌，退出返回结果。

使用 librosa 提取以下特征：
- bpm: 估计节拍（beat_track）
- energy: RMS 能量均值，映射到 0-1
- valence: 情绪值（使用 spectral_centroid 代理，越亮越正面，归一化）
- key: 使用 chroma 向量估计调式（C/C#/.../B）
- spectral_centroid / bandwidth / flatness / rolloff / zero_crossing_rate: 用于
  更细的音色分析（DJ 面板）
"""

import json
import sys
import traceback

import librosa
import numpy as np


PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def estimate_key(chroma: np.ndarray) -> str:
    """
    朴素调式估计：
    取每个 chroma bin 的平均强度，最大的那个视为 tonic。
    """
    avg = np.mean(chroma, axis=1)
    idx = int(np.argmax(avg))
    return PITCH_CLASSES[idx]


def analyze(audio_path: str) -> dict:
    # 载入音频（单声道，采样率默认 22050）—— 对 BPM/频谱分析足够
    y, sr = librosa.load(audio_path, sr=22050, mono=True)

    # BPM
    tempo, _beats = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(np.atleast_1d(tempo)[0])

    # RMS 能量
    rms = librosa.feature.rms(y=y)[0]
    energy_raw = float(np.mean(rms))
    # 归一化到 0-1（经验值，典型音乐 rms 0.02-0.3）
    energy = float(np.clip(energy_raw / 0.3, 0.0, 1.0))

    # Chroma 调式
    chroma = librosa.feature.chroma_stft(y=y, sr=sr)
    key = estimate_key(chroma)

    # 频谱特征
    centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    bandwidth = float(np.mean(librosa.feature.spectral_bandwidth(y=y, sr=sr)))
    flatness = float(np.mean(librosa.feature.spectral_flatness(y=y)))
    rolloff = float(np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr)))
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(y=y)))

    # valence：简单映射 spectral_centroid 到 0-1 作为情绪代理
    # centroid 范围通常 500-4000 Hz
    valence = float(np.clip((centroid - 500) / 3500, 0.0, 1.0))

    return {
        "bpm": round(bpm, 2),
        "energy": round(energy, 4),
        "valence": round(valence, 4),
        "key": key,
        "spectral_centroid": round(centroid, 2),
        "spectral_bandwidth": round(bandwidth, 2),
        "spectral_flatness": round(flatness, 6),
        "spectral_rolloff": round(rolloff, 2),
        "zero_crossing_rate": round(zcr, 6),
    }


def main() -> int:
    try:
        raw = sys.stdin.read().strip()
        if not raw:
            raise ValueError("empty stdin")
        req = json.loads(raw)
        audio_path = req.get("audio_path")
        if not audio_path:
            raise ValueError("missing audio_path in request")
        data = analyze(audio_path)
        sys.stdout.write(json.dumps({"ok": True, "data": data}) + "\n")
        return 0
    except Exception as error:
        sys.stdout.write(
            json.dumps(
                {"ok": False, "error": str(error)},
                ensure_ascii=False,
            )
            + "\n"
        )
        sys.stderr.write(traceback.format_exc() + "\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
