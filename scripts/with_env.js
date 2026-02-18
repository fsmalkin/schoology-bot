import { spawn } from "node:child_process";

function usage() {
  console.error("Usage: node scripts/with_env.js <env_file> <command> [args...]");
  process.exit(1);
}

const [, , envFile, command, ...args] = process.argv;

if (!envFile || !command) {
  usage();
}

const child = spawn(command, args, {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    DOTENV_CONFIG_PATH: envFile,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
