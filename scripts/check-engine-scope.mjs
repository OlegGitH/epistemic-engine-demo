import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const endpoint = (process.env.EPISTEMIC_ENDPOINT || "http://127.0.0.1:8080").replace(/\/$/, "");
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const checks = [];
const startedAt = new Date();
const durableRequired = process.env.EPISTEMIC_REQUIRE_DURABLE === "true";

const record = (id, detail, values = {}) => checks.push({ id, status:"passed", detail, ...values });

const health = await api("/healthz");
assert.equal(health.body.status, "ok");
if (durableRequired) {
  assert.equal(health.body.storage, "postgresql");
  assert.equal(health.body.durable, true);
}
const discovery = await api("/.well-known/epistemic");
for (const feature of ["batch", "certificate", "context-propagation", "idempotency", "ordering", "stream", "synchronous-evaluation"]) {
  assert.ok(discovery.body.features.includes(feature), `missing advertised feature: ${feature}`);
}
record("capability-discovery", "Health and all required portable protocol capabilities are advertised.", { features:discovery.body.features.length });

const catalog = await api("/v1/tools");
assert.ok(catalog.body.tools.some(tool => tool.id === "github-actions-pipeline"));
const generated = await api("/v1/tools/github-actions/pipelines", { method:"POST", expected:201, body:{ config_path:".epistemic.yaml" } });
assert.match(generated.body.files[0].content, /Epistemic quality gate/);
record("pipeline-tool", "The tool catalog generated a GitHub Actions quality-gate workflow.");

const portableDecision = `food-lens-protocol-${stamp}`;
const portableRun = `food-lens-protocol-run-${stamp}`;
const protocolEvents = [
  protocolEvent("build", "evidence.discovered", 1, { evidence_type:"build_result", check:"build", status:"passed" }),
  protocolEvent("tests", "verification.completed", 2, { kind:"test", check:"unit test", status:"passed" }),
  protocolEvent("compatibility", "verification.completed", 3, { kind:"test", check:"compatibility test", status:"passed" }),
  protocolEvent("privacy", "verification.completed", 4, { kind:"test", check:"privacy test", status:"passed" })
];
const firstEvent = await api("/v1/events", { method:"POST", expected:202, body:protocolEvents[0], headers:{"Epistemic-Context":`decision=${portableDecision};run=${portableRun};correlation=${stamp}`} });
const duplicateEvent = await api("/v1/events", { method:"POST", expected:202, body:protocolEvents[0] });
assert.equal(firstEvent.body.accepted, true);
assert.equal(duplicateEvent.body.duplicate, true);
const collision = { ...protocolEvents[0], id:`collision-${stamp}`, idempotency_key:`collision-${stamp}` };
await api("/v1/events", { method:"POST", expected:400, body:collision });
const batch = await api("/v1/events:batch", { method:"POST", expected:202, body:{ events:protocolEvents.slice(1) } });
assert.equal(batch.body.accepted.length, 3);
record("protocol-ingestion", "Single, duplicate, ordered-collision, context-header, and batch event behavior matched the contract.");

const portable = await api("/v1/decisions:evaluate", { method:"POST", body:{
  spec_version:"0.1",
  decision_id:portableDecision,
  recommendation:"Publish the verified Food Lens revision.",
  action:{ type:"software_deployment", subject:{ type:"repository", id:"OlegGitH/epistemic-engine-demo" }, risk_level:"medium" },
  context:{ run_id:portableRun, correlation_id:stamp },
  mode:"enforce",
  requirements:[
    { id:"build", description:"Build succeeds", critical:true, evidence_types:["build_result"] },
    { id:"tests", description:"Tests pass", critical:true, evidence_types:["test_result"] },
    { id:"compatibility", description:"Compatibility passes", critical:true, evidence_types:["test_result"] },
    { id:"privacy", description:"Privacy passes", critical:true, evidence_types:["test_result"] }
  ],
  approval:{ approved:true, actor:"engine-scope-test", time:new Date().toISOString() }
} });
assert.equal(portable.body.status, "allow");
assert.equal(portable.body.action_allowed, true);
assert.match(portable.body.certificate.proof.digest, /^[a-f0-9]{64}$/);
const queriedDecision = await api(`/v1/decisions/${portableDecision}`);
const history = await api(`/v1/decisions/${portableDecision}/events`);
const portableCertificate = await api(`/v1/decisions/${portableDecision}/certificate`);
assert.equal(queriedDecision.body.certificate.proof.digest, portable.body.certificate.proof.digest);
assert.equal(portableCertificate.body.proof.digest, portable.body.certificate.proof.digest);
assert.ok(history.body.events.length >= 7);
record("protocol-evaluation", "Buffered evidence produced an approved portable allow result, queryable history, and stable certificate proof.", { events:history.body.events.length, digest:portable.body.certificate.proof.digest });

const account = (await api("/v1/accounts", { method:"POST", expected:201, body:{ name:`Food Lens Full Scope ${stamp}`, slug:`food-lens-scope-${stamp}` } })).body;
const project = (await api(`/v1/accounts/${account.id}/projects`, { method:"POST", expected:201, body:{ name:"Food Lens", repository:"OlegGitH/epistemic-engine-demo", owner:"OlegGitH" } })).body;
const aiSystem = (await api(`/v1/projects/${project.id}/ai-systems`, { method:"POST", expected:201, body:{ name:"Food Lens Health Classifier", provider:"deterministic-demo", model:"food-lens-demo-v0.2", purpose:"Classify visible food cues under explicit privacy and epistemic constraints", data_classes:["aggregate_visual_features", "file_metadata"], tools:["health_rule_engine"], owner:"OlegGitH" } })).body;
const connection = (await api(`/v1/projects/${project.id}/connections`, { method:"POST", expected:201, body:{ provider:"github-actions", repository:"OlegGitH/epistemic-engine-demo", endpoint } })).body;
assert.match(connection.token, /^epk_/);
assert.equal(connection.connection.token_hash, undefined);
record("portfolio-registration", "Account, project, declared AI usage, and one-time authenticated connection were created.");

const supportedRun = await createRun("supported", "Deploy a fully evidenced Food Lens revision.");
const supportedEvents = [
  ["build.completed", { status:"passed", artifact:"food-lens-build" }],
  ["test.completed", { status:"passed", suite:"unit and integration tests" }],
  ["compatibility.test.completed", { status:"passed", suite:"legacy API compatibility" }],
  ["privacy.test.completed", { status:"passed", suite:"raw image boundary" }],
  ["rollback.check.completed", { status:"ready", target:"previous revision" }]
];
let duplicateIdentity;
for (const [index, [type, payload]] of supportedEvents.entries()) {
  const event = await addRunEvent(supportedRun.id, index + 1, type, payload, `supported-${index}`);
  if (index === 0) {
    const duplicate = await addRunEvent(supportedRun.id, index + 1, type, payload, `supported-${index}`);
    assert.equal(duplicate.id, event.id);
    duplicateIdentity = duplicate.id;
  }
}
const supportedGraph = (await api(`/v1/runs/${supportedRun.id}/analyze`, { method:"POST" })).body;
assert.equal(supportedGraph.claims.filter(claim => claim.critical && claim.state === "supported").length, 4);
assert.equal(supportedGraph.claims.some(claim => claim.state === "contradicted"), false);
const emptyPlan = await api(`/v1/decisions/${supportedGraph.decision.id}/verification-plan`, { method:"POST", expected:201 });
assert.equal(emptyPlan.body.verifications.length, 0);
const supportedCertificate = (await api(`/v1/decisions/${supportedGraph.decision.id}/evaluate`, { method:"POST", body:{ human_approved:true } })).body;
assert.equal(supportedCertificate.verdict, "VERIFIED");
assert.equal(supportedCertificate.action_allowed, true);
assert.match(supportedCertificate.proof.digest, /^[a-f0-9]{64}$/);
const storedCertificate = await api(`/v1/decisions/${supportedGraph.decision.id}/certificate`);
assert.equal(storedCertificate.body.proof.digest, supportedCertificate.proof.digest);
const snapshot = await readGraphSnapshot(supportedRun.id);
assert.match(snapshot, /event: graph\.snapshot/);
record("supported-control-plane-run", "Five typed observations produced four supported critical claims, no verification work, an approved immutable certificate, idempotent event identity, and an SSE graph snapshot.", { event_id:duplicateIdentity, digest:supportedCertificate.proof.digest });

const insufficientRun = await createRun("insufficient", "Deploy without direct release evidence.");
const insufficientGraph = (await api(`/v1/runs/${insufficientRun.id}/analyze`, { method:"POST" })).body;
assert.ok(insufficientGraph.unknowns.filter(item => item.critical && !item.resolved).length >= 4);
const insufficientCertificate = (await api(`/v1/decisions/${insufficientGraph.decision.id}/evaluate`, { method:"POST", body:{ human_approved:false } })).body;
assert.equal(insufficientCertificate.verdict, "INSUFFICIENT_EVIDENCE");
assert.equal(insufficientCertificate.action_allowed, false);
record("insufficient-evidence-gate", "Missing direct evidence created critical unknowns and a hard insufficient-evidence decision.", { unknowns:insufficientGraph.unknowns.length });

const contradictedRun = await createRun("contradicted", "Deploy a revision with a privacy contradiction.");
await addRunEvent(contradictedRun.id, 1, "build.completed", { status:"passed" }, "contradicted-build");
await addRunEvent(contradictedRun.id, 2, "test.completed", { status:"passed" }, "contradicted-tests");
await addRunEvent(contradictedRun.id, 3, "compatibility.test.completed", { status:"passed" }, "contradicted-compat");
await addRunEvent(contradictedRun.id, 4, "privacy.test.completed", { status:"passed" }, "contradicted-privacy");
await addRunEvent(contradictedRun.id, 5, "log.output", { status:"captured", line:"customer.email=test@example.com" }, "contradicted-log");
const contradictedGraph = (await api(`/v1/runs/${contradictedRun.id}/analyze`, { method:"POST" })).body;
assert.ok(contradictedGraph.claims.some(claim => claim.critical && claim.state === "contradicted"));
assert.ok(contradictedGraph.relations.some(relation => relation.type === "contradicts"));
const contradictedCertificate = (await api(`/v1/decisions/${contradictedGraph.decision.id}/evaluate`, { method:"POST", body:{ human_approved:true } })).body;
assert.equal(contradictedCertificate.verdict, "CONTRADICTED");
assert.equal(contradictedCertificate.action_allowed, false);
record("contradiction-gate", "A PII-bearing log contradicted the privacy claim and blocked action despite human approval.");

const verificationRun = await createRun("verification", "Deploy after bounded compatibility and privacy verification.");
await addRunEvent(verificationRun.id, 1, "build.completed", { status:"passed" }, "verification-build");
await addRunEvent(verificationRun.id, 2, "test.completed", { status:"passed" }, "verification-tests");
const verificationGraph = (await api(`/v1/runs/${verificationRun.id}/analyze`, { method:"POST" })).body;
const plan = await api(`/v1/decisions/${verificationGraph.decision.id}/verification-plan`, { method:"POST", expected:201 });
assert.equal(plan.body.verifications.length, 2);
await api(`/v1/verifications/${plan.body.verifications[0].id}/execute`, { method:"POST", expected:400, body:{ environment:"sandbox", outcome:"passed", artifact:{ exit_code:0 } } });
await api(`/v1/verifications/${plan.body.verifications[0].id}/execute`, { method:"POST", expected:400, body:{ environment:"production", outcome:"passed", artifact:{ exit_code:0 }, approved:true, approved_by:"scope-test" } });
for (const verification of plan.body.verifications) {
  const executed = await api(`/v1/verifications/${verification.id}/execute`, { method:"POST", body:{ environment:"sandbox", outcome:"passed", artifact:{ exit_code:0, check:verification.kind, revision:stamp }, approved:true, approved_by:"scope-test" } });
  assert.match(executed.body.artifact_hash, /^[a-f0-9]{64}$/);
}
const verifiedGraph = (await api(`/v1/runs/${verificationRun.id}/graph`)).body;
assert.equal(verifiedGraph.claims.filter(claim => claim.state === "externally_verified").length, 2);
assert.equal(verifiedGraph.unknowns.every(item => item.resolved), true);
const conditionalCertificate = (await api(`/v1/decisions/${verificationGraph.decision.id}/evaluate`, { method:"POST", body:{ human_approved:false } })).body;
assert.equal(conditionalCertificate.verdict, "VERIFIED_WITH_CONDITIONS");
assert.equal(conditionalCertificate.action_allowed, false);
assert.ok(conditionalCertificate.artifact_hashes.length >= 2);
record("bounded-verification", "Unapproved and production execution were rejected; approved sandbox checks resolved unknowns and produced artifact-addressed conditional verification.", { verifications:plan.body.verifications.length });

const report = {
  schema_version:"food-lens-quality/v1",
  tool:"food-lens-full-scope",
  status:"passed",
  exit_code:0,
  summary:"Application, protocol, control-plane, policy, verification, proof, and publication checks passed.",
  checks:checks.map(({id, status}) => ({id, status}))
};
const ingestPayload = {
  external_id:`scope-publication-${stamp}`,
  ai_system_id:aiSystem.id,
  policy_version:"epistemic.dev/v0.1",
  context:{ repository:"OlegGitH/epistemic-engine-demo", commit_sha:process.env.GITHUB_SHA || "local-full-scope", branch:process.env.GITHUB_REF_NAME || "main", workflow:"Food Lens Full Scope", run_url:"" },
  report,
  certificate:portable.body.certificate
};
const firstIngest = await api("/v1/ingest", { method:"POST", expected:202, token:connection.token, body:ingestPayload });
const retryIngest = await api("/v1/ingest", { method:"POST", expected:202, token:connection.token, body:ingestPayload });
assert.equal(retryIngest.body.report_id, firstIngest.body.report_id);
assert.equal(retryIngest.body.certificate_id, firstIngest.body.certificate_id);
const tampered = structuredClone(ingestPayload);
tampered.external_id = `tampered-${stamp}`;
tampered.certificate.result.action_allowed = false;
await api("/v1/ingest", { method:"POST", expected:400, token:connection.token, body:tampered });
await api("/v1/ingest", { method:"POST", expected:401, token:"invalid-token", body:{ ...ingestPayload, external_id:`unauthorized-${stamp}` } });
record("authenticated-publication", "Portable report publication was idempotent; invalid tokens and a tampered certificate proof were rejected.", { report_id:firstIngest.body.report_id, certificate_id:firstIngest.body.certificate_id });

const dashboard = (await api(`/v1/accounts/${account.id}/dashboard`)).body;
assert.equal(dashboard.metrics.projects, 1);
assert.equal(dashboard.metrics.connected_projects, 1);
assert.ok(dashboard.metrics.reports >= 1);
assert.ok(dashboard.knowledge.claims >= 20);
assert.ok(dashboard.knowledge.contradicted_claims >= 1);
assert.ok(dashboard.certificates.length >= 5);
assert.ok(dashboard.activity.length >= 5);
record("dashboard-aggregation", "The account dashboard aggregated internal runs, knowledge, contradictions, AI usage, the connected report, and both internal and portable certificates.", { metrics:dashboard.metrics, knowledge:dashboard.knowledge });

const revoked = await api(`/v1/connections/${connection.connection.id}`, { method:"DELETE" });
assert.equal(revoked.body.status, "revoked");
await api("/v1/ingest", { method:"POST", expected:401, token:connection.token, body:{ ...ingestPayload, external_id:`revoked-${stamp}` } });
const replacement = await api(`/v1/projects/${project.id}/connections`, { method:"POST", expected:201, body:{ provider:"github-actions", repository:"OlegGitH/epistemic-engine-demo", endpoint } });
assert.equal(replacement.body.connection.status, "active");
const finalDashboard = (await api(`/v1/accounts/${account.id}/dashboard`)).body;
assert.equal(finalDashboard.metrics.connected_projects, 1);
record("connection-revocation", "A revoked project token could no longer publish, and rotation restored an active connection without exposing the replacement token in the report.");

const finishedAt = new Date();
const scopeReport = {
  schema_version:"epistemic-engine-scope/v1",
  status:"passed",
  endpoint,
  storage:health.body.storage || "unknown",
  durable:health.body.durable === true,
  started_at:startedAt.toISOString(),
  finished_at:finishedAt.toISOString(),
  duration_ms:finishedAt - startedAt,
  account_id:account.id,
  project_id:project.id,
  dashboard_url:`http://127.0.0.1:3000/?account=${account.id}`,
  persistence_probe:{ account_id:account.id, project_id:project.id, run_id:supportedRun.id, decision_id:supportedGraph.decision.id, certificate_digest:supportedCertificate.proof.digest },
  checks,
  exclusions:[
    durableRequired
      ? "No persistence exclusion: PostgreSQL is required for this run and restart survival is checked separately."
      : "PostgreSQL restart persistence is checked only when EPISTEMIC_REQUIRE_DURABLE=true.",
    "Docker/Codex/OpenAI adapters are optional approval-gated integrations and are not invoked by this dependency-free demo harness.",
    "GCP infrastructure deployment is not exercised by a local engine run."
  ]
};
await mkdir(".epistemic", { recursive:true });
await writeFile(".epistemic/engine-scope-report.json", JSON.stringify(scopeReport, null, 2) + "\n");
console.log(`epistemic-engine-full-scope-ok (${checks.length} checks)`);
console.log(`dashboard: ${scopeReport.dashboard_url}`);

async function createRun(label, recommendation) {
  return (await api("/v1/runs", { method:"POST", expected:201, body:{ account_id:account.id, project_id:project.id, ai_system_id:aiSystem.id, external_trace_id:`${label}-${stamp}`, title:`Food Lens ${label} scenario`, source:"food-lens-full-scope", recommendation, action_type:"software_deployment", subject:"OlegGitH/epistemic-engine-demo", risk_level:"high" } })).body;
}

async function addRunEvent(runID, sequence, type, payload, suffix) {
  return (await api(`/v1/runs/${runID}/events`, { method:"POST", expected:202, body:{ external_id:`${suffix}-${stamp}`, sequence, type, source:"food-lens-scope", correlation_id:stamp, payload } })).body;
}

function protocolEvent(suffix, type, sequence, data) {
  const id = `${suffix}-${stamp}`;
  return { spec_version:"0.1", id, type, source:{ name:"food-lens-scope", version:"1" }, subject:{ type:"repository", id:"OlegGitH/epistemic-engine-demo" }, time:new Date().toISOString(), context:{ decision_id:portableDecision, run_id:portableRun, correlation_id:stamp }, ordering:{ sequence, partition:portableRun }, idempotency_key:id, data };
}

async function readGraphSnapshot(runID) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${endpoint}/v1/runs/${runID}/events/stream`, { signal:controller.signal });
    assert.equal(response.status, 200);
    const { value } = await response.body.getReader().read();
    return new TextDecoder().decode(value);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function api(path, { method="GET", body, token, expected=200, headers={} } = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${endpoint}${path}`, { method, headers:requestHeaders, body:body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    throw new Error(`Cannot reach Epistemic Engine at ${endpoint}: ${error.message}`);
  }
  const text = await response.text();
  let parsed = {};
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = { raw:text }; }
  }
  assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, received ${response.status}: ${text}`);
  return { status:response.status, headers:response.headers, body:parsed };
}
