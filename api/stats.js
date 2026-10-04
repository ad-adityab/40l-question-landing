// GET /api/stats  ->  { asked, answered, share_answered }
// The read-back shown on the page, computed from the Supabase exchanges table.
// asked          = real questions (answered + not_found + refused); capped and error rows are excluded.
// share_answered = of the placement questions (answered + not_found), the % answered from an official
//                  source. Refused questions (pay, people, off-topic) are left out of the share.
import { sbCount, sbSelect } from "./_lib.js";

export default async function handler(req, res) {
  try {
    const [answered, notFound, refused] = await Promise.all([
      sbCount("exchanges", "outcome=eq.answered"),
      sbCount("exchanges", "outcome=eq.not_found"),
      sbCount("exchanges", "outcome=eq.refused")
    ]);
    const asked = answered + notFound + refused;
    // Cost check: average tokens and latency per real question (Gemini was called), from the stored rows.
    const rows = await sbSelect("exchanges?select=input_tokens,output_tokens,latency_ms&outcome=in.(answered,not_found,refused)&order=id.desc&limit=500");
    const avg = k => rows.length ? Math.round(rows.reduce((a, r) => a + (r[k] || 0), 0) / rows.length) : 0;
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json({
      asked,
      answered,
      share_answered: (answered + notFound) ? Math.round((answered / (answered + notFound)) * 100) : 0,
      avg_input_tokens: avg("input_tokens"),
      avg_output_tokens: avg("output_tokens"),
      avg_latency_ms: avg("latency_ms")
    });
  } catch (err) {
    console.error("stats failed:", err.message);
    return res.status(502).json({ error: "stats unavailable" });
  }
}
