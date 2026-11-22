/**
 * Cross-platform development launcher.
 *
 * The previous dev script used `export NODE_ENV=development`, which only works
 * in bash. Windows cmd and PowerShell do not understand it. Setting the
 * variable here keeps the development logger pretty-printed on every platform.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "development" };

const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: here, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Exited with code ${code}`))));
  });

try {
  await run(["./build.mjs"]);
  await run(["--enable-source-maps", "./dist/index.mjs"]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
