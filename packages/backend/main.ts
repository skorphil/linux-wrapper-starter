import { getRootIdentity } from "./dbus-client.ts";

const DEV_URL = Deno.env.get("VITE_DEV_URL");

async function waitForUrl(url: string, timeoutMs = 10000) {
  const start = Date.now();
  console.log(`Waiting for ${url}...`);
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok || res.status === 404) return;
    } catch {
      // Ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// Minimal static file server logic for production
async function serveStatic(req: Request): Promise<Response> {
  const url = new URL(req.url);
  
  // API endpoints
  if (url.pathname === "/api/memory") {
    return new Response(JSON.stringify(Deno.memoryUsage()), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
  if (url.pathname === "/api/id") {
    const result = await getRootIdentity();
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  // Static files (only if not in dev mode with external URL)
  let filepath = url.pathname === "/" ? "index.html" : url.pathname;
  if (filepath.startsWith("/")) filepath = filepath.substring(1);

  try {
    const assetUrl = import.meta.resolve("../frontend/dist/" + filepath);
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error("Not found");
    
    const headers = new Headers(response.headers);
    const contentType = filepath.endsWith(".html") ? "text/html" : 
                        filepath.endsWith(".js") ? "application/javascript" :
                        filepath.endsWith(".css") ? "text/css" :
                        filepath.endsWith(".svg") ? "image/svg+xml" : null;
    if (contentType) headers.set("Content-Type", contentType);
    
    return new Response(response.body, { headers });
  } catch {
    // SPA fallback: serve index.html
    try {
      const indexUrl = import.meta.resolve("../frontend/dist/index.html");
      const response = await fetch(indexUrl);
      return new Response(response.body, { headers: { "Content-Type": "text/html" } });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  }
}

// Start local server
let port = 3000;
try {
  Deno.serve({ port, hostname: "127.0.0.1" }, serveStatic);
} catch (e) {
  if (e instanceof Deno.errors.AddrInUse) {
    // Fallback to random port
    const s = Deno.serve({ port: 0, hostname: "127.0.0.1" }, serveStatic);
    port = (s.addr as Deno.NetAddr).port;
  } else {
    throw e;
  }
}

const APP_URL = DEV_URL || `http://127.0.0.1:${port}`;

// Deno.BrowserWindow is experimental
// deno-lint-ignore no-explicit-any
const DenoAny = Deno as any;

if (typeof DenoAny.BrowserWindow !== "undefined") {
  if (DEV_URL) await waitForUrl(APP_URL);

  const win = new DenoAny.BrowserWindow({
    title: "Linux Wrapper Starter",
    width: 1000,
    height: 800,
  });

  win.bind("getMemoryUsage", () => Promise.resolve(Deno.memoryUsage()));
  win.bind("getRootIdentity", () => getRootIdentity());

  win.addEventListener("close", () => Deno.exit(0));

  win.navigate(APP_URL);
} else {
  console.log(`Server running at ${APP_URL}`);
}
