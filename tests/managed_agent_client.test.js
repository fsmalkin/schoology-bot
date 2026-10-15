import test from "node:test";
import assert from "node:assert/strict";
import { parseServerSentEvents } from "../src/managed_agent_client.js";
import { streamBytes, sseEvent } from "./helpers/managed_stream_fixture.js";

async function parse(text, chunkSize = 1) {
  const events = [];
  for await (const event of parseServerSentEvents(streamBytes(text, chunkSize))) events.push(event);
  return events;
}

for (const type of ["agent.message", "agent.custom_tool_use", "session.status_idle"]) {
  test(`SSE event name supplies missing JSON type for ${type}`, async () => {
    const [event] = await parse(sseEvent(type, { id: "evt_fixture" }));
    assert.equal(event.type, type);
    assert.equal(event.event, type);
    assert.equal(event.id, "evt_fixture");
  });
}

test("SSE preserves explicitly supplied JSON type and event metadata", async () => {
  for (const type of ["agent.message", "", null]) {
    const [event] = await parse(sseEvent("session.status_idle", { type, event: "existing" }));
    assert.equal(event.type, type);
    assert.equal(event.event, "existing");
  }
});

for (const [name, newline] of [["LF", "\n"], ["CRLF", "\r\n"], ["CR", "\r"]]) {
  test(`SSE ${name} framing preserves multiline JSON and UTF-8 at every chunk size`, async () => {
    const first = `: keepalive${newline}event: agent.message${newline}data: {"type":"agent.message",${newline}data: "content":[{"type":"text","text":"caf\u00e9 \u2603"}]}${newline}${newline}`;
    const wire = first + sseEvent("session.status_idle", { type: "session.status_idle", stop_reason: { type: "end_turn" } }, newline);
    for (let size = 1; size <= new TextEncoder().encode(wire).length; size += 1) {
      const events = await parse(wire, size);
      assert.equal(events.length, 2, `chunk size ${size}`);
      assert.equal(events[0].content[0].text, "caf\u00e9 \u2603");
      assert.equal(events[1].stop_reason.type, "end_turn");
    }
  });
}

test("SSE ignores comments and DONE while preserving a trailing complete JSON frame", async () => {
  const events = await parse(': ping\n\ndata: [DONE]\n\nevent: agent.message\ndata: {"type":"agent.message","id":"last"}');
  assert.deepEqual(events.map(event => event.id), ["last"]);
});

for (const raw of ['{"error":{"message":"private_fixture_marker"}}', "private_fixture_marker", "[DONE]", ""]) {
  test(`SSE error frame fails without echoing its payload (${raw ? "body " + raw.length : "empty"})`, async () => {
    await assert.rejects(() => parse(`event: error\ndata: ${raw}\n\n`), error => {
      assert.match(error.message, /Managed Agents stream error/);
      assert.doesNotMatch(error.message, /private_fixture_marker/);
      return true;
    });
  });
}

for (const type of ["agent.message", "agent.custom_tool_use", "session.status_idle"]) {
  test(`malformed recognized ${type} JSON fails without echoing data`, async () => {
    await assert.rejects(() => parse(`event: ${type}\ndata: {private_fixture_marker\n\n`), error => {
      assert.match(error.message, /invalid JSON/i);
      assert.doesNotMatch(error.message, /private_fixture_marker/);
      return true;
    });
  });
}

test("untyped and unknown non-JSON SSE retain the existing generic fallback", async () => {
  assert.deepEqual(await parse("data: hello\n\nevent: notice\ndata: world\n\n"), [
    { type: "message", data: "hello" }, { type: "notice", data: "world" },
  ]);
});

test("recognized events require JSON objects and cannot use the generic DONE sentinel", async () => {
  for (const raw of ["null", "[]", "true", "[DONE]", ""]) {
    await assert.rejects(() => parse(`event: session.status_idle\ndata: ${raw}\n\n`), /invalid JSON/i);
  }
  await assert.rejects(() => parse("event: session.status_idle\n\n"), /invalid JSON/i);
});

test("SSE parser cancels and unlocks the reader after a failure", async () => {
  let cancelled = 0;
  const readable = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("event: error\ndata: {}\n\n")); },
    cancel() { cancelled += 1; },
  });
  await assert.rejects(async () => {
    for await (const event of parseServerSentEvents(readable)) assert.fail(`unexpected event ${event.type}`);
  }, /Managed Agents stream error/);
  assert.equal(cancelled, 1);
  assert.equal(readable.locked, false);
});
