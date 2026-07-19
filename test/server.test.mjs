import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createFoodLensServer } from "../server.mjs";

async function withServer(check) {
  const server = createFoodLensServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await check(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("analysis API returns traceable deterministic evidence", async () => withServer(async base => {
  const payload = { filename:"garden-salad.jpg", image_sha256:"a".repeat(64), size:42_000, features:{ average_rgb:[74,151,78], brightness:118, colorfulness:63, edge_density:.12 } };
  const first = await fetch(`${base}/api/analyze`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
  const second = await fetch(`${base}/api/analyze`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), await second.json());
}));

test("analysis API actively rejects raw image transmission", async () => withServer(async base => {
  const response = await fetch(`${base}/api/analyze`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ image_data:"data:image/png;base64,unsafe", features:{ average_rgb:[0,0,0] } }) });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "raw_image_forbidden");
}));
