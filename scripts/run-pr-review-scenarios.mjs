import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { reviewPullRequest } from "../src/pr-review.mjs";

const endpoint = (process.env.EPISTEMIC_ENDPOINT || "http://127.0.0.1:8080").replace(/\/$/, "");
const dashboardEndpoint = (process.env.EPISTEMIC_DASHBOARD_ENDPOINT || "http://127.0.0.1:3000").replace(/\/$/, "");
const provider = process.env.PR_REVIEW_PROVIDER || "recorded";
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const manifest = JSON.parse(await readFile("epistemic-scenario.json", "utf8"));
const fixtureDir = new URL("../fixtures/pr-review/", import.meta.url);
const availableFixtureNames = (await readdir(fixtureDir)).filter(name => name.endsWith(".json")).sort();
assert.ok(availableFixtureNames.length >= 5, "expected the full PR coverage scenario matrix");
const selectedScenario = process.env.PR_REVIEW_SCENARIO || manifest.pr_review_scenario || "all";
const fixtureNames = selectedScenario === "all"
  ? availableFixtureNames
  : availableFixtureNames.filter(name => name === `${selectedScenario}.json`);
assert.ok(fixtureNames.length > 0, `unknown PR review scenario: ${selectedScenario}`);
const fixtures = await Promise.all(fixtureNames.map(async name => JSON.parse(await readFile(new URL(name, fixtureDir), "utf8"))));
const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || manifest.branch || "local";
if (process.env.GITHUB_ACTIONS === "true" && manifest.branch) {
  assert.equal(branch, manifest.branch, `scenario manifest is intended for ${manifest.branch}, not ${branch}`);
}

const health = await api("/health");
assert.equal(health.status, "ok");
if (process.env.EPISTEMIC_REQUIRE_DURABLE === "true") {
  assert.equal(health.storage, "postgresql");
  assert.equal(health.durable, true);
}

const account = await api("/v1/accounts", {
  method:"POST", expected:201,
  body:{ name:`PR Coverage Lab · ${provider}`, slug:`pr-coverage-${provider}-${stamp}` }
});
const project = await api(`/v1/accounts/${account.id}/projects`, {
  method:"POST", expected:201,
  body:{ name:"PR Requirement Coverage Lab", repository:"OlegGitH/epistemic-engine-demo", owner:"OlegGitH" }
});
const aiSystem = await api(`/v1/projects/${project.id}/ai-systems`, {
  method:"POST", expected:201,
  body:{
    name:"PR Requirement Coverage Reviewer",
    provider:provider === "openai" ? "openai" : "recorded-deterministic-demo",
    model:provider === "openai" ? (process.env.OPENAI_MODEL || "gpt-5.6") : "recorded-pr-coverage-v1",
    purpose:"Compare written change requests with PR text and supplied code, test, and documentation artifacts",
    data_classes:["pull_request_text", "change_summaries", "test_results"],
    tools:["epistemic_requirement_gate"],
    owner:"OlegGitH"
  }
});

const outcomes = [];
await mkdir(".epistemic/pr-review", { recursive:true });
for (const fixture of fixtures) {
  assert.equal(fixture.schema_version, "pr-coverage-scenario/v1");
  const review = await reviewPullRequest(fixture, { provider });
  const run = await api("/v1/runs", {
    method:"POST", expected:201,
    body:{
      account_id:account.id,
      project_id:project.id,
      ai_system_id:aiSystem.id,
      external_trace_id:`pr-review-${fixture.id}-${stamp}`,
      title:fixture.title,
      goal:fixture.request,
      source:"pr-coverage-scenario-suite",
      recommendation:`Merge ${fixture.title} only when every critical request requirement is evidence-backed.`,
      action_type:"code_change_review",
      subject:`OlegGitH/epistemic-engine-demo#${fixture.pull_request.number}`,
      risk_level:"high"
    }
  });
  let sequence = 1;
  await addEvent(run.id, sequence++, "requirements.declared", "request-author", {
    request:fixture.request,
    requirements:fixture.requirements
  });
  for (const artifact of fixture.artifacts) {
    await addEvent(run.id, sequence++, "change.artifact.observed", "github-pr", artifact);
  }
  for (const assessment of review.assessments) {
    await addEvent(run.id, sequence++, "requirement.assessed", `pr-reviewer:${review.provider}`, {
      ...assessment,
      reviewer:`${review.provider}:${review.model}`
    });
  }

  const graph = await api(`/v1/runs/${run.id}/analyze`, { method:"POST" });
  assert.equal(graph.claims.length, fixture.requirements.length, `${fixture.id}: one claim must exist per requirement`);
  const certificate = await api(`/v1/decisions/${graph.decision.id}/evaluate`, {
    method:"POST",
    body:{ human_approved:fixture.human_approved }
  });
  if (provider === "recorded") {
    assert.equal(certificate.verdict, fixture.expected.verdict, `${fixture.id}: unexpected verdict`);
    assert.equal(certificate.action_allowed, fixture.expected.action_allowed, `${fixture.id}: unexpected action gate`);
  } else {
    const shouldAllow = fixture.id === "fully-covered";
    assert.equal(certificate.action_allowed, shouldAllow, `${fixture.id}: live reviewer produced an unsafe action gate`);
  }
  assert.match(certificate.proof.digest, /^[a-f0-9]{64}$/);
  const humanReport = await api(`/v1/decisions/${graph.decision.id}/certificate/report`);
  assert.equal(humanReport.proof.digest, certificate.proof.digest);
  assert.match(humanReport.markdown, /Epistemic Decision Report/);

  const runUrl = `${dashboardEndpoint}/run?run=${run.id}`;
  const outcome = {
    scenario:fixture.id,
    title:fixture.title,
    description:fixture.description,
    provider:review.provider,
    model:review.model,
    response_id:review.response_id || null,
    requirements:fixture.requirements.length,
    assessments:review.assessments.length,
    claim_states:Object.fromEntries(graph.claims.map(claim => [claim.scope.replace("request requirement ", ""), claim.state])),
    open_unknowns:graph.unknowns.filter(item => item.critical && !item.resolved).length,
    expected:fixture.expected,
    observed:{ verdict:certificate.verdict, action_allowed:certificate.action_allowed },
    run_id:run.id,
    decision_id:graph.decision.id,
    certificate_digest:certificate.proof.digest,
    run_url:runUrl
  };
  outcomes.push(outcome);
  await Promise.all([
    writeFile(`.epistemic/pr-review/${fixture.id}-result.json`, JSON.stringify(outcome, null, 2) + "\n"),
    writeFile(`.epistemic/pr-review/${fixture.id}-certificate.json`, JSON.stringify(certificate, null, 2) + "\n"),
    writeFile(`.epistemic/pr-review/${fixture.id}-report.md`, humanReport.markdown)
  ]);
  console.log(`${fixture.id}: ${certificate.verdict} · action ${certificate.action_allowed ? "allowed" : "blocked"}`);
}

const dashboard = await api(`/v1/accounts/${account.id}/dashboard`);
assert.equal(dashboard.account.id, account.id);
assert.ok(dashboard.certificates.length >= fixtures.length);
const dashboardUrl = `${dashboardEndpoint}/?account=${account.id}`;
const suiteReport = {
  schema_version:"epistemic-pr-coverage-suite/v1",
  status:"passed",
  generated_at:new Date().toISOString(),
  provider,
  selected_scenario:selectedScenario,
  branch,
  honest_mode:provider === "openai" ? "live OpenAI Responses API" : "recorded deterministic model output",
  engine:{ endpoint, storage:health.storage || "unknown", durable:health.durable === true },
  account_id:account.id,
  project_id:project.id,
  ai_system_id:aiSystem.id,
  dashboard_url:dashboardUrl,
  totals:{ scenarios:outcomes.length, allowed:outcomes.filter(item => item.observed.action_allowed).length, blocked:outcomes.filter(item => !item.observed.action_allowed).length },
  outcomes,
  persistence_probes:outcomes.map(item => ({ account_id:account.id, project_id:project.id, run_id:item.run_id, decision_id:item.decision_id, certificate_digest:item.certificate_digest }))
};
await writeFile(".epistemic/pr-review-suite-report.json", JSON.stringify(suiteReport, null, 2) + "\n");
console.log(`epistemic-pr-review-suite-ok (${outcomes.length} scenarios)`);
console.log(`dashboard: ${dashboardUrl}`);

async function addEvent(runID, sequence, type, source, payload) {
  return api(`/v1/runs/${runID}/events`, {
    method:"POST", expected:202,
    body:{ external_id:`${runID}-${sequence}`, sequence, type, source, correlation_id:stamp, payload }
  });
}

async function api(path, { method="GET", body, expected=200 } = {}) {
  let response;
  try {
    response = await fetch(`${endpoint}${path}`, {
      method,
      headers:body === undefined ? {} : { "Content-Type":"application/json" },
      body:body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (error) {
    throw new Error(`Cannot reach Epistemic Engine at ${endpoint}: ${error.message}`);
  }
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, got ${response.status}: ${text}`);
  return parsed;
}
