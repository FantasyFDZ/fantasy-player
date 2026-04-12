#!/usr/bin/env python3
"""
Melody 音频分析 sidecar。

调用约定：
    stdin: {"audio_path": "/path/to/file.wav"}  (single JSON line)
    stdout: {"ok": true, "data": {...}} | {"ok": false, "error": "..."}

Rust 侧 spawn 本脚本，一次处理一首歌，退出返回结果。

特征提取：
- bpm: essentia RhythmExtractor2013(multifeature) —— MIREX 基准约 87%
  准确率，比 librosa beat_track 的 ~75% 高出一档
- beats_confidence: BPM 置信度（essentia 输出）
- key: essentia KeyExtractor —— 基于 HPCP + Krumhansl 曲线谱，
  比 librosa chroma argmax 精准得多
- energy: librosa RMS 均值归一化到 0-1
- valence: 情绪代理，由 spectral centroid 映射
- spectral_centroid / bandwidth / flatness / rolloff / zero_crossing_rate:
  librosa 全曲均值，给 DJ 控制台做音色分析
"""

import json
import sys
import traceback

import essentia.standard as es
import librosa
import numpy as np


def analyze(audio_path: str) -> dict:
    # 1. Essentia 路径：22050 Hz 单声道 —— RhythmExtractor2013 和
    #    KeyExtractor 内部都默认 44100，但低采样率也能跑，速度更快
    audio_es = es.MonoLoader(filename=audio_path, sampleRate=44100)()

    # BPM —— multifeature 方法综合多个 onset detector，最稳
    rhythm = es.RhythmExtractor2013(method="multifeature")
    bpm, beats, beats_confidence, _bpm_estimates, _bpm_intervals = rhythm(audio_es)

    # 调式 —— HPCP + Krumhansl 谱
    key_extractor = es.KeyExtractor()
    key, scale, key_strength = key_extractor(audio_es)

    # 2. librosa 路径：继续用 22050 采样率，给后面的几个频谱特征提供数据
    y, sr = librosa.load(audio_path, sr=22050, mono=True)

    # RMS 能量
    rms = librosa.feature.rms(y=y)[0]
    energy_raw = float(np.mean(rms))
    energy = float(np.clip(energy_raw / 0.3, 0.0, 1.0))

    # 频谱特征
    centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    bandwidth = float(np.mean(librosa.feature.spectral_bandwidth(y=y, sr=sr)))
    flatness = float(np.mean(librosa.feature.spectral_flatness(y=y)))
    rolloff = float(np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr)))
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(y=y)))

    # valence: centroid 归一化（500-4000 Hz 对应 0-1）
    valence = float(np.clip((centroid - 500) / 3500, 0.0, 1.0))

    # 组装 key string：major 大调省略后缀，minor 小调加 m（跟 Rekordbox 习惯）
    key_string = key if scale == "major" else f"{key}m"

    return {
        "bpm": round(float(bpm), 2),
        "bpm_confidence": round(float(beats_confidence), 3),
        "energy": round(energy, 4),
        "valence": round(valence, 4),
        "key": key_string,
        "key_confidence": round(float(key_strength), 3),
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
