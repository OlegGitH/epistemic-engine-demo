const $=(id)=>document.getElementById(id);
const stages=["capture","features","classify","explain"];
const els={input:$("image-input"),drop:$("dropzone"),prompt:$("upload-prompt"),preview:$("preview"),replace:$("replace"),empty:$("empty-result"),loading:$("loading-result"),loadingCopy:$("loading-copy"),result:$("result"),badge:$("verdict-badge"),score:$("score"),ring:$("score-ring"),classification:$("classification"),summary:$("summary"),confidence:$("confidence"),detected:$("detected-items"),signals:$("signals"),disclaimer:$("disclaimer"),trace:$("trace-state"),evidence:$("evidence"),evidenceEmpty:$("evidence-empty")};

els.input.addEventListener("change",()=>{if(els.input.files?.[0])void analyzeFile(els.input.files[0])});
els.replace.addEventListener("click",(event)=>{event.preventDefault();els.input.click()});
els.drop.addEventListener("dragover",(event)=>{event.preventDefault();els.drop.classList.add("dragging")});
els.drop.addEventListener("dragleave",()=>els.drop.classList.remove("dragging"));
els.drop.addEventListener("drop",(event)=>{event.preventDefault();els.drop.classList.remove("dragging");const file=event.dataTransfer?.files?.[0];if(file)void analyzeFile(file)});
document.querySelectorAll(".sample").forEach((button)=>button.addEventListener("click",async()=>{const response=await fetch(button.dataset.src);const blob=await response.blob();void analyzeFile(new File([blob],button.dataset.name,{type:blob.type}))}));
const requestedSample=new URLSearchParams(location.search).get("sample");
const sampleNames={salad:"garden-salad-bowl.svg",pizza:"cheese-pizza.svg",donut:"pink-donut.svg"};
if(sampleNames[requestedSample])setTimeout(()=>document.querySelector(`[data-name="${sampleNames[requestedSample]}"]`).click(),150);

async function analyzeFile(file){
  if(!file.type.startsWith("image/")){showError("Please choose an image file.");return}
  const objectURL=URL.createObjectURL(file);els.preview.src=objectURL;els.preview.hidden=false;els.prompt.hidden=true;els.replace.hidden=false;
  resetStages();els.empty.hidden=true;els.result.hidden=true;els.loading.hidden=false;els.badge.className="verdict-badge working";els.badge.textContent="Analyzing";
  try{
    stage("capture","active");els.loadingCopy.textContent="Decoding image locally…";const image=await loadImage(objectURL);await pause(180);stage("capture","done");
    stage("features","active");els.loadingCopy.textContent="Extracting aggregate visual features…";const features=extractFeatures(image);const imageHash=await sha256(file);await pause(220);stage("features","done");
    stage("classify","active");els.loadingCopy.textContent="Applying the demo scoring model…";const response=await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:file.name,mime_type:file.type,size:file.size,image_sha256:imageHash,features})});if(!response.ok)throw new Error("Analysis API failed");const result=await response.json();await pause(220);stage("classify","done");
    stage("explain","active");els.loadingCopy.textContent="Building the evidence explanation…";await pause(180);renderResult(result);stage("explain","done");els.trace.textContent="Complete";
  }catch(error){showError(error.message||"Could not analyze this image")}finally{URL.revokeObjectURL(objectURL)}
}

function extractFeatures(image){
  const canvas=document.createElement("canvas");canvas.width=48;canvas.height=48;const context=canvas.getContext("2d",{willReadFrequently:true});context.drawImage(image,0,0,48,48);const {data}=context.getImageData(0,0,48,48);
  let red=0,green=0,blue=0,count=0,colorfulness=0,edges=0,edgeChecks=0;
  for(let index=0;index<data.length;index+=4){if(data[index+3]<20)continue;const r=data[index],g=data[index+1],b=data[index+2];red+=r;green+=g;blue+=b;colorfulness+=(Math.abs(r-g)+Math.abs(g-b)+Math.abs(b-r))/3;count++;if(index>=16){const delta=Math.abs(r-data[index-16])+Math.abs(g-data[index-15])+Math.abs(b-data[index-14]);if(delta>95)edges++;edgeChecks++}}
  count=Math.max(1,count);const average=[red,green,blue].map(value=>Math.round(value/count));return{average_rgb:average,brightness:Math.round((average[0]*.299)+(average[1]*.587)+(average[2]*.114)),colorfulness:Math.round(colorfulness/count),edge_density:Number((edges/Math.max(1,edgeChecks)).toFixed(3))};
}

function renderResult(value){
  els.loading.hidden=true;els.result.hidden=false;els.badge.className=`verdict-badge ${value.classification}`;els.badge.textContent=value.classification.replace("_"," ");els.score.textContent=value.score;els.ring.style.setProperty("--score",`${value.score*3.6}deg`);els.ring.dataset.tone=value.classification;els.classification.textContent=value.classification==="healthy"?"Looks balanced":value.classification==="less_healthy"?"Treat-like cues":"Mixed signals";els.summary.textContent=value.summary;els.confidence.textContent=`${value.confidence}%`;els.detected.innerHTML=value.detected_items.map(item=>`<span>${escapeHTML(item)}</span>`).join("");els.signals.innerHTML=value.signals.map(item=>`<article><i class="${item.impact}"></i><span>${escapeHTML(item.label)}</span><b>${escapeHTML(item.value)}</b></article>`).join("");els.disclaimer.textContent=value.disclaimer;
  els.evidenceEmpty.hidden=true;els.evidence.hidden=false;$("evidence-model").textContent=value.evidence.model;$("evidence-hash").textContent=`${value.evidence.image_sha256.slice(0,22)}…`;$("evidence-method").textContent=value.evidence.method;
}

function resetStages(){stages.forEach(name=>stage(name,""));els.trace.textContent="Running";els.evidence.hidden=true;els.evidenceEmpty.hidden=false}
function stage(name,status){const element=document.querySelector(`[data-stage="${name}"]`);element.classList.remove("active","done");if(status)element.classList.add(status)}
function showError(message){els.loading.hidden=true;els.empty.hidden=false;els.empty.querySelector("h3").textContent="Analysis unavailable";els.empty.querySelector("p").textContent=message;els.badge.className="verdict-badge error";els.badge.textContent="Error";els.trace.textContent="Stopped"}
function loadImage(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error("The image could not be decoded."));image.src=url})}
async function sha256(file){const value=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());return[...new Uint8Array(value)].map(byte=>byte.toString(16).padStart(2,"0")).join("")}
function pause(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function escapeHTML(value){return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char])}
