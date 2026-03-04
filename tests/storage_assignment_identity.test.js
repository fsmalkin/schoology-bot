import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { loadState, saveState, updateStateWithScrape } from "../src/storage.js";

test("updateStateWithScrape preserves one canonical key across title drift", () => {
  const state = {
    meta: { createdAt: "2026-03-02T10:00:00Z" },
    assignments: {},
  };

  updateStateWithScrape(state, "2026-03-02T11:00:00Z", [
    {
      course: "Novice Latin Level B MS",
      title: "February 23rd-Topic03B - Show What You Know",
      dueDate: "2026-02-23",
      status: "Missing",
      score: "",
      url: "https://bcps.schoology.com/assignment/8267055411",
      rawText: "",
      isMissing: true,
    },
  ]);

  updateStateWithScrape(state, "2026-03-03T11:00:00Z", [
    {
      course: "Novice Latin Level B MS",
      title: "February 23rd-Topic03B - Show What You Know (Graded: 2/27)",
      dueDate: "2026-02-23",
      status: "Missing",
      score: "",
      url: "https://bcps.schoology.com/assignment/8267055411",
      rawText: "",
      isMissing: true,
    },
  ]);

  const keys = Object.keys(state.assignments);
  assert.deepEqual(keys, ["assignment:8267055411"]);
  assert.equal(state.assignments["assignment:8267055411"].title.includes("(Graded: 2/27)"), true);
});

test("loadState merges legacy hash + canonical duplicate records into canonical key", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-identity-"));
  const statePath = path.join(tmpDir, "state.json");
  const base = [
    "https://bcps.schoology.com/assignment/8267055411",
    "Novice Latin Level B MS",
    "February 23rd-Topic03B - Show What You Know",
    "2026-02-23",
  ].join("|");
  const legacyHash = crypto.createHash("sha1").update(base).digest("hex");

  const payload = {
    meta: { createdAt: "2026-03-01T10:00:00Z" },
    assignments: {
      [legacyHash]: {
        key: legacyHash,
        course: "Novice Latin Level B MS",
        title: "February 23rd-Topic03B - Show What You Know",
        dueDate: "2026-02-23",
        status: "Missing",
        score: "",
        url: "https://bcps.schoology.com/assignment/8267055411",
        rawText: "",
        firstSeenAt: "2026-02-23T10:00:00Z",
        lastSeenAt: "2026-03-01T10:00:00Z",
        isMissing: false,
        resolvedAt: "2026-03-01T10:00:00Z",
      },
      "assignment:8267055411": {
        key: "assignment:8267055411",
        assignmentId: "8267055411",
        course: "Novice Latin Level B MS",
        title: "February 23rd-Topic03B - Show What You Know (Graded: 2/27)",
        dueDate: "2026-02-23",
        status: "Missing",
        score: "",
        url: "https://bcps.schoology.com/assignment/8267055411",
        rawText: "",
        firstSeenAt: "2026-02-23T10:00:00Z",
        lastSeenAt: "2026-03-02T10:00:00Z",
        isMissing: true,
      },
    },
  };
  fs.writeFileSync(statePath, JSON.stringify(payload, null, 2), "utf8");

  const loaded = loadState(statePath);
  const keys = Object.keys(loaded.assignments);
  assert.deepEqual(keys, ["assignment:8267055411"]);
  assert.equal(loaded.assignments["assignment:8267055411"].firstSeenAt, "2026-02-23T10:00:00Z");
  assert.equal(loaded.assignments["assignment:8267055411"].lastSeenAt, "2026-03-02T10:00:00Z");

  saveState(statePath, loaded);
  const saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.deepEqual(Object.keys(saved.assignments), ["assignment:8267055411"]);
});
