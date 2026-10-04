// POST /api/ask  { question: string, visitor_id: string }
// Retrieves the closest official entries from Supabase, asks Gemini to answer only from them,
// enforces the guardrails, stores the exchange in Supabase and returns the answer.
import {
  MODEL, PER_VISITOR_CAP, PER_NETWORK_DAILY_CAP, GLOBAL_DAILY_CAP, MAX_QUESTION_CHARS,
  loadEntries, rank, askGemini, enforce, sbCount, sbInsert, hashNetwork, VISITOR_RE, todayStartIso
} from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  for (const k of ["GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_KEY"]) {
    if (!process.env[k]) return res.status(500).json({ error: "The demo is not configured yet." });
  }

  const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});
  const question = String(body.question || "").replace(/\s+/g, " ").trim();
  const visitor = String(body.visitor_id || "");
  if (!VISITOR_RE.test(visitor)) return res.status(400).json({ error: "Missing visitor id. Reload the page and try again." });
  if (question.length < 3) return res.status(400).json({ error: "Type a question first." });
  if (question.length > MAX_QUESTION_CHARS) return res.status(400).json({ error: `Keep it under ${MAX_QUESTION_CHARS} characters.` });

  const net = hashNetwork(req);
  const since = encodeURIComponent(todayStartIso());
  const started = Date.now();

  try {
    // ---- caps: only real answers count (capped and error rows are stored but never count) ----
    const REAL = "outcome=in.(answered,not_found,refused)";
    const [mine, network, today] = await Promise.all([
      sbCount("exchanges", `visitor_id=eq.${visitor}&${REAL}`),
      sbCount("exchanges", `net_hash=eq.${net}&created_at=gte.${since}&${REAL}`),
      sbCount("exchanges", `created_at=gte.${since}&${REAL}`)
    ]);
    let capMsg = null;
    if (mine >= PER_VISITOR_CAP) capMsg = `You've used all ${PER_VISITOR_CAP} questions for this demo. The full FAQ is on The 40L Question page.`;
    else if (network >= PER_NETWORK_DAILY_CAP) capMsg = "This network has reached today's limit for the demo. Try again tomorrow.";
    else if (today >= GLOBAL_DAILY_CAP) capMsg = "The demo has reached today's limit. Try again tomorrow.";
    if (capMsg) {
      await sbInsert("exchanges", row({ visitor, net, question, answer: capMsg, outcome: "capped", started }));
      return res.status(429).json({ status: "capped", answer: capMsg, remaining: 0 });
    }

    // ---- retrieve, generate, enforce ----
    const entries = await loadEntries();
    const candidates = rank(question, entries);
    const g = await askGemini(question, candidates);
    const out = enforce(g.parsed, candidates);

    await sbInsert("exchanges", row({
      visitor, net, question, answer: out.answer, outcome: out.status, matched: out.cited,
      candidates: candidates.map(c => c.id), inTok: g.inputTokens, outTok: g.outputTokens, model: g.model, started
    }));

    const cited = out.cited.map(id => {
      const e = entries.find(x => x.id === id);
      return e ? { id, question: e.question, source: e.source } : { id };
    });
    return res.status(200).json({
      status: out.status,
      answer: out.answer,
      cited,
      remaining: Math.max(0, PER_VISITOR_CAP - mine - 1)
    });
  } catch (err) {
    console.error("ask failed:", err.message);
    try { await sbInsert("exchanges", row({ visitor, net, question, answer: String(err.message).slice(0, 300), outcome: "error", started })); } catch {}
    // A short, non-secret code (e.g. "gemini 429") helps debugging without exposing anything.
    return res.status(502).json({ error: "Something went wrong. Try again in a minute.", code: String(err.message).split(":")[0].slice(0, 40) });
  }
}

function row({ visitor, net, question, answer, outcome, matched = [], candidates = [], inTok = 0, outTok = 0, model = MODEL, started }) {
  return {
    visitor_id: visitor,
    net_hash: net,
    input: question,
    output: answer,
    outcome,
    matched_ids: matched,
    candidate_ids: candidates,
    input_tokens: inTok,
    output_tokens: outTok,
    model,
    latency_ms: Date.now() - started
  };
}
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
