import fetch from "node-fetch";

const OPENAI_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini-2024-07-18";
const FAKE_MODE = (process.env.FAKE_OPENAI === "true");

export interface CityInfo {
  city: string;
  country: string | null;
  languages: string[];
  population: number | null;
  foundedYear: number | null;
}

interface OpenAIResponse {
  choices: {
    message: {
      parsed?: CityInfo;
      content?: string;
    };
  }[];
}

function fakeCityData(city: string): CityInfo {
  return {
    city,
    country: "Unknown",
    languages: ["Unknown"],
    population: 100000,
    foundedYear: 1500
  };
}

function extractJSON(text: string): any | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function fetchCityData(cityName: string): Promise<CityInfo> {
  if (FAKE_MODE) return fakeCityData(cityName);

  const prompt = `
Return VALID JSON following the schema.
If a value is unknown, set null.

Schema:
{
  "city": string,
  "country": string|null,
  "languages": [string],
  "population": integer|null,
  "foundedYear": integer|null
}

City: "${cityName}"
  `;

  const body = {
    model: OPENAI_MODEL,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "city_schema",
        schema: {
          type: "object",
          properties: {
            city: { type: "string" },
            country: { type: ["string", "null"] },
            languages: { type: "array", items: { type: "string" }},
            population: { type: ["integer", "null"] },
            foundedYear: { type: ["integer", "null"] }
          },
          required: ["city", "country", "languages", "population", "foundedYear"]
        }
      }
    },
    messages: [
      { role: "system", content: "Return ONLY JSON." },
      { role: "user", content: prompt }
    ],
    temperature: 0
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const json = (await res.json()) as OpenAIResponse;

  const parsed = json.choices?.[0]?.message?.parsed;
  const content = json.choices?.[0]?.message?.content ?? "";

  console.log("[OPENAI] parsed exists?", !!parsed);
  console.log("[OPENAI] content=", content);

  // 1. Si parsed existe → perfecto
  if (parsed) return parsed;

  // 2. Si no, intentar extraer JSON del content
  const fallback = extractJSON(content);
  if (fallback) return fallback as CityInfo;

  // 3. Último recurso → devolver valores nulos sin romper el juego
  console.log("[OPENAI] WARNING: respuesta sin JSON válido. Usando fallback.");

  return {
    city: cityName,
    country: null,
    languages: [],
    population: null,
    foundedYear: null
  };
}

export async function isValidCity(cityName: string): Promise<boolean> {
  // Empty or very short answers are not cities
  if (!cityName || cityName.trim().length < 2) {
    return false;
  }

  if (FAKE_MODE) {
    // In fake mode, consider any non-empty string as a valid city
    return true;
  }

  const prompt = `Determine if "${cityName}" is the name of a real city or town. Consider: - Official city names in any language - Historical city names - Well-known towns and municipalities - Capital cities and major urban centers Return ONLY "true" if it is a real city/town, or "false" if it is not (e.g., countries, regions, landmarks, fictional places, or random words).`;

  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: "You are a geography expert. Return only 'true' or 'false'." },
      { role: "user", content: prompt }
    ],
    temperature: 0,
    max_tokens: 10
  };

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const json = (await res.json()) as OpenAIResponse;
    const content = json.choices?.[0]?.message?.content?.toLowerCase().trim();

    console.log(`[OPENAI] City validation: "${cityName}" = ${content}`);

    return content === "true";
  } catch (err) {
    console.error("[OPENAI] Error validating city:", err);
    // Fallback: consider it valid if OpenAI fails
    return true;
  }
}

export async function areCitiesEquivalent(city1: string, city2: string): Promise<boolean> {
  if (FAKE_MODE) {
    const norm1 = city1.toLowerCase().trim();
    const norm2 = city2.toLowerCase().trim();
    return norm1 === norm2;
  }

  const prompt = `Analyze if these two city names refer to the same city or are equivalent names for the same geographical location. City 1: "${city1}" City 2: "${city2}" Consider: - Different language names (e.g., "New York" vs "Nueva York") - Alternative names and spellings (e.g., "Mumbai" vs "Bombay") - Abbreviations and common variations - Historical name changes Return ONLY "true" if they refer to the same city, or "false" if they are different cities.`;

  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: "You are a geography expert. Return only 'true' or 'false'." },
      { role: "user", content: prompt }
    ],
    temperature: 0,
    max_tokens: 10
  };

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const json = (await res.json()) as OpenAIResponse;
    const content = json.choices?.[0]?.message?.content?.toLowerCase().trim();

    console.log(`[OPENAI] City comparison: "${city1}" vs "${city2}" = ${content}`);

    return content === "true";
  } catch (err) {
    console.error("[OPENAI] Error comparing cities:", err);
    return false;
  }
}