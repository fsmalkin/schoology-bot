import { projectCurrentGradebook } from "../../src/current_gradebook.js";

// A request-owned bridge to an already sanctioned document observer. The host
// executes this fixed projector in its trusted read-only browser context and
// supplies the real observation time; no model supplies a function or scope.
export function createCurrentTermGradebookReader({ observeGradebook, scope } = {}) {
  const names = ["principalId", "studentId", "currentTermId", "currentTermLabel"];
  const valid = scope && names.every(name => typeof scope[name] === "string" &&
    scope[name].trim() && scope[name].length <= (name === "principalId" ? 128 : 80) &&
    !/[\0\r\n]/.test(scope[name]));
  const fixed = valid ? Object.freeze(Object.fromEntries(names.map(name => [name, scope[name].trim()]))) : null;
  return async function readCurrentTermSnapshot(...args) {
    if (args.length || !fixed || typeof observeGradebook !== "function") return null;
    let input;
    try { input = await observeGradebook(projectCurrentGradebook, fixed); }
    catch { return null; }
    const source = input?.sourceScope;
    if (input?.format !== "schoology-qualified-current-term/v1" ||
        source?.principalId !== fixed.principalId || source.studentId !== fixed.studentId ||
        source.currentTermId !== fixed.currentTermId || input.currentTerm?.id !== fixed.currentTermId) return null;
    return input;
  };
}
