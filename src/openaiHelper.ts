import fetch from "node-fetch";

const OPENAI_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini-2024-07-18";
const FAKE_MODE = (process.env.FAKE_OPENAI === "true");

interface CityInfo {
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
    };
  }[];
}

if (!OPENAI_KEY && !FAKE_MODE) {
  console.warn("WARNING: OPENAI_API_KEY is not set. OpenAI calls will fail.");
}

function fakeCityData(cityName: string): CityInfo {
  return {
    city: cityName,
    country: "Unknown",
    languages: ["Unknown"],
    population: 500000,
    foundedYear: 1500,
  };
}

export async function fetchCityData(cityName: string): Promise<CityInfo> {
  if (FAKE_MODE) {
    return fakeCityData(cityName);
  }

  if (!OPENAI_KEY) {
    throw new Error("OPENAI_API_KEY missing.");
  }

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
            languages: {
              type: "array",
              items: { type: "string" }
            },
            population: { type: ["integer", "null"] },
            foundedYear: { type: ["integer", "null"] }
          },
          required: ["city", "country", "languages", "population", "foundedYear"]
        }
      }
    },
    messages: [
      {
        role: "user",
        content: `Give factual information about the city "${cityName}".`
      }
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

  // ❗ TypeScript fix: explicitly type the result  
  const json = (await res.json()) as OpenAIResponse;

  if (!res.ok) {
    throw new Error(`OpenAI error: ${res.status} ${JSON.stringify(json)}`);
  }

  console.log("Raw OpenAI full response:", JSON.stringify(json, null, 2));

  const data = json.choices?.[0]?.message?.parsed;
  if (!data) {
    throw new Error("Missing parsed JSON from OpenAI response.");
  }

  return data;
}
