import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { schoologyLoginTestHooks } from "../src/schoology.js";

async function withPage(fn) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    return await fn(page);
  } finally {
    await browser.close();
  }
}

test("Microsoft KMSI prompt chooses Yes to preserve the session", async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <h1>Stay signed in?</h1>
      <button id="idSIButton9" onclick="window.clickedKmsi = 'yes'">Yes</button>
      <button id="idBtn_Back" onclick="window.clickedKmsi = 'no'">No</button>
    `);

    const handled = await schoologyLoginTestHooks.maybeHandleMicrosoftKmsi(page);

    assert.equal(handled, true);
    assert.equal(await page.evaluate(() => window.clickedKmsi), "yes");
  });
});

test("Microsoft-configured auth can submit the native Schoology login form", async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <form onsubmit="window.submittedLogin = true; event.preventDefault();">
        <label>Email or Username <input id="edit-mail" name="mail" /></label>
        <label>Password <input id="edit-pass" type="password" /></label>
        <input id="edit-submit" type="submit" value="Log in" />
      </form>
    `);

    const didAttempt = await schoologyLoginTestHooks.runLoginFlow(
      page,
      {
        schoology: {
          username: "student@example.test",
          password: "correct horse battery staple",
          ssoSchool: "Baltimore County Public Schools",
        },
      },
      "microsoft"
    );

    assert.equal(didAttempt, true);
    assert.equal(await page.inputValue("#edit-mail"), "student@example.test");
    assert.equal(await page.inputValue("#edit-pass"), "correct horse battery staple");
    assert.equal(await page.evaluate(() => window.submittedLogin), true);
  });
});

test("Microsoft-configured remote Schoology form starts SAML and prefers the BCPS account provider", async () => {
  await withPage(async (page) => {
    await page.route("https://bcps.schoology.com/login/saml?**", async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `
          <script>
            window.localFieldTouched = false;
            function showMicrosoftForm() {
              window.clickedAzure = true;
              document.body.innerHTML =
                '<form>' +
                '<input id="i0116" name="loginfmt" type="email" />' +
                '<input id="i0118" name="passwd" type="password" />' +
                '<button id="idSIButton9" type="button" onclick="window.submitCount = (window.submitCount || 0) + 1">Next</button>' +
                '</form>';
            }
          </script>
          <form>
            <button id="AzureADBCPSOrgExchange" type="button" onclick="showMicrosoftForm()">
              Login with your BCPS Account
            </button>
            <label>Sign in name <input id="signInName" oninput="window.localFieldTouched = true" /></label>
            <label>Password <input id="password" type="password" oninput="window.localFieldTouched = true" /></label>
          </form>
        `,
      });
    });

    await page.setContent(`
      <form>
        <label>Email or Username <input id="edit-mail" name="mail" /></label>
        <label>Password <input id="edit-pass" type="password" /></label>
        <input id="edit-school-nid" type="hidden" value="1434972705" />
        <input id="edit-submit" type="submit" value="Log in" />
      </form>
    `);

    const didAttempt = await schoologyLoginTestHooks.runLoginFlow(
      page,
      {
        schoology: {
          loginUrl: "https://bcps.schoology.com/login",
          gradesUrl: "https://bcps.schoology.com/grades/grades",
          username: "bcps-student",
          password: "saved-password",
          ssoSchool: "Baltimore County Public Schools",
        },
      },
      "microsoft"
    );

    assert.equal(didAttempt, true);
    assert.equal(await page.evaluate(() => window.clickedAzure), true);
    assert.equal(await page.evaluate(() => window.localFieldTouched), false);
    assert.equal(await page.inputValue("#i0116"), "bcps-student");
    assert.equal(await page.inputValue("#i0118"), "saved-password");
    assert.equal(await page.evaluate(() => window.submitCount), 2);
  });
});

test("BCPS credential rejection surfaces a clear saved-credentials error", async () => {
  await withPage(async (page) => {
    await page.route("https://bcps.schoology.com/login/saml?**", async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `
          <form onsubmit="
            event.preventDefault();
            document.body.textContent = 'The username or password provided in the request are invalid.';
          ">
            <label>Sign in name <input id="signInName" /></label>
            <label>Password <input id="password" type="password" /></label>
            <button id="next" type="submit">SIGN IN</button>
          </form>
        `,
      });
    });

    await page.setContent(`
      <form>
        <label>Email or Username <input id="edit-mail" name="mail" /></label>
        <label>Password <input id="edit-pass" type="password" /></label>
        <input id="edit-school-nid" type="hidden" value="1434972705" />
        <input id="edit-submit" type="submit" value="Log in" />
      </form>
    `);

    await assert.rejects(
      () =>
        schoologyLoginTestHooks.runLoginFlow(
          page,
          {
            schoology: {
              loginUrl: "https://bcps.schoology.com/login",
              gradesUrl: "https://bcps.schoology.com/grades/grades",
              username: "bcps-student",
              password: "stale-password",
              ssoSchool: "Baltimore County Public Schools",
            },
          },
          "microsoft"
        ),
      /BCPS login rejected the saved credentials/
    );
  });
});
