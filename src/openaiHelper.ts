import fetch from "node-fetch";

const OPENAI_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini-2024-07-18";
const FAKE_MODE = (process.env.FAKE_OPENAI === "true");
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

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
  // Clean the text first
  const cleanText = text.trim();

  // Try to find JSON object
  const match = cleanText.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const jsonStr = match[0];
    // Remove any trailing commas before closing braces/brackets
    const cleanedJson = jsonStr
      .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
      .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":'); // Quote unquoted keys

    return JSON.parse(cleanedJson);
  } catch (err) {
    console.log("[OPENAI] Error parsing JSON:", err);
    return null;
  }
}

export async function fetchCityData(cityName: string): Promise<CityInfo> {
  if (FAKE_MODE) return fakeCityData(cityName);

  const prompt = `Provide information about the city "${cityName}" in the following JSON format. If any information is unknown, use null. Be precise and factual.

{"city": "City Name", "country": "Country Name", "languages": ["Language1", "Language2"], "population": 123456, "foundedYear": 1234}`;

  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: "Return ONLY valid JSON. No explanations, no markdown, just the JSON object." },
      { role: "user", content: prompt }
    ],
    temperature: 0,
    max_tokens: 200
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
    city: cityName || "Unknown",
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

  const prompt = `Is "${cityName}" the name of a real city, town, or urban area? Answer only "true" or "false". Consider: cities, towns, municipalities, capitals, suburbs, historical cities, alternative spellings. Not countries, regions, landmarks, fictional places, companies, or random words. When in doubt, err on the side of "true" for urban settlements.`;

  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: "Return only 'true' or 'false'. Be permissive with city names and alternative spellings." },
      { role: "user", content: prompt }
    ],
    temperature: 0,
    max_tokens: 12
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
    // Fallback: consider it invalid if OpenAI fails (safer approach)
    return false;
  }
}

export async function areCitiesEquivalent(city1: string, city2: string): Promise<boolean> {
  if (FAKE_MODE) {
    const norm1 = city1.toLowerCase().trim();
    const norm2 = city2.toLowerCase().trim();
    return norm1 === norm2;
  }

  const prompt = `Do "${city1}" and "${city2}" refer to the same city? Consider different languages, alternative names, spellings, and historical changes. Answer only "true" or "false".`;

  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: "Return only 'true' or 'false'. No explanations." },
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