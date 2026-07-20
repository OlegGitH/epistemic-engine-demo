import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const endpoint = (process.env.EPISTEMIC_ENDPOINT || "http://127.0.0.1:8080").replace(/\/$/, "");
const scope = JSON.parse(await readFile(".epistemic/engine-scope-report.json", "utf8"));
const probe = scope.persistence_probe;
assert.ok(probe?.account_id && probe?.run_id && probe?.decision_id && probe?.certificate_digest, "scope report does not contain a persistence probe");

const health = await get("/healthz");
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

const result = {
  schema_version:"epistemic-persistence/v1",
  status:"passed",
  checked_at:new Date().toISOString(),
  storage:health.storage,
  account_id:probe.account_id,
  run_id:probe.run_id,
  decision_id:probe.decision_id,
  certificate_digest:probe.certificate_digest,
  persisted:{ account:true, project:true, run_graph:true, certificate:true, human_report:true }
};
await writeFile(".epistemic/persistence-report.json", JSON.stringify(result, null, 2) + "\n");
console.log("epistemic-postgresql-restart-persistence-ok");

async function get(path) {
  const response = await fetch(`${endpoint}${path}`);
  const text = await response.text();
  assert.equal(response.status, 200, `GET ${path}: ${response.status} ${text}`);
  return JSON.parse(text);
}
