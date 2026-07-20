import assert from "node:assert/strict";
import test from "node:test";
import { recordedReview, reviewPullRequest, validateReview } from "../src/pr-review.mjs";

const input = {
  request:"Add cursor pagination.",
  requirements:[{ id:"cursor", text:"Return and accept a cursor.", critical:true }],
  pull_request:{ title:"Add cursor pagination", description:"Implements cursors." },
  artifacts:[{ id:"diff-api", kind:"code_diff", path:"src/api.mjs", summary:"Adds cursors." }],
  recorded_assessments:[{ requirement_id:"cursor", status:"passed", confidence:.96, rationale:"The diff implements the requested cursor.", evidence_refs:["diff-api"] }]
};

test("recorded reviewer returns validated evidence-bound coverage", async () => {
  const review = await reviewPullRequest(input);
  assert.equal(review.provider, "recorded");
  assert.equal(review.assessments[0].status, "passed");
  assert.deepEqual(recordedReview(input).assessments, input.recorded_assessments);
});

test("review validation rejects invented evidence", () => {
  assert.throws(() => validateReview(input, { assessments:[{ ...input.recorded_assessments[0], evidence_refs:["invented"] }] }), /unknown evidence ref/);
});

test("review validation rejects duplicate and unknown requirements", () => {
  assert.throws(() => validateReview(input, { assessments:[input.recorded_assessments[0], input.recorded_assessments[0]] }), /duplicate assessed requirement/);
  assert.throws(() => validateReview(input, { assessments:[{ ...input.recorded_assessments[0], requirement_id:"other" }] }), /unknown assessed requirement/);
});

test("openai mode is credential-gated", async () => {
  await assert.rejects(reviewPullRequest(input, { provider:"openai", apiKey:"" }), /OPENAI_API_KEY/);
});
