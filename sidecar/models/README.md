# Essentia-TensorFlow 模型（Tier 3，可选）

这个目录用来存放 Essentia 预训练模型。**全部都是可选的**——audio_analyzer.py 在缺模型或缺 essentia-tensorflow 包时会自动跳过这一层，相关字段返回 `null`，不影响其他特征分析。

启用以后会多出这些字段：

| 字段                | 来源                                              |
| ------------------- | ------------------------------------------------- |
| `voice_instrumental` | voice_instrumental-discogs-effnet-1               |
| `voice_gender`       | gender-discogs-effnet-1                           |
| `mood_tags`          | mood_acoustic / aggressive / electronic / happy / party / relaxed / sad |
| `genre_tags`         | genre_discogs400-discogs-effnet-1（top-3 风格）   |
| `instrument_tags`    | mtg_jamendo_instrument-discogs-effnet-1（top-4） |

## 1. 安装 essentia-tensorflow

普通 essentia wheel 不带 TF 算子。需要装带 TF 的版本：

```bash
# 卸载普通版（如果已装）
/opt/homebrew/bin/python3.12 -m pip uninstall -y essentia

# 装带 tensorflow 的版本
/opt/homebrew/bin/python3.12 -m pip install essentia-tensorflow
```

> **macOS arm64 注意**：截至 2026/04，`essentia-tensorflow` 在 Apple Silicon 上的官方 wheel 不完整，可能需要先 `pip install tensorflow-macos` 再尝试。如果装不上，保持现状即可——音频分析照样工作，只是 Tier 3 字段为 null。

## 2. 下载模型文件

所有模型来自 https://essentia.upf.edu/models/

```bash
cd /Users/fms26/Coding/musicplayer/sidecar/models

BASE=https://essentia.upf.edu/models

# 嵌入主干（所有下游任务复用）
curl -LO $BASE/feature-extractors/discogs-effnet/discogs-effnet-bs64-1.pb

# voice / instrumental
curl -LO $BASE/classification-heads/voice_instrumental/voice_instrumental-discogs-effnet-1.pb

# gender
curl -LO $BASE/classification-heads/gender/gender-discogs-effnet-1.pb

# mood (7 个二分类 head)
for m in acoustic aggressive electronic happy party relaxed sad; do
  curl -LO $BASE/classification-heads/mood_$m/mood_$m-discogs-effnet-1.pb
done

# genre (400 类)
curl -LO $BASE/classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1.pb
curl -LO $BASE/classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1.json

# instrument (mtg-jamendo 40 类)
curl -LO $BASE/classification-heads/mtg_jamendo_instrument/mtg_jamendo_instrument-discogs-effnet-1.pb
curl -LO $BASE/classification-heads/mtg_jamendo_instrument/mtg_jamendo_instrument-discogs-effnet-1.json
```

总下载约 **80-100 MB**。`.json` 文件包含类标签，没有它代码会回退到 `class_<index>` 字符串。

## 3. 验证

放好以后再跑一次 sidecar，看 `voice_instrumental` 等字段是否有值。
