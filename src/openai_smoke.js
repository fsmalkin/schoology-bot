import "dotenv/config";
import OpenAI from "openai";

function extractText(response) {
  if (response?.output_text) return response.output_text;
  const output = response?.output;
  if (!Array.isArray(output)) return "";
  return output
    .map((item) => {
      if (!item) return "";
      if (item.type === "output_text" && item.text) return item.text;
      if (item.type === "message" && Array.isArray(item.content)) {
        return item.content
          .map((part) => (part?.text ? part.text : ""))
          .join("");
      }
      return "";
    })
    .join("");
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in .env");
  }

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: "gpt-5.2",
    input: "Return the single word: ok",
  });

  const text = extractText(response).trim();
  console.log(text || "(no text returned)");
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
