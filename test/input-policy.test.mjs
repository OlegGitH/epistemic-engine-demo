import assert from "node:assert/strict";
import test from "node:test";
import { enforceAnalysisInput, InputPolicyError } from "../src/input-policy.mjs";

const valid = { filename:"salad.jpg", image_sha256:"a".repeat(64), size:42_000, features:{ average_rgb:[70,150,75], brightness:116, colorfulness:60, edge_density:.12 } };

test("aggregate visual features pass the API privacy boundary", () => {
  assert.equal(enforceAnalysisInput(valid), valid);
});

test("raw image material is rejected even when nested", () => {
  assert.throws(() => enforceAnalysisInput({ ...valid, metadata:{ image_base64:"unsafe" } }), error => error instanceof InputPolicyError && error.code === "raw_image_forbidden");
});

test("invalid digests and oversized files are rejected", () => {
  assert.throws(() => enforceAnalysisInput({ ...valid, image_sha256:"not-a-digest" }), /64-character/);
  assert.throws(() => enforceAnalysisInput({ ...valid, size:25_000_001 }), /25,000,000/);
});
