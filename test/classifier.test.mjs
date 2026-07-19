import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFoodImage } from "../src/classifier.mjs";

test("salad image is classified as healthy with traceable evidence",()=>{
  const result=analyzeFoodImage({filename:"garden-salad.jpg",mime_type:"image/jpeg",size:42000,image_sha256:"abc",features:{average_rgb:[74,151,78],brightness:118,colorfulness:63,edge_density:.12}});
  assert.equal(result.classification,"healthy");
  assert.ok(result.score>=68);
  assert.equal(result.evidence.image_sha256,"abc");
  assert.ok(result.signals.some(item=>item.label==="Whole-food cue"));
});

test("donut image is classified as less healthy",()=>{
  const result=analyzeFoodImage({filename:"pink-donut.png",features:{average_rgb:[218,143,132],brightness:164,colorfulness:46,edge_density:.08}});
  assert.equal(result.classification,"less_healthy");
  assert.ok(result.score<43);
});

test("unknown image produces a bounded mixed result",()=>{
  const result=analyzeFoodImage({filename:"camera-upload.webp",features:{average_rgb:[128,126,124],brightness:126,colorfulness:18,edge_density:.02}});
  assert.equal(result.classification,"mixed");
  assert.ok(result.confidence>=62&&result.confidence<=96);
  assert.match(result.disclaimer,/not medical/i);
});
