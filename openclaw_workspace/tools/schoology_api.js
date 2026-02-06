async function main() {
  const url = process.env.SCHOLOGY_TOOL_API_URL;
  if (!url) {
    console.error("SCHOLOGY_TOOL_API_URL is not set.");
    process.exit(1);
  }

  const apiKey = process.env.SCHOLOGY_TOOL_API_KEY;
  const raw = process.argv.slice(2).join(" ").trim();
  if (!raw) {
    console.error("Usage: node schoology_api.js '<json_payload>'");
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    console.error("Invalid JSON payload.");
    process.exit(1);
  }

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  console.log(text);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
