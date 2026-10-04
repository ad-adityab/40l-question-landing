// Test doubles: an in-memory Supabase (PostgREST subset) and a scripted Gemini.
// Installed by replacing globalThis.fetch, so the real handlers run unchanged.
import fs from "node:fs";

const SAMPLE_ENTRIES = [
  { id: "t-1", topic: "Clusters & schedule", question: "When is placement week?", answer: "30 Nov to 10 Dec 2026.", source: "Policy", keywords: ["placement week", "dates"], ask_variants: ["placement week dates"], active: true },
  { id: "t-2", topic: "Counters & shortlists", question: "How many counters do I get in each cluster?", answer: "P1: 20 application counters.", source: "Policy", keywords: ["counters", "P1"], ask_variants: ["how many applications can i make"], active: true },
  { id: "t-3", topic: "Portal & policy", question: "Where can we see the CTC for a role?", answer: "Check the portal.", source: "CAC", keywords: ["CTC", "salary"], ask_variants: ["how much does the role pay"], active: true }
];

export function installMocks({ entriesFile, gemini = "scripted", log = false } = {}) {
  const db = {
    answer_entries: entriesFile ? JSON.parse(fs.readFileSync(entriesFile, "utf8")).map(e => ({ ...e, active: true })) : SAMPLE_ENTRIES,
    exchanges: []
  };
  let nextId = 1;
  const geminiCalls = [];
  process.env.GEMINI_API_KEY ||= "test-key";
  process.env.SUPABASE_URL ||= "https://mock.supabase.co";
  process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

  function applyFilters(rows, params) {
    for (const [k, v] of params) {
      if (["select", "order", "limit"].includes(k)) continue;
      const [op, ...rest] = v.split("."); const val = rest.join(".");
      rows = rows.filter(r => {
        const x = r[k];
        if (op === "eq") return String(x) === val;
        if (op === "neq") return String(x) !== val;
        if (op === "gte") return String(x) >= val;
        if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").includes(String(x));
        return true;
      });
    }
    return rows;
  }

  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = (opts.method || "GET").toUpperCase();
    if (u.hostname.endsWith("supabase.co")) {
      const k = process.env.SUPABASE_SERVICE_KEY;
      if (opts.headers?.apikey !== k) return new Response("no", { status: 401 });
      if (!k.startsWith("sb_") && opts.headers?.Authorization !== `Bearer ${k}`) return new Response("no", { status: 401 });
      const table = u.pathname.split("/").pop();
      if (!db[table]) return new Response("no table", { status: 404 });
      if (method === "POST") {
        const row = JSON.parse(opts.body);
        db[table].push({ id: nextId++, created_at: new Date().toISOString(), ...row });
        return new Response(null, { status: 201 });
      }
      const rows = applyFilters(db[table], u.searchParams);
      if (method === "HEAD") return new Response(null, { status: 206, headers: { "content-range": `0-0/${rows.length}` } });
      return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.hostname === "generativelanguage.googleapis.com") {
      if (opts.headers?.["x-goog-api-key"] !== process.env.GEMINI_API_KEY) return new Response("bad key", { status: 403 });
      const body = JSON.parse(opts.body);
      geminiCalls.push(body);
      const prompt = body.contents[0].parts[0].text;
      const question = prompt.split("STUDENT QUESTION:\n")[1] || "";
      const ids = [...prompt.matchAll(/^\[([^\]]+)\]/gm)].map(m => m[1]);
      let out;
      const mode = typeof gemini === "function" ? null : gemini;
      if (typeof gemini === "function") out = gemini(question, ids);
      else if (/salary|ctc|package|pay\b/i.test(question)) out = { status: "refused", answer: "I can't discuss pay. Check the placement portal for each role's details.", cited_ids: [] };
      else if (/will i get|my chances|should i pick/i.test(question)) out = { status: "refused", answer: "I can't predict outcomes or give personal career advice. I answer questions about ISB's placement rules and process, like counters, deadlines and offers.", cited_ids: [] };
      else if (/python|poem|ignore|recipe/i.test(question)) out = { status: "refused", answer: "I only answer questions about the ISB placement process.", cited_ids: [] };
      else if (ids.length) out = { status: "answered", answer: "Mock answer from " + ids[0] + ".", cited_ids: [ids[0]] };
      else out = { status: "not_found", answer: "Not answered yet. Ask in the group.", cited_ids: [] };
      if (log) console.log("  [gemini mock]", mode, JSON.stringify(out));
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }],
        usageMetadata: { promptTokenCount: Math.round(prompt.length / 4) + 600, candidatesTokenCount: Math.round(out.answer.length / 4) + 12 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("unexpected fetch " + url);
  };
  return { db, geminiCalls };
}

// Minimal Vercel-style req/res for calling a handler directly.
export async function call(handler, { method = "POST", body = {}, ip = "1.2.3.4" } = {}) {
  const req = { method, body, headers: { "x-forwarded-for": ip }, socket: {} };
  let statusCode = 200, payload, headers = {};
  const res = {
    status(c) { statusCode = c; return res; },
    json(o) { payload = o; return res; },
    setHeader(k, v) { headers[k] = v; }
  };
  await handler(req, res);
  return { status: statusCode, body: payload, headers };
}
