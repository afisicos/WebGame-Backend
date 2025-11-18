// src/openaiHelper.ts

const OPENAI_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/**
 * Pide a OpenAI datos estructurados de una ciudad.
 * Devuelve: { country, languages: string[], population: number|null, foundedYear: number|null }
 */
export async function fetchCityData(cityName: string) {
  const system = `You are an assistant that returns JSON with factual information about a city.`;
  const prompt = `Return a JSON object about the city named "${cityName}". Include fields:
{
  "city": string,
  "country": string or null,
  "languages": [strings] (primary languages spoken in that city/country),
  "population": integer or null (approximate population),
  "foundedYear": integer or null (year city founded or earliest known settlement)
}
If the city is ambiguous, pick the most likely internationally-known city with that name (explain in a "note" field). Provide only valid JSON in the response.`;

  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt }
    ],
    temperature: 0.0,
    max_tokens: 400
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${txt}`);
  }

  const json = await res.json();
  // extraer contenido del assistant
  const raw = json.choices?.[0]?.message?.content ?? "";
  // Intentar parsear JSON del contenido (puede venir con texto; intentamos extraer primer bloque JSON)
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON returned by OpenAI");
  }
  try {
    const parsed = JSON.parse(match[0]);
    return parsed;
  } catch (e) {
    throw new Error("Failed parse JSON from OpenAI: " + e);
  }
}
