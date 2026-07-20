import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";

const endpoint = (process.env.EPISTEMIC_ENDPOINT || "http://127.0.0.1:8080").replace(/\/$/, "");
const scope = JSON.parse(await readFile(".epistemic/engine-scope-report.json", "utf8"));
const probe = scope.persistence_probe;
assert.ok(probe?.account_id && probe?.run_id && probe?.decision_id && probe?.certificate_digest, "scope report does not contain a persistence probe");

const health = await get("/health");
assert.equal(health.storage, "postgresql");
assert.equal(health.durable, true);
const dashboard = await get(`/v1/accounts/${probe.account_id}/dashboard`);
const graph = await get(`/v1/runs/${probe.run_id}/graph`);
const certificate = await get(`/v1/decisions/${probe.decision_id}/certificate`);
const humanReport = await get(`/v1/decisions/${probe.decision_id}/certificate/report`);

assert.equal(dashboard.account.id, probe.account_id);
assert.ok(dashboard.projects.some(project => project.id === probe.project_id && project.runs >= 1));
assert.equal(graph.run.id, probe.run_id);
assert.equal(certificate.proof.digest, probe.certificate_digest);
assert.equal(humanReport.proof.digest, probe.certificate_digest);
assert.match(humanReport.markdown, /Epistemic Decision Report/);

let branchScenario = null;
if (await exists(".epistemic/branch-scenario-report.json")) {
  const scenarioReport = JSON.parse(await readFile(".epistemic/branch-scenario-report.json", "utf8"));
  if (normalizeEndpoint(scenarioReport.engine?.endpoint) !== normalizeEndpoint(endpoint)) {
    console.log(`skipping branch persistence probe from another Engine: ${scenarioReport.engine?.endpoint || "unknown"}`);
  } else {
  const scenarioProbe = scenarioReport.persistence_probe;
  assert.ok(scenarioProbe?.account_id && scenarioProbe?.run_id && scenarioProbe?.decision_id && scenarioProbe?.certificate_digest);
  const scenarioDashboard = await get(`/v1/accounts/${scenarioProbe.account_id}/dashboard`);
  const scenarioGraph = await get(`/v1/runs/${scenarioProbe.run_id}/graph`);
  const scenarioCertificate = await get(`/v1/decisions/${scenarioProbe.decision_id}/certificate`);
  const scenarioHumanReport = await get(`/v1/decisions/${scenarioProbe.decision_id}/certificate/report`);
  assert.equal(scenarioDashboard.account.id, scenarioProbe.account_id);
  assert.equal(scenarioGraph.run.id, scenarioProbe.run_id);
  assert.equal(scenarioCertificate.proof.digest, scenarioProbe.certificate_digest);
  assert.equal(scenarioHumanReport.proof.digest, scenarioProbe.certificate_digest);
  branchScenario = {
    scenario:scenarioReport.scenario,
    account_id:scenarioProbe.account_id,
    run_id:scenarioProbe.run_id,
    decision_id:scenarioProbe.decision_id,
    certificate_digest:scenarioProbe.certificate_digest,
    persisted:true
  };
  }
}

let prReviewSuite = null;
if (await exists(".epistemic/pr-review-suite-report.json")) {
  const suiteReport = JSON.parse(await readFile(".epistemic/pr-review-suite-report.json", "utf8"));
  const expectedScenarios = suiteReport.totals?.scenarios;
  assert.ok(Number.isInteger(expectedScenarios) && expectedScenarios > 0, "PR review report does not declare a valid scenario count");
  assert.equal(suiteReport.persistence_probes?.length, expectedScenarios, "every selected PR scenario must provide a persistence probe");
  if ((suiteReport.selected_scenario || "all") === "all") {
    assert.ok(expectedScenarios >= 5, "the main PR review matrix must retain all coverage scenarios");
  } else {
    assert.equal(expectedScenarios, 1, "a scenario branch must persist exactly one selected PR review path");
  }
  for (const suiteProbe of suiteReport.persistence_probes) {
    const suiteGraph = await get(`/v1/runs/${suiteProbe.run_id}/graph`);
    const suiteCertificate = await get(`/v1/decisions/${suiteProbe.decision_id}/certificate`);
    const suiteHumanReport = await get(`/v1/decisions/${suiteProbe.decision_id}/certificate/report`);
    assert.equal(suiteGraph.run.id, suiteProbe.run_id);
    assert.equal(suiteCertificate.proof.digest, suiteProbe.certificate_digest);
    assert.equal(suiteHumanReport.proof.digest, suiteProbe.certificate_digest);
  }
  const suiteDashboard = await get(`/v1/accounts/${suiteReport.account_id}/dashboard`);
  assert.equal(suiteDashboard.account.id, suiteReport.account_id);
  assert.ok(suiteDashboard.certificates.length >= suiteReport.persistence_probes.length);
  prReviewSuite = {
    account_id:suiteReport.account_id,
    scenarios:suiteReport.persistence_probes.length,
    certificates:suiteReport.persistence_probes.length,
    persisted:true
  };
}

const result = {
  schema_version:"epistemic-persistence/v1",
  status:"passed",
  checked_at:new Date().toISOString(),
  storage:health.storage,
  account_id:probe.account_id,
  run_id:probe.run_id,
  decision_id:probe.decision_id,
  certificate_digest:probe.certificate_digest,
  persisted:{ account:true, project:true, run_graph:true, certificate:true, human_report:true },
  branch_scenario:branchScenario,
  pr_review_suite:prReviewSuite
};
await writeFile(".epistemic/persistence-report.json", JSON.stringify(result, null, 2) + "\n");
console.log("epistemic-postgresql-restart-persistence-ok");

async function get(path) {
  const response = await fetch(`${endpoint}${path}`);
  const text = await response.text();
  assert.equal(response.status, 200, `GET ${path}: ${response.status} ${text}`);
  return JSON.parse(text);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeEndpoint(value) {
  return String(value || "").replace(/\/$/, "");
}
