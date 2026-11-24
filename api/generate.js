// Fonction serveur Vercel : /api/generate
// Variables d'environnement :
//   GEMINI_API_KEY  (clé Google AI Studio)  -> utilisée en priorité
//   GEMINI_MODEL    (facultatif, ex : gemini-3.5-flash)
//   ANTHROPIC_API_KEY (facultatif, secours ou alternative payante)
const hits = new Map();

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  // Limite simple : 15 demandes par minute et par visiteur
  const ip = (req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (list.length >= 15) return res.status(429).json({ error: 'rate' });
  list.push(now);
  hits.set(ip, list);

  const prompt = req.body && req.body.prompt;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) {
    return res.status(400).json({ error: 'bad' });
  }

  try {
    if (process.env.GEMINI_API_KEY) {
      const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
      const r = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 1500 }
          })
        }
      );
      if (!r.ok) {
        let detail = '';
        try { const b = await r.json(); detail = (b.error && b.error.message) || ''; } catch (e) {}
        return res.status(r.status === 429 ? 429 : 502).json({ error: 'gemini ' + r.status, detail: detail.slice(0, 200) });
      }
      const j = await r.json();
      const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      return res.status(200).json({ text: parts.map(p => p.text || '').join('') });
    }

    if (process.env.ANTHROPIC_API_KEY) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5-5',
          max_tokens: 1200,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!r.ok) return res.status(502).json({ error: 'upstream' });
      const j = await r.json();
      return res.status(200).json({ text: (j.content || []).map(c => c.text || '').join('') });
    }

    return res.status(500).json({ error: 'no key' });
  } catch (e) {
    return res.status(500).json({ error: 'fail' });
  }
};
