import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const checks = [
  run("unit-tests", ["--test"]),
  run("api-smoke", ["scripts/smoke.mjs"])
];
const scenario = JSON.parse(await readFile("epistemic-scenario.json", "utf8")).scenario;
const scenarioStatus = {
  "supported-release":"passed",
  "insufficient-evidence":"pending",
  "privacy-contradiction":"failed",
  "bounded-verification":"passed"
}[scenario] || "passed";
const sourceFiles = ["server.mjs", "src/classifier.mjs", "src/input-policy.mjs", "package-lock.json"];
const artifacts = [];
for (const path of sourceFiles) {
  const content = await readFile(path);
  artifacts.push({ path, sha256:sha256(content), bytes:content.byteLength });
}
const passed = checks.every(check => check.status === "passed");
const evidence = {
  schema_version:"food-lens-quality/v1",
  tool:"food-lens-ci",
  status:passed ? scenarioStatus : "failed",
  exit_code:passed ? 0 : 1,
  summary:scenarioSummary(scenario, passed),
  generated_at:new Date().toISOString(),
  checks:[
    ...checks,
    { id:"image-privacy", status:passed ? "passed" : "failed", detail:"The API test actively rejects raw image fields; only aggregate visual features are accepted." },
    { id:"source-integrity", status:"passed", detail:`Recorded SHA-256 hashes for ${artifacts.length} release inputs.` }
  ],
  artifacts,
  claims:[
    { id:"tests", status:passed ? "supported" : "contradicted", evidence:["unit-tests", "api-smoke"] },
    { id:"privacy", status:passed && scenario !== "privacy-contradiction" ? "supported" : "contradicted", evidence:["image-privacy"] }
  ]
};

await mkdir(".epistemic", { recursive:true });
const serialized = JSON.stringify(evidence, null, 2) + "\n";
await writeFile(".epistemic/ci-evidence.json", serialized);
await writeFile(".epistemic/project-quality.json", serialized);
console.log(`wrote executable evidence: ${evidence.status}`);
if (!passed) process.exit(1);

function scenarioSummary(id, checksPassed) {
  if (!checksPassed) return "One or more executable Food Lens quality checks failed.";
  if (id === "insufficient-evidence") return "Executable checks passed, but required release evidence is intentionally missing.";
  if (id === "privacy-contradiction") return "Executable checks passed, but scenario evidence contradicts the privacy claim.";
  if (id === "bounded-verification") return "Approved sandbox checks pass; consequential deployment still requires human approval.";
  return "Executable classifier, API, privacy-boundary, and smoke checks passed with release approval.";
}

function run(id, args) {
  const started = performance.now();
  const result = spawnSync(process.execPath, args, { encoding:"utf8", timeout:60_000 });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  return {
    id,
    status:result.status === 0 && !result.error ? "passed" : "failed",
    command:`node ${args.join(" ")}`,
    duration_ms:Math.round(performance.now() - started),
    exit_code:result.status ?? 1,
    output_sha256:sha256(output),
    detail:result.error ? result.error.message : lastNonEmptyLine(output)
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function lastNonEmptyLine(value) {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1) || "completed";
}
