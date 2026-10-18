import test from "node:test";
import assert from "node:assert/strict";
import { advanceSavedSessionSignIn } from "../src/schoology.js";
import { readOriginalProfileSource } from "../src/schoology_profile_source.js";

function passwordPage({ filled, account }) {
  let submissions = 0;
  const page = {
    url: () => "https://login.microsoftonline.com/tenant/login",
    waitForTimeout: async () => {},
    locator(selector) {
      const locator = {
        first: () => locator,
        isVisible: async () => selector.includes("passwd"),
        count: async () => selector === "input[type='password']" ? 1 : 0,
        focus: async () => {},
        evaluate: async fn => { const value = fn({ value: filled ? "opaque-native-credential" : "" }); assert.equal(typeof value,"boolean"); return value; },
        textContent: async () => account,
        fill: async () => { throw Error("Password must never be manually filled"); },
        inputValue: async () => { throw Error("Password must never be read"); },
        click: async () => { assert.equal(selector,"#idSIButton9"); submissions++; },
      };
      return locator;
    },
  };
  return { page, submissions: () => submissions };
}

test("sign-in routing never reads/fills passwords and submits only an opaque exact-account autofill", async () => {
  for (const example of [{filled:false,account:"mms199@bcps.org",expected:0},{filled:true,account:"other@bcps.org",expected:0},{filled:true,account:"mms199@bcps.org",expected:1}]) {
    const fake=passwordPage(example);
    const result=await advanceSavedSessionSignIn(fake.page,"mms199@bcps.org");
    assert.equal(fake.submissions(),example.expected);
    assert.equal(result.passwordSubmitted,Boolean(example.expected));
    assert.equal(JSON.stringify(result).includes("opaque-native-credential"),false);
  }
});

test("unqualified provider and main-profile path refuse before credentials or browser launch", async () => {
  const page={url:()=>"https://example.com/login",locator:()=>{throw Error("Untrusted page accessed");}};
  assert.equal((await advanceSavedSessionSignIn(page,"mms199@bcps.org")).state,"UNQUALIFIED_AUTH_ORIGIN");
  await assert.rejects(readOriginalProfileSource({databasePath:"/owned/agent.db",browserProfileDirectory:"/main/chrome"}),/Separate app-owned/);
});
