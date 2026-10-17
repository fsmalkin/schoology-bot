// A small in-memory DOM double for the selectors used by the gradebook
// projection. It is not an HTML parser or browser/CSS conformance fixture.
class FixtureElement {
  constructor(tag, classes = "", ownText = "", attributes = {}, children = []) {
    this.tag = tag;
    this.classes = new Set(classes.split(/\s+/).filter(Boolean));
    this.ownText = ownText;
    this.attributes = attributes;
    this.children = children;
  }
  get textContent() { return [this.ownText, ...this.children.map(child => child.textContent)].filter(Boolean).join(" "); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  matches(selector) {
    const tag = selector.match(/^[a-z][a-z0-9-]*/i)?.[0];
    if (tag && this.tag !== tag) return false;
    for (const match of selector.matchAll(/\.([\w-]+)/g)) if (!this.classes.has(match[1])) return false;
    const attribute = selector.match(/\[([\w-]+)(?:\*=['"]([^'"]*)['"])?\]/);
    if (attribute) {
      const value = this.getAttribute(attribute[1]);
      if (value === null || (attribute[2] !== undefined && !value.includes(attribute[2]))) return false;
    }
    const unparsed = selector.replace(/^[a-z][a-z0-9-]*/i, "").replace(/\.([\w-]+)/g, "").replace(/\[[^\]]+\]/g, "");
    if (unparsed) throw new Error("Unsupported fixture selector.");
    return true;
  }
  querySelectorAll(selector) {
    const selected = [];
    for (const group of selector.split(",")) {
      let roots = [this];
      for (const part of group.trim().split(/\s+/)) roots = roots.flatMap(root => root.descendants().filter(node => node.matches(part)));
      selected.push(...roots);
    }
    return [...new Set(selected)];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

function element(tag, classes, ownText, attributes = {}, children = []) {
  return new FixtureElement(tag, classes, ownText, attributes, children);
}

function row(options = {}) {
  const {
    title = "Fixture equations", href = "/assignment/100", due = "Due Oct 16, 2026",
    comment = "Missing", gradeHint = "", awarded = "0", max = "10", exception = "",
    submitted = false, period = "",
  } = options;
  const gradeChildren = [element("span", "awarded-grade", awarded), element("span", "max-grade", max)];
  if (exception) gradeChildren.push(element("span", "exception-text", exception));
  if (submitted) gradeChildren.push(element("span", "has-dropbox-icon grade-pending-icon", "", {}, [
    element("span", "visually-hidden", "Assignment submitted"),
  ]));
  return element("tr", "report-row item-row", "", { "data-fixture-period": period }, [
    element("td", "item-title", "", {}, [element("a", "", title, { href })]),
    element("td", "due-date", due),
    element("td", "grade-column", gradeHint, {}, gradeChildren),
    element("td", "comment-column", "", {}, [element("span", "comment", `Comment: ${comment}`)]),
  ]);
}

export function gradebookDocument({ heading = "Fixture gradebook", course = "Fixture mathematics Course", rows = [{}] } = {}) {
  return element("document", "", "", {}, [
    element("h1", "", heading),
    element("div", "gradebook-course", "", {}, [
      element("div", "gradebook-course-title", course),
      element("table", "", "", {}, rows.map(row)),
    ]),
  ]);
}
