import fs from "node:fs";
import { spawnSync } from "node:child_process";

// Never unlink this file: cooperating containers must lock the same inode.
export function claimLinuxProcessLease(filename) {
  const fd = fs.openSync(filename, "a");
  let claimed = false;
  try {
    // FD3 is a duplicate of this open file description. The nonblocking helper
    // can exit while Node retains the kernel lock through its original FD.
    const result = spawnSync("/usr/bin/flock", ["--exclusive", "--nonblock", "3"], {
      stdio: ["ignore", "ignore", "ignore", fd],
      env: {},
      timeout: 5000,
    });
    if (result.error || result.status !== 0) {
      throw new Error("Telegram process lease unavailable or occupied; refusing startup.");
    }
    const held = fs.fstatSync(fd, { bigint: true });
    const current = fs.statSync(filename, { bigint: true });
    if (held.dev !== current.dev || held.ino !== current.ino) {
      throw new Error("Telegram process lease file changed; refusing startup.");
    }
    claimed = true;
    let released = false;
    return {
      protocol: "linux-flock-v1",
      release() {
        if (!released) {
          released = true;
          fs.closeSync(fd);
        }
      },
    };
  } finally {
    if (!claimed) fs.closeSync(fd);
  }
}
