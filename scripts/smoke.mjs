import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port=4399; const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,["server.mjs"],{cwd:new URL("..",import.meta.url),env:{...process.env,PORT:String(port)},stdio:"ignore"});
try {
  for(let attempt=0;attempt<40;attempt++){try{if((await fetch(`${base}/api/health`)).ok)break}catch{}await new Promise(resolve=>setTimeout(resolve,100));if(attempt===39)throw new Error("server did not start")}
  const page=await fetch(base); assert.equal(page.status,200); assert.match(await page.text(),/Food Lens/);
  const response=await fetch(`${base}/api/analyze`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:"salad-bowl.svg",features:{average_rgb:[70,155,74],brightness:116,colorfulness:70,edge_density:.14}})});
  assert.equal(response.status,200); const result=await response.json(); assert.equal(result.classification,"healthy"); assert.ok(result.evidence.model);
  console.log("food-lens-smoke-ok");
} finally { child.kill(); }
