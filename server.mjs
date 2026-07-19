import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeFoodImage } from "./src/classifier.mjs";
import { enforceAnalysisInput, InputPolicyError } from "./src/input-policy.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const contentTypes = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".svg":"image/svg+xml", ".json":"application/json; charset=utf-8" };

export function createFoodLensServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/api/health") return json(response, 200, { status:"ok", model:"food-lens-demo-v0.1" });
      if (request.method === "POST" && url.pathname === "/api/analyze") {
        const body = enforceAnalysisInput(await readJSON(request));
        return json(response, 200, analyzeFoodImage(body));
      }
      if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error:"method_not_allowed" });
      const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const target = normalize(join(publicDir, relative));
      if (!target.startsWith(publicDir)) return json(response, 403, { error:"forbidden" });
      const content = await readFile(target);
      response.writeHead(200, { "Content-Type":contentTypes[extname(target)] || "application/octet-stream", "Cache-Control":"no-store" });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      const status = error?.code === "ENOENT" ? 404 : error?.message === "payload_too_large" ? 413 : error instanceof InputPolicyError ? error.status : error instanceof SyntaxError ? 400 : 500;
      json(response, status, { error:status === 500 ? "internal_error" : error.code || error.message || "not_found", message:status === 500 ? undefined : error.message });
    }
  });
}

async function readJSON(request) {
  const chunks=[]; let bytes=0;
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 1_000_000) throw new Error("payload_too_large"); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
function json(response, status, body) { response.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}); response.end(JSON.stringify(body)); }

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port=Number(process.env.PORT || 4300);
  createFoodLensServer().listen(port,"127.0.0.1",()=>console.log(`Food Lens running at http://127.0.0.1:${port}`));
}
