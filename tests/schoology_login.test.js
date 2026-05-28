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

test("Microsoft-configured remote Schoology form starts SAML and uses BCPS local fields", async () => {
  await withPage(async (page) => {
    await page.route("https://bcps.schoology.com/login/saml?**", async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `
          <form onsubmit="
            window.submittedB2c = {
              username: document.querySelector('#signInName').value,
              password: document.querySelector('#password').value
            };
            event.preventDefault();
            document.body.innerHTML =
              '<h1>Stay signed in?</h1><button id=&quot;idSIButton9&quot; onclick=&quot;window.clickedKmsi = true&quot;>Yes</button>';
          ">
            <button id="AzureADBCPSOrgExchange" type="button" onclick="window.clickedAzure = true">
              Login with your BCPS Account
            </button>
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
    assert.deepEqual(await page.evaluate(() => window.submittedB2c), {
      username: "bcps-student",
      password: "saved-password",
    });
    assert.equal(await page.evaluate(() => window.clickedAzure), undefined);
    assert.equal(await page.evaluate(() => window.clickedKmsi), true);
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
