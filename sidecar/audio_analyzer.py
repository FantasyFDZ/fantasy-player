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
    # 1. Essentia 路径：44100 Hz 单声道
    audio_es = es.MonoLoader(filename=audio_path, sampleRate=44100)()

    # ---- BPM: 多算法融合 ------------------------------------------
    #
    # 单一算法（multifeature）在抒情曲上容易给出 2 倍速误判（比如
    # 真实 74 BPM 的歌被检测成 148）。策略：同时跑两种不同算法，
    # 根据一致性做裁决。

    # 算法 A: RhythmExtractor2013 multifeature —— 综合多 onset 检测
    rex_multi = es.RhythmExtractor2013(method="multifeature")
    bpm_a, _beats_a, conf_a_raw, _, _ = rex_multi(audio_es)
    bpm_a = float(bpm_a)
    conf_a_norm = min(1.0, max(0.0, float(conf_a_raw) / 3.5))

    # 算法 B: PercivalBpmEstimator —— Percival & Tzanetakis 2014
    # 独立算法，没有 confidence 输出，只有一个 bpm 数字
    try:
        bpm_b = float(es.PercivalBpmEstimator()(audio_es))
    except Exception:
        bpm_b = bpm_a

    # 裁决：
    #  a) 两者相差 < 5% → 很一致，采用 A 并加成置信度 +0.2
    #  b) 一个 ≈ 另一个 × 2（容差 5%）→ 存在半速/倍速歧义
    #     - 短期能量低（可能是抒情曲）→ 偏向较低的 BPM
    #     - 短期能量高 → 偏向较高的 BPM
    #  c) 完全不一致 → 取 A（confidence 更可靠），但 confidence × 0.6
    bpm_final = bpm_a
    bpm_confidence = conf_a_norm
    bpm_candidates = [round(bpm_a, 2), round(bpm_b, 2)]

    rel_diff = abs(bpm_a - bpm_b) / max(bpm_a, bpm_b, 1e-6)
    higher = max(bpm_a, bpm_b)
    lower = min(bpm_a, bpm_b)
    is_double = lower > 0 and abs(higher - 2 * lower) / lower < 0.08

    if rel_diff < 0.05:
        # 两者一致，提升置信度
        bpm_final = (bpm_a + bpm_b) / 2
        bpm_confidence = min(1.0, conf_a_norm + 0.2)
    elif is_double:
        # 半速/倍速歧义 —— 用 RMS 能量判断
        rms = librosa.feature.rms(
            y=librosa.load(audio_path, sr=22050, mono=True)[0]
        )[0]
        energy_quick = float(np.mean(rms))
        # 经验阈值：典型抒情曲 RMS < 0.08，激烈歌 > 0.15
        if energy_quick < 0.12:
            # 抒情倾向 → 取低速
            bpm_final = lower
        else:
            # 动感倾向 → 取高速
            bpm_final = higher
        # 歧义情况下稍微降低信度
        bpm_confidence = conf_a_norm * 0.75

    # 调式 —— HPCP + Krumhansl 谱
    key_extractor = es.KeyExtractor()
    key, scale, key_strength_raw = key_extractor(audio_es)
    key_confidence = min(1.0, max(0.0, float(key_strength_raw)))

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
        "bpm": round(float(bpm_final), 2),
        "bpm_confidence": round(bpm_confidence, 3),
        "bpm_candidates": bpm_candidates,
        "energy": round(energy, 4),
        "valence": round(valence, 4),
        "key": key_string,
        "key_confidence": round(key_confidence, 3),
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
