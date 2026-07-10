import "server-only";
import { getSheetValues, overwriteSheet, ensureSheet } from "./google";
import { cached, invalidate } from "./cache";
import { toRecords, num, safeAsin } from "./parse";
import { usingSupabase, dbLoadHealth, dbLoadChecklist, dbSaveChecklist } from "./db";

export const CHECKLISTS: Record<string, string[]> = {
  "High Traffic / Low Conv": [
    "Quick sanity checks (Buy Box > 95%, In-stock 100%, Price vs peers)",
    "Relevance audit (Search term & listing keyword alignment)",
    "Primary image & title optimization (Clarity, benefits, keywords)",
    "First 3 bullets review (Objection-crushing, outcome-focused)",
    "A+ Content audit (Comparison charts, visual plans, FAQs)",
    "'Look Inside' / interior images review",
    "Social proof check (Reviews, endorsements)",
    "Offer tests (Coupons, price experiments)",
    "Variation hygiene (Merge duplicates, set best-seller as default)",
    "Ad strategy review (Shift budget from discovery to conversion)",
    "Category-specific must-haves check (e.g., 'Updated for 2025')",
  ],
  "Low Traffic / Low Conv": [
    "Keyword & relevance overhaul (Research and update all text)",
    "Fix core listing elements for conversion (Title, Image, Bullets, A+)",
    "Improve trust signals (Get more verified reviews, add editorial reviews)",
    "Run targeted ads to kickstart traffic (Sponsored Products - Exact Match)",
    "External traffic push (Social media, forums, Amazon Attribution)",
    "Promotional hooks (Launch with coupons or limited-time deals)",
    "Monitor & Iterate (Track changes in Traffic/Conversion flags)",
  ],
};

const HEALTH_SHEET = "ASIN_Health_Data";
const CHECKLIST_SHEET = "ASIN_Checklist_Status";

export interface HealthRaw {
  month: string; // YYYY-MM
  asin: string;
  title: string;
  sales: number;
  units: number;
  sessions: number;
  usp: number; // unit session percentage
  buyBox: number; // featured offer percentage
}

export async function loadHealth(): Promise<HealthRaw[]> {
  if (usingSupabase()) return dbLoadHealth();
  return cached("health:data", 10 * 60 * 1000, async () => {
    const recs = toRecords(await getSheetValues(HEALTH_SHEET));
    const out: HealthRaw[] = [];
    for (const r of recs) {
      const month = String(r["Month"] ?? "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      out.push({
        month,
        asin: safeAsin(r["(Child) ASIN"] ?? r["ASIN"]),
        title: r["Title"] ?? "",
        sales: num(r["Ordered Product Sales"]),
        units: num(r["Units Ordered"]),
        sessions: num(r["Sessions - Total"]),
        usp: num(r["Unit Session Percentage"]),
        buyBox: num(r["Featured Offer Percentage"]),
      });
    }
    return out;
  });
}

export interface HealthCalc {
  asin: string;
  title: string;
  sales: number;
  units: number;
  sessions: number;
  usp: number;
  buyBox: number;
  asp: number;
  trafficFlag: string;
  conversionFlag: string;
  buyBoxFlag: string;
  opportunity: string;
  potentialUnits: number;
  potentialRevenue: number;
  priorityScore: number;
}

/** Aggregate across months (sessions-weighted percentages) and compute all flags/scores. */
export function aggregateHealth(rows: HealthRaw[], months: string[], targetUsp: number): HealthCalc[] {
  const filtered = rows.filter((r) => months.includes(r.month));
  const byAsin = new Map<string, HealthRaw[]>();
  for (const r of filtered) {
    (byAsin.get(r.asin) ?? byAsin.set(r.asin, []).get(r.asin)!).push(r);
  }
  const out: HealthCalc[] = [];
  for (const [asin, group] of byAsin) {
    const sessions = group.reduce((s, g) => s + g.sessions, 0);
    const sales = group.reduce((s, g) => s + g.sales, 0);
    const units = group.reduce((s, g) => s + g.units, 0);
    const usp = sessions > 0 ? group.reduce((s, g) => s + g.usp * g.sessions, 0) / sessions : 0;
    const buyBox = sessions > 0 ? group.reduce((s, g) => s + g.buyBox * g.sessions, 0) / sessions : 0;
    const asp = units > 0 ? sales / units : 0;
    const potentialUnits = Math.max(0, (targetUsp - usp) * sessions);
    const potentialRevenue = potentialUnits * asp;
    const ifFactor = sessions < 5000 ? 0.8 : 1;
    out.push({
      asin,
      title: group[0].title,
      sales, units, sessions, usp, buyBox, asp,
      trafficFlag: sessions < 5000 ? "Low Traffic" : "OK",
      conversionFlag: usp < targetUsp ? "Low Conversion" : "OK",
      buyBoxFlag: buyBox < 0.9 ? "Buy Box Loss" : "OK",
      opportunity: sessions >= 5000 && usp < targetUsp ? "High Traffic / Low Conv" : "",
      potentialUnits,
      potentialRevenue,
      priorityScore: potentialRevenue * buyBox * ifFactor,
    });
  }
  return out.sort((a, b) => b.priorityScore - a.priorityScore);
}

export interface ChecklistRow {
  month: string;
  asin: string;
  item: string;
  status: boolean;
}

export async function loadChecklist(): Promise<ChecklistRow[]> {
  if (usingSupabase()) return dbLoadChecklist();
  await ensureSheet(CHECKLIST_SHEET, ["Month", "ASIN", "Checklist Item", "Status"]);
  return cached("health:checklist", 60 * 1000, async () => {
    const recs = toRecords(await getSheetValues(CHECKLIST_SHEET));
    return recs.map((r) => ({
      month: String(r["Month"] ?? "").slice(0, 7),
      asin: safeAsin(r["ASIN"]),
      item: r["Checklist Item"] ?? "",
      status: ["true", "t", "1", "yes", "y"].includes(String(r["Status"]).trim().toLowerCase()),
    }));
  });
}

/** Overwrite the (month, asin) block with the submitted state. */
export async function saveChecklist(month: string, asin: string, items: { item: string; status: boolean }[]) {
  if (usingSupabase()) return dbSaveChecklist(month, asin, items);
  const existing = await loadChecklist();
  const kept = existing.filter((r) => !(r.month === month && r.asin === asin));
  const all = [
    ...kept,
    ...items.map((i) => ({ month, asin, item: i.item, status: i.status })),
  ];
  // de-dupe on (month, asin, item), keep last
  const map = new Map<string, ChecklistRow>();
  for (const r of all) map.set(`${r.month}||${r.asin}||${r.item}`, r);
  await overwriteSheet(
    CHECKLIST_SHEET,
    ["Month", "ASIN", "Checklist Item", "Status"],
    [...map.values()].map((r) => [r.month, r.asin, r.item, r.status ? "TRUE" : "FALSE"]),
  );
  invalidate("health:checklist");
}

export { HEALTH_SHEET };
