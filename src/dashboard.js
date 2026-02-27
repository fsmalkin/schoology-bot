import "dotenv/config";
import { getConfig } from "./config.js";
import { createDashboardServer } from "./dashboard_server.js";

const config = getConfig();
const port = Number(process.env.DASHBOARD_PORT || config?.dashboard?.port || 8787);
const host = String(process.env.DASHBOARD_HOST || "127.0.0.1").trim();
const server = createDashboardServer({ config });

server.start(port, host);

process.on("SIGINT", async () => {
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.stop();
  process.exit(0);
});
