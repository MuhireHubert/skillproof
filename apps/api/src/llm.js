// Minimal Anthropic Messages API client. Output is always treated as untrusted and validated by callers.
export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return JSON');
  return JSON.parse(text.slice(start, end + 1));
}

export function createLlm({ apiKey, model, fetchImpl = fetch, baseUrl = 'https://api.anthropic.com' }) {
  if (!apiKey) return null;
  return {
    async json({ system, user, maxTokens = 1500 }) {
      const res = await fetchImpl(baseUrl + '/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      });
      if (!res.ok) throw new Error('The AI service returned status ' + res.status);
      const data = await res.json();
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      return extractJson(text);
    },
  };
}
