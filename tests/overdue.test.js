import test from "node:test";
import assert from "node:assert/strict";
import { deadlineEvidence, submissionEvidence } from "../src/overdue.js";
import { createDb, syncAssignmentsFromState, listAssignments, updateAssignmentStatus } from "../src/db.js";
import { openSubscriptionToolStore, importQualifiedSource, executeSubscriptionTool } from "../src/subscription_tools.js";
import { toolDefinitions } from "../src/tool_definitions.js";

const tz = "America/New_York";
const now = new Date("2026-10-18T20:00:00Z");
for (const [status, expected] of [
  ["Missing", "unsubmitted"], ["Missing (draft not submitted)", "unsubmitted"],
  ["Draft (not submitted)", "unsubmitted"], ["Incomplete (draft not submitted)", "unsubmitted"],
  ["Incomplete", "unknown"], ["Not marked missing", "unknown"], ["", "unknown"], ["Draft", "unknown"],
  ["Submitted", "submitted"], ["Submitted, awaiting grade", "submitted"],
  ["Submitted (grading status unknown)", "submitted"], ["Exempt", "exempt"],
  ["Exempt (draft not submitted)", "exempt"], ["Submitted (Exempt; ungraded marker)", "exempt"],
  ["Submitted, awaiting grade (Schoology also marks Missing)", "conflicting"],
  ["Submitted (grading status unknown; Schoology also marks Incomplete)", "conflicting"],
]) test(`submission evidence: ${status || "blank"} is ${expected}`, () => {
  assert.equal(submissionEvidence({status,score:""}), expected);
});
test("local submitted claim and contradictory source markers are never definite unsubmitted", () => {
  assert.equal(submissionEvidence({status:"Missing",manualStatus:"turned in"}),"conflicting");
  assert.equal(submissionEvidence({status:"Not marked missing",manualStatus:"Submitted"}),"unknown");
  assert.equal(submissionEvidence({status:"Missing",rawText:"This student has made a submission that has not been graded."}),"conflicting");
  assert.equal(submissionEvidence({status:"Missing",rawText:"This student has completed assignment submission"}),"conflicting");
  assert.equal(submissionEvidence({status:"Missing",manualStatus:"Waiting on teacher"}),"unsubmitted");
  assert.equal(submissionEvidence({isMissing:true,score:""}),"unknown");
  assert.equal(submissionEvidence({status:"Submitted",isMissing:true}),"conflicting");
  assert.equal(submissionEvidence({status:"Missing",isMissing:false}),"conflicting");
});

for (const [value, kind, overdue] of [
  ["10/17/26", "date-only", true], ["10/18/26", "date-only", false], ["2026-10-17", "date-only", true],
  ["10/18/26 3:59pm", "exact", true], ["10/18/26 4:00pm", "exact", false], ["10/18/26 4:01pm", "exact", false],
  ["10/19/26 12:00am", "exact", false], ["2026-10-18T15:00:00-04:00", "exact", true],
  ["2/30/26", "unknown", false], ["2/29/26", "unknown", false], ["13/1/26", "unknown", false],
  ["10/17/26 25:00", "unknown", false], ["10/17/26 0:30pm", "unknown", false],
  ["10/17/26 12:60pm", "unknown", false], ["Due 10/17/26", "unknown", false],
  ["10/17/26 unknown time", "unknown", false], ["2026-02-30T12:00:00Z", "unknown", false],
  ["2026-10-17T12:00", "unknown", false], ["", "unknown", false],
]) test(`deadline evidence: ${value || "blank"}`, () => {
  const result=deadlineEvidence(value,tz,now);
  assert.equal(result.kind,kind);assert.equal(result.overdue,overdue);
  if(kind!=="exact") assert.equal(result.dueDateIso,null);
});
test("local midnight, DST transitions and ambiguous wall times retain actual evidence", () => {
  assert.equal(deadlineEvidence("10/17/26",tz,"2026-10-18T03:59:00Z").overdue,false);
  assert.equal(deadlineEvidence("10/17/26",tz,"2026-10-18T04:00:00Z").overdue,true);
  assert.equal(deadlineEvidence("3/8/26 3:30am",tz,now).dueDateIso,"2026-03-08T07:30:00.000Z");
  assert.equal(deadlineEvidence("3/8/26 2:30am",tz,now).kind,"unknown");
  assert.equal(deadlineEvidence("11/1/26 1:30am",tz,"2026-11-02T00:00:00Z").kind,"unknown");
  assert.equal(deadlineEvidence("2026-11-01T01:30:00-05:00",tz,"2026-11-02T00:00:00Z").overdue,true);
});

function seed(db, rows) {
  syncAssignmentsFromState(db,{assignments:Object.fromEntries(rows.map((row,index)=> {
    const key=`a${index}`;return [key,{key,course:"Science",title:`Fixture ${index}`,dueDate:"10/17/26",status:"Missing",isMissing:true,firstSeenAt:now.toISOString(),lastSeenAt:now.toISOString(),...row}];
  }))});
}
test("original SQLite overdue filter applies evidence, current scope and local preferences before limit", () => {
  const db=createDb(":memory:");
  try {
    seed(db,[{status:"Not marked missing"},{status:"Incomplete"},{status:"Submitted, awaiting grade"},{status:"Submitted (grading status unknown)"},{status:"Exempt"},{status:"Missing"},{status:"Draft (not submitted)"},{status:"Missing",dueDate:"10/19/26"},{status:"Missing",dueDate:"10/18/26 3:00pm"}]);
    assert.deepEqual(listAssignments(db,{status:"overdue",now,limit:1}).map(r=>r.key),["a5"]);
    assert.deepEqual(listAssignments(db,{status:"overdue",now,assignmentKeys:["a6","a8"]}).map(r=>r.key),["a6","a8"]);
    updateAssignmentStatus(db,{key:"a5",status:"Submitted"});
    updateAssignmentStatus(db,{key:"a6",status:"E"});
    const filtered=listAssignments(db,{status:"overdue",now});
    assert.deepEqual(filtered.map(r=>r.key),["a6","a8"]);
    assert.equal(filtered[0].manualStatus,"Waiting on teacher");
    assert.equal(filtered[0].deadlineEvidence.dueDateIso,null);
    assert.deepEqual(listAssignments(db,{status:"overdue",now,includePending:false}).map(r=>r.key),["a8"]);
    const broad=listAssignments(db,{status:"overdue_all",now});
    assert.equal(broad.length,8);
    assert.equal(broad.find(r=>r.key==="a5").submissionEvidence,"conflicting");
    assert.equal(broad.find(r=>r.key==="a4").submissionEvidence,"exempt");
    assert.equal(listAssignments(db,{status:"overdue",now,assignmentKeys:[]}).length,0);
    assert.throws(()=>listAssignments(db,{status:"invalid"}),/Unsupported/);
  } finally {db.close();}
});

test("subscription reply enforces strict default and labels explicitly broader states without resurrecting old rows", async () => {
  const config={databasePath:":memory:",principalId:"telegram:test",studentProfileId:"123",currentTerm:"MP 1 2026-2027",currentTermId:"456"};
  const db=openSubscriptionToolStore(config);
  const row=(title,status,id)=>({course:"Science",title,status,isMissing:status==="Missing",dueDate:"1/1/26",url:`https://bcps.schoology.com/assignment/${id}`});
  const source=assignments=>({format:"schoology-qualified-current-term/v1",subjectVerified:true,currentTermVerified:true,sourceScope:{principalId:config.principalId,studentId:config.studentProfileId,currentTermId:config.currentTermId},currentTerm:{id:config.currentTermId,label:config.currentTerm},snapshot:{sourceOrigin:"https://bcps.schoology.com",observedAt:new Date().toISOString(),complete:true,assignments}});
  try {
    importQualifiedSource(db,config,source([row("Old absent row","Missing",10)]));
    importQualifiedSource(db,config,source([row("Unknown work","Not marked missing",11),row("Incomplete work","Incomplete",12),row("Sent ungraded work","Submitted, awaiting grade",13),row("Sent unknown grading","Submitted (grading status unknown)",14),row("Excused work","Exempt",15),row("Actual unsubmitted work","Missing",16)]));
    const request=(id,status)=>({operationId:`telegram-update-${id}`,toolName:"list_assignments",arguments:{status,limit:1}});
    const strict=await executeSubscriptionTool(db,request(901,"overdue"));
    assert.equal(strict.filter,"overdue");assert.equal(strict.assignmentKeys.length,1);
    assert.match(strict.reply,/Actual unsubmitted work/);assert.match(strict.reply,/time unknown/);assert.match(strict.reply,/America\/New_York/);
    assert.doesNotMatch(strict.reply,/Old absent row|Unknown work|Incomplete work|Sent ungraded work|Sent unknown grading|Excused work/);
    const broad=await executeSubscriptionTool(db,{...request(902,"overdue_all"),arguments:{status:"overdue_all",limit:100}});
    assert.equal(broad.assignmentKeys.length,6);assert.match(broad.reply,/Submission evidence: unknown/);assert.match(broad.reply,/Submission evidence: submitted/);assert.match(broad.reply,/Submission evidence: exempt/);
    await assert.rejects(executeSubscriptionTool(db,request(901,"overdue")),/do not replay/);
  } finally {db.close();}
});
test("original planner tool contract exposes default overdue and explicit all-status overdue",()=>{
  const tool=toolDefinitions().find(t=>t.name==="list_assignments");
  assert.ok(tool.parameters.properties.status.enum.includes("overdue"));
  assert.ok(tool.parameters.properties.status.enum.includes("overdue_all"));
  assert.match(tool.description,/ordinary overdue.*ALWAYS.*status=overdue/);
});
