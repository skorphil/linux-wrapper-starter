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

/** Headers that apply only to a single transport-level connection. */
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

/** Returns a copy of the headers without hop-by-hop entries. */
function withoutHopByHop(headers: Headers): Headers {
  const copy = new Headers(headers);
  for (const name of HOP_BY_HOP_HEADERS) {
    copy.delete(name);
  }
  return copy;
}

/**
 * Maps a close code received from a peer onto a code that is valid to send
 * from this side. Codes such as 1005/1006 are reserved and must not be sent.
 */
function sendableCloseCode(code: number): number {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;
}

/**
 * Bridges a browser WebSocket to the Vite dev server (used by the HMR client).
 * Frames received before the upstream socket opens are queued.
 */
function proxyWebSocket(req: Request, target: URL): Response {
  const requested = req.headers.get("sec-websocket-protocol");
  const protocols = requested
    ? requested.split(",").map((p) => p.trim()).filter(Boolean)
    : [];

  const upstreamUrl = new URL(req.url);
  upstreamUrl.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  upstreamUrl.host = target.host;

  const { socket, response } = Deno.upgradeWebSocket(req, {
    protocol: protocols[0],
  });
  // Binary frames must arrive as ArrayBuffer so they can be forwarded as-is.
  socket.binaryType = "arraybuffer";

  const upstream = new WebSocket(upstreamUrl, protocols);
  upstream.binaryType = "arraybuffer";
  const queue: (string | ArrayBuffer)[] = [];

  socket.onmessage = (event) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(event.data);
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      queue.push(event.data);
    }
  };

  upstream.onopen = () => {
    for (const message of queue.splice(0)) {
      upstream.send(message);
    }
  };

  upstream.onmessage = (event) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(event.data);
    }
  };

  upstream.onerror = (event) => {
    console.error("Vite WebSocket proxy upstream error:", event);
  };

  upstream.onclose = (event) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(sendableCloseCode(event.code), event.reason);
    }
  };

  socket.onclose = (event) => {
    if (
      upstream.readyState === WebSocket.OPEN ||
      upstream.readyState === WebSocket.CONNECTING
    ) {
      upstream.close(sendableCloseCode(event.code), event.reason);
    }
  };

  return response;
}

/** Forwards a plain HTTP request to the Vite dev server and streams back the reply. */
async function proxyHttp(req: Request, target: URL): Promise<Response> {
  const incoming = new URL(req.url);
  const upstreamUrl = new URL(incoming.pathname + incoming.search, target);

  const headers = withoutHopByHop(req.headers);
  // Ask Vite for an identity-encoded body so the streamed bytes match headers.
  headers.delete("accept-encoding");
  headers.set("host", upstreamUrl.host);

  const hasBody = req.body !== null && req.method !== "GET" &&
    req.method !== "HEAD";

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: withoutHopByHop(upstream.headers),
    });
  } catch (error) {
    console.error("Vite proxy request failed:", upstreamUrl.href, error);
    return new Response("Bad Gateway: Vite dev server unreachable", {
      status: 502,
    });
  }
}

/**
 * Starts a loopback proxy in front of the Vite dev server. The webview is
 * navigated to this proxy rather than to Vite directly, because native
 * bindings are only injected for the app's own origin.
 * Returns the proxy URL.
 */
function startDevProxy(target: URL): string {
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1" }, (req) => {
    const isUpgrade = req.headers.get("upgrade")?.toLowerCase() === "websocket";
    return isUpgrade ? proxyWebSocket(req, target) : proxyHttp(req, target);
  });
  const port = (server.addr as Deno.NetAddr).port;
  const url = `http://127.0.0.1:${port}/`;
  console.log("Proxying Vite at", target.href, "via", url);
  return url;
}

// Start local server (production static files and browser fallback)
// deno-lint-ignore no-explicit-any
const DenoAny = Deno as any;

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

let APP_URL = `http://127.0.0.1:${port}`;

if (DEV_URL) {
  await waitForUrl(DEV_URL);
  APP_URL = startDevProxy(new URL(DEV_URL));
}

if (typeof DenoAny.BrowserWindow !== "undefined") {
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

// Static file server for production builds and browser fallback
async function serveStatic(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // API endpoints
  if (url.pathname === "/api/memory") {
    return new Response(JSON.stringify(Deno.memoryUsage()), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
  if (url.pathname === "/api/id") {
    const result = await getRootIdentity();
    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  let filepath = url.pathname === "/" ? "index.html" : url.pathname;
  if (filepath.startsWith("/")) filepath = filepath.substring(1);

  try {
    const assetUrl = import.meta.resolve("../frontend/dist/" + filepath);
    const response = await fetch(assetUrl);
    if (!response.ok) throw new Error("Not found");

    const headers = new Headers(response.headers);
    const contentType = filepath.endsWith(".html")
      ? "text/html"
      : filepath.endsWith(".js")
      ? "application/javascript"
      : filepath.endsWith(".css")
      ? "text/css"
      : filepath.endsWith(".svg")
      ? "image/svg+xml"
      : null;
    if (contentType) headers.set("Content-Type", contentType);

    return new Response(response.body, { headers });
  } catch {
    // SPA fallback: serve index.html
    try {
      const indexUrl = import.meta.resolve("../frontend/dist/index.html");
      const response = await fetch(indexUrl);
      return new Response(response.body, {
        headers: { "Content-Type": "text/html" },
      });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  }
}
