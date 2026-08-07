export type Locale = "zh-TW" | "en";

export const LOCALE_STORAGE_KEY = "nullcity.locale";

const zhTW = {
  kicker: "危機指揮模擬",
  subtitle:
    "破碎的通報。互相爭執的主張。城市不會等你確認真相。只根據你真正知道的下達命令——而不是你看不見的真相。",
  scenario: "場景",
  seed: "種子",
  seedHint: "相同場景與種子會重現相同事件序列。",
  start: "開始任務",
  starting: "正在建立工作階段…",
  seedInvalid: "種子必須是整數。",
  serverDown: "連不上 NULL CITY 伺服器。是否已執行 pnpm demo？",
  localNote:
    "完全在本機工作階段伺服器運行。無雲端、無帳號。進行中的任務不會把真相送到瀏覽器；完成後的產物可在重播實驗室載入真相供事後分析。",
  districts: "行政區",
  localeToggle: "English",
  topology: "拓樸",
  evidence: "證據",
  claims: "主張與評估",
  teams: "小隊與資源",
  commands: "指令編排",
  advance: "推進時脈",
  auto: "自動推進",
  pause: "暫停",
  running: "進行中",
  completed: "已完成",
  debrief: "戰後簡報",
  exportDebrief: "匯出戰後簡報",
  exportReport: "匯出報告",
  replayLab: "重播實驗室",
} as const;

const en = {
  kicker: "Crisis Command Simulation",
  subtitle:
    "Fragmented reports. Contested claims. A city that will not wait for certainty. Command from what you actually know — not from the truth you can't see.",
  scenario: "Scenario",
  seed: "Seed",
  seedHint: "Same seed and scenario reproduce the same event sequence.",
  start: "Start Session",
  starting: "Starting session…",
  seedInvalid: "Seed must be a whole number.",
  serverDown: "Could not reach the NULL CITY server. Is it running?",
  localNote:
    "Runs entirely against your local session server. No cloud services or accounts. During an active run, no truth reaches this browser; completed artifacts may reveal truth inside Replay Lab for post-run analysis.",
  districts: "districts",
  localeToggle: "繁體中文",
  topology: "Topology",
  evidence: "Evidence",
  claims: "Claims & Assessments",
  teams: "Teams & Resources",
  commands: "Command Composer",
  advance: "Advance",
  auto: "Auto-advance",
  pause: "Pause",
  running: "Running",
  completed: "Completed",
  debrief: "After-Action Debrief",
  exportDebrief: "Export debrief",
  exportReport: "Export report",
  replayLab: "Replay Lab",
} as const;

export type MessageKey = keyof typeof zhTW;
export type Messages = Record<MessageKey, string>;

export const MESSAGES: Record<Locale, Messages> = {
  "zh-TW": zhTW,
  en,
};

export const SCENARIO_SUMMARIES: Record<Locale, Record<string, string>> = {
  "zh-TW": {
    "black-river": "基礎建設連鎖：電力、供水與錯誤資訊在五個行政區交織惡化。",
    "glass-harbor": "危化品煙羽、醫療超載，以及錯置歸因的新聞在半島瓶頸競速。",
    "signal-zero": "通訊劣化與偽造遙測讓每則通報都像硬幣——直到現場驗證。",
    "mirror-district": "雙生行政區互相鏡像指控。先驗證再投入醫療／撤離，否則會堵死唯一橋梁。",
    "red-ledger": "配給帳冊當機：真短缺在北里，幽靈戶籍把南里畫成災區。錯發勸告會引爆動亂。",
  },
  en: {
    "black-river": "An infrastructure cascade: power, water, and misinformation compound across five districts.",
    "glass-harbor": "A hazmat plume, medical overload, and a false-attribution report race across a peninsula chokepoint.",
    "signal-zero": "Comms degradation and spoofed telemetry make every report a coin flip until it's verified on-site.",
    "mirror-district": "Twin districts mirror each other's accusations. Verify before committing medical/evac, or jam the only bridge.",
    "red-ledger": "Ration ledger crash: real shortfall in North Wards; ghost census paints South Wards. Wrong advisories deepen unrest.",
  },
};

export function readStoredLocale(): Locale {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (value === "en" || value === "zh-TW") {
      return value;
    }
  } catch {
    // ignore
  }
  return "zh-TW";
}

export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}
