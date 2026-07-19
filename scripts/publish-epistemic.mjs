import { readFile } from "node:fs/promises";

const endpoint=(process.env.EPISTEMIC_ENDPOINT||"").replace(/\/$/,"");
const token=process.env.EPISTEMIC_INGEST_TOKEN||"";
if(!endpoint||!token){console.log("Epistemic dashboard publishing skipped: endpoint or ingest token is not configured.");process.exit(0)}

const certificate=JSON.parse(await readFile(process.env.EPISTEMIC_CERTIFICATE_PATH||".epistemic/certificate.json","utf8"));
const report=JSON.parse(await readFile(process.env.EPISTEMIC_REPORT_PATH||".epistemic/project-quality.json","utf8"));
const repository=process.env.GITHUB_REPOSITORY||"OlegGitH/epistemic-engine-demo";
const runID=process.env.GITHUB_RUN_ID||String(Date.now());
const attempt=process.env.GITHUB_RUN_ATTEMPT||"1";
const response=await fetch(`${endpoint}/v1/ingest`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({external_id:`github-${repository}-${runID}-${attempt}`,ai_system_id:process.env.EPISTEMIC_AI_SYSTEM_ID||"",policy_version:"epistemic.dev/v0.1",context:{repository,commit_sha:process.env.GITHUB_SHA||"",branch:process.env.GITHUB_REF_NAME||"",workflow:process.env.GITHUB_WORKFLOW||"Food Lens CI",run_url:`${process.env.GITHUB_SERVER_URL||"https://github.com"}/${repository}/actions/runs/${runID}`},report,certificate})});
const body=await response.text();
if(!response.ok)throw new Error(`Epistemic publish failed (${response.status}): ${body}`);
console.log(`Published Epistemic report and certificate: ${body}`);
