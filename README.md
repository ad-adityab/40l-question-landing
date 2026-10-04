# The 40L Question: landing page + Ask the 40L

The landing page for **The 40L Question** (*Answers worth your fee.*), a student-built page that helps ISB Class of 2027 students during placements. It keeps only the official answers from the CAC and CAS, puts every deadline on a countdown, and gives a short daily brief. The product itself lives at https://thebettercampus.netlify.app/40L_ROI/.

This repo is coursework for the GenAI class (Tasks 3 and 4) and is not an official ISB, CAS or CAC product.

## What's here
| Path | What it is |
|---|---|
| `index.html` | The one-page site: hero, problem, how it works, what it won't do, launch post, the **Ask the 40L** demo, CTA. Plain HTML/CSS/JS, no build step. |
| `api/ask.js` | Vercel serverless function. Takes a question, finds the 5 closest official entries in Supabase, asks Gemini to answer **only** from them, enforces the guardrails, stores the exchange in Supabase, returns the answer. |
| `api/stats.js` | Read-back for the page: questions asked and the share answered from an official source, counted from the Supabase table. |
| `api/_lib.js` | Shared code: system prompt, retrieval, Gemini call, Supabase calls, caps, guardrail checks. |
| `supabase/schema.sql` | The two tables (`answer_entries`, `exchanges`), with Row Level Security on. |
| `tests/` | Local tests with Gemini and Supabase mocked (`npm test`), plus a local dev server (`npm run dev`). |

The answer entries themselves (the name-free Placement Policy and general-process answers) are loaded straight into Supabase and are **not** stored in this repo.

## Keys
No key is in this repo. The function reads three Vercel environment variables:
`GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

## Guardrails and limits
- Answers only from the official entries, citing which ones; otherwise "Not answered yet. Ask in the group."
- Refuses pay/CTC questions (points to the placement portal), questions about people, and anything off-topic. A server-side check also blocks any pay figure in an answer.
- Gemini `gemini-2.5-flash-lite`, at most 300 output tokens.
- 5 questions per visitor (random browser id), 15 per network per day (a one-way hash, no raw IP), 300 per day for the whole site.
