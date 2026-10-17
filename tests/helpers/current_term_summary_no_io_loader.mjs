import { resolve as resolveCurrentSummary } from "./current_summary_no_services_loader.mjs";

const io = /^(?:node:)?(?:fs(?:\/promises)?|child_process|worker_threads|http|https|http2|net|tls|dns(?:\/promises)?|dgram|sqlite)$/;
const services = /^(?:dotenv|node-cron|nodemailer|twilio)(?:\/|$)/;

// A test import-graph guard, not a sandbox for arbitrary host-supplied code.
export async function resolve(specifier, context, nextResolve) {
  if (io.test(specifier) || services.test(specifier)) {
    throw new Error("CURRENT-TERM-ADAPTER-IO-IMPORT-BLOCKED");
  }
  return resolveCurrentSummary(specifier, context, nextResolve);
}
