import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const endpoint = (process.env.EPISTEMIC_ENDPOINT || "http://127.0.0.1:8080").replace(/\/$/, "");
const dashboardEndpoint = (process.env.EPISTEMIC_DASHBOARD_ENDPOINT || "http://127.0.0.1:3000").replace(/\/$/, "");
const manifest = JSON.parse(await readFile("epistemic-scenario.json", "utf8"));
assert.equal(manifest.schema_version, "epistemic-branch-scenario/v1");

const scenarios = {
  "supported-release": {
    title:"Supported release",
    description:"A fully evidenced release is verified and allowed.",
    recommendation:"Deploy a fully evidenced Food Lens revision.",
    expectedVerdict:"VERIFIED",
    expectedActionAllowed:true,
    events:[
      ["build.completed", { status:"passed", artifact:"food-lens-build" }],
      ["test.completed", { status:"passed", suite:"unit and integration tests" }],
      ["compatibility.test.completed", { status:"passed", suite:"legacy API compatibility" }],
      ["privacy.test.completed", { status:"passed", suite:"raw image boundary" }],
      ["rollback.check.completed", { status:"ready", target:"previous revision" }]
    ],
    humanApproved:true,
    validate(graph) {
      assert.equal(graph.claims.filter(claim => claim.critical && claim.state === "supported").length, 4);
      assert.equal(graph.claims.some(claim => claim.state === "contradicted"), false);
    }
  },
  "insufficient-evidence": {
    title:"Insufficient evidence",
    description:"Missing direct release evidence produces critical unknowns and blocks deployment.",
    recommendation:"Deploy without direct release evidence.",
    expectedVerdict:"INSUFFICIENT_EVIDENCE",
    expectedActionAllowed:false,
    events:[],
    humanApproved:false,
    validate(graph) {
      assert.ok(graph.unknowns.filter(item => item.critical && !item.resolved).length >= 4);
    }
  },
  "privacy-contradiction": {
    title:"Privacy contradiction",
    description:"A PII-bearing log contradicts the privacy claim and blocks deployment despite approval.",
    recommendation:"Deploy a revision whose runtime log contradicts its privacy claim.",
    expectedVerdict:"CONTRADICTED",
    expectedActionAllowed:false,
    events:[
      ["build.completed", { status:"passed" }],
      ["test.completed", { status:"passed" }],
      ["compatibility.test.completed", { status:"passed" }],
      ["privacy.test.completed", { status:"passed" }],
      ["log.output", { status:"captured", line:"customer.email=test@example.com" }]
    ],
    humanApproved:true,
    validate(graph) {
      assert.ok(graph.claims.some(claim => claim.critical && claim.state === "contradicted"));
      assert.ok(graph.relations.some(relation => relation.type === "contradicts"));
    }
  },
  "bounded-verification": {
    title:"Bounded verification",
    description:"Approved sandbox checks resolve unknowns, but deployment remains conditional pending human approval.",
    recommendation:"Deploy after sandboxed compatibility and privacy verification.",
    expectedVerdict:"VERIFIED_WITH_CONDITIONS",
    expectedActionAllowed:false,
    events:[
      ["build.completed", { status:"passed" }],
      ["test.completed", { status:"passed" }]
    ],
    humanApproved:false,
    async verify(graph, api) {
      const plan = (await api(`/v1/decisions/${graph.decision.id}/verification-plan`, { method:"POST", expected:201 })).body;
      assert.equal(plan.verifications.length, 2);
      await api(`/v1/verifications/${plan.verifications[0].id}/execute`, {
        method:"POST",
        expected:400,
        body:{ environment:"sandbox", outcome:"passed", artifact:{ exit_code:0 } }
      });
      await api(`/v1/verifications/${plan.verifications[0].id}/execute`, {
        method:"POST",
        expected:400,
        body:{ environment:"production", outcome:"passed", artifact:{ exit_code:0 }, approved:true, approved_by:"branch-scenario" }
      });
      for (const verification of plan.verifications) {
        const executed = (await api(`/v1/verifications/${verification.id}/execute`, {
          method:"POST",
          body:{
            environment:"sandbox",
            outcome:"passed",
            artifact:{ exit_code:0, check:verification.kind, scenario:scenarioID },
            approved:true,
            approved_by:"branch-scenario"
          }
        })).body;
        assert.match(executed.artifact_hash, /^[a-f0-9]{64}$/);
      }
      const resolved = (await api(`/v1/runs/${graph.run.id}/graph`)).body;
      assert.equal(resolved.claims.filter(claim => claim.state === "externally_verified").length, 2);
      assert.equal(resolved.unknowns.every(item => item.resolved), true);
      return { graph:resolved, verifications:plan.verifications.length };
    }
  }
};

const scenarioID = process.env.GITHUB_ACTIONS === "true"
  ? manifest.scenario
  : process.env.EPISTEMIC_SCENARIO || manifest.scenario;
const scenario = scenarios[scenarioID];
assert.ok(scenario, `unknown scenario: ${scenarioID}`);
const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || manifest.branch || "local";
if (process.env.GITHUB_ACTIONS === "true" && manifest.branch) {
  assert.equal(branch, manifest.branch, `scenario manifest is intended for ${manifest.branch}, not ${branch}`);
}

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const health = (await api("/health")).body;
assert.equal(health.status, "ok");
if (process.env.EPISTEMIC_REQUIRE_DURABLE === "true") {
  assert.equal(health.storage, "postgresql");
  assert.equal(health.durable, true);
}

const account = (await api("/v1/accounts", {
  method:"POST",
  expected:201,
  body:{ name:`Food Lens · ${scenario.title} · ${branch}`, slug:`food-lens-${scenarioID}-${stamp}` }
})).body;
const project = (await api(`/v1/accounts/${account.id}/projects`, {
  method:"POST",
  expected:201,
  body:{ name:`Food Lens · ${scenario.title}`, repository:"OlegGitH/epistemic-engine-demo", owner:"OlegGitH" }
})).body;
const aiSystem = (await api(`/v1/projects/${project.id}/ai-systems`, {
  method:"POST",
  expected:201,
  body:{
    name:"Food Lens Health Classifier",
    provider:"deterministic-demo",
    model:"food-lens-demo-v0.2",
    purpose:"Classify visible food cues under explicit privacy and epistemic constraints",
    data_classes:["aggregate_visual_features", "file_metadata"],
    tools:["health_rule_engine"],
    owner:"OlegGitH"
  }
})).body;
const run = (await api("/v1/runs", {
  method:"POST",
  expected:201,
  body:{
    account_id:account.id,
    project_id:project.id,
    ai_system_id:aiSystem.id,
    external_trace_id:`branch-${scenarioID}-${stamp}`,
    title:`Food Lens · ${scenario.title}`,
    source:"food-lens-branch-scenario",
    recommendation:scenario.recommendation,
    action_type:"software_deployment",
    subject:"OlegGitH/epistemic-engine-demo",
    risk_level:"high"
  }
})).body;

for (const [index, [type, payload]] of scenario.events.entries()) {
  await api(`/v1/runs/${run.id}/events`, {
    method:"POST",
    expected:202,
    body:{
      external_id:`${scenarioID}-${index + 1}-${stamp}`,
      sequence:index + 1,
      type,
      source:"food-lens-branch-scenario",
      correlation_id:stamp,
      payload
    }
  });
}

let graph = (await api(`/v1/runs/${run.id}/analyze`, { method:"POST" })).body;
scenario.validate?.(graph);
let verification = { verifications:0 };
if (scenario.verify) {
  verification = await scenario.verify(graph, api);
  graph = verification.graph;
}

const certificate = (await api(`/v1/decisions/${graph.decision.id}/evaluate`, {
  method:"POST",
  body:{ human_approved:scenario.humanApproved }
})).body;
assert.equal(certificate.verdict, scenario.expectedVerdict);
assert.equal(certificate.action_allowed, scenario.expectedActionAllowed);
assert.match(certificate.proof.digest, /^[a-f0-9]{64}$/);

const humanReport = (await api(`/v1/decisions/${graph.decision.id}/certificate/report`)).body;
assert.equal(humanReport.proof.digest, certificate.proof.digest);
assert.match(humanReport.markdown, /Epistemic Decision Report/);
const dashboard = (await api(`/v1/accounts/${account.id}/dashboard`)).body;
assert.ok(dashboard.projects.some(item => item.id === project.id && item.runs >= 1));
assert.ok(dashboard.certificates.some(item => item.digest === certificate.proof.digest));

const dashboardUrl = `${dashboardEndpoint}/?account=${account.id}`;
const report = {
  schema_version:"epistemic-branch-scenario-result/v1",
  tool:"epistemic-branch-scenario",
  status:"passed",
  exit_code:0,
  summary:scenario.description,
  scenario:scenarioID,
  branch,
  description:scenario.description,
  expected:{ verdict:scenario.expectedVerdict, action_allowed:scenario.expectedActionAllowed },
  observed:{ verdict:certificate.verdict, action_allowed:certificate.action_allowed },
  engine:{ endpoint, storage:health.storage || "unknown", durable:health.durable === true },
  dashboard_url:dashboardUrl,
  account_id:account.id,
  project_id:project.id,
  ai_system_id:aiSystem.id,
  run_id:run.id,
  decision_id:graph.decision.id,
  certificate_digest:certificate.proof.digest,
  evidence:{ events:scenario.events.length, claims:graph.claims.length, unknowns:graph.unknowns.length, verifications:verification.verifications },
  persistence_probe:{ account_id:account.id, project_id:project.id, run_id:run.id, decision_id:graph.decision.id, certificate_digest:certificate.proof.digest }
};

await mkdir(".epistemic", { recursive:true });
await Promise.all([
  writeFile(".epistemic/branch-scenario-report.json", JSON.stringify(report, null, 2) + "\n"),
  writeFile(".epistemic/branch-certificate.json", JSON.stringify(certificate, null, 2) + "\n"),
  writeFile(".epistemic/branch-certificate-report.md", humanReport.markdown)
]);

console.log(`epistemic-branch-scenario-ok: ${scenarioID}`);
console.log(`outcome: ${certificate.verdict} (action ${certificate.action_allowed ? "allowed" : "blocked"})`);
console.log(`dashboard: ${dashboardUrl}`);

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
  let parsed = {};
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = { raw:text }; }
  }
  assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, received ${response.status}: ${text}`);
  return { body:parsed, status:response.status };
}
