const TWSE_DAILY_URL = "https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json";
const TWSE_HISTORY_URL = "https://www.twse.com.tw/exchangeReport/STOCK_DAY";
const TWSE_VALUE_URL = "https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU_d";
const WORKER_QUOTES_URL = "https://jasic-quotes.yipo-jacky.workers.dev/quotes";
const STATIC_QUOTES_URL = "https://yipojacky-wq.github.io/Jacky/data/realtime-quotes.json";
const HOT_SPRINT_URL = "./data/hot-sprint.json";
const STORAGE_KEY = "jasic-v2-battle-watchlist";
const MAX_WATCH_SYMBOLS = 20;
const AUTO_REFRESH_MS = 5 * 60 * 1000;
const REALTIME_POLL_MS = 15 * 1000;
const DEFAULT_WATCH_SYMBOLS = ["2327", "2408", "2303"];

const state = {
  catalog: [],
  valuations: new Map(),
  realtimeQuotes: new Map(),
  realtimeGeneratedAt: "",
  markets: {
    taiex: null,
    taifexNight: null
  },
  watchSymbols: loadWatchSymbols(),
  stocks: [],
  recommendations: { buy: [], sell: [] },
  sprintFeed: { updatedAt: "", items: [] },
  sprintRanking: [],
  recommendationCount: 10,
  filter: "all",
  loading: false,
  latestDate: ""
};

const elements = {
  form: document.querySelector("#stockSearchForm"),
  input: document.querySelector("#stockSearchInput"),
  results: document.querySelector("#searchResults"),
  clear: document.querySelector("#clearSearchBtn"),
  board: document.querySelector("#stockBoard"),
  empty: document.querySelector("#emptyState"),
  loading: document.querySelector("#loadingState"),
  refresh: document.querySelector("#refreshBtn"),
  status: document.querySelector("#updateStatus"),
  filter: document.querySelector("#signalFilter"),
  template: document.querySelector("#stockCardTemplate")
};

const recommendationElements = {
  board: document.querySelector("#recommendationBoard"),
  loading: document.querySelector("#recommendationLoading"),
  date: document.querySelector("#recommendationDate"),
  toggles: document.querySelectorAll("[data-recommendation-count]")
};

const sprintElements = {
  board: document.querySelector("#sprintBoard"),
  loading: document.querySelector("#sprintLoading"),
  freshness: document.querySelector("#sprintFreshness")
};

let deferredInstallPrompt = null;
const installButton = document.querySelector("#installBtn");

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

function loadWatchSymbols() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_WATCH_SYMBOLS));
      return [...DEFAULT_WATCH_SYMBOLS];
    }
    const saved = JSON.parse(raw);
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [...DEFAULT_WATCH_SYMBOLS];
  }
}

function saveWatchSymbols() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.watchSymbols));
}

function toNumber(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).replaceAll(",", "").replace(/[＋+]/g, "").trim();
  if (!normalized || normalized === "--" || normalized === "-") return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "--";
  return value >= 100 ? value.toFixed(1) : value.toFixed(2);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatDate(date) {
  if (!date || date.length !== 8) return date || "--";
  return `${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)}`;
}

function fetchJson(url) {
  return fetch(url, { cache: "no-store" }).then((response) => {
    if (!response.ok) throw new Error(`資料服務回應 ${response.status}`);
    return response.json();
  });
}

async function loadMarketCatalog() {
  const payload = await fetchJson(TWSE_DAILY_URL);
  if (payload.stat !== "OK" || !Array.isArray(payload.data)) {
    throw new Error(payload.stat || "目前無法取得證交所行情");
  }

  state.latestDate = payload.date;
  state.catalog = payload.data
    .filter((row) => /^\d{4}$/.test(row[0]))
    .map((row) => ({
      symbol: row[0],
      name: String(row[1]).replace(/\*+$/, ""),
      volume: toNumber(row[2]),
      open: toNumber(row[4]),
      high: toNumber(row[5]),
      low: toNumber(row[6]),
      close: toNumber(row[7]),
      change: toNumber(row[8]),
      transactions: toNumber(row[9]),
      date: payload.date
    }));

  await loadValuations(payload.date);
  buildDailyRecommendations();
  await loadHotSprint();
}

async function loadHotSprint() {
  try {
    const payload = await fetchJson(`${HOT_SPRINT_URL}?t=${Date.now()}`);
    state.sprintFeed = {
      updatedAt: payload.updatedAt || "",
      items: Array.isArray(payload.items) ? payload.items : []
    };
    buildSprintRanking();
  } catch {
    state.sprintFeed = { updatedAt: "", items: [] };
    state.sprintRanking = [];
  }
}

function buildSprintRanking() {
  state.sprintRanking = state.sprintFeed.items
    .map((item) => {
      const market = state.catalog.find((stock) => stock.symbol === item.symbol);
      if (!market || !Number.isFinite(market.close) || !Number.isFinite(item.targetPrice)) return null;
      const gap = item.targetPrice - market.close;
      const upsidePercent = market.close > 0 ? (gap / market.close) * 100 : null;
      const battle = getSprintBattle(market);
      const ageDays = getAgeDays(item.publishedAt);
      return { ...item, market, gap, upsidePercent, battle, ageDays };
    })
    .filter((item) => item && item.gap >= 100)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 10);
}

function getAgeDays(dateString) {
  const date = new Date(`${dateString}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function getSprintBattle(stock) {
  const previousClose = Number.isFinite(stock.change) ? stock.close - stock.change : null;
  const changePercent = Number.isFinite(previousClose) && previousClose > 0
    ? (stock.change / previousClose) * 100
    : 0;
  const rangePercent = Number.isFinite(stock.high) && Number.isFinite(stock.low) && stock.low > 0
    ? ((stock.high - stock.low) / stock.low) * 100
    : 0;
  const closePosition = Number.isFinite(stock.high) && Number.isFinite(stock.low) && stock.high !== stock.low
    ? (stock.close - stock.low) / (stock.high - stock.low)
    : 0.5;

  if (changePercent >= 4 && closePosition >= 0.7) {
    return {
      key: "attack",
      title: "多方衝刺",
      brief: `漲幅 ${formatPercent(changePercent)}，收盤接近當日高檔，動能強但不宜追價。`,
      risk: rangePercent >= 8 ? "波動很高" : "波動偏高"
    };
  }
  if (changePercent > 0) {
    return {
      key: "watch",
      title: "偏多觀察",
      brief: `當日維持上漲 ${formatPercent(changePercent)}，宜等量價續強或拉回確認。`,
      risk: rangePercent >= 6 ? "震盪偏大" : "中度波動"
    };
  }
  return {
    key: "risk",
    title: "消息強、盤勢弱",
    brief: `目標價具想像空間，但當日股價 ${formatPercent(changePercent)}，先觀察止跌訊號。`,
    risk: rangePercent >= 6 ? "高風險" : "轉弱警戒"
  };
}

function buildDailyRecommendations() {
  const eligible = state.catalog
    .map((stock) => {
      const previousClose = Number.isFinite(stock.close) && Number.isFinite(stock.change)
        ? stock.close - stock.change
        : null;
      const changePercent = Number.isFinite(previousClose) && previousClose > 0
        ? (stock.change / previousClose) * 100
        : null;
      const liquidity = Math.log10(Math.max(stock.volume || 1, 1));
      const activity = Math.log10(Math.max(stock.transactions || 1, 1));
      return { ...stock, previousClose, changePercent, liquidity, activity };
    })
    .filter((stock) =>
      Number.isFinite(stock.close) &&
      Number.isFinite(stock.changePercent) &&
      stock.close >= 8 &&
      stock.volume >= 100000
    );

  const buyCandidates = eligible
    .filter((stock) => stock.changePercent >= 0.5 && stock.changePercent <= 8.5)
    .map((stock) => ({
      ...stock,
      radarScore: stock.changePercent * 1.45 + stock.liquidity * 0.7 + stock.activity * 0.35,
      action: "買進觀察",
      reason: stock.changePercent >= 4 ? "量價轉強，留意勿追高" : "短線動能轉強"
    }))
    .sort((a, b) => b.radarScore - a.radarScore);

  const sellCandidates = eligible
    .filter((stock) => stock.changePercent <= -0.5)
    .map((stock) => ({
      ...stock,
      radarScore: Math.abs(stock.changePercent) * 1.55 + stock.liquidity * 0.65 + stock.activity * 0.35,
      action: "賣出避險",
      reason: stock.changePercent <= -6 ? "跌勢擴大，優先控管風險" : "短線轉弱，留意支撐"
    }))
    .sort((a, b) => b.radarScore - a.radarScore);

  state.recommendations = {
    buy: buyCandidates.slice(0, 10),
    sell: sellCandidates.slice(0, 10)
  };
}

async function loadValuations(date) {
  const url = `${TWSE_VALUE_URL}?response=json&date=${date}&selectType=ALL`;
  try {
    const payload = await fetchJson(url);
    if (payload.stat !== "OK" || !Array.isArray(payload.data)) return;
    state.valuations = new Map(payload.data.map((row) => [
      row[0],
      {
        dividendYield: toNumber(row[3]),
        pe: toNumber(row[5]),
        pb: toNumber(row[6])
      }
    ]));
  } catch {
    state.valuations = new Map();
  }
}

async function loadRealtimeQuotes() {
  const symbols = state.watchSymbols.join(",");
  const sources = [
    `${WORKER_QUOTES_URL}?symbols=${encodeURIComponent(symbols)}&t=${Date.now()}`,
    `${STATIC_QUOTES_URL}?t=${Date.now()}`
  ];

  for (const source of sources) {
    try {
      const payload = await fetchJson(source);
      const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
      if (!quotes.length && !payload.markets?.taiex && !payload.markets?.taifexNight) {
        throw new Error("即時報價服務未回傳資料");
      }
      state.realtimeQuotes = new Map(quotes.map((quote) => [quote.symbol, quote]));
      state.realtimeGeneratedAt = payload.generatedAt || "";
      state.markets = {
        taiex: payload.markets?.taiex || null,
        taifexNight: payload.markets?.taifexNight || null
      };
      return;
    } catch {
      // Worker 尚未部署或暫時失效時，繼續使用 GitHub Pages 靜態報價檔。
    }
  }

  state.realtimeQuotes = new Map();
  state.realtimeGeneratedAt = "";
  state.markets = { taiex: null, taifexNight: null };
}

function getMonthKeys(dateString, count = 3) {
  const year = Number(dateString.slice(0, 4));
  const month = Number(dateString.slice(4, 6));
  const keys = [];
  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date(year, month - 1 - offset, 1);
    keys.push(`${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}01`);
  }
  return keys;
}

async function loadHistory(symbol) {
  const monthKeys = getMonthKeys(state.latestDate, 3);
  const payloads = await Promise.all(monthKeys.map((date) => {
    const url = `${TWSE_HISTORY_URL}?response=json&date=${date}&stockNo=${symbol}`;
    return fetchJson(url).catch(() => null);
  }));

  const rows = payloads
    .filter((payload) => payload?.stat === "OK" && Array.isArray(payload.data))
    .flatMap((payload) => payload.data.map((row) => ({
      date: row[0],
      volume: toNumber(row[1]),
      open: toNumber(row[3]),
      high: toNumber(row[4]),
      low: toNumber(row[5]),
      close: toNumber(row[6]),
      change: toNumber(row[7])
    })))
    .filter((row) => Number.isFinite(row.close))
    .sort((a, b) => rocDateToKey(a.date).localeCompare(rocDateToKey(b.date)));

  const unique = new Map(rows.map((row) => [row.date, row]));
  return [...unique.values()];
}

function rocDateToKey(value) {
  const [rocYear, month, day] = String(value).split("/");
  return `${Number(rocYear) + 1911}${month}${day}`;
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function calculateRsi(closes, period = 14) {
  if (closes.length <= period) return null;
  const recent = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < recent.length; i += 1) {
    const difference = recent[i] - recent[i - 1];
    if (difference >= 0) gains += difference;
    else losses += Math.abs(difference);
  }

  const averageGain = gains / period;
  const averageLoss = losses / period;
  if (averageLoss === 0) return 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - (100 / (1 + relativeStrength));
}

function calculateIndicators(history, market) {
  const adjustedHistory = [...history];
  if (market.isRealtime && Number.isFinite(market.close)) {
    const latest = adjustedHistory.at(-1);
    if (latest && rocDateToKey(latest.date) === market.date) {
      adjustedHistory[adjustedHistory.length - 1] = { ...latest, close: market.close, volume: market.volume };
    } else {
      adjustedHistory.push({
        date: market.date,
        close: market.close,
        volume: market.volume
      });
    }
  }

  const closes = adjustedHistory.map((item) => item.close);
  const volumes = adjustedHistory.map((item) => item.volume);
  const current = closes.at(-1) ?? market.close;
  const ma5 = average(closes.slice(-5));
  const ma20 = average(closes.slice(-20));
  const rsi = calculateRsi(closes);
  const previous20 = closes.at(-21);
  const momentum20 = Number.isFinite(previous20) ? ((current - previous20) / previous20) * 100 : null;
  const volume5 = average(volumes.slice(-5));
  const volume20 = average(volumes.slice(-20));
  const volumeRatio = Number.isFinite(volume5) && Number.isFinite(volume20) && volume20 !== 0
    ? volume5 / volume20
    : null;

  return { current, ma5, ma20, rsi, momentum20, volumeRatio };
}

function evaluateSignal(indicators, market) {
  let score = 0;
  const reasons = [];
  const { current, ma5, ma20, rsi, momentum20, volumeRatio } = indicators;

  if (Number.isFinite(ma20)) {
    if (current > ma20) {
      score += 2;
      reasons.push({ type: "positive", text: `現價站上 MA20（${formatPrice(ma20)}），中短期趨勢偏多。` });
    } else {
      score -= 2;
      reasons.push({ type: "negative", text: `現價跌破 MA20（${formatPrice(ma20)}），中短期趨勢承壓。` });
    }
  }

  if (Number.isFinite(ma5) && Number.isFinite(ma20)) {
    if (ma5 > ma20) {
      score += 1;
      reasons.push({ type: "positive", text: "MA5 高於 MA20，短線動能相對強勢。" });
    } else {
      score -= 1;
      reasons.push({ type: "negative", text: "MA5 低於 MA20，短線尚未轉強。" });
    }
  }

  if (Number.isFinite(rsi)) {
    if (rsi >= 50 && rsi <= 70) {
      score += 1;
      reasons.push({ type: "positive", text: `RSI 為 ${rsi.toFixed(1)}，多方力道偏強但尚未明顯過熱。` });
    } else if (rsi > 75) {
      score -= 1;
      reasons.push({ type: "neutral", text: `RSI 為 ${rsi.toFixed(1)}，走勢強但短線可能過熱。` });
    } else if (rsi < 35) {
      score -= 1;
      reasons.push({ type: "negative", text: `RSI 為 ${rsi.toFixed(1)}，目前賣壓較重。` });
    } else {
      reasons.push({ type: "neutral", text: `RSI 為 ${rsi.toFixed(1)}，多空力道接近中性。` });
    }
  }

  if (Number.isFinite(momentum20)) {
    if (momentum20 > 3) score += 1;
    if (momentum20 < -3) score -= 1;
    reasons.push({
      type: momentum20 > 3 ? "positive" : momentum20 < -3 ? "negative" : "neutral",
      text: `近 20 日漲跌為 ${formatPercent(momentum20)}，${momentum20 > 3 ? "動能向上" : momentum20 < -3 ? "動能向下" : "目前處於整理區間"}。`
    });
  }

  if (Number.isFinite(volumeRatio) && volumeRatio > 1.25) {
    reasons.push({
      type: market.change >= 0 ? "positive" : "negative",
      text: `近期量比 ${volumeRatio.toFixed(2)}，量能放大且當日${market.change >= 0 ? "收漲" : "收跌"}。`
    });
  }

  if (score >= 3) return { key: "buy", title: "買進觀察", score, reasons };
  if (score <= -3) return { key: "sell", title: "拋售警示", score, reasons };
  return { key: "hold", title: "可持有", score, reasons };
}

async function buildStock(symbol) {
  const dailyMarket = state.catalog.find((item) => item.symbol === symbol);
  if (!dailyMarket) throw new Error(`找不到上市股票 ${symbol}`);
  const quote = state.realtimeQuotes.get(symbol);
  const market = mergeRealtimeQuote(dailyMarket, quote);
  const history = await loadHistory(symbol);
  const indicators = calculateIndicators(history, market);
  const signal = evaluateSignal(indicators, market);
  const valuation = state.valuations.get(symbol) || {};
  return { ...market, history, indicators, signal, valuation };
}

function mergeRealtimeQuote(daily, quote) {
  if (!quote || !Number.isFinite(quote.price)) {
    return {
      ...daily,
      previousClose: daily.close,
      isRealtime: false
    };
  }
  const previousClose = Number.isFinite(quote.previousClose) ? quote.previousClose : daily.close;
  return {
    ...daily,
    previousClose,
    close: quote.price,
    change: Number.isFinite(previousClose) ? quote.price - previousClose : daily.change,
    open: quote.open ?? daily.open,
    high: quote.high ?? daily.high,
    low: quote.low ?? daily.low,
    volume: quote.volume ?? daily.volume,
    date: quote.date || daily.date,
    quoteTime: quote.time || "",
    isRealtime: true
  };
}

async function refreshAll(options = {}) {
  if (state.loading) return;
  setLoading(true);
  clearError();

  try {
    await loadMarketCatalog();
    await loadRealtimeQuotes();
    const results = await Promise.allSettled(state.watchSymbols.map(buildStock));
    state.stocks = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length) showError(`有 ${failed.length} 檔股票暫時無法更新，請稍後再試。`);

    render();
    const realtimeTimes = state.stocks.map((stock) => stock.quoteTime).filter(Boolean).sort();
    const latestQuoteTime = realtimeTimes.at(-1);
    const realtimeEnabled = state.realtimeQuotes.size > 0;
    const generatedTime = formatGeneratedTime(state.realtimeGeneratedAt);
    elements.status.textContent = realtimeEnabled
      ? latestQuoteTime
        ? `今日盤價・最後更新 ${latestQuoteTime}`
        : `即時報價已啟用${generatedTime ? `・資料檔更新 ${generatedTime}` : ""}`
      : `目前顯示 ${formatDate(state.latestDate)} 收盤`;
    elements.status.classList.toggle("quote-warning", !realtimeEnabled);
    if (!realtimeEnabled) {
      showError("目前無法取得即時報價，已暫時顯示最近交易日收盤資料。");
    }
  } catch (error) {
    showError(`無法取得證交所資料：${error.message}`);
    elements.status.textContent = "資料更新失敗";
  } finally {
    setLoading(false);
    if (options.focusSearch) elements.input.focus();
  }
}

async function refreshRealtimeQuotes() {
  if (state.loading) return;

  try {
    await loadRealtimeQuotes();
    state.stocks = state.stocks.map((stock) => {
      const dailyMarket = state.catalog.find((item) => item.symbol === stock.symbol);
      if (!dailyMarket) return stock;
      const market = mergeRealtimeQuote(dailyMarket, state.realtimeQuotes.get(stock.symbol));
      const indicators = calculateIndicators(stock.history, market);
      const signal = evaluateSignal(indicators, market);
      return { ...market, history: stock.history, indicators, signal, valuation: stock.valuation };
    });
    render();

    const realtimeTimes = state.stocks.map((stock) => stock.quoteTime).filter(Boolean).sort();
    const latestQuoteTime = realtimeTimes.at(-1);
    const generatedTime = formatGeneratedTime(state.realtimeGeneratedAt);
    elements.status.textContent = latestQuoteTime
      ? `今日盤價・最後更新 ${latestQuoteTime}`
      : `即時報價已啟用${generatedTime ? `・資料檔更新 ${generatedTime}` : ""}`;
    elements.status.classList.remove("quote-warning");
  } catch {
    // 保留上一筆可用行情，避免短暫網路問題清空畫面。
  }
}

function setLoading(loading) {
  state.loading = loading;
  elements.refresh.classList.toggle("is-loading", loading);
  elements.refresh.disabled = loading;
  elements.loading.hidden = !loading || state.watchSymbols.length === 0;
  if (loading && state.watchSymbols.length > 0) elements.empty.hidden = true;
  recommendationElements.loading.hidden = !loading;
  if (loading) recommendationElements.board.hidden = true;
}

function showError(message) {
  clearError();
  const banner = document.createElement("div");
  banner.className = "error-banner";
  banner.id = "errorBanner";
  banner.textContent = message;
  document.querySelector(".watch-section").prepend(banner);
}

function clearError() {
  document.querySelector("#errorBanner")?.remove();
}

function searchCatalog(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return state.catalog
    .filter((stock) =>
      stock.symbol.toLowerCase().includes(normalized) ||
      stock.name.toLowerCase().includes(normalized)
    )
    .slice(0, 8);
}

function renderSearchResults(matches, query) {
  elements.results.innerHTML = "";
  if (!query.trim()) {
    elements.results.hidden = true;
    return;
  }

  if (!state.catalog.length) {
    elements.results.innerHTML = '<div class="search-message">股票名單載入中，請稍候…</div>';
  } else if (!matches.length) {
    elements.results.innerHTML = '<div class="search-message">找不到相符的上市股票</div>';
  } else {
    matches.forEach((stock) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      button.dataset.symbol = stock.symbol;
      button.setAttribute("role", "option");
      button.innerHTML = `<span>${escapeHtml(stock.name)}</span><strong>${escapeHtml(stock.symbol)}</strong>`;
      elements.results.append(button);
    });
  }
  elements.results.hidden = false;
}

async function addStock(symbol) {
  if (!symbol || state.watchSymbols.includes(symbol)) {
    elements.input.value = "";
    elements.results.hidden = true;
    return;
  }

  if (state.watchSymbols.length >= MAX_WATCH_SYMBOLS) {
    showError(`自選股最多保存 ${MAX_WATCH_SYMBOLS} 檔，請先移除一檔再新增。`);
    return;
  }

  state.watchSymbols.unshift(symbol);
  saveWatchSymbols();
  elements.input.value = "";
  elements.clear.hidden = true;
  elements.results.hidden = true;
  setLoading(true);

  try {
    const stock = await buildStock(symbol);
    state.stocks.unshift(stock);
    render();
  } catch (error) {
    state.watchSymbols = state.watchSymbols.filter((item) => item !== symbol);
    saveWatchSymbols();
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

function removeStock(symbol) {
  state.watchSymbols = state.watchSymbols.filter((item) => item !== symbol);
  state.stocks = state.stocks.filter((item) => item.symbol !== symbol);
  saveWatchSymbols();
  render();
}

function render() {
  const visibleStocks = state.filter === "all"
    ? state.stocks
    : state.stocks.filter((stock) => stock.signal.key === state.filter);

  elements.board.innerHTML = "";
  visibleStocks.forEach((stock) => elements.board.append(createStockCard(stock)));

  const hasAny = state.watchSymbols.length > 0;
  elements.empty.hidden = hasAny || state.loading;
  elements.board.hidden = !hasAny;
  renderMarketOverview();
  renderRecommendations();
  renderSprint();
  renderSummary();
}

function renderRecommendations() {
  const perSide = Math.max(1, Math.floor(state.recommendationCount / 2));
  recommendationElements.board.innerHTML = "";
  recommendationElements.date.textContent = state.latestDate
    ? `資料日期 ${formatDate(state.latestDate)}`
    : "等待最新交易資料";

  const columns = [
    {
      key: "buy",
      title: "買進觀察",
      caption: "相對強勢",
      stocks: state.recommendations.buy.slice(0, perSide)
    },
    {
      key: "sell",
      title: "賣出避險",
      caption: "相對弱勢",
      stocks: state.recommendations.sell.slice(0, perSide)
    }
  ];

  columns.forEach((column) => {
    const section = document.createElement("section");
    section.className = `recommendation-column ${column.key}-column`;
    const heading = document.createElement("div");
    heading.className = "recommendation-column-heading";
    heading.innerHTML = `<h3>${column.title}</h3><span>${column.caption} ${column.stocks.length} 檔</span>`;
    const list = document.createElement("div");
    list.className = "recommendation-list";

    column.stocks.forEach((stock, index) => {
      const item = document.createElement("article");
      item.className = "recommendation-item";
      item.innerHTML = `
        <span class="recommendation-rank">${String(index + 1).padStart(2, "0")}</span>
        <div class="recommendation-stock">
          <strong>${escapeHtml(stock.name)} ${escapeHtml(stock.symbol)}</strong>
          <span>成交量 ${formatCompactNumber(stock.volume)}・收盤 ${formatPrice(stock.close)}</span>
        </div>
        <div class="recommendation-action">
          <strong>${formatPercent(stock.changePercent)}</strong>
          <span>${escapeHtml(stock.reason)}</span>
        </div>
      `;
      list.append(item);
    });

    if (!column.stocks.length) {
      const empty = document.createElement("div");
      empty.className = "search-message";
      empty.textContent = "今日尚無符合條件的股票";
      list.append(empty);
    }

    section.append(heading, list);
    recommendationElements.board.append(section);
  });

  recommendationElements.loading.hidden = true;
  recommendationElements.board.hidden = false;
}

function formatCompactNumber(value) {
  if (!Number.isFinite(value)) return "--";
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)} 億`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 萬`;
  return value.toLocaleString("zh-TW");
}

function renderSprint() {
  sprintElements.board.innerHTML = "";
  const updatedAt = state.sprintFeed.updatedAt ? new Date(state.sprintFeed.updatedAt) : null;
  const updatedLabel = updatedAt && !Number.isNaN(updatedAt.getTime())
    ? updatedAt.toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    : "來源資料待更新";
  const staleCount = state.sprintRanking.filter((item) => Number.isFinite(item.ageDays) && item.ageDays > 30).length;
  sprintElements.freshness.textContent = staleCount
    ? `${updatedLabel}・${staleCount} 筆逾 30 天`
    : `${updatedLabel}・來源可追溯`;
  sprintElements.freshness.classList.toggle("is-stale", staleCount > 0);

  state.sprintRanking.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = `sprint-card sprint-${item.battle.key}`;
    card.dataset.symbol = item.symbol;
    const staleLabel = Number.isFinite(item.ageDays) && item.ageDays > 30
      ? '<span class="source-age is-stale">消息逾 30 天</span>'
      : `<span class="source-age">${item.ageDays ?? "--"} 天前</span>`;
    card.innerHTML = `
      <div class="sprint-rank">${String(index + 1).padStart(2, "0")}</div>
      <div class="sprint-stock">
        <span>${escapeHtml(item.symbol)}・${escapeHtml(item.institution)}</span>
        <h3>${escapeHtml(item.name)}</h3>
        <div class="sprint-prices">
          <span>最新股價 <strong>${formatPrice(item.market.close)}</strong></span>
          <span>外資目標 <strong>${formatPrice(item.targetPrice)}</strong></span>
          <span class="sprint-gap">價差 <strong>+${formatPrice(item.gap)}</strong></span>
        </div>
        <div class="sprint-upside">目標價潛在空間 ${formatPercent(item.upsidePercent)}</div>
      </div>
      <div class="sprint-battle">
        <span class="battle-kicker">JASIC 戰情簡報</span>
        <strong>${escapeHtml(item.battle.title)}</strong>
        <p>${escapeHtml(item.battle.brief)}</p>
        <span class="battle-risk">風險：${escapeHtml(item.battle.risk)}</span>
      </div>
      <div class="sprint-source">
        ${staleLabel}
        <time datetime="${escapeHtml(item.publishedAt)}">${escapeHtml(item.publishedAt)}</time>
        <a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.sourceTitle)}</a>
        <button type="button" data-add-sprint-symbol="${escapeHtml(item.symbol)}">加入自選戰情</button>
      </div>
    `;
    sprintElements.board.append(card);
  });

  if (!state.sprintRanking.length) {
    sprintElements.board.innerHTML = `
      <div class="sprint-empty">
        目前沒有符合「目標價高於最新股價至少 100 元」且具有可追溯來源的資料。
      </div>
    `;
  }

  sprintElements.loading.hidden = true;
  sprintElements.board.hidden = false;
}

function renderMarketOverview() {
  renderMarketQuote("taiex", state.markets.taiex);
  renderMarketQuote("taifexNight", state.markets.taifexNight);

  const quoteTimes = [state.markets.taiex, state.markets.taifexNight]
    .filter(Boolean)
    .map((quote) => `${formatDate(quote.date)} ${formatQuoteTime(quote.time)}`.trim())
    .filter(Boolean);
  document.querySelector("#marketQuoteTime").textContent = quoteTimes.length
    ? `資料時間 ${quoteTimes.sort().at(-1)}`
    : "行情暫時無法取得";
}

function renderMarketQuote(key, quote) {
  const prefix = key === "taiex" ? "taiex" : "taifexNight";
  const priceElement = document.querySelector(`#${prefix}Price`);
  const changeElement = document.querySelector(`#${prefix}Change`);
  const highElement = document.querySelector(`#${prefix}High`);
  const lowElement = document.querySelector(`#${prefix}Low`);

  if (!quote || !Number.isFinite(quote.price)) {
    priceElement.textContent = "--";
    changeElement.textContent = key === "taiex" ? "等待證交所報價" : "等待近月合約報價";
    changeElement.className = "market-change";
    highElement.textContent = "--";
    lowElement.textContent = "--";
    return;
  }

  const change = Number.isFinite(quote.previousClose) ? quote.price - quote.previousClose : null;
  const changePercent = Number.isFinite(change) && quote.previousClose
    ? (change / quote.previousClose) * 100
    : null;
  priceElement.textContent = formatMarketPrice(quote.price);
  changeElement.textContent = Number.isFinite(change)
    ? `${change > 0 ? "+" : ""}${formatMarketPrice(change)}（${formatPercent(changePercent)}）`
    : `更新 ${formatQuoteTime(quote.time)}`;
  changeElement.className = `market-change ${change >= 0 ? "positive" : "negative"}`;
  highElement.textContent = formatMarketPrice(quote.high);
  lowElement.textContent = formatMarketPrice(quote.low);
}

function formatMarketPrice(value) {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString("zh-TW", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatQuoteTime(value) {
  const digits = String(value || "").replaceAll(":", "");
  if (!/^\d{6}$/.test(digits)) return value || "";
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`;
}

function formatGeneratedTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function renderSummary() {
  const counts = { buy: 0, hold: 0, sell: 0 };
  state.stocks.forEach((stock) => counts[stock.signal.key] += 1);
  document.querySelector("#buyCount").textContent = counts.buy;
  document.querySelector("#holdCount").textContent = counts.hold;
  document.querySelector("#sellCount").textContent = counts.sell;
}

function createStockCard(stock) {
  const fragment = elements.template.content.cloneNode(true);
  const card = fragment.querySelector(".stock-card");
  const changePercent = Number.isFinite(stock.change) && Number.isFinite(stock.previousClose) && stock.previousClose !== 0
    ? (stock.change / stock.previousClose) * 100
    : null;

  card.dataset.symbol = stock.symbol;
  card.dataset.signal = stock.signal.key;
  setText(card, ".stock-code", stock.symbol);
  setText(card, ".stock-name", stock.name);
  setText(
    card,
    ".data-date",
    stock.isRealtime
      ? `即時報價 ${formatDate(stock.date)} ${stock.quoteTime}`
      : `收盤資料 ${formatDate(stock.date)}`
  );
  setText(card, ".previous-close", formatPrice(stock.previousClose));
  setText(card, ".previous-date", stock.isRealtime ? "前一交易日" : formatDate(stock.date));
  setText(card, ".stock-price", formatPrice(stock.close));
  setText(card, ".stock-change", `${stock.change > 0 ? "+" : ""}${formatPrice(stock.change)}（${formatPercent(changePercent)}）`);
  setText(
    card,
    ".quote-update-time",
    stock.isRealtime ? `更新 ${stock.quoteTime}` : "等待今日即時報價"
  );
  setText(card, ".current-price-label", stock.isRealtime ? "今日盤價" : "最近收盤");
  card.querySelector(".stock-change").classList.add(stock.change >= 0 ? "positive" : "negative");
  setText(card, ".signal-label", "JASIC 綜合訊號");
  setText(card, ".signal-title", stock.signal.title);
  setText(card, ".signal-score", `技術分數 ${stock.signal.score > 0 ? "+" : ""}${stock.signal.score}`);
  setText(card, ".ma5-value", formatPrice(stock.indicators.ma5));
  setText(card, ".ma20-value", formatPrice(stock.indicators.ma20));
  setText(card, ".rsi-value", Number.isFinite(stock.indicators.rsi) ? stock.indicators.rsi.toFixed(1) : "--");
  setText(card, ".momentum-value", formatPercent(stock.indicators.momentum20));
  setText(card, ".pe-value", Number.isFinite(stock.valuation.pe) ? stock.valuation.pe.toFixed(2) : "--");
  setText(card, ".yield-value", Number.isFinite(stock.valuation.dividendYield) ? `${stock.valuation.dividendYield.toFixed(2)}%` : "--");
  setText(card, ".volume-ratio-value", Number.isFinite(stock.indicators.volumeRatio) ? stock.indicators.volumeRatio.toFixed(2) : "--");
  setText(card, ".trend-value", getTrendLabel(stock));
  setText(card, ".support-value", formatPrice(getSupportPrice(stock)));
  setText(card, ".stop-value", formatPrice(getStopPrice(stock)));
  setText(card, ".target-value", formatPrice(getTargetPrice(stock)));

  const reasonList = card.querySelector(".reason-list");
  stock.signal.reasons.forEach((reason) => {
    const item = document.createElement("div");
    item.className = `reason ${reason.type}-reason`;
    item.innerHTML = `<span class="reason-mark">${reason.type === "positive" ? "↑" : reason.type === "negative" ? "↓" : "−"}</span><span>${escapeHtml(reason.text)}</span>`;
    reasonList.append(item);
  });

  const lessons = [
    {
      title: `均線判讀：${stock.indicators.ma5 > stock.indicators.ma20 ? "短線偏強" : "短線偏弱"}`,
      text: "均線適合看趨勢，不適合單獨預測轉折。價格在均線附近反覆穿越時，常代表盤整。"
    },
    {
      title: `RSI 判讀：${getRsiLabel(stock.indicators.rsi)}`,
      text: "RSI 過熱不等於立刻下跌，超賣也不等於立刻反彈；應搭配趨勢與成交量一起觀察。"
    }
  ];

  const lessonContainer = card.querySelector(".indicator-lessons");
  lessons.forEach((lesson) => {
    const item = document.createElement("div");
    item.className = "lesson";
    item.innerHTML = `<h4>${escapeHtml(lesson.title)}</h4><p>${escapeHtml(lesson.text)}</p>`;
    lessonContainer.append(item);
  });

  return fragment;
}

function getTrendLabel(stock) {
  if (stock.signal.key === "buy") return stock.indicators.rsi > 75 ? "偏多但過熱" : "偏多";
  if (stock.signal.key === "sell") return "偏空";
  return stock.indicators.ma5 >= stock.indicators.ma20 ? "震盪偏多" : "震盪偏弱";
}

function getSupportPrice(stock) {
  const candidates = [stock.indicators.ma5, stock.indicators.ma20, stock.low].filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates.filter((value) => value <= stock.close), stock.close * 0.96) : stock.close * 0.96;
}

function getStopPrice(stock) {
  const support = getSupportPrice(stock);
  return Math.min(support * 0.98, stock.close * 0.94);
}

function getTargetPrice(stock) {
  const momentum = Number.isFinite(stock.indicators.momentum20)
    ? Math.min(Math.max(stock.indicators.momentum20 / 100, 0.04), 0.12)
    : 0.06;
  return stock.close * (1 + momentum);
}

function getRsiLabel(value) {
  if (!Number.isFinite(value)) return "資料不足";
  if (value >= 70) return "偏熱";
  if (value <= 30) return "偏弱／超賣區";
  if (value >= 50) return "偏強";
  return "中性偏弱";
}

function setText(container, selector, value) {
  container.querySelector(selector).textContent = value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

elements.input.addEventListener("input", () => {
  const query = elements.input.value;
  elements.clear.hidden = !query;
  renderSearchResults(searchCatalog(query), query);
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const matches = searchCatalog(elements.input.value);
  if (matches.length) addStock(matches[0].symbol);
  else renderSearchResults([], elements.input.value);
});

elements.results.addEventListener("click", (event) => {
  const result = event.target.closest("[data-symbol]");
  if (result) addStock(result.dataset.symbol);
});

elements.clear.addEventListener("click", () => {
  elements.input.value = "";
  elements.clear.hidden = true;
  elements.results.hidden = true;
  elements.input.focus();
});

elements.board.addEventListener("click", (event) => {
  const card = event.target.closest(".stock-card");
  if (!card) return;

  if (event.target.closest(".remove-button")) {
    removeStock(card.dataset.symbol);
    return;
  }

  const detailsButton = event.target.closest(".details-button");
  if (detailsButton) {
    const details = card.querySelector(".stock-details");
    const expanded = detailsButton.getAttribute("aria-expanded") === "true";
    detailsButton.setAttribute("aria-expanded", String(!expanded));
    details.hidden = expanded;
  }
});

document.querySelector(".quick-picks").addEventListener("click", (event) => {
  const button = event.target.closest("[data-quick-symbol]");
  if (button) addStock(button.dataset.quickSymbol);
});

elements.refresh.addEventListener("click", () => refreshAll());

elements.filter.addEventListener("change", () => {
  state.filter = elements.filter.value;
  render();
});

recommendationElements.toggles.forEach((button) => {
  button.addEventListener("click", () => {
    state.recommendationCount = Number(button.dataset.recommendationCount);
    recommendationElements.toggles.forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    renderRecommendations();
  });
});

document.querySelectorAll("[data-scroll-target]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(`#${button.dataset.scrollTarget}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });
});

sprintElements.board.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add-sprint-symbol]");
  if (button) addStock(button.dataset.addSprintSymbol);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".stock-search")) elements.results.hidden = true;
});

refreshAll({ focusSearch: false });
setInterval(() => refreshAll(), AUTO_REFRESH_MS);
setInterval(() => refreshRealtimeQuotes(), REALTIME_POLL_MS);
