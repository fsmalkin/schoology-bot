import test from "node:test";
import assert from "node:assert/strict";
import { shouldSendLoginAlert } from "../src/tasks.js";

test("shouldSendLoginAlert sends on first login failure", () => {
  const state = { meta: {} };
  const error = new Error("Login failed using configured sign-in provider.");
  const shouldSend = shouldSendLoginAlert(state, error, {
    now: "2026-02-22T12:00:00.000Z",
    cooldownMinutes: 360,
  });
  assert.equal(shouldSend, true);
});

test("shouldSendLoginAlert suppresses repeats within cooldown", () => {
  const state = {
    meta: {
      loginAlert: {
        lastSentAt: "2026-02-22T12:00:00.000Z",
        lastError: "Login failed using configured sign-in provider.",
      },
    },
  };
  const error = new Error("Login failed using configured sign-in provider.");
  const shouldSend = shouldSendLoginAlert(state, error, {
    now: "2026-02-22T12:30:00.000Z",
    cooldownMinutes: 360,
  });
  assert.equal(shouldSend, false);
});

test("shouldSendLoginAlert sends if error text changes", () => {
  const state = {
    meta: {
      loginAlert: {
        lastSentAt: "2026-02-22T12:00:00.000Z",
        lastError: "Login failed using configured sign-in provider.",
      },
    },
  };
  const error = new Error("Login flow not recognized.");
  const shouldSend = shouldSendLoginAlert(state, error, {
    now: "2026-02-22T12:30:00.000Z",
    cooldownMinutes: 360,
  });
  assert.equal(shouldSend, true);
});

test("shouldSendLoginAlert sends after a successful scrape", () => {
  const state = {
    meta: {
      loginAlert: {
        lastSentAt: "2026-02-22T12:00:00.000Z",
        lastSuccessAt: "2026-02-22T12:15:00.000Z",
        lastError: "Login failed using configured sign-in provider.",
      },
    },
  };
  const error = new Error("Login failed using configured sign-in provider.");
  const shouldSend = shouldSendLoginAlert(state, error, {
    now: "2026-02-22T12:20:00.000Z",
    cooldownMinutes: 360,
  });
  assert.equal(shouldSend, true);
});

test("shouldSendLoginAlert sends after cooldown elapses", () => {
  const state = {
    meta: {
      loginAlert: {
        lastSentAt: "2026-02-22T00:00:00.000Z",
        lastError: "Login failed using configured sign-in provider.",
      },
    },
  };
  const error = new Error("Login failed using configured sign-in provider.");
  const shouldSend = shouldSendLoginAlert(state, error, {
    now: "2026-02-22T07:00:00.000Z",
    cooldownMinutes: 360,
  });
  assert.equal(shouldSend, true);
});

