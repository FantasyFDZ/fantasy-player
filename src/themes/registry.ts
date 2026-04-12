// 6 套主题 —— 完全对应 gramophone-final-v7.html 的色号。
// 如无具体依据，不擅自改色。

import type { ThemeDefinition, ThemeId } from "./types";

const afternoon_sun: ThemeDefinition = {
  id: "afternoon_sun",
  name: "午后暖阳",
  background:
    "linear-gradient(160deg,#d8c8b0 0%,#c8b89e 30%,#b8a88c 60%,#a89878 100%)",
  cabinet: {
    background: "linear-gradient(180deg,#9a7550,#7a5a38)",
    shadow:
      "0 6px 20px rgba(80,45,10,0.45),inset 0 1px 0 rgba(255,255,255,0.1)",
    innerTop: "rgba(255,255,255,0.1)",
  },
  discFrame: {
    background:
      "radial-gradient(circle,rgba(255,250,235,0.35),rgba(200,180,150,0.2))",
    border: "3px solid rgba(180,160,130,0.35)",
  },
  disc: {
    shadow: "0 4px 20px rgba(100,70,20,0.3)",
  },
  lever: {
    ballBg: "radial-gradient(circle at 40% 35%,#e0c890,#a08050)",
    stemBg: "linear-gradient(90deg,#a08050,#c8a870,#a08050)",
    slotBg: "#4a3018",
    slotBorder: "1px solid rgba(255,200,120,0.08)",
    tagColor: "#c8a870",
  },
  labelColor: "#d4be98",
  footColor: "#6a4a30",
  tonearm: {
    armOuter: "#8a7a6a",
    armInner: "#a09080",
    head: "#7a6a5a",
    needle: "#b0a090",
    pivotFill: "#8a7a6a",
    pivotStroke: "#9a8a7a",
  },
  accent: "#c8a050",
  lyrics: {
    title: "#3a2510",
    artist: "#6a5030",
    active: "#2a1505",
    nextLine: "#3a2010",
    mid: "#7a6545",
    far: "#9a8568",
  },
  playbar: {
    background: "rgba(190,170,140,0.35)",
    progressTrack: "rgba(100,70,30,0.15)",
    progressFill: "linear-gradient(90deg,#8a6030,#c8a050)",
    playBtnBg: "#8a6530",
    playBtnColor: "#f2e4d0",
    textColor: "#6a5030",
    iconColor: "#8a7050",
  },
  godRays: [
    {
      top: "-80px",
      left: "6%",
      width: "90px",
      height: "520px",
      background:
        "linear-gradient(180deg,rgba(255,255,240,0.4),rgba(255,250,230,0.15),transparent 80%)",
      blur: 28,
      rotate: 10,
    },
    {
      top: "-80px",
      left: "14%",
      width: "55px",
      height: "480px",
      background:
        "linear-gradient(180deg,rgba(255,255,245,0.32),rgba(255,248,225,0.1),transparent 80%)",
      blur: 32,
      rotate: 13,
    },
  ],
  ambientGlows: [
    {
      top: "5%",
      left: "5%",
      width: "320px",
      height: "400px",
      background:
        "radial-gradient(ellipse at 50% 30%,rgba(255,255,240,0.18),transparent 70%)",
    },
  ],
  dust: [
    { top: "20%", left: "8%", size: 3, color: "rgba(255,255,230,0.7)", delay: 0 },
    { top: "35%", left: "14%", size: 2, color: "rgba(255,252,225,0.5)", delay: 0.7 },
    { top: "50%", left: "11%", size: 3, color: "rgba(255,250,220,0.4)", delay: 1.4 },
    { top: "28%", left: "18%", size: 2, color: "rgba(255,252,220,0.45)", delay: 2.1 },
  ],
};

const moonlit_study: ThemeDefinition = {
  id: "moonlit_study",
  name: "月光书房",
  background:
    "linear-gradient(160deg,#1a1f2e 0%,#141828 30%,#0e1220 60%,#0a0e18 100%)",
  cabinet: {
    background: "linear-gradient(180deg,#2a3040,#1a2030)",
    shadow:
      "0 6px 20px rgba(0,0,0,0.5),inset 0 1px 0 rgba(140,170,220,0.05)",
    innerTop: "rgba(140,170,220,0.05)",
  },
  discFrame: {
    background:
      "radial-gradient(circle,rgba(140,170,220,0.08),rgba(40,50,80,0.1))",
    border: "3px solid rgba(100,120,160,0.15)",
  },
  disc: { shadow: "0 4px 25px rgba(0,0,0,0.5)" },
  lever: {
    ballBg: "radial-gradient(circle at 40% 35%,#a0b0c8,#5a6a80)",
    stemBg: "linear-gradient(90deg,#4a5a70,#7a8aa0,#4a5a70)",
    slotBg: "#101420",
    slotBorder: "1px solid rgba(140,170,220,0.1)",
    tagColor: "#5a6a80",
  },
  labelColor: "#6a7a8a",
  footColor: "#1a2030",
  tonearm: {
    armOuter: "#5a6a80",
    armInner: "#7a8a9a",
    head: "#4a5a6a",
    needle: "#8a9aaa",
    pivotFill: "#4a5a6a",
    pivotStroke: "#5a6a7a",
  },
  accent: "#7a9ac0",
  lyrics: {
    title: "#c8d4e8",
    artist: "#6a7a90",
    active: "#d0ddf0",
    nextLine: "#b0c0d8",
    mid: "#5a6a80",
    far: "#3a4a60",
  },
  playbar: {
    background: "rgba(20,24,40,0.5)",
    progressTrack: "rgba(100,120,160,0.1)",
    progressFill: "linear-gradient(90deg,#4a6a9a,#7a9ac0)",
    playBtnBg: "rgba(100,130,180,0.3)",
    playBtnBorder: "1px solid rgba(140,170,220,0.15)",
    playBtnColor: "#b0c8e8",
    textColor: "#5a6a80",
    iconColor: "#5a6a80",
  },
  godRays: [
    {
      top: "-80px",
      left: "7%",
      width: "90px",
      height: "520px",
      background:
        "linear-gradient(180deg,rgba(200,215,255,0.2),rgba(180,200,245,0.05),transparent)",
      blur: 24,
      rotate: 10,
    },
    {
      top: "-80px",
      left: "15%",
      width: "55px",
      height: "480px",
      background:
        "linear-gradient(180deg,rgba(210,225,255,0.14),rgba(190,210,250,0.03),transparent)",
      blur: 28,
      rotate: 13,
    },
  ],
  ambientGlows: [
    {
      top: "5%",
      left: "3%",
      width: "340px",
      height: "420px",
      background:
        "radial-gradient(ellipse at 50% 30%,rgba(200,215,255,0.12),transparent 70%)",
    },
  ],
  dust: [
    { top: "18%", left: "8%", size: 2, color: "rgba(200,220,255,0.4)", delay: 0.5 },
    { top: "40%", left: "13%", size: 2, color: "rgba(200,220,255,0.3)", delay: 1.5 },
    { top: "55%", left: "10%", size: 3, color: "rgba(200,220,255,0.25)", delay: 2.5 },
  ],
};

const sunset_jazz: ThemeDefinition = {
  id: "sunset_jazz",
  name: "黄昏爵士",
  background:
    "linear-gradient(160deg,#1e0e08 0%,#180a04 40%,#120602 70%,#0a0200 100%)",
  cabinet: {
    background: "linear-gradient(180deg,#4a2210,#2a1208)",
    shadow:
      "0 6px 25px rgba(0,0,0,0.7),inset 0 1px 0 rgba(255,200,150,0.06)",
    innerTop: "rgba(255,200,150,0.06)",
  },
  discFrame: {
    background:
      "radial-gradient(circle,rgba(255,220,180,0.1),rgba(40,15,5,0.1))",
    border: "3px solid rgba(180,100,50,0.18)",
  },
  disc: { shadow: "0 4px 25px rgba(0,0,0,0.6)" },
  lever: {
    ballBg: "radial-gradient(circle at 40% 35%,#d09840,#8a5820)",
    stemBg: "linear-gradient(90deg,#6a3a18,#b07830,#6a3a18)",
    slotBg: "#1a0a04",
    slotBorder: "1px solid rgba(255,140,60,0.08)",
    tagColor: "#7a4a20",
  },
  labelColor: "#8a5528",
  footColor: "#1a0a04",
  tonearm: {
    armOuter: "#7a4a28",
    armInner: "#9a6a38",
    head: "#5a3518",
    needle: "#a07838",
    pivotFill: "#5a3518",
    pivotStroke: "#6a4528",
  },
  accent: "#d08830",
  lyrics: {
    title: "#e8c098",
    artist: "#7a4a20",
    active: "#f0d8a8",
    nextLine: "#d0b078",
    mid: "#5a3518",
    far: "#2a1408",
  },
  playbar: {
    background: "rgba(10,4,0,0.6)",
    progressTrack: "rgba(100,50,10,0.15)",
    progressFill: "linear-gradient(90deg,#8a4818,#d08830)",
    playBtnBg: "rgba(210,140,60,0.2)",
    playBtnBorder: "1px solid rgba(210,140,60,0.15)",
    playBtnColor: "#d0a860",
    textColor: "#5a3518",
    iconColor: "#5a3518",
  },
  godRays: [
    {
      top: "-60px",
      left: "0%",
      width: "360px",
      height: "520px",
      background:
        "radial-gradient(ellipse at top center,rgba(255,240,220,0.14),rgba(255,200,160,0.04),transparent 70%)",
      blur: 38,
      rotate: 5,
    },
    {
      top: "-80px",
      left: "8%",
      width: "70px",
      height: "500px",
      background:
        "linear-gradient(180deg,rgba(255,245,230,0.18),rgba(255,220,180,0.03),transparent 80%)",
      blur: 26,
      rotate: 8,
    },
  ],
  ambientGlows: [
    {
      top: "0",
      left: "0%",
      width: "420px",
      height: "340px",
      background:
        "radial-gradient(ellipse at 45% 20%,rgba(255,240,220,0.1),transparent 65%)",
    },
    // 暗角保留
    {
      inset: "0",
      background:
        "radial-gradient(ellipse at 20% 30%,transparent 40%,rgba(0,0,0,0.4) 100%)",
    },
  ],
  dust: [
    { top: "22%", left: "10%", size: 2, color: "rgba(255,240,210,0.5)", delay: 0 },
    { top: "40%", left: "16%", size: 2, color: "rgba(255,235,200,0.35)", delay: 1.2 },
    { top: "55%", left: "8%", size: 2, color: "rgba(255,235,200,0.3)", delay: 2.0 },
  ],
};

const misty_forest: ThemeDefinition = {
  id: "misty_forest",
  name: "晨雾森林",
  background:
    "linear-gradient(160deg,#e8ede6 0%,#d4ddd0 30%,#c0ccb8 60%,#b0bca8 100%)",
  cabinet: {
    background: "linear-gradient(180deg,#8a9a78,#6a7a58)",
    shadow:
      "0 6px 20px rgba(50,60,40,0.3),inset 0 1px 0 rgba(255,255,255,0.08)",
    innerTop: "rgba(255,255,255,0.08)",
  },
  discFrame: {
    background:
      "radial-gradient(circle,rgba(200,220,190,0.2),rgba(160,180,150,0.1))",
    border: "3px solid rgba(140,160,130,0.2)",
  },
  disc: { shadow: "0 4px 20px rgba(60,80,50,0.2)" },
  lever: {
    ballBg: "radial-gradient(circle at 40% 35%,#c0d0a8,#7a8a68)",
    stemBg: "linear-gradient(90deg,#6a7a58,#a0b088,#6a7a58)",
    slotBg: "#3a4a28",
    slotBorder: "1px solid rgba(180,210,160,0.1)",
    tagColor: "#8a9a78",
  },
  labelColor: "#b0c098",
  footColor: "#5a6a48",
  tonearm: {
    armOuter: "#7a8a6a",
    armInner: "#90a080",
    head: "#6a7a5a",
    needle: "#a0b090",
    pivotFill: "#6a7a5a",
    pivotStroke: "#7a8a6a",
  },
  accent: "#80a858",
  lyrics: {
    title: "#2a3a20",
    artist: "#5a6a4a",
    active: "#1a2a10",
    nextLine: "#3a4a28",
    mid: "#5a6a4a",
    far: "#8a9a7a",
  },
  playbar: {
    background: "rgba(180,200,170,0.25)",
    progressTrack: "rgba(70,90,50,0.12)",
    progressFill: "linear-gradient(90deg,#5a7a3a,#80a858)",
    playBtnBg: "#5a7a3a",
    playBtnColor: "#e8ede6",
    textColor: "#4a5a3a",
    iconColor: "#5a6a48",
  },
  godRays: [
    {
      top: "-80px",
      left: "4%",
      width: "75px",
      height: "560px",
      background:
        "linear-gradient(180deg,rgba(255,255,250,0.4),rgba(255,255,248,0.14),transparent 80%)",
      blur: 16,
      rotate: 8,
    },
    {
      top: "-80px",
      left: "11%",
      width: "50px",
      height: "530px",
      background:
        "linear-gradient(180deg,rgba(255,255,252,0.32),rgba(255,255,248,0.1),transparent 80%)",
      blur: 20,
      rotate: 11,
    },
    {
      top: "-80px",
      left: "17%",
      width: "38px",
      height: "500px",
      background:
        "linear-gradient(180deg,rgba(255,255,254,0.26),rgba(255,255,250,0.06),transparent 80%)",
      blur: 24,
      rotate: 14,
    },
  ],
  ambientGlows: [
    {
      top: "0",
      left: "2%",
      width: "340px",
      height: "360px",
      background:
        "radial-gradient(ellipse at 50% 25%,rgba(255,255,250,0.14),transparent 65%)",
    },
  ],
  dust: [
    { top: "15%", left: "6%", size: 4, color: "rgba(255,255,240,0.6)", delay: 0 },
    { top: "30%", left: "12%", size: 3, color: "rgba(255,255,245,0.5)", delay: 0.6 },
    { top: "22%", left: "18%", size: 3, color: "rgba(255,255,248,0.45)", delay: 1.2 },
    { top: "48%", left: "10%", size: 3, color: "rgba(255,255,242,0.35)", delay: 1.8 },
  ],
};

const sakura_wafu: ThemeDefinition = {
  id: "sakura_wafu",
  name: "樱花和风",
  background:
    "linear-gradient(160deg,#faf0f0 0%,#f0e0e4 30%,#e8d0d8 60%,#e0c4d0 100%)",
  cabinet: {
    background: "linear-gradient(180deg,#c09098,#a07880)",
    shadow:
      "0 6px 20px rgba(120,60,70,0.2),inset 0 1px 0 rgba(255,255,255,0.12)",
    innerTop: "rgba(255,255,255,0.12)",
  },
  discFrame: {
    background:
      "radial-gradient(circle,rgba(255,240,242,0.3),rgba(220,190,200,0.15))",
    border: "3px solid rgba(200,170,180,0.25)",
  },
  disc: { shadow: "0 4px 20px rgba(150,80,100,0.15)" },
  lever: {
    ballBg: "radial-gradient(circle at 40% 35%,#e8d0d8,#b09098)",
    stemBg: "linear-gradient(90deg,#a08088,#d0b8c0,#a08088)",
    slotBg: "#6a4850",
    slotBorder: "1px solid rgba(255,200,210,0.08)",
    tagColor: "#c0a0a8",
  },
  labelColor: "#e0c8d0",
  footColor: "#8a6a70",
  tonearm: {
    armOuter: "#b08a90",
    armInner: "#c8a0a8",
    head: "#9a7a80",
    needle: "#c8b0b8",
    pivotFill: "#9a7a80",
    pivotStroke: "#aa8a90",
  },
  accent: "#e0a0b0",
  lyrics: {
    title: "#4a2a30",
    artist: "#8a6a70",
    active: "#3a1a20",
    nextLine: "#5a3a40",
    mid: "#8a6a70",
    far: "#b09098",
  },
  playbar: {
    background: "rgba(230,200,210,0.3)",
    progressTrack: "rgba(150,100,110,0.1)",
    progressFill: "linear-gradient(90deg,#c08090,#e0a0b0)",
    playBtnBg: "#b07880",
    playBtnColor: "#faf0f0",
    textColor: "#8a6a70",
    iconColor: "#a08088",
  },
  godRays: [
    {
      top: "-80px",
      left: "6%",
      width: "80px",
      height: "500px",
      background:
        "linear-gradient(180deg,rgba(255,255,250,0.32),rgba(255,255,245,0.1),transparent 80%)",
      blur: 26,
      rotate: 10,
    },
    {
      top: "-80px",
      left: "14%",
      width: "48px",
      height: "460px",
      background:
        "linear-gradient(180deg,rgba(255,255,252,0.22),transparent 80%)",
      blur: 30,
      rotate: 14,
    },
  ],
  ambientGlows: [
    {
      top: "0",
      left: "2%",
      width: "320px",
      height: "320px",
      background:
        "radial-gradient(ellipse at 50% 25%,rgba(255,255,250,0.12),transparent 65%)",
    },
  ],
  dust: [
    { top: "18%", left: "7%", size: 5, color: "rgba(255,200,210,0.4)", delay: 0, petal: true },
    { top: "40%", left: "14%", size: 4, color: "rgba(255,190,205,0.3)", delay: 1.5, petal: true },
    { top: "55%", left: "10%", size: 5, color: "rgba(255,195,210,0.35)", delay: 2.2, petal: true },
    { top: "28%", left: "17%", size: 4, color: "rgba(255,200,210,0.35)", delay: 3.0, petal: true },
  ],
};

const deep_space: ThemeDefinition = {
  id: "deep_space",
  name: "星际深空",
  background:
    "linear-gradient(160deg,#0a0a1e 0%,#0e0820 30%,#14082a 60%,#08041a 100%)",
  cabinet: {
    background: "linear-gradient(180deg,#2a1a3a,#1a1028)",
    shadow:
      "0 6px 25px rgba(0,0,0,0.6),inset 0 1px 0 rgba(140,100,220,0.05)",
    innerTop: "rgba(140,100,220,0.05)",
  },
  discFrame: {
    background:
      "radial-gradient(circle,rgba(120,60,200,0.06),rgba(20,10,40,0.1))",
    border: "3px solid rgba(100,60,180,0.12)",
  },
  disc: {
    // 多层紫色辉光 —— 唱片自带！
    shadow:
      "0 4px 30px rgba(120,50,200,0.35),0 0 80px rgba(100,40,180,0.2),0 0 140px rgba(80,30,160,0.12),0 0 200px rgba(60,20,140,0.06)",
  },
  lever: {
    ballBg: "radial-gradient(circle at 40% 35%,#9a8ab0,#5a4a6a)",
    stemBg: "linear-gradient(90deg,#4a3a5a,#7a6a8a,#4a3a5a)",
    slotBg: "#100618",
    slotBorder: "1px solid rgba(120,60,200,0.1)",
    tagColor: "#6a5a7a",
  },
  labelColor: "#6a5a7a",
  footColor: "#1a1028",
  tonearm: {
    armOuter: "#5a4a6a",
    armInner: "#7a6a8a",
    head: "#4a3a5a",
    needle: "#8a7a9a",
    pivotFill: "#4a3a5a",
    pivotStroke: "#5a4a6a",
  },
  accent: "#9a6ad0",
  lyrics: {
    title: "#c8b8e8",
    artist: "#6a5a80",
    active: "#d8c8f0",
    nextLine: "#b0a0d0",
    mid: "#5a4a6a",
    far: "#2a2040",
  },
  playbar: {
    background: "rgba(10,8,20,0.5)",
    progressTrack: "rgba(80,50,140,0.1)",
    progressFill: "linear-gradient(90deg,#6a3aa0,#9a6ad0)",
    playBtnBg: "rgba(120,80,200,0.25)",
    playBtnBorder: "1px solid rgba(140,100,220,0.15)",
    playBtnColor: "#c0a8e8",
    textColor: "#5a4a6a",
    iconColor: "#5a4a6a",
  },
  godRays: [
    {
      top: "-60px",
      left: "4%",
      width: "200px",
      height: "460px",
      background:
        "radial-gradient(ellipse at top,rgba(220,210,255,0.08),rgba(180,170,240,0.02),transparent 70%)",
      blur: 34,
      rotate: 8,
    },
  ],
  ambientGlows: [
    {
      top: "10%",
      left: "6%",
      width: "260px",
      height: "220px",
      background:
        "radial-gradient(ellipse,rgba(200,190,255,0.05),transparent)",
      blur: 38,
    },
  ],
  dust: [
    { top: "12%", left: "8%", size: 2, color: "rgba(220,210,255,0.5)", delay: 0 },
    { top: "30%", left: "18%", size: 1, color: "rgba(255,255,255,0.6)", delay: 0.8 },
    { top: "55%", left: "10%", size: 2, color: "rgba(200,190,255,0.3)", delay: 1.5 },
    { top: "42%", left: "15%", size: 1, color: "rgba(255,255,255,0.4)", delay: 2.2 },
  ],
};

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  afternoon_sun,
  moonlit_study,
  sunset_jazz,
  misty_forest,
  sakura_wafu,
  deep_space,
};

export const THEME_ORDER: ThemeId[] = [
  "afternoon_sun",
  "moonlit_study",
  "sunset_jazz",
  "misty_forest",
  "sakura_wafu",
  "deep_space",
];

export const DEFAULT_THEME: ThemeId = "moonlit_study";
