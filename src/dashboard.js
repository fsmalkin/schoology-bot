import "dotenv/config";
import { getConfig } from "./config.js";
import { createDashboardServer } from "./dashboard_server.js";

const config = getConfig();
const port = Number(process.env.DASHBOARD_PORT || config?.dashboard?.port || 8787);
const server = createDashboardServer({ config });

server.start(port);

process.on("SIGINT", async () => {
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.stop();
  process.exit(0);
});
