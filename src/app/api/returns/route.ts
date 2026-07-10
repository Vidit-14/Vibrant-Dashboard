import { loadCombined } from "@/lib/returns";

export async function GET() {
  try {
    const rows = await loadCombined();
    return Response.json({ rows });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Vercel: allow up to 60s for large sheet/DB reads and file processing
export const maxDuration = 60;
