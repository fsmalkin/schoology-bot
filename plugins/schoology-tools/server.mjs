// MCP2025-11-25 stdio transport. Node builtins only; no listener or model call.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const OPERATION = /^schoology-plugin-[A-Za-z0-9][A-Za-z0-9_-]{8,95}$/;
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const readJson = file => JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
const textResult = value => ({ content:[{type:"text",text:JSON.stringify(value)}],structuredContent:value,isError:value.ok === false });
const failure = (code,reply) => textResult({ok:false,code,reply});
const object = value => value && typeof value === "object" && !Array.isArray(value);
const string = (value,max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const statusValues = ["missing","all","resolved","submitted_awaiting_grade"];
export function backendArtifactPaths(root) {
  const files=["package.json","package-lock.json","scripts/schoology_plugin_backend_cli.mjs"];
  const visit=directory=>{for(const item of fs.readdirSync(directory,{withFileTypes:true})){
    if(item.isSymbolicLink())throw Error("Source links are not enrolled");
    const file=path.join(directory,item.name);
    if(item.isDirectory())visit(file);
    else if(/\.(?:m?js|json)$/.test(item.name))files.push(path.relative(root,file).split(path.sep).join("/"));
  }};
  visit(path.join(root,"src"));return files.sort();
}
const schema = properties => ({type:"object",additionalProperties:false,properties,required:["operationId"]});
const opProperty = {type:"string",pattern:OPERATION.source,description:"Stable task-owned operation ID. Reuse the same ID for recovery; never replace a held ID."};
const targetProperty = {type:"string",minLength:1,maxLength:2000,description:"One exact current assignment title, course / title or Schoology assignment URL."};
const TOOL_DEFINITIONS = [
  {name:"schoology_connection_status",description:"Verify the enrolled local connection and known sign-in state without reading assignments or launching a browser.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"schoology_operation_status",description:"Read one existing operation receipt. Never re-execute its effect.",inputSchema:schema({operationId:opProperty})},
  {name:"list_assignments",description:"Read saved current-term assignments. Source time is preserved. Use target for one exact assignment, including its local notes/status.",inputSchema:schema({operationId:opProperty,status:{type:"string",enum:statusValues},course:{type:"string",maxLength:200},target:targetProperty,limit:{type:"integer",minimum:1,maximum:100},includeIgnored:{type:"boolean"},includePending:{type:"boolean"}})},
  {name:"build_daily_summary",description:"Build the original summary from saved current-term data; does not scrape or schedule reminders.",inputSchema:schema({operationId:opProperty})},
  {name:"refresh_schoology",description:"Refresh through the existing app-owned headless Chrome session. Requires completed app sign-in; never enters credentials or sends reminders.",inputSchema:schema({operationId:opProperty})},
  ...["add_assignment_note","update_assignment_status","clear_assignment_notes","clear_assignment_status"].map(name=>({name,description:`${name.replaceAll("_"," ")} for one explicit user-requested local assignment. Schoology itself is unchanged; clears retain history.`,inputSchema:{...schema({operationId:opProperty,target:targetProperty,...(name==="add_assignment_note"?{note:{type:"string",minLength:1,maxLength:2000}}:name==="update_assignment_status"?{status:{type:"string",minLength:1,maxLength:160}}:{})}),required:["operationId","target",...(name==="add_assignment_note"?["note"]:name==="update_assignment_status"?["status"]:[])]}}))
].map(tool=>({...tool,annotations:{readOnlyHint:!/(add_|update_|clear_|refresh_)/.test(tool.name),destructiveHint:false,idempotentHint:true,openWorldHint:tool.name==="refresh_schoology"}}));

function validateArguments(tool,args) {
  if(!object(args)||Object.keys(args).some(key=>!Object.hasOwn(tool.inputSchema.properties,key))) throw Error("Invalid arguments");
  for(const key of tool.inputSchema.required||[]) if(!Object.hasOwn(args,key)) throw Error("Missing argument");
  if(tool.name!=="schoology_connection_status"&&!OPERATION.test(args.operationId||"")) throw Error("Stable operation identity required");
  if(Object.hasOwn(args,"target")&&!string(args.target,2000)) throw Error("Exact target required");
  if(Object.hasOwn(args,"course")&&(typeof args.course!=="string"||args.course.length>200)) throw Error("Invalid course");
  if(Object.hasOwn(args,"note")&&!string(args.note,2000)) throw Error("Invalid note");
  if(Object.hasOwn(args,"status")&&(tool.name==="list_assignments"?!statusValues.includes(args.status):!string(args.status,160))) throw Error("Invalid status");
  if(Object.hasOwn(args,"limit")&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>100)) throw Error("Invalid limit");
  for(const key of ["includeIgnored","includePending"]) if(Object.hasOwn(args,key)&&typeof args[key]!=="boolean") throw Error("Invalid boolean");
}

export function loadConnection(connectionPath) {
  if(!path.isAbsolute(connectionPath)) throw Error("Absolute connection required");
  const connection=readJson(connectionPath);
  if(connection.format!=="schoology-local-plugin-connection/v1"||![connection.backendRoot,connection.toolConfigPath,connection.operationDirectory,connection.sourceAuthStatusPath].every(value=>typeof value==="string"&&path.isAbsolute(value))) throw Error("Invalid connection");
  const configBytes=fs.readFileSync(connection.toolConfigPath);
  if(sha(configBytes)!==connection.toolConfigSha256) throw Error("Changed private configuration");
  const config=JSON.parse(configBytes.toString("utf8").replace(/^\uFEFF/,""));
  if(config.studentProfileId!==connection.studentProfileId||config.currentTerm!==connection.currentTerm||config.currentTermId!==connection.currentTermId||config.principalId!==connection.principalId||!path.isAbsolute(config.databasePath)||!fs.statSync(config.databasePath).isFile()) throw Error("Subject, term or database mismatch");
  if(config.browserProfileDirectory!==path.join(path.dirname(config.databasePath),"schoology-app-profile")) throw Error("Separate source profile required");
  const cli=path.join(connection.backendRoot,"scripts/schoology_plugin_backend_cli.mjs");
  if(!object(connection.backendFiles)||backendArtifactPaths(connection.backendRoot).some(file=>!Object.hasOwn(connection.backendFiles,file))) throw Error("Pinned source and dependency lock required");
  for(const [relative,expected] of Object.entries(connection.backendFiles)) {
    const resolved=path.resolve(connection.backendRoot,relative);
    if(path.isAbsolute(relative)||!resolved.startsWith(path.resolve(connection.backendRoot)+path.sep)||sha(fs.readFileSync(resolved))!==expected) throw Error("Backend artifact changed");
  }
  fs.mkdirSync(connection.operationDirectory,{recursive:true});
  return {...connection,cli,binding:sha(JSON.stringify([config.databasePath,config.principalId,config.studentProfileId,config.currentTermId,config.currentTerm])),backendFingerprint:sha(JSON.stringify(connection.backendFiles))};
}

export function invokeBackend(connection,input) {
  return new Promise((resolve,reject)=>{
    const env={DOTENV_CONFIG_PATH:path.join(connection.operationDirectory,"no-dotenv"),AUTO_UPCOMING_ENABLED:"false",AUTO_IGNORE_ENABLED:"false",LOGIN_ALERTS_ENABLED:"false"};
    // Retain OS/runtime paths only. Node hooks, dotenv overrides, provider
    // credentials and arbitrary environment configuration cannot cross here.
    const osKeys=new Set(["PATH","SYSTEMROOT","WINDIR","TEMP","TMP","USERPROFILE","HOMEDRIVE","HOMEPATH","APPDATA","LOCALAPPDATA","PROGRAMFILES","PROGRAMFILES(X86)","PROGRAMDATA","HOME","LANG","LC_ALL"]);
    for(const [key,value] of Object.entries(process.env))if(osKeys.has(key.toUpperCase()))env[key]=value;
    const child=spawn(process.execPath,[connection.cli,connection.toolConfigPath],{cwd:connection.backendRoot,env,windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let output="",overflow=false;
    child.stdout.setEncoding("utf8");child.stdout.on("data",chunk=>{if(output.length+chunk.length>65536){overflow=true;child.kill();}else output+=chunk;});
    child.stderr.resume();
    child.on("error",()=>reject(Error("Backend launch failed")));
    child.on("close",code=>{try{if(code!==0||overflow)throw Error();resolve(JSON.parse(output));}catch{reject(Error("Backend result unavailable"));}});
    child.stdin.on("error",()=>{});child.stdin.end(JSON.stringify(input),"utf8");
  });
}

export function createPluginHandler({connectionPath,backend=invokeBackend}={}) {
  let initialized=false,ready=false;
  return async message=>{
    if(!object(message)||message.jsonrpc!=="2.0"||typeof message.method!=="string"||("id"in message&&typeof message.id!=="string"&&!Number.isSafeInteger(message.id))) return {jsonrpc:"2.0",id:null,error:{code:-32600,message:"Invalid request"}};
    const id=message.id;
    const response=result=>({jsonrpc:"2.0",id,result});
    const error=(code,text)=>({jsonrpc:"2.0",id,error:{code,message:text}});
    if(id===undefined){if(message.method==="notifications/initialized"&&initialized)ready=true;return null;}
    if(message.method==="initialize") {
      if(initialized)return error(-32600,"Already initialized");
      initialized=true;
      const versions=["2025-11-25","2025-06-18","2025-03-26","2024-11-05"];
      return response({protocolVersion:versions.includes(message.params?.protocolVersion)?message.params.protocolVersion:versions[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:"schoology-tools",version:"0.1.0"},instructions:"Use only the enrolled current-term source. Preserve operation IDs and source times. Local edits never change Schoology. Reminders remain off."});
    }
    if(!ready)return error(-32000,"Initialize the connection first");
    if(message.method==="ping")return response({});
    if(message.method==="tools/list")return response({tools:TOOL_DEFINITIONS});
    if(message.method!=="tools/call")return error(-32601,"Method not found");
    const tool=TOOL_DEFINITIONS.find(tool=>tool.name===message.params?.name);
    if(!tool)return error(-32602,"Tool is outside the enabled scope");
    const args=message.params.arguments??{};
    try {validateArguments(tool,args);} catch {return error(-32602,"Invalid tool arguments");}
    let connection;
    try {connection=loadConnection(connectionPath);} catch {return response(failure("CONNECTION_REQUIRED","The enrolled local Schoology connection is unavailable or changed. No operation was started."));}
    const receiptPath=operation=>path.join(connection.operationDirectory,`${operation}.json`);
    const save=(file,value)=>{const temporary=`${file}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(temporary,JSON.stringify(value),{mode:0o600});fs.renameSync(temporary,file);};
    const sourceAuth=()=>{try {return readJson(connection.sourceAuthStatusPath).state;} catch {return "UNKNOWN";}};
    if(tool.name==="schoology_connection_status")return response(textResult({ok:true,format:connection.format,configurationValidated:true,sourceSession:sourceAuth(),liveRefreshVerified:false,reminders:false,tools:TOOL_DEFINITIONS.map(t=>t.name)}));
    if(tool.name==="schoology_operation_status") {
      try {const receipt=readJson(receiptPath(args.operationId));if(receipt.binding!==connection.binding)throw Error();return response(textResult({ok:true,operationId:args.operationId,state:receipt.state,toolName:receipt.toolName,result:receipt.result??null}));}
      catch {return response(failure("OPERATION_UNKNOWN","No matching operation receipt was found. Do not substitute a new ID to retry an uncertain effect."));}
    }
    const file=receiptPath(args.operationId),requestHash=sha(JSON.stringify([tool.name,args]));
    const receipt={operationId:args.operationId,state:"RESERVED",binding:connection.binding,backendFingerprint:connection.backendFingerprint,toolName:tool.name,requestHash,backendCalls:0,at:new Date().toISOString()};
    try {fs.writeFileSync(file,JSON.stringify(receipt),{flag:"wx",mode:0o600});}
    catch {return response(failure("OPERATION_HELD","This operation ID already exists or cannot be reserved. Read its original receipt; no backend call was repeated."));}
    if(tool.name==="refresh_schoology"&&sourceAuth()!=="SIGNED_IN_SOURCE_VERIFIED") {
      receipt.state="AUTH_REQUIRED";receipt.result={ok:false,code:"SOURCE_SESSION_REQUIRED",reply:"Finish the existing Schoology app-window sign-in before a live refresh. Saved data was not refreshed; no new browser was opened."};save(file,receipt);return response(textResult(receipt.result));
    }
    const operations={add_assignment_note:"note",update_assignment_status:"status",clear_assignment_notes:"clear-notes",clear_assignment_status:"clear-status"};
    const {operationId,...rest}=args;
    const input={command:"execute",operationId,toolName:tool.name,arguments:operations[tool.name]?{}:rest,...(operations[tool.name]?{localRequest:{operation:operations[tool.name],target:args.target,value:args.note??args.status}}:{})};
    try {
      receipt.backendCalls=1;save(file,receipt);
      const result=await backend(connection,input);
      if(!object(result)||typeof result.ok!=="boolean"||!string(result.reply,5000)) throw Error("Invalid backend result");
      receipt.state=result.ok?"COMPLETED":"REFUSED";receipt.result=result;save(file,receipt);
      return response(textResult(result));
    } catch {
      receipt.state="HELD_NO_AUTOMATIC_REPLAY";save(file,receipt);
      return response(failure("OPERATION_HELD","The original tool result is uncertain. This operation remains reserved; do not retry under a new ID."));
    }
  };
}

export async function serveStdio({input=process.stdin,output=process.stdout,handler}={}) {
  let buffered="";let queue=Promise.resolve();
  const write=value=>{if(value)output.write(`${JSON.stringify(value)}\n`);};
  input.setEncoding("utf8");
  for await(const chunk of input){
    buffered+=chunk;
    if(Buffer.byteLength(buffered,"utf8")>32768&&!buffered.includes("\n")){write({jsonrpc:"2.0",id:null,error:{code:-32700,message:"Message too large"}});return;}
    let end;
    while((end=buffered.indexOf("\n"))>=0){
      const line=buffered.slice(0,end);buffered=buffered.slice(end+1);
      queue=queue.then(async()=>{let message;try {if(Buffer.byteLength(line,"utf8")>32768)throw Error();message=JSON.parse(line);}catch{write({jsonrpc:"2.0",id:null,error:{code:-32700,message:"Invalid JSON message"}});return;}try{write(await handler(message));}catch{write({jsonrpc:"2.0",id:message?.id??null,error:{code:-32603,message:"Local handler unavailable"}});}});
    }
  }
  await queue;
  if(buffered.trim())write({jsonrpc:"2.0",id:null,error:{code:-32700,message:"Incomplete JSON message"}});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  // The standard per-user enrollment is metadata only and remains outside ZIPs.
  const connectionPath=process.argv.length===4&&process.argv[2]==="--connection"?process.argv[3]:path.join(os.homedir(),".schoology-tools","connection.json");
  await serveStdio({handler:createPluginHandler({connectionPath})});
}
