// Vercel Serverless Function — shared store for Datalytics edits (công thức FE / đề xuất / comment).
// Uses Vercel KV / Upstash Redis REST API. Set env: KV_REST_API_URL, KV_REST_API_TOKEN.
const KEY = 'datalytics_notes';

async function kvGet() {
  const base = process.env.KV_REST_API_URL, tok = process.env.KV_REST_API_TOKEN;
  if (!base || !tok) return {};
  const r = await fetch(`${base}/get/${KEY}`, { headers: { Authorization: `Bearer ${tok}` } });
  const j = await r.json().catch(() => ({}));
  if (!j || j.result == null) return {};
  try { return JSON.parse(j.result); } catch { return {}; }
}
async function kvSet(obj) {
  const base = process.env.KV_REST_API_URL, tok = process.env.KV_REST_API_TOKEN;
  if (!base || !tok) return;
  await fetch(`${base}/set/${KEY}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'text/plain' },
    body: JSON.stringify(obj),
  });
}

export default async function handler(req, res) {
  try {
    if (!process.env.KV_REST_API_URL) { res.status(200).json({ _nostore: true }); return; }
    if (req.method === 'GET') { res.status(200).json(await kvGet()); return; }
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      if (!body || typeof body !== 'object') { let raw=''; for await (const c of req) raw += c; try { body = JSON.parse(raw); } catch { body = {}; } }
      const cur = await kvGet();
      if (body.all && typeof body.all === 'object') { Object.assign(cur, body.all); }
      else if (body.k) { if (body.v === '' || body.v == null) delete cur[body.k]; else cur[body.k] = body.v; }
      await kvSet(cur);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: 'method' });
  } catch (e) { res.status(500).json({ error: String(e) }); }
}
