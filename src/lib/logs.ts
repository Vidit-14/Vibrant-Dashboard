import "server-only";
import { getSheetValues, appendRows } from "./google";
import { cached, invalidate } from "./cache";
import { toRecords, safeAsin } from "./parse";
import { usingSupabase, dbLoadLogs, dbAppendLog } from "./db";

const SHEET = "ASIN Selections (log changes)";

/** Stable composite key for an (ASIN, campaign) pair. */
export function pairKey(asin: string, campaign: string): string {
  return `${asin}||${campaign}`;
}

export interface LogEntry {
  timestamp: string;
  asin: string;
  campaign: string;
  comment: string;
}

export async function loadLogs(): Promise<LogEntry[]> {
  if (usingSupabase()) return dbLoadLogs();
  return cached("logs", 60 * 1000, async () => {
    const recs = toRecords(await getSheetValues(SHEET));
    const out: LogEntry[] = [];
    for (const r of recs) {
      const ts = r["Timestamp"];
      if (!ts) continue;
      // handles both ISO-ish and DD-MM-YYYY entries
      let d = new Date(ts);
      if (Number.isNaN(d.getTime())) {
        const m = ts.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(.*)$/);
        if (m) d = new Date(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}${m[4]}`);
      }
      if (Number.isNaN(d.getTime())) continue;
      out.push({
        timestamp: d.toISOString(),
        asin: safeAsin(r["ASIN"]),
        campaign: r["Campaign"] ?? "",
        comment: r["Comment"] ?? "",
      });
    }
    return out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  });
}

/** Keys of (ASIN, campaign) pairs logged within the last 7 days. */
export async function getActiveLoggedPairs(): Promise<Set<string>> {
  const logs = await loadLogs();
  const cutoff = Date.now() - 7 * 86400000;
  const set = new Set<string>();
  for (const l of logs) {
    if (Date.parse(l.timestamp) >= cutoff) set.add(pairKey(l.asin, l.campaign));
  }
  return set;
}

export async function appendLog(asin: string, campaign: string, comment: string) {
  if (usingSupabase()) return dbAppendLog(String(asin), campaign, comment);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const expiry = new Date(now.getTime() + 7 * 86400000);
  const expiryStr = `${expiry.getFullYear()}-${pad(expiry.getMonth() + 1)}-${pad(expiry.getDate())}`;
  // column order matches the existing sheet: Timestamp, Expiry, ASIN, Campaign, Comment, (spare)
  await appendRows(SHEET, [[stamp, expiryStr, String(asin), campaign, comment, ""]]);
  invalidate("logs");
}
