import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { openSubscriptionToolStore, importQualifiedSource, executeSubscriptionTool } from "../src/subscription_tools.js";
import { createPluginHandler, serveStdio, backendArtifactPaths } from "../plugins/schoology-tools/server.mjs";

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const digest=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const row={course:"Geometry",title:"Geometry practice",url:"https://bcps.schoology.com/assignment/789",dueDate:"10/21/26 11:59pm",status:"Missing",isMissing:true};
const call=(name,arguments_={},id=2)=>({jsonrpc:"2.0",id,method:"tools/call",params:{name,arguments:arguments_}});
const op=label=>`schoology-plugin-fixture-${label}`;
async function initialize(handler){await handler({jsonrpc:"2.0",id:0,method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"fixture",version:"1"}}});await handler({jsonrpc:"2.0",method:"notifications/initialized"});}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"schoology-plugin-fixture-"));
  const config={databasePath:path.join(dir,"agent.db"),principalId:"telegram:fixture",studentProfileId:"123",currentTermId:"456",currentTerm:"MP 1 2026-2027",browserProfileDirectory:path.join(dir,"schoology-app-profile"),username:"fixture@bcps.org"};
  const db=openSubscriptionToolStore(config);
  importQualifiedSource(db,config,{format:"schoology-qualified-current-term/v1",subjectVerified:true,currentTermVerified:true,sourceScope:{principalId:config.principalId,studentId:"123",currentTermId:"456"},currentTerm:{id:"456",label:config.currentTerm},snapshot:{complete:true,sourceOrigin:"https://bcps.schoology.com",observedAt:new Date().toISOString(),assignments:[row]}});
  const configPath=path.join(dir,"tools.json"),authPath=path.join(dir,"auth.json"),connectionPath=path.join(dir,"connection.json");
  fs.writeFileSync(configPath,JSON.stringify(config));fs.writeFileSync(authPath,JSON.stringify({state:"AUTH_REQUIRED_IN_APP_CHROME"}));
  const files=backendArtifactPaths(root);
  const connection={format:"schoology-local-plugin-connection/v1",backendRoot:root,toolConfigPath:configPath,toolConfigSha256:digest(configPath),operationDirectory:path.join(dir,"operations"),sourceAuthStatusPath:authPath,principalId:config.principalId,studentProfileId:"123",currentTermId:"456",currentTerm:config.currentTerm,backendFiles:Object.fromEntries(files.map(relative=>[relative,digest(path.join(root,relative))]))};
  fs.writeFileSync(connectionPath,JSON.stringify(connection));
  return {dir,db,config,configPath,authPath,connectionPath,connection,close(){db.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

test("plugin protocol discovers the bounded tools and refuses malformed/unsupported input before backend calls",async()=>{
  const f=fixture();let calls=0;const handler=createPluginHandler({connectionPath:f.connectionPath,backend:async()=>{calls++;throw Error();}});
  try{
    assert.equal((await handler(call("list_assignments",{operationId:op("early")}))).error.code,-32000);
    await initialize(handler);
    const list=await handler({jsonrpc:"2.0",id:1,method:"tools/list"});
    assert.equal(list.result.tools.length,9);
    assert.equal(list.result.tools.some(t=>/reminder|send_message|submit_homework/.test(t.name)),false);
    for(const bad of [call("drain_due_reminders",{}),call("list_assignments",{}),call("list_assignments",{operationId:op("badarg"),databasePath:"other"}),call("list_assignments",{operationId:op("badlimit"),limit:101}),call("update_assignment_status",{operationId:op("bulk"),target:["a","b"],status:"E"})]) assert.equal((await handler(bad)).error.code,-32602);
    const status=(await handler(call("schoology_connection_status"))).result.structuredContent;
    assert.equal(status.configurationValidated,true);assert.equal(status.sourceSession,"AUTH_REQUIRED_IN_APP_CHROME");assert.equal(status.liveRefreshVerified,false);
    assert.equal(calls,0);assert.equal(fs.readdirSync(f.connection.operationDirectory).length,0);
  }finally{f.close();}
});

test("actual original CLI shares SQLite, preserves UTF8, journals local changes and refuses replay across MCP restart",async()=>{
  const f=fixture();let handler=createPluginHandler({connectionPath:f.connectionPath});
  try{
    await initialize(handler);
    const noteId=op("unicode-note");
    const note=await handler(call("add_assignment_note",{operationId:noteId,target:row.url,note:"Bring ruler - café 📐"}));
    assert.equal(note.result.isError,false);assert.equal(f.db.prepare("SELECT note FROM assignment_notes").get().note,"Bring ruler - café 📐");
    await handler(call("update_assignment_status",{operationId:op("status"),target:row.url,status:"E"}));
    const read=(await handler(call("list_assignments",{operationId:op("read"),target:row.url}))).result.structuredContent;
    assert.match(read.reply,/café 📐/);assert.match(read.reply,/Waiting on teacher/);assert.match(read.reply,/Schoology:.*Missing/);
    handler=createPluginHandler({connectionPath:f.connectionPath});await initialize(handler);
    assert.equal((await handler(call("add_assignment_note",{operationId:noteId,target:row.url,note:"duplicate"}))).result.structuredContent.code,"OPERATION_HELD");
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM assignment_notes").get().n,1);
    const saved=(await handler(call("schoology_operation_status",{operationId:noteId}))).result.structuredContent;
    assert.equal(saved.state,"COMPLETED");assert.match(saved.result.reply,/café 📐/);
    await handler(call("clear_assignment_notes",{operationId:op("clear-note"),target:row.url}));
    await handler(call("clear_assignment_status",{operationId:op("clear-status"),target:row.url}));
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM assignment_notes").get().n,0);
    assert.equal(f.db.prepare("SELECT manual_status FROM assignments").get().manual_status,"");
    assert.match(f.db.prepare("SELECT before_json FROM subscription_effects WHERE id=?").get(op("clear-note")).before_json,/café 📐/);
    await executeSubscriptionTool(f.db,{operationId:"telegram-update-99",toolName:"list_assignments",arguments:{status:"all"}},f.config);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM subscription_effects").get().n,6);
    await assert.rejects(executeSubscriptionTool(f.db,{operationId:op("wrong-default"),toolName:"list_assignments"},f.config),/operation identity/);
    await assert.rejects(executeSubscriptionTool(f.db,{operationId:"telegram-update-100",toolName:"list_assignments"},{...f.config,allowedOperationNamespace:"schoology-plugin"}),/operation identity/);
  }finally{f.close();}
});

test("known auth wall starts no browser/backend; changed enrollment and uncertain effects remain held",async()=>{
  const f=fixture();let calls=0;
  let handler=createPluginHandler({connectionPath:f.connectionPath,backend:async()=>{calls++;throw Error("no raw diagnostic");}});
  try{
    await initialize(handler);
    const auth=(await handler(call("refresh_schoology",{operationId:op("auth")}))).result.structuredContent;
    assert.equal(auth.code,"SOURCE_SESSION_REQUIRED");assert.equal(calls,0);
    const first=await handler(call("list_assignments",{operationId:op("uncertain")}));assert.equal(first.result.structuredContent.code,"OPERATION_HELD");assert.equal(calls,1);
    handler=createPluginHandler({connectionPath:f.connectionPath,backend:async()=>{calls++;return {ok:true,reply:"wrong"};}});await initialize(handler);
    await handler(call("list_assignments",{operationId:op("uncertain")}));assert.equal(calls,1);
    assert.equal((await handler(call("schoology_operation_status",{operationId:op("uncertain")}))).result.structuredContent.state,"HELD_NO_AUTOMATIC_REPLAY");
    fs.appendFileSync(f.configPath," ");
    assert.equal((await handler(call("list_assignments",{operationId:op("changed-config")}))).result.structuredContent.code,"CONNECTION_REQUIRED");assert.equal(calls,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM subscription_effects").get().n,0);
  }finally{f.close();}
});

test("signed-in fixture permits exactly one refresh and refusal results are durable",async()=>{
  const f=fixture();let calls=0;
  const handler=createPluginHandler({connectionPath:f.connectionPath,backend:async(_c,input)=>{calls++;assert.equal(input.toolName,"refresh_schoology");return {ok:false,code:"SOURCE_SESSION_REQUIRED",reply:"Session expired; saved data unchanged."};}});
  try{
    fs.writeFileSync(f.authPath,JSON.stringify({state:"SIGNED_IN_SOURCE_VERIFIED"}));await initialize(handler);
    await handler(call("refresh_schoology",{operationId:op("refresh")}));
    assert.equal(calls,1);assert.equal((await handler(call("schoology_operation_status",{operationId:op("refresh")}))).result.structuredContent.state,"REFUSED");
    await handler(call("refresh_schoology",{operationId:op("refresh")}));assert.equal(calls,1);
  }finally{f.close();}
});

test("backend code closure is required and Node startup/environment injection cannot enter the child",async()=>{
  const f=fixture(),priorOptions=process.env.NODE_OPTIONS,priorPath=process.env.NODE_PATH;
  try{
    const hook=path.join(f.dir,"hook.cjs"),marker=path.join(f.dir,"unexpected-hook");
    fs.writeFileSync(hook,`require('fs').writeFileSync(${JSON.stringify(marker)},'executed')`);
    process.env.NODE_OPTIONS=`--require=${hook}`;process.env.NODE_PATH=f.dir;
    const handler=createPluginHandler({connectionPath:f.connectionPath});await initialize(handler);
    assert.equal((await handler(call("list_assignments",{operationId:op("no-hook"),target:row.url}))).result.isError,false);
    assert.equal(fs.existsSync(marker),false);
    delete f.connection.backendFiles["src/tool_runner.js"];
    fs.writeFileSync(f.connectionPath,JSON.stringify(f.connection));
    assert.equal((await handler(call("list_assignments",{operationId:op("missing-dispatcher")}))).result.structuredContent.code,"CONNECTION_REQUIRED");
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM subscription_effects").get().n,1);
  }finally{
    if(priorOptions===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=priorOptions;
    if(priorPath===undefined)delete process.env.NODE_PATH;else process.env.NODE_PATH=priorPath;
    f.close();
  }
});

test("real stdio subprocess initializes, discovers and executes one original saved-data tool with protocol-only UTF8 stdout",async()=>{
  const f=fixture();
  try{
    const server=path.join(root,"plugins/schoology-tools/server.mjs");
    const child=spawn(process.execPath,[server,"--connection",f.connectionPath],{cwd:root,env:{...process.env,DOTENV_CONFIG_PATH:path.join(f.dir,"none")},stdio:["pipe","pipe","pipe"]});
    let stdout="",stderr="";child.stdout.setEncoding("utf8");child.stdout.on("data",s=>stdout+=s);child.stderr.on("data",s=>stderr+=s);
    const done=new Promise((resolve,reject)=>{child.on("error",reject);child.on("close",code=>resolve(code));});
    for(const msg of [{jsonrpc:"2.0",id:0,method:"initialize",params:{protocolVersion:"2025-11-25"}},{jsonrpc:"2.0",method:"notifications/initialized"},{jsonrpc:"2.0",id:1,method:"tools/list"},call("list_assignments",{operationId:op("stdio"),target:row.url})])child.stdin.write(`${JSON.stringify(msg)}\n`);
    child.stdin.end();assert.equal(await done,0,stderr);
    const messages=stdout.trim().split("\n").map(s=>JSON.parse(s));
    assert.equal(messages.length,3);assert.equal(messages[0].result.protocolVersion,"2025-11-25");assert.equal(messages[1].result.tools.length,9);assert.match(messages[2].result.structuredContent.reply,/Geometry practice/);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM subscription_effects").get().n,1);
  }finally{f.close();}
});

test("stdio refuses invalid and oversized messages and package references only its contained connector",async()=>{
  let output="";const sink=new Writable({write(chunk,_encoding,callback){output+=chunk;callback();}});
  await serveStdio({input:Readable.from(["not-json\n",`${"x".repeat(33000)}\n`]),output:sink,handler:async()=>{throw Error("Must not execute");}});
  assert.equal(output.trim().split("\n").length,2);for(const line of output.trim().split("\n"))assert.equal(JSON.parse(line).error.code,-32700);
  const pluginRoot=path.join(root,"plugins/schoology-tools"),plugin=JSON.parse(fs.readFileSync(path.join(pluginRoot,"plugin.json"))),mcp=JSON.parse(fs.readFileSync(path.join(pluginRoot,"mcp.json")));
  assert.equal(plugin.$schema,"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");assert.equal(plugin.name,"schoology-tools");assert.ok(plugin.extensions["com.openai"].interface.shortDescription.length<=30);
  assert.equal(mcp.mcpServers["schoology-tools"].type,"stdio");assert.deepEqual(mcp.mcpServers["schoology-tools"].args,["${PLUGIN_ROOT}/server.mjs"]);
  assert.match(fs.readFileSync(path.join(pluginRoot,"skills/assignments/SKILL.md"),"utf8"),/^---\r?\nname: assignments\r?\ndescription:/);
});
