#!/usr/bin/env python3
"""
Melody 音频分析 sidecar。

调用约定：
    stdin: {"audio_path": "/path/to/file.wav"}  (single JSON line)
    stdout: {"ok": true, "data": {...}} | {"ok": false, "error": "..."}

Rust 侧 spawn 本脚本，一次处理一首歌，退出返回结果。

输出字段（详见 analyze() 末尾的字典）：

  Tier 0 — 节奏 / 调式（核心）
    bpm, bpm_confidence, bpm_candidates, key, key_confidence

  Tier 1 — 能量 / 频谱（librosa 全曲均值）
    energy, valence, spectral_centroid, spectral_bandwidth,
    spectral_flatness, spectral_rolloff, zero_crossing_rate

  Tier 2 — 拓展感性特征（Essentia 纯算法，无需外部模型）
    loudness_lufs        全曲整合响度 (LUFS)
    dynamic_complexity   动态复杂度 (dB)，越高动态越大
    danceability         舞动性评分（约 0-3）
    onset_rate           每秒 onset 数，反映打击密度
    pitch_mean_hz        主旋律平均 pitch (Hz)
    pitch_std_hz         主旋律 pitch 标准差，越大旋律起伏越剧烈
    pitch_range_semitones 主旋律覆盖的半音跨度
    tuning_hz            演奏调音频率 (Hz)，标准 440
    chord_progression    最常见的 6 个和弦标签数组
    chord_changes_per_min 每分钟和弦变化次数（粗略反映和声密度）
    timbre_brightness_label  从 MFCC[1] 推出的音色明度标签
    timbre_warmth_label      从 MFCC[2] 推出的音色温度标签

  Tier 3 — 预训练模型（Essentia-TensorFlow，可选）
    缺 essentia-tensorflow 包或对应 .pb 模型文件时全部为 null。
    voice_instrumental, voice_gender,
    mood_tags, genre_tags, instrument_tags
"""

import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any

import essentia.standard as es
import librosa
import numpy as np


# ---- 模型目录 ---------------------------------------------------------------
# Essentia-TensorFlow 预训练模型（.pb 文件）放在这里。缺失时该 tier 全部 null。
MODELS_DIR = Path(__file__).resolve().parent / "models"


# ---- helpers ---------------------------------------------------------------

def _safe(call, default=None):
    """运行算法，失败时返回 default 而不是抛异常。"""
    try:
        return call()
    except Exception:
        return default


def _stats(arr) -> tuple[float, float]:
    a = np.asarray(arr, dtype=np.float64)
    if a.size == 0:
        return 0.0, 0.0
    return float(np.mean(a)), float(np.std(a))


def _hz_to_semitones(hz: np.ndarray) -> np.ndarray:
    """把 pitch Hz 数组转半音数（基准 A4=440），过滤 0 值。"""
    valid = hz[hz > 0]
    if valid.size == 0:
        return np.empty(0)
    return 12.0 * np.log2(valid / 440.0)


def _label_brightness(mfcc1_mean: float) -> str:
    """MFCC[1] 大致反映高频比重；阈值是经验值。"""
    if mfcc1_mean < -40:
        return "暗哑低沉"
    if mfcc1_mean < -10:
        return "中性偏暖"
    if mfcc1_mean < 30:
        return "通透清亮"
    return "尖锐高频"


def _label_warmth(mfcc2_mean: float) -> str:
    """MFCC[2] 经验上与共鸣感/胸腔感相关。"""
    if mfcc2_mean < -20:
        return "干冷"
    if mfcc2_mean < 10:
        return "中性"
    if mfcc2_mean < 40:
        return "圆润温暖"
    return "饱满浓郁"


# ---- BPM 多算法融合 ---------------------------------------------------------

def _detect_bpm(audio_es, audio_path: str) -> tuple[float, float, list[float]]:
    """返回 (bpm_final, bpm_confidence_0_1, candidates)。"""
    rex_multi = es.RhythmExtractor2013(method="multifeature")
    bpm_a, _, conf_a_raw, _, _ = rex_multi(audio_es)
    bpm_a = float(bpm_a)
    conf_a_norm = min(1.0, max(0.0, float(conf_a_raw) / 3.5))

    bpm_b = _safe(lambda: float(es.PercivalBpmEstimator()(audio_es)), bpm_a)

    bpm_final = bpm_a
    bpm_confidence = conf_a_norm
    candidates = [round(bpm_a, 2), round(bpm_b, 2)]

    rel_diff = abs(bpm_a - bpm_b) / max(bpm_a, bpm_b, 1e-6)
    higher = max(bpm_a, bpm_b)
    lower = min(bpm_a, bpm_b)
    is_double = lower > 0 and abs(higher - 2 * lower) / lower < 0.08

    if rel_diff < 0.05:
        bpm_final = (bpm_a + bpm_b) / 2
        bpm_confidence = min(1.0, conf_a_norm + 0.2)
    elif is_double:
        rms_quick = librosa.feature.rms(
            y=librosa.load(audio_path, sr=22050, mono=True)[0]
        )[0]
        energy_quick = float(np.mean(rms_quick))
        bpm_final = lower if energy_quick < 0.12 else higher
        bpm_confidence = conf_a_norm * 0.75

    return bpm_final, bpm_confidence, candidates


# ---- Tier 2 —— Essentia 纯算法扩展 ----------------------------------------

def _extract_loudness(audio_path: str) -> tuple[float | None, float | None]:
    """LoudnessEBUR128 + DynamicComplexity。需要 stereo。"""
    try:
        loader = es.AudioLoader(filename=audio_path)
        audio_stereo, sr, _, _, _, _ = loader()
        if audio_stereo.ndim == 1:
            audio_stereo = np.column_stack([audio_stereo, audio_stereo])
        ebur = es.LoudnessEBUR128(sampleRate=sr)
        _, _, integrated, _ = ebur(audio_stereo)
        lufs = float(integrated)
    except Exception:
        lufs = None

    try:
        mono_22050 = librosa.load(audio_path, sr=22050, mono=True)[0]
        dyn = es.DynamicComplexity(sampleRate=22050)
        complexity, _ = dyn(mono_22050.astype(np.float32))
        dynamic_complexity = float(complexity)
    except Exception:
        dynamic_complexity = None

    return lufs, dynamic_complexity


def _extract_danceability(audio_es) -> float | None:
    return _safe(
        lambda: float(es.Danceability()(audio_es)[0]),
        None,
    )


def _extract_onset_rate(audio_es) -> float | None:
    try:
        _, rate = es.OnsetRate()(audio_es)
        return float(rate)
    except Exception:
        return None


def _extract_predominant_pitch(audio_es) -> dict:
    """主旋律 pitch 序列（PitchMelodia/MELODIA）。"""
    try:
        pitch_extractor = es.PredominantPitchMelodia(
            frameSize=2048, hopSize=128, sampleRate=44100
        )
        pitches, _confidences = pitch_extractor(audio_es)
        pitches = np.asarray(pitches, dtype=np.float64)
        valid = pitches[pitches > 0]
        if valid.size == 0:
            return {"mean": None, "std": None, "range_semitones": None}
        semitones = _hz_to_semitones(pitches)
        return {
            "mean": float(np.mean(valid)),
            "std": float(np.std(valid)),
            "range_semitones": float(
                np.percentile(semitones, 95) - np.percentile(semitones, 5)
            ),
        }
    except Exception:
        return {"mean": None, "std": None, "range_semitones": None}


def _extract_chords(audio_es) -> tuple[list[str] | None, float | None]:
    """ChordsDetection on HPCP frames. 返回 top 6 + 每分钟变化次数。"""
    try:
        frame_size = 4096
        hop_size = 2048
        sample_rate = 44100

        spec = es.Spectrum(size=frame_size)
        win = es.Windowing(type="blackmanharris62", size=frame_size)
        spec_peaks = es.SpectralPeaks(
            magnitudeThreshold=1e-5,
            minFrequency=40,
            maxFrequency=5000,
            sampleRate=sample_rate,
        )
        hpcp = es.HPCP()
        chords = es.ChordsDetection(sampleRate=sample_rate, hopSize=hop_size)

        hpcps = []
        for frame in es.FrameGenerator(
            audio_es, frameSize=frame_size, hopSize=hop_size, startFromZero=True
        ):
            freqs, mags = spec_peaks(spec(win(frame)))
            hpcps.append(hpcp(freqs, mags))

        if not hpcps:
            return None, None

        hpcps_arr = np.asarray(hpcps, dtype=np.float32)
        chord_seq, _strengths = chords(hpcps_arr)

        # 统计 top
        from collections import Counter
        counter = Counter(chord_seq)
        top = [c for c, _ in counter.most_common(6)]

        # 变化次数
        changes = sum(
            1 for i in range(1, len(chord_seq)) if chord_seq[i] != chord_seq[i - 1]
        )
        seconds = (len(chord_seq) * hop_size) / sample_rate
        per_min = (changes / seconds * 60.0) if seconds > 0 else 0.0
        return top, float(per_min)
    except Exception:
        return None, None


def _extract_tuning(audio_es) -> float | None:
    try:
        spec = es.Spectrum()
        win = es.Windowing(type="hann")
        spec_peaks = es.SpectralPeaks(
            magnitudeThreshold=1e-5, minFrequency=40, maxFrequency=5000
        )
        tuning = es.TuningFrequency()
        freqs_all = []
        mags_all = []
        for frame in es.FrameGenerator(
            audio_es, frameSize=2048, hopSize=1024, startFromZero=True
        ):
            f, m = spec_peaks(spec(win(frame)))
            if f.size > 0:
                freqs_all.append(f)
                mags_all.append(m)
        if not freqs_all:
            return None
        # 取一个稳定的中段帧
        mid = len(freqs_all) // 2
        tf, _cents = tuning(freqs_all[mid], mags_all[mid])
        return float(tf)
    except Exception:
        return None


def _extract_mfcc_labels(audio_es) -> tuple[float | None, float | None, str, str]:
    """13 维 MFCC 全曲均值，仅保留 [1] 和 [2] 用于音色描述。"""
    try:
        spec = es.Spectrum()
        win = es.Windowing(type="hann")
        mfcc = es.MFCC(numberCoefficients=13)
        coeffs_acc = []
        for frame in es.FrameGenerator(
            audio_es, frameSize=2048, hopSize=1024, startFromZero=True
        ):
            _, c = mfcc(spec(win(frame)))
            coeffs_acc.append(c)
        if not coeffs_acc:
            return None, None, "未知", "未知"
        coeffs = np.asarray(coeffs_acc, dtype=np.float64).mean(axis=0)
        m1 = float(coeffs[1])
        m2 = float(coeffs[2])
        return m1, m2, _label_brightness(m1), _label_warmth(m2)
    except Exception:
        return None, None, "未知", "未知"


# ---- Tier 3 —— Essentia-TensorFlow 预训练模型 ----------------------------
#
# 我们用 try-load 的方式优雅降级：
#   - import essentia.standard 中的 Tensorflow* 算法失败 → 全 null
#   - 模型 .pb 文件不存在 → 该字段 null
#
# 模型来源：https://essentia.upf.edu/models/
#   - voice_instrumental: discogs-effnet-bs64-1.pb + voice_instrumental-discogs-effnet-1.pb
#   - mood: discogs-effnet-bs64-1.pb + mood_acoustic, mood_aggressive,
#           mood_electronic, mood_happy, mood_party, mood_relaxed, mood_sad
#   - genre: discogs-effnet-bs64-1.pb + genre_discogs400-discogs-effnet-1.pb
#   - instrument: discogs-effnet-bs64-1.pb + mtg_jamendo_instrument-discogs-effnet-1.pb
#
# 见 sidecar/models/README.md 的下载脚本。

class TfModelRunner:
    """所有 TF 模型的统一入口，构造一次嵌入即可复用。"""

    def __init__(self, models_dir: Path):
        self.models_dir = models_dir
        self.available = False
        self.embedding_model = None
        self.discogs_embeddings = None  # 缓存
        self._tf_available = False
        try:
            from essentia.standard import (  # noqa: F401
                TensorflowPredictEffnetDiscogs,
                TensorflowPredict2D,
            )
            self._tf_available = True
        except Exception:
            self._tf_available = False
            return

        effnet_pb = models_dir / "discogs-effnet-bs64-1.pb"
        if effnet_pb.is_file():
            try:
                from essentia.standard import TensorflowPredictEffnetDiscogs
                self.embedding_model = TensorflowPredictEffnetDiscogs(
                    graphFilename=str(effnet_pb), output="PartitionedCall:1"
                )
                self.available = True
            except Exception:
                self.embedding_model = None

    def compute_embeddings(self, audio_path: str):
        if not self.available or self.discogs_embeddings is not None:
            return self.discogs_embeddings
        try:
            audio_16k = es.MonoLoader(
                filename=audio_path, sampleRate=16000, resampleQuality=4
            )()
            self.discogs_embeddings = self.embedding_model(audio_16k)
        except Exception:
            self.discogs_embeddings = None
        return self.discogs_embeddings

    def _predict_2d(self, model_filename: str) -> np.ndarray | None:
        if not self.available or self.discogs_embeddings is None:
            return None
        pb = self.models_dir / model_filename
        if not pb.is_file():
            return None
        try:
            from essentia.standard import TensorflowPredict2D
            head = TensorflowPredict2D(
                graphFilename=str(pb), output="model/Softmax"
            )
            return head(self.discogs_embeddings).mean(axis=0)
        except Exception:
            return None

    # ---- 各任务 head ----

    def voice_instrumental(self) -> str | None:
        out = self._predict_2d("voice_instrumental-discogs-effnet-1.pb")
        if out is None:
            return None
        return ["instrumental", "voice"][int(np.argmax(out))]

    def voice_gender(self) -> str | None:
        out = self._predict_2d("gender-discogs-effnet-1.pb")
        if out is None:
            return None
        return ["female", "male"][int(np.argmax(out))]

    def mood_tags(self) -> list[str] | None:
        labels: list[str] = []
        mood_models = [
            ("mood_acoustic-discogs-effnet-1.pb", "acoustic", "non_acoustic"),
            ("mood_aggressive-discogs-effnet-1.pb", "aggressive", "non_aggressive"),
            ("mood_electronic-discogs-effnet-1.pb", "electronic", "non_electronic"),
            ("mood_happy-discogs-effnet-1.pb", "happy", "non_happy"),
            ("mood_party-discogs-effnet-1.pb", "party", "non_party"),
            ("mood_relaxed-discogs-effnet-1.pb", "relaxed", "non_relaxed"),
            ("mood_sad-discogs-effnet-1.pb", "sad", "non_sad"),
        ]
        any_loaded = False
        for fname, pos, _neg in mood_models:
            out = self._predict_2d(fname)
            if out is None:
                continue
            any_loaded = True
            if int(np.argmax(out)) == 0:  # 第一个标签为正向
                labels.append(pos)
        return labels if any_loaded else None

    def genre_tags(self, top_k: int = 3) -> list[str] | None:
        out = self._predict_2d("genre_discogs400-discogs-effnet-1.pb")
        if out is None:
            return None
        idx = np.argsort(out)[::-1][:top_k]
        labels_path = self.models_dir / "genre_discogs400-discogs-effnet-1.json"
        if labels_path.is_file():
            try:
                meta = json.loads(labels_path.read_text())
                names = meta.get("classes", [])
                if names:
                    return [names[i] for i in idx if i < len(names)]
            except Exception:
                pass
        return [f"class_{i}" for i in idx]

    def instrument_tags(self, top_k: int = 4) -> list[str] | None:
        out = self._predict_2d("mtg_jamendo_instrument-discogs-effnet-1.pb")
        if out is None:
            return None
        idx = np.argsort(out)[::-1][:top_k]
        labels_path = self.models_dir / "mtg_jamendo_instrument-discogs-effnet-1.json"
        if labels_path.is_file():
            try:
                meta = json.loads(labels_path.read_text())
                names = meta.get("classes", [])
                if names:
                    return [names[i] for i in idx if i < len(names)]
            except Exception:
                pass
        return [f"class_{i}" for i in idx]


# ---- 主入口 -----------------------------------------------------------------

def analyze(audio_path: str) -> dict[str, Any]:
    audio_es = es.MonoLoader(filename=audio_path, sampleRate=44100)()

    # ---- Tier 0: BPM + Key ------------------------------------------------
    bpm_final, bpm_confidence, bpm_candidates = _detect_bpm(audio_es, audio_path)

    key_extractor = es.KeyExtractor()
    key, scale, key_strength_raw = key_extractor(audio_es)
    key_confidence = min(1.0, max(0.0, float(key_strength_raw)))
    key_string = key if scale == "major" else f"{key}m"

    # ---- Tier 1: librosa 频谱 ---------------------------------------------
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    rms = librosa.feature.rms(y=y)[0]
    energy_raw = float(np.mean(rms))
    energy = float(np.clip(energy_raw / 0.3, 0.0, 1.0))
    centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    bandwidth = float(np.mean(librosa.feature.spectral_bandwidth(y=y, sr=sr)))
    flatness = float(np.mean(librosa.feature.spectral_flatness(y=y)))
    rolloff = float(np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr)))
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(y=y)))
    valence = float(np.clip((centroid - 500) / 3500, 0.0, 1.0))

    # ---- Tier 2: Essentia 拓展 --------------------------------------------
    lufs, dynamic_complexity = _extract_loudness(audio_path)
    danceability = _extract_danceability(audio_es)
    onset_rate = _extract_onset_rate(audio_es)
    pitch_info = _extract_predominant_pitch(audio_es)
    chord_top, chord_changes_per_min = _extract_chords(audio_es)
    tuning_hz = _extract_tuning(audio_es)
    mfcc1, mfcc2, brightness_label, warmth_label = _extract_mfcc_labels(audio_es)

    # ---- Tier 3: TF 预训练模型（可选）---------------------------------------
    voice_instrumental = None
    voice_gender = None
    mood_tags = None
    genre_tags = None
    instrument_tags = None
    if MODELS_DIR.is_dir():
        runner = TfModelRunner(MODELS_DIR)
        if runner.available:
            runner.compute_embeddings(audio_path)
            voice_instrumental = runner.voice_instrumental()
            voice_gender = runner.voice_gender()
            mood_tags = runner.mood_tags()
            genre_tags = runner.genre_tags()
            instrument_tags = runner.instrument_tags()

    return {
        # Tier 0
        "bpm": round(float(bpm_final), 2),
        "bpm_confidence": round(bpm_confidence, 3),
        "bpm_candidates": bpm_candidates,
        "key": key_string,
        "key_confidence": round(key_confidence, 3),
        # Tier 1
        "energy": round(energy, 4),
        "valence": round(valence, 4),
        "spectral_centroid": round(centroid, 2),
        "spectral_bandwidth": round(bandwidth, 2),
        "spectral_flatness": round(flatness, 6),
        "spectral_rolloff": round(rolloff, 2),
        "zero_crossing_rate": round(zcr, 6),
        # Tier 2
        "loudness_lufs": None if lufs is None else round(lufs, 2),
        "dynamic_complexity": (
            None if dynamic_complexity is None else round(dynamic_complexity, 3)
        ),
        "danceability": None if danceability is None else round(danceability, 3),
        "onset_rate": None if onset_rate is None else round(onset_rate, 3),
        "pitch_mean_hz": (
            None if pitch_info["mean"] is None else round(pitch_info["mean"], 2)
        ),
        "pitch_std_hz": (
            None if pitch_info["std"] is None else round(pitch_info["std"], 2)
        ),
        "pitch_range_semitones": (
            None
            if pitch_info["range_semitones"] is None
            else round(pitch_info["range_semitones"], 2)
        ),
        "tuning_hz": None if tuning_hz is None else round(tuning_hz, 2),
        "chord_progression": chord_top,
        "chord_changes_per_min": (
            None if chord_changes_per_min is None else round(chord_changes_per_min, 2)
        ),
        "mfcc_brightness": None if mfcc1 is None else round(mfcc1, 3),
        "mfcc_warmth": None if mfcc2 is None else round(mfcc2, 3),
        "timbre_brightness_label": brightness_label,
        "timbre_warmth_label": warmth_label,
        # Tier 3
        "voice_instrumental": voice_instrumental,
        "voice_gender": voice_gender,
        "mood_tags": mood_tags,
        "genre_tags": genre_tags,
        "instrument_tags": instrument_tags,
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
