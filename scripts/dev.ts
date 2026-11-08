/**
 * Development orchestrator.
 * Spawns the Vite frontend and the Deno Desktop app (with HMR).
 * Both processes are terminated when either exits or on SIGINT/SIGTERM.
 */

const DEV_URL = "http://127.0.0.1:5173";

const frontend = new Deno.Command(Deno.execPath(), {
  args: ["task", "--cwd", "packages/frontend", "dev"],
  stdin: "null",
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

const desktop = new Deno.Command(Deno.execPath(), {
  args: [
    "desktop",
    "--hmr",
    "-o",
    ".deno-desktop",
    "--config",
    "deno.desktop.json",
    "--allow-all",
    "packages/backend/main.ts",
  ],
  env: { VITE_DEV_URL: DEV_URL },
  stdin: "null",
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

const children = [frontend, desktop];
let exiting = false;

async function shutdown(code: number) {
  if (exiting) return;
  exiting = true;
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Already exited
    }
  }
  await Promise.all(children.map((child) => child.status));
  Deno.exit(code);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(sig, () => shutdown(130));
}

const first = await Promise.race([
  frontend.status.then((status) => ({ name: "Frontend", status })),
  desktop.status.then((status) => ({ name: "Desktop", status })),
]);

console.log(
  `\n${first.name} exited with code ${first.status.code}. Stopping...`,
);
await shutdown(first.status.code ?? 1);
