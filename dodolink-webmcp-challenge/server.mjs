import { createReadStream, promises as fs } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 5173);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function pageHtml() {
  const left = String.fromCharCode(60);
  const right = String.fromCharCode(62);
  const open = (tag, attributes = "") => `${left}${tag}${attributes ? ` ${attributes}` : ""}${right}`;
  const close = (tag) => `${left}/${tag}${right}`;
  const element = (tag, attributes, content) => `${open(tag, attributes)}${content}${close(tag)}`;

  const status = element(
    "div",
    'class="status-pill" id="protocol-status"',
    `${element("span", 'class="status-dot"', "")}${element("span", "", "WebMCP Protocol: Connecting…")}`,
  );
  const form = element(
    "form",
    'id="search-form"',
    `${element("label", 'class="sr-only" for="request"', "Shopping request")}` +
      `${element("textarea", 'id="request" rows="4" placeholder="Find a reliable product under my budget"', "")}` +
      `${element("button", 'class="primary-button" type="submit"', "Prepare a plan ↗")}`,
  );
  const agentCard = element(
    "aside",
    'class="agent-card"',
    `${element("p", 'class="card-kicker"', "Agent console")}` +
      `${element("h3", "", "What are you sourcing?")}` +
      `${element("p", 'class="muted"', "Search real marketplace listings manually or through a WebMCP-enabled agent.")}` +
      `${element("div", 'class="suggestions"', element("button", 'class="suggestion" data-query="Find a smartphone under 200000 Naira"', "→ Find a product under budget"))}` +
      form +
      `${element("div", 'class="tool-note"', "◎ Read-only tools. No payment, checkout, or seller messages.")}`,
  );
  const planPanel = element(
    "section",
    'class="plan-panel" aria-live="polite"',
    `${element("div", 'class="panel-topline"', element("div", "", `${element("p", 'class="card-kicker"', "Human review space")}${element("h2", 'id="plan-title"', "Marketplace signals")}`) + element("span", 'class="result-count" id="result-count"', "Live data"))}` +
      `${element("div", 'id="plan-content" class="plan-content"', element("div", 'class="empty-state"', `${element("div", 'class="empty-mark"', "⌁")}${element("h3", "", "Your plan will appear here")}${element("p", "", "Choose a prompt or ask your own marketplace question.")}`))}`,
  );
  const head =
    open("meta", 'charset="UTF-8"') +
    open("meta", 'name="viewport" content="width=device-width, initial-scale=1"') +
    element("title", "", "DodoLink Agent Shopping") +
    open("link", 'rel="stylesheet" href="/styles.css"');
  const body =
    element("header", 'class="hero"', element("div", 'class="hero-inner"', `${status}${element("p", 'class="eyebrow"', "DodoLink Agent Shopping")}${element("h1", "", `Agent speed.${open("br")}Human judgment.`)}${element("p", 'class="hero-copy"', "A safe WebMCP marketplace collaboration demo.")}`)) +
    element("main", 'class="shell"', element("section", 'class="workspace"', `${agentCard}${planPanel}`)) +
    element("footer", "", `${element("span", "", "DodoLink Agent Shopping")}${element("span", "", "WebMCP Challenge · Open source")}`) +
    element("script", 'type="module" src="/src/app.js"', "");

  return `${open("!doctype html")}${element("html", 'lang="en"', `${element("head", "", head)}${element("body", "", body)}`)}`;
}

function safePath(requestPath) {
  const requested = decodeURIComponent(requestPath.split("?")[0] || "/");
  const relative = requested.replace(/^\/+/, "");
  const candidate = normalize(join(root, relative));
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate.startsWith(rootPrefix) ? candidate : null;
}

const server = createServer(async (request, response) => {
  if ((request.url || "/").split("?")[0] === "/") {
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": "text/html; charset=utf-8",
    });
    response.end(pageHtml());
    return;
  }

  const path = safePath(request.url || "/");
  if (!path) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(path);
    if (!stat.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": mimeTypes[extname(path)] || "application/octet-stream",
    });
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`DodoLink WebMCP challenge demo listening on http://localhost:${port}`);
});