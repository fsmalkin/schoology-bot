import test from "node:test";
import assert from "node:assert/strict";
import { openSubscriptionToolStore, importQualifiedSource, executeSubscriptionTool, subscriptionToolCatalog } from "../src/subscription_tools.js";

const config = { databasePath: ":memory:", principalId: "telegram:test", studentProfileId: "123", currentTerm: "MP 1 2026-2027", currentTermId: "456" };
const row = { course: "Geometry", title: "Geometry practice", dueDate: "10/21/26 11:59pm", status: "Missing", isMissing: true, url: "https://bcps.schoology.com/assignment/789" };
function source() { return { format: "schoology-qualified-current-term/v1", subjectVerified: true, currentTermVerified: true, sourceScope: { principalId: config.principalId, studentId: config.studentProfileId, currentTermId: config.currentTermId }, currentTerm: { id: config.currentTermId, label: config.currentTerm }, snapshot: { sourceOrigin: "https://bcps.schoology.com", observedAt: new Date().toISOString(), complete: true, assignments: [{ ...row }] } }; }
const request = (id, toolName, localRequest, args={}) => ({ operationId: `telegram-update-${id}`, toolName, localRequest, arguments: args });

test("real SQLite tools preserve notes/status through import, reject replay, and retain reversible clears", async () => {
  const db = openSubscriptionToolStore(config);
  try {
    importQualifiedSource(db, config, source());
    const note = await executeSubscriptionTool(db, request(1,"add_assignment_note",{operation:"note",target:row.url,value:"Bring ruler"}));
    assert.match(note.reply,/Saved a local note/);
    assert.equal(db.prepare("SELECT note FROM assignment_notes").get().note,"Bring ruler");
    await executeSubscriptionTool(db,request(2,"update_assignment_status",{operation:"status",target:row.title,value:"E"}));
    importQualifiedSource(db,config,source());
    const list = await executeSubscriptionTool(db,request(3,"list_assignments",null,{status:"all"}));
    assert.match(list.reply,/Waiting on teacher/); assert.match(list.reply,/Bring ruler/); assert.match(list.reply,/Schoology:.*Missing/);
    await assert.rejects(executeSubscriptionTool(db,request(1,"add_assignment_note",{operation:"note",target:row.url,value:"duplicate"})),/do not replay/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM assignment_notes").get().n,1);
    await executeSubscriptionTool(db,request(4,"clear_assignment_notes",{operation:"clear-notes",target:row.url}));
    await executeSubscriptionTool(db,request(5,"clear_assignment_status",{operation:"clear-status",target:row.url}));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM assignment_notes").get().n,0);
    assert.equal(subscriptionToolCatalog(db).assignments[0].manualStatus,"");
    assert.match(db.prepare("SELECT before_json FROM subscription_effects WHERE id='telegram-update-4'").get().before_json,/Bring ruler/);
    const summary=await executeSubscriptionTool(db,request(6,"build_daily_summary",null));
    assert.match(summary.reply,/Geometry practice/);
  } finally { db.close(); }
});

test("source binding, freshness, explicit edit and scope fail closed without mutations", async () => {
  const db=openSubscriptionToolStore(config);
  try {
    for(const patch of [s=>s.sourceScope.studentId="999",s=>s.sourceScope.principalId="other",s=>s.currentTerm.id="other",s=>s.snapshot.complete=false,s=>s.snapshot.observedAt="2000-01-01T00:00:00Z",s=>s.snapshot.assignments[0].score="100"]){const s=source();patch(s);assert.throws(()=>importQualifiedSource(db,config,s));}
    assert.equal(db.prepare("SELECT COUNT(*) n FROM assignments").get().n,0);
    importQualifiedSource(db,config,source());
    await assert.rejects(executeSubscriptionTool(db,request(1,"add_assignment_note",{operation:"note",target:"Absent",value:"text"})),/exact assignment/);
    await assert.rejects(executeSubscriptionTool(db,request(2,"add_assignment_note",{operation:"status",target:row.url,value:"text"})),/mismatch/);
    await assert.rejects(executeSubscriptionTool(db,request(3,"drain_due_reminders",null)),/reminders remain off/);
    await assert.rejects(executeSubscriptionTool(db,request(4,"list_assignments",null,{unexpected:true})),/Unexpected/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM subscription_effects").get().n,0);
  } finally { db.close(); }
});

test("later complete source resolves absent missing rows and excludes them from edit targets", async () => {
  const db=openSubscriptionToolStore(config);
  try {
    const first=source();first.snapshot.observedAt=new Date(Date.now()-1000).toISOString();
    importQualifiedSource(db,config,first);
    const second=source();second.snapshot.assignments=[];
    importQualifiedSource(db,config,second);
    assert.equal(db.prepare("SELECT is_missing FROM assignments").get().is_missing,0);
    assert.equal(subscriptionToolCatalog(db).assignments.length,0);
    await assert.rejects(executeSubscriptionTool(db,request(1,"add_assignment_note",{operation:"note",target:row.url,value:"text"})),/exact assignment/);
  } finally {db.close();}
});

test("stale saved catalog refuses local edits without changing data", async () => {
  const db=openSubscriptionToolStore(config);
  try {
    importQualifiedSource(db,config,source());
    db.prepare("UPDATE subscription_source SET observed_at=?").run("2000-01-01T00:00:00Z");
    const result=await executeSubscriptionTool(db,request(1,"add_assignment_note",{operation:"note",target:row.url,value:"text"}));
    assert.equal(result.ok,false);assert.match(result.reply,/No change was saved/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM assignment_notes").get().n,0);
  } finally {db.close();}
});

test("an exact assignment read excludes other rows and does not invent missing/submission status", async () => {
  const db=openSubscriptionToolStore(config);
  try {
    const s=source();s.snapshot.assignments[0]={...row,status:"Not marked missing",isMissing:false};
    s.snapshot.assignments.push({...row,title:"Other missing assignment",url:"https://bcps.schoology.com/assignment/999"});
    importQualifiedSource(db,config,s);
    const result=await executeSubscriptionTool(db,request(1,"list_assignments",null,{target:row.url}));
    assert.match(result.reply,/Geometry practice/);
    assert.match(result.reply,/Not marked missing \(submission status unknown\)/);
    assert.doesNotMatch(result.reply,/Other missing assignment|Needs action/);
    await assert.rejects(executeSubscriptionTool(db,request(2,"list_assignments",null,{target:"Absent"})),/exact assignment/);
  } finally {db.close();}
});
