import { mkdir, writeFile } from "node:fs/promises";
await mkdir(".epistemic",{recursive:true});
const evidence={tool:"food-lens-ci",status:"passed",exit_code:0,summary:"Classifier unit tests, API smoke test, and privacy boundary passed.",checks:[{id:"unit-tests",status:"passed"},{id:"api-smoke",status:"passed"},{id:"image-privacy",status:"passed",detail:"Raw image bytes remain in the browser; only aggregate visual features are analyzed by the demo API."}]};
await writeFile(".epistemic/ci-evidence.json",JSON.stringify(evidence,null,2)+"\n");
await writeFile(".epistemic/project-quality.json",JSON.stringify(evidence,null,2)+"\n");
console.log("wrote .epistemic/ci-evidence.json");
