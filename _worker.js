const MAX_SOURCE_BYTES = 2_000_000;
const MAX_SOURCES = 30;
const CACHE_SECONDS = 300;
const TYPES = new Set(["mtproto", "socks", "web"]);

function trimToken(value) {
  return value.trim().replace(/[),;\]}.!?]+$/, "").replace(/&amp;/gi, "&");
}

function validHost(host) {
  return typeof host === "string" && host.length > 0 && host.length <= 253 && !/[\s/@]/.test(host);
}

function validPort(port) {
  return /^\d{1,5}$/.test(String(port || "")) && Number(port) >= 1 && Number(port) <= 65535;
}

function normalizeMTProto(link) {
  try {
    const url = new URL(link);
    const isTelegram = (url.protocol === "tg:" && url.hostname === "proxy") ||
      (url.protocol === "https:" && url.hostname === "t.me" && url.pathname === "/proxy");
    if (!isTelegram) return null;
    const server = url.searchParams.get("server");
    const port = url.searchParams.get("port");
    const secret = url.searchParams.get("secret");
    if (!validHost(server) || !validPort(port) || !secret || !/^[a-zA-Z0-9_+\/-]+={0,2}$/.test(secret)) return null;
    return { type: "mtproto", value: link };
  } catch {
    return null;
  }
}

function parseProxyToken(token) {
  const value = trimToken(token);
  if (!value || value.startsWith("#") || value.startsWith("//")) return null;
  const mtproto = normalizeMTProto(value);
  if (mtproto) return mtproto;

  // Explicit protocols are the clearest way to distinguish SOCKS and web proxies.
  if (/^(socks4|socks5|socks5h|socks):\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!validHost(url.hostname) || !validPort(url.port)) return null;
      return { type: "socks", value };
    } catch {
      return null;
    }
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!validHost(url.hostname) || !validPort(url.port)) return null;
      return { type: "web", value };
    } catch {
      return null;
    }
  }

  // Common plain-text formats: host:port (web) or host:port:user:password (SOCKS list).
  const fields = value.split(":");
  if (fields.length === 4 && validHost(fields[0]) && validPort(fields[1])) {
    return { type: "socks", value };
  }
  if (fields.length === 2 && validHost(fields[0]) && validPort(fields[1])) {
    return { type: "web", value };
  }
  return null;
}

function parseText(text) {
  const results = [];
  const mtprotoLinks = text.match(/(?:tg:\/\/proxy\?|https:\/\/t\.me\/proxy\?)[^\s"'<>]+/gi) || [];
  for (const link of mtprotoLinks) {
    const item = normalizeMTProto(trimToken(link));
    if (item) results.push(item);
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    // URLs can sit beside labels or prose; only proxy schemes are extracted.
    const explicit = line.match(/(?:socks4|socks5h?|socks|https?):\/\/[^\s"'<>]+/gi) || [];
    if (explicit.length) {
      for (const token of explicit) {
        const item = parseProxyToken(token);
        if (item) results.push(item);
      }
      continue;
    }
    const plain = line.split(/[\s,;]+/)[0];
    const item = parseProxyToken(plain);
    if (item) results.push(item);
  }

  const seen = new Set();
  return results.filter((item) => {
    let key = `${item.type}\u0000${item.value}`;
    if (item.type === "mtproto") {
      try {
        const url = new URL(item.value);
        key = `mtproto\u0000${(url.searchParams.get("server") || "").toLowerCase()}\u0000${url.searchParams.get("port")}\u0000${url.searchParams.get("secret")}`;
      } catch { /* normalizeMTProto already validated the URL */ }
    }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readAsset(env, path) {
  try {
    const response = await env.ASSETS.fetch(new Request(new URL(path, "https://assets.local")));
    if (!response.ok) return "";
    return (await response.text()).slice(0, MAX_SOURCE_BYTES);
  } catch {
    return "";
  }
}

async function getProxies(env) {
  const [local, sourceList] = await Promise.all([
    readAsset(env, "/data/proxies.txt"),
    readAsset(env, "/sources.txt")
  ]);
  const sources = sourceList.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .filter((line) => {
      try { return new URL(line).protocol === "https:"; }
      catch { return false; }
    }).slice(0, MAX_SOURCES);

  const textParts = [local];
  await Promise.all(sources.map(async (source) => {
    try {
      const response = await fetch(source, {
        headers: { "User-Agent": "PROXY_LIST/2.0" },
        signal: AbortSignal.timeout(8000),
        redirect: "follow"
      });
      if (response.ok) textParts.push((await response.text()).slice(0, MAX_SOURCE_BYTES));
    } catch {
      // Unavailable sources are skipped so the site can keep serving other entries.
    }
  }));
  return parseText(textParts.join("\n"));
}

function responseHeaders(contentType, cacheSeconds = CACHE_SECONDS) {
  return {
    "Content-Type": contentType,
    "Cache-Control": cacheSeconds ? `public, max-age=${cacheSeconds}` : "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  };
}

function groupCounts(proxies) {
  return {
    mtproto: proxies.filter((p) => p.type === "mtproto").length,
    socks: proxies.filter((p) => p.type === "socks").length,
    web: proxies.filter((p) => p.type === "web").length
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders("text/plain; charset=utf-8", 0) });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: responseHeaders("text/plain; charset=utf-8", 0) });
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "PROXY_LIST", categories: ["mtproto", "socks", "web"] }, {
        headers: responseHeaders("application/json; charset=utf-8", 0)
      });
    }

    const textType = ({ "/proxy.txt": null, "/mtproto.txt": "mtproto", "/socks.txt": "socks", "/web.txt": "web" })[url.pathname];
    const isTextEndpoint = url.pathname === "/proxy.txt" || ["/mtproto.txt", "/socks.txt", "/web.txt"].includes(url.pathname);
    if (isTextEndpoint || url.pathname === "/api/proxies") {
      const requestedType = (url.searchParams.get("type") || "").toLowerCase();
      if (requestedType && !TYPES.has(requestedType)) {
        return Response.json({ error: "Unknown type. Use mtproto, socks or web." }, {
          status: 400, headers: responseHeaders("application/json; charset=utf-8", 0)
        });
      }

      const cacheUrl = new URL(url.origin + url.pathname);
      if (requestedType) cacheUrl.searchParams.set("type", requestedType);
      let response = await caches.default.match(new Request(cacheUrl.toString(), { method: "GET" }));
      if (!response) {
        const all = await getProxies(env);
        const type = isTextEndpoint ? textType : requestedType || null;
        const filtered = type ? all.filter((p) => p.type === type) : all;
        const body = isTextEndpoint
          ? (filtered.length ? filtered.map((p) => p.value).join("\n") + "\n" : "")
          : JSON.stringify({
              count: filtered.length,
              counts: groupCounts(all),
              proxies: filtered,
              categories: {
                mtproto: all.filter((p) => p.type === "mtproto"),
                socks: all.filter((p) => p.type === "socks"),
                web: all.filter((p) => p.type === "web")
              }
            }, null, 2);
        response = new Response(body, {
          headers: responseHeaders(isTextEndpoint ? "text/plain; charset=utf-8" : "application/json; charset=utf-8")
        });
        ctx.waitUntil(caches.default.put(new Request(cacheUrl.toString(), { method: "GET" }), response.clone()));
      }
      if (request.method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
      return response;
    }

    if (url.pathname === "/") {
      return env.ASSETS.fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
