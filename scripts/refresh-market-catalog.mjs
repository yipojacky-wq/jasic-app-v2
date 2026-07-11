import { writeFile } from "node:fs/promises";

const outputPath = new URL("../data/market-catalog.json", import.meta.url);
const twseDailyUrl = "https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json";
const twseValueUrl = "https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU_d";

function toNumber(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).replaceAll(",", "").replace(/[＋+]/g, "").trim();
  if (!normalized || normalized === "--" || normalized === "-") return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "JASIC-V2-market-catalog-refresh/1.0" }
  });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  const text = await response.text();
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  return parseDailyCsv(trimmed);
}

const dailyPayload = await fetchJson(twseDailyUrl);
if (!dailyPayload.date || !Array.isArray(dailyPayload.data)) {
  throw new Error(dailyPayload.stat || "TWSE daily payload is unavailable");
}

const stocks = dailyPayload.data
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
    date: dailyPayload.date
  }));

let valuations = [];
try {
  const valuePayload = await fetchJson(`${twseValueUrl}?response=json&date=${dailyPayload.date}&selectType=ALL`);
  if (valuePayload.stat === "OK" && Array.isArray(valuePayload.data)) {
    valuations = valuePayload.data.map((row) => ({
      symbol: row[0],
      dividendYield: toNumber(row[2]),
      peRatio: toNumber(row[4]),
      pbRatio: toNumber(row[5])
    }));
  }
} catch {
  valuations = [];
}

const catalog = {
  generatedAt: new Date().toISOString(),
  date: dailyPayload.date,
  source: "TWSE STOCK_DAY_ALL + BWIBBU_d",
  stocks,
  valuations
};

await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

function parseDailyCsv(text) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);
  const dataRows = rows.slice(1);
  return {
    date: rocCompactDateToKey(dataRows.find((row) => row[0])?.[0]),
    data: dataRows.map((row) => [
      row[1],
      row[2],
      row[3],
      "",
      row[5],
      row[6],
      row[7],
      row[8],
      row[9],
      row[10]
    ])
  };
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function rocCompactDateToKey(value) {
  const text = String(value || "");
  if (!/^\d{7}$/.test(text)) return "";
  const year = Number(text.slice(0, 3)) + 1911;
  return `${year}${text.slice(3, 5)}${text.slice(5, 7)}`;
}
