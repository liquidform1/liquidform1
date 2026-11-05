// Liquidform AI chat via OpenRouter. The key stays server-side.
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

function toOpenAIMessages(system, messages) {
  const out = [{ role: "system", content: system || "You are Liquidform AI, a helpful assistant." }];
  for (const m of messages) {
    if (Array.isArray(m.images) && m.images.length) {
      const content = [{ type: "text", text: m.text || "" }];
      for (const url of m.images) if (url) content.push({ type: "image_url", image_url: { url } });
      out.push({ role: m.role, content });
    } else out.push({ role: m.role, content: m.text || "" });
  }
  return out;
}

async function chat(body) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { status: 500, body: { detail: "OPENROUTER_API_KEY is not configured on the server." } };
  const messages = (body && body.messages) || [];
  if (!Array.isArray(messages) || !messages.length) return { status: 400, body: { detail: "messages is required" } };
  try {
    const r = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`, "Content-Type": "application/json",
        "HTTP-Referer": process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || "https://liquidform.onrender.com",
        "X-Title": "Liquidform",
      },
      body: JSON.stringify({ model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL, messages: toOpenAIMessages(body.system, messages), temperature: 0.7 }),
    });
    const data = await r.json();
    if (r.status >= 400 || data.error) return { status: 502, body: { detail: (data.error && (data.error.message || data.error)) || `OpenRouter error (${r.status})` } };
    return { status: 200, body: { reply: data.choices?.[0]?.message?.content || "(no response)" } };
  } catch (e) { return { status: 502, body: { detail: String((e && e.message) || e) } }; }
}

module.exports = { chat };
