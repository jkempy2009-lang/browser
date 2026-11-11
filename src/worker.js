// Relay for the score sheet viewer. Runs on Cloudflare Workers.
// The viewer page (public/index.html) is served by Cloudflare as a static file.
// Everything else comes here: this fetches a website on the visitor's behalf and
// removes the "do not embed me" instructions, so it can be shown inside the viewer.
//
// Address format:  https://<this-site>/https://example.com/some/page

// Headers from the fetched website that must not reach the browser.
const DROP_HEADERS = [
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "set-cookie",
  "strict-transport-security",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "report-to",
  "nel",
];

// Headers from the visitor's browser that are passed on to the website.
const PASS_HEADERS = ["accept", "accept-language", "user-agent", "content-type", "range"];

export default {
  async fetch(request) {
    const here = new URL(request.url);

    // The viewer page asks this to find out whether a relay is available.
    if (here.pathname === "/__relay") return text("relay", 200);

    let target = parseTarget(here.pathname + here.search, here.hostname);

    // A request like /style.css has lost the website it belongs to.
    // Work it out from the page that asked for it and send the browser to the full address.
    if (!target) {
      const from = refererTarget(request, here);
      if (!from) return text("Nothing here. Go to the home page and paste a link.", 404);
      return Response.redirect(here.origin + "/" + from.origin + here.pathname + here.search, 307);
    }

    // Opened directly as its own tab instead of inside the viewer: send it back to the viewer.
    if (request.headers.get("sec-fetch-dest") === "document") {
      return Response.redirect(here.origin + "/?url=" + encodeURIComponent(target.href), 302);
    }

    const headers = new Headers();
    for (const name of PASS_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const hasBody = request.method !== "GET" && request.method !== "HEAD";

    let upstream;
    try {
      upstream = await fetch(target.href, {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
        redirect: "manual",
      });
    } catch (err) {
      return text("Could not reach " + target.hostname + ".", 502);
    }

    const out = new Headers(upstream.headers);
    for (const name of DROP_HEADERS) out.delete(name);
    // Only allow relayed pages to be displayed inside this site's own viewer.
    out.set("content-security-policy", "frame-ancestors 'self'");
    // Keep the Referer header, which the fallback above depends on.
    out.set("referrer-policy", "same-origin");

    // Keep redirects inside the relay.
    const location = upstream.headers.get("location");
    if (location) {
      const next = toProxied(location, target, here.origin);
      if (next) out.set("location", next);
    }

    const response = new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: out,
    });

    const type = upstream.headers.get("content-type") || "";
    if (!type.includes("text/html")) return response;
    return rewriteHtml(response, target, here.origin);
  },
};

// Rewrite links, images, scripts and forms in a page so they also go through the relay.
function rewriteHtml(response, target, relayOrigin) {
  const fix = (attr) => ({
    element(el) {
      const value = el.getAttribute(attr);
      if (!value) return;
      const next = toProxied(value, target, relayOrigin);
      if (next) el.setAttribute(attr, next);
    },
  });

  const fixSrcset = {
    element(el) {
      const value = el.getAttribute("srcset");
      if (!value) return;
      const parts = value.split(/,\s+/).map((part) => {
        const bits = part.trim().split(/\s+/);
        const next = toProxied(bits[0], target, relayOrigin);
        if (next) bits[0] = next;
        return bits.join(" ");
      });
      el.setAttribute("srcset", parts.join(", "));
    },
  };

  return new HTMLRewriter()
    .on("[href]", fix("href"))
    .on("[src]", fix("src"))
    .on("[action]", fix("action"))
    .on("[poster]", fix("poster"))
    .on("[srcset]", fixSrcset)
    .on("meta", {
      element(el) {
        const kind = (el.getAttribute("http-equiv") || el.getAttribute("name") || "").toLowerCase();
        if (kind === "content-security-policy" || kind === "referrer") el.remove();
      },
    })
    .on("head", {
      element(el) {
        el.prepend("<script>" + PAGE_SCRIPT + "</script>", { html: true });
      },
    })
    .transform(response);
}

// Runs inside each relayed page: sends the page's own background requests
// to other websites through the relay too.
const PAGE_SCRIPT = `(function(){
  var P = location.origin + "/";
  function fix(u){
    try {
      var a = new URL(u, document.baseURI);
      if (a.origin !== location.origin && /^https?:$/.test(a.protocol)) return P + a.href;
    } catch (e) {}
    return u;
  }
  var f = window.fetch;
  if (f) window.fetch = function(input, init){
    if (typeof input === "string" || input instanceof URL) input = fix(String(input));
    return f.call(this, input, init);
  };
  var open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(){
    arguments[1] = fix(arguments[1]);
    return open.apply(this, arguments);
  };
})();`;

// "/https://example.com/page?x=1" -> URL object for https://example.com/page?x=1
function parseTarget(pathAndQuery, relayHost) {
  const match = pathAndQuery.match(/^\/(https?):\/+(.+)$/i);
  if (!match) return null;
  let url;
  try {
    url = new URL(match[1].toLowerCase() + "://" + match[2]);
  } catch (err) {
    return null;
  }
  return isAllowedTarget(url, relayHost) ? url : null;
}

function refererTarget(request, here) {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    const ref = new URL(referer);
    if (ref.origin !== here.origin) return null;
    return parseTarget(ref.pathname + ref.search, here.hostname);
  } catch (err) {
    return null;
  }
}

// Only public websites: no internal addresses, no raw IP addresses, no looping back to the relay.
function isAllowedTarget(url, relayHost) {
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (host === relayHost.toLowerCase()) return false;
  if (!host.includes(".")) return false;
  if (host.includes(":") || host.startsWith("[")) return false;
  if (/^[0-9.]+$/.test(host)) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false;
  return true;
}

// Turn an address found in a page into one that goes through the relay.
// Returns null for things that should be left alone (#anchors, data:, mailto: and so on).
function toProxied(value, target, relayOrigin) {
  const raw = value.trim();
  if (!raw || raw.startsWith("#")) return null;
  let url;
  try {
    url = new URL(raw, target.href);
  } catch (err) {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return relayOrigin + "/" + url.href;
}

function text(message, status) {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
