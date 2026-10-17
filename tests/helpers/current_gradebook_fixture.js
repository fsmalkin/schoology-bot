// Limited tree/selector/layout double, not a browser or HTML/CSS parser.
class Element {
  constructor(tag, classes = "", text = "", attributes = {}, children = []) {
    this.tag = tag;
    this.classes = new Set(classes.split(/\s+/).filter(Boolean));
    this.classList = { contains: name => this.classes.has(name) };
    this.text = text;
    this.attributes = attributes;
    this.children = children;
    this.hidden = false;
    for (const child of children) child.parentElement = this;
  }
  get textContent() {
    if (["grade-column", "comment-column", "awarded-grade", "max-grade"].some(c => this.classes.has(c))) {
      throw new Error("Forbidden source field was read");
    }
    return [this.text, ...this.children.map(n => n.textContent)].filter(Boolean).join(" ");
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getBoundingClientRect() {
    let node = this;
    while (node) {
      if (node.hidden) return { height: 0 };
      node = node.parentElement;
    }
    return { height: 20 };
  }
  descendants() { return this.children.flatMap(n => [n, ...n.descendants()]); }
  matches(selector) {
    const tag = selector.match(/^[a-z][a-z0-9-]*/i)?.[0];
    if (tag && tag !== this.tag) return false;
    for (const [, c] of selector.matchAll(/\.([\w-]+)/g)) if (!this.classes.has(c)) return false;
    const attributes = [...selector.matchAll(/\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]/g)];
    for (const [, name, double, single] of attributes) {
      const value = this.getAttribute(name);
      if (value === null || ((double ?? single) !== undefined && value !== (double ?? single))) return false;
    }
    const rest = selector.replace(/^[a-z][a-z0-9-]*/i, "").replace(/\.([\w-]+)/g, "").replace(/\[[^\]]+\]/g, "");
    if (rest) throw new Error("Unsupported fixture selector");
    return true;
  }
  querySelectorAll(selector) {
    const result = [];
    for (const group of selector.split(",")) {
      let roots = [this];
      for (const part of group.trim().split(/\s+/)) roots = roots.flatMap(r => r.descendants().filter(n => n.matches(part)));
      result.push(...roots);
    }
    return [...new Set(result)];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
const el = (tag, classes = "", text = "", attrs = {}, children = []) => new Element(tag, classes, text, attrs, children);

export const fixtureScope = Object.freeze({
  principalId: "fixture-caller", studentId: "101",
  currentTermId: "fixture-current", currentTermLabel: "Fixture current period",
});
export function fixtureStyle(node) { return { display: node.hidden ? "none" : "block", visibility: "visible" }; }

export function currentGradebookFixture({
  studentId = "101", profileCount = 1, menu = true, label = fixtureScope.currentTermLabel,
  currentTermId = fixtureScope.currentTermId, extraActive = false,
  courses = [{ title: "Fixture mathematics", items: [{ title: "Fixture missing", status: "Missing" }] }],
  pagination = false, loading = false,
} = {}) {
  const profile = () => el("a", "", "Your Profile",
    { href: "/user/" + studentId + "/info", ...(menu ? { role: "menuitem" } : {}) });
  const nodes = Array.from({ length: profileCount }, profile);
  courses.forEach((course, index) => {
    const category = "category-" + index;
    const pastCategory = "past-category-" + index;
    const period = (id, title, collapsed) => el("tr",
      "report-row period-row" + (collapsed ? " childrenCollapsed" : ""),
      "", { "data-id": id, "data-parent-id": "course-" + index },
      [el("th", "title-column", title + "Grading Period (25%)")]);
    const group = (id, parent) => el("tr", "report-row category-row", "",
      { "data-id": id, "data-parent-id": parent });
    const rows = [
      period(currentTermId, label, false), period("fixture-past", "Fixture past period", !extraActive),
      group(category, currentTermId), group(pastCategory, "fixture-past"),
    ];
    (course.items ?? []).forEach((item, itemIndex) => {
      const title = item.title ?? "Fixture item";
      const titleChildren = item.omitTitle ? [] : [
        el("span", "title", item.href === null ? title : "", {}, item.href === null ? [] : [
          el("a", "", title, { href: item.href ?? "/assignment/fixture-" + index + "-" + itemIndex }),
        ]),
        el("span", "due-date", "Due " + (item.due ?? "Oct 16, 2026")),
      ];
      const statusChildren = item.status ? [el("span", "exception-text", item.status)] : [];
      if (item.submitted) statusChildren.push(el("span", "has-dropbox-icon grade-pending-icon", "", {}, [
        el("span", "visually-hidden", "Assignment submitted"),
      ]));
      const row = el("tr", "report-row item-row", "", {
        "data-id": item.id ?? "item-" + itemIndex,
        "data-parent-id": item.parent ?? (item.past ? pastCategory : category),
      }, [
        el("th", "title-column", "", {}, titleChildren),
        el("td", "grade-column", "fixture-secret-score", {}, [
          el("span", "awarded-grade", "fixture-secret-grade"), ...statusChildren,
        ]),
        el("td", "comment-column", "fixture-secret-comment"),
      ]);
      row.hidden = Boolean(item.hidden || item.past);
      rows.push(row);
    });
    const report = el("div", "gradebook-course-grades", "", {}, [el("table", "", "", {}, rows)]);
    report.hidden = Boolean(course.hidden);
    nodes.push(el("div", "gradebook-course", "", {}, [
      el("div", "gradebook-course-title", (course.title ?? "Fixture course") + " Course"), report,
    ]));
  });
  if (pagination) nodes.push(el("a", "pager", "Next", { rel: "next" }));
  if (loading) nodes.push(el("div", "loading", "", { "aria-busy": "true" }));
  return el("document", "", "", {}, nodes);
}
