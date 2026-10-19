import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { captureConnectedBrowserSource, validateConnectedBrowserSource } from "../src/connected_browser_source.js";
import { projectCurrentGradebook } from "../src/current_gradebook.js";
import { currentGradebookFixture, fixtureStyle } from "./helpers/current_gradebook_fixture.js";

async function fixture(studentId, action) {
  const directory=mkdtempSync(path.join(tmpdir(),"schoology-driver-test-"));
  const runtime=path.join(directory,"browser-client.mjs");
  writeFileSync(runtime,"export async function setupBrowserRuntime(){return globalThis.__schoologyFixtureApi;}\n");
  const previousApi=globalThis.__schoologyFixtureApi,previousRepl=globalThis.nodeRepl;
  const calls={roster:0,newTabs:0,navigations:0,menuVisible:false,menuClicks:0,menuWaits:0,closedCourse:false,output:[],inventory:[{id:"runtime-browser",type:"extension",metadata:{extensionInstanceId:"11111111-1111-4111-8111-111111111111"}}]};
  const config={browserSourceExtensionInstanceId:"11111111-1111-4111-8111-111111111111",browserSourceRuntimeModule:runtime,principalId:"telegram:-10001",studentProfileId:"123",currentTermId:"456",currentTerm:"MP 1 2026-2027"};
  const document=currentGradebookFixture({studentId,currentTermId:"456",label:config.currentTerm,courses:[{items:[{title:"Fixture submitted",href:"/assignment/789",submitted:true}]}]});
  const tab={id:"fixture-tab",url:async()=>"https://bcps.schoology.com/grades/grades",goto:async url=>{assert.equal(url,"https://bcps.schoology.com/grades/grades");calls.navigations++;},reload:async()=>{calls.navigations++;},playwright:{
    getByRole:()=>({isVisible:async()=>calls.menuVisible,waitFor:async()=>{calls.menuWaits++;calls.menuVisible=true;}}),
    locator:selector=>({all:async()=>{assert.equal(selector,".gradebook-course-title");calls.roster++;return [{click:async()=>{calls.menuVisible=false;calls.closedCourse=false;}}];},click:async()=>{assert.equal(selector,"button.Z_KgC");calls.menuClicks++;}}),
    evaluate:async expression=>{
      if(String(expression).includes('profiles:')&&!calls.menuVisible)throw Error("Identity was read before menu readiness");
      return runInNewContext(typeof expression==="function"?`(${expression.toString()})()`:expression,{document,location:{origin:"https://bcps.schoology.com",pathname:"/grades/grades"},getComputedStyle:node=>({...fixtureStyle(node),...(calls.closedCourse&&node.classes.has("gradebook-course-grades")?{display:"none"}:{})}),URL});
    },
  }};
  globalThis.__schoologyFixtureApi={browsers:{list:async()=>calls.inventory,get:async id=>{assert.equal(id,calls.inventory[0].id);return {nameSession:async()=>{},tabs:{list:async()=>[],new:async()=>{calls.newTabs++;return tab;}}};}}};
  globalThis.nodeRepl={write:text=>calls.output.push(text)};
  try {
    await action({config,calls,options:{runtimeModule:pathToFileURL(runtime).href,extensionInstanceId:config.browserSourceExtensionInstanceId,readerSha256:createHash("sha256").update(projectCurrentGradebook.toString()).digest("hex"),expectedScope:{principalId:config.principalId,studentId:"123",currentTermId:"456",currentTermLabel:config.currentTerm}}});
  } finally {
    globalThis.__schoologyFixtureApi=previousApi;globalThis.nodeRepl=previousRepl;
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));
    assert.ok(path.basename(directory).startsWith("schoology-driver-test-"));
    rmSync(directory,{recursive:true,force:true});
  }
}

test("actual app driver uses the supported SDK and emits the original qualified projection once", async()=>fixture("123",async({config,calls,options})=>{
  await captureConnectedBrowserSource(options);
  assert.equal(calls.newTabs,1);assert.equal(calls.navigations,1);assert.equal(calls.output.length,1);
  assert.equal(calls.menuClicks,1);assert.equal(calls.menuWaits,2);
  const envelope=JSON.parse(calls.output[0].slice("SCHOOLOGY_SOURCE_V1:".length));
  assert.equal(envelope.browserId,"runtime-browser");
  assert.equal(envelope.browserExtensionInstanceId,config.browserSourceExtensionInstanceId);
  const validated=validateConnectedBrowserSource(config,envelope);
  assert.equal(validated.source.snapshot.assignments[0].status,"Submitted, awaiting grade");
  assert.equal(validated.source.snapshot.complete,true);
  assert.deepEqual(Object.keys(validated.source.snapshot.assignments[0]).sort(),["course","dueDate","isMissing","status","title","url"]);
}));

test("course expansion restores and verifies the identity menu before projection",async()=>fixture("123",async({calls,options})=>{
  calls.closedCourse=true;
  await captureConnectedBrowserSource(options);
  assert.equal(calls.menuClicks,2);assert.equal(calls.menuWaits,2);assert.equal(calls.output.length,1);
}));

for (const mode of ["missing", "ambiguous"]) test(`actual app driver refuses ${mode} extension before tab or record access`,async()=>fixture("123",async({calls,options})=>{
  calls.inventory=mode==="missing"?[]:[...calls.inventory,...calls.inventory];
  await assert.rejects(captureConnectedBrowserSource(options),/Exact sanctioned browser extension missing or ambiguous/);
  assert.equal(calls.newTabs,0);assert.equal(calls.roster,0);assert.deepEqual(calls.output,[]);
}));

test("actual app driver resolves a changed runtime browser ID from stable metadata",async()=>fixture("123",async({calls,options})=>{
  calls.inventory[0].id="another-runtime-id";
  await captureConnectedBrowserSource(options);
  assert.equal(JSON.parse(calls.output[0].slice("SCHOOLOGY_SOURCE_V1:".length)).browserId,"another-runtime-id");
}));

test("actual app driver refuses a different student before roster/assignment access",async()=>fixture("999",async({calls,options})=>{
  await assert.rejects(captureConnectedBrowserSource(options),/Approved source account required before roster access/);
  assert.equal(calls.roster,0);assert.deepEqual(calls.output,[]);
}));
