/**
 * Cross-platform replacement for the old `sh -c` preinstall guard.
 *
 * It does two things the original did, without needing a POSIX shell:
 * - removes stray npm/yarn lockfiles so only pnpm-lock.yaml is respected
 * - refuses to install under npm or yarn, which would corrupt the workspace
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

for (const lockfile of ["package-lock.json", "yarn.lock"]) {
  const target = path.join(root, lockfile);
  if (existsSync(target)) rmSync(target, { force: true });
}

const agent = process.env.npm_config_user_agent ?? "";
if (!agent.startsWith("pnpm/")) {
  console.error("Use pnpm instead of npm or yarn. Install it with: npm install -g pnpm");
  process.exit(1);
}
