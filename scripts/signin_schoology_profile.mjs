import fs from "node:fs";
import { readOriginalProfileSource, SourceSessionRequired } from "../src/schoology_profile_source.js";
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""));
const statusPath = process.argv[3];
const write = state => fs.writeFileSync(statusPath, JSON.stringify({ state, at: new Date().toISOString(), studentProfileId: config.studentProfileId, currentTerm: config.currentTerm }));
try {
  write("OPENING_OFFICIAL_SIGNIN");
  const source = await readOriginalProfileSource(config, { interactive: true, onAuthRequired: () => write("AUTH_REQUIRED_IN_APP_CHROME") });
  write(source.snapshot.complete ? "SIGNED_IN_SOURCE_VERIFIED" : "SOURCE_COVERAGE_INCOMPLETE");
} catch (error) { write(error instanceof SourceSessionRequired ? "AUTH_REQUIRED_WINDOW_CLOSED" : "SETUP_FAILED_NO_SECRET_LOGGED"); process.exitCode = 1; }
