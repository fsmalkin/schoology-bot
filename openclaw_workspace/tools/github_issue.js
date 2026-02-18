async function main() {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) {
    console.error("GITHUB_REPO or GITHUB_TOKEN is not set.");
    process.exit(1);
  }

  const raw = process.argv.slice(2).join(" ").trim();
  if (!raw) {
    console.error("Usage: node github_issue.js '<json_payload>'");
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    console.error("Invalid JSON payload.");
    process.exit(1);
  }

  const title = String(payload.title || "").trim();
  const body = String(payload.body || "").trim();
  if (!title || !body) {
    console.error("title and body are required.");
    process.exit(1);
  }

  const issuePayload = {
    title,
    body,
  };
  if (Array.isArray(payload.labels) && payload.labels.length > 0) {
    issuePayload.labels = payload.labels;
  }

  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(issuePayload),
  });

  const text = await res.text();
  if (!res.ok) {
    console.log(JSON.stringify({ ok: false, error: text }));
    process.exit(1);
  }

  try {
    const json = JSON.parse(text);
    console.log(JSON.stringify({ ok: true, url: json.html_url, number: json.number }));
  } catch (err) {
    console.log(JSON.stringify({ ok: true, raw: text }));
  }
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
