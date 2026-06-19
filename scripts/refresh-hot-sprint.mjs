import { readFile, writeFile } from "node:fs/promises";

const feedPath = new URL("../data/hot-sprint.json", import.meta.url);
const twseUrl = "https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json";

const response = await fetch(twseUrl, {
  headers: { "user-agent": "JASIC-V2-hot-sprint-refresh/1.0" }
});
if (!response.ok) throw new Error(`TWSE responded ${response.status}`);

const marketPayload = await response.json();
if (marketPayload.stat !== "OK" || !Array.isArray(marketPayload.data)) {
  throw new Error(marketPayload.stat || "TWSE payload is unavailable");
}

const market = new Map(marketPayload.data.map((row) => [
  row[0],
  Number(String(row[7]).replaceAll(",", ""))
]));
const feed = JSON.parse(await readFile(feedPath, "utf8"));

feed.updatedAt = new Date().toISOString();
feed.priceDate = marketPayload.date;
feed.items = feed.items.map((item) => {
  const currentPrice = market.get(item.symbol);
  if (!Number.isFinite(currentPrice)) return item;
  return {
    ...item,
    referencePrice: currentPrice,
    referenceGap: item.targetPrice - currentPrice
  };
});

await writeFile(feedPath, `${JSON.stringify(feed, null, 2)}\n`, "utf8");
