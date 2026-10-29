import assert from "node:assert/strict";
import { test } from "node:test";
import { globToRegExp, makeFileFilter } from "../src/config.mjs";
import { parseDiff } from "../src/diff.mjs";
import { alreadyPosted, existingComment, exitCodeFor, extractJson, inlineMarker, markerKey, normaliseReport, renderInline, renderSummary, SUMMARY_MARKER } from "../src/report.mjs";

const DIFF = `diff --git a/src/pages/Referral.tsx b/src/pages/Referral.tsx
new file mode 100644
--- /dev/null
+++ b/src/pages/Referral.tsx
@@ -0,0 +1,4 @@
+import { Button } from "@baseline/react";
+export function Referral() {
+  return <Button hierarchy="Primary" label="Copy" />;
+}
diff --git a/src/App.tsx b/src/App.tsx
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -10,6 +10,7 @@ import Home from "./pages/Home";
 const a = 1;
 const b = 2;
-const c = 3;
+const c = 4;
+const d = 5;
 const e = 6;
 const f = 7;
 const g = 8;
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
`;

test("parseDiff tracks added, commentable and old line numbers", () => {
	const files = parseDiff(DIFF);
	assert.equal(files.length, 3);
	const [referral, app, logo] = files;
	assert.equal(referral.path, "src/pages/Referral.tsx");
	assert.equal(referral.oldPath, null);
	assert.deepEqual([...referral.added], [1, 2, 3, 4]);
	assert.deepEqual([...app.added], [12, 13]);
	assert.deepEqual([...app.commentable], [10, 11, 12, 13, 14, 15, 16]);
	assert.equal(app.contextOld.get(14), 13);
	assert.equal(app.contextOld.get(10), 10);
	assert.ok(logo.binary);
});

test("globs match the way the config expects", () => {
	assert.ok(globToRegExp("src/**/*.tsx").test("src/pages/Referral.tsx"));
	assert.ok(globToRegExp("src/**/*.tsx").test("src/App.tsx"));
	assert.ok(!globToRegExp("src/*.tsx").test("src/pages/Referral.tsx"));
	assert.ok(globToRegExp("**/*.{css,scss}").test("a/b/c.scss"));
	const filter = makeFileFilter(["src/**/*.{ts,tsx}"], ["**/*.test.*", "**/*.stories.*"]);
	assert.ok(filter("src/Button.tsx"));
	assert.ok(!filter("src/Button.stories.tsx"));
	assert.ok(!filter("README.md"));
});

test("extractJson copes with fences and stray prose", () => {
	assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
	assert.deepEqual(extractJson('Here you go:\n```json\n{"a":1}\n```'), { a: 1 });
	assert.deepEqual(extractJson('Sure. {"a":{"b":2}} Done.'), { a: { b: 2 } });
	assert.throws(() => extractJson("no json here"));
});

const files = parseDiff(DIFF);
const raw = {
	styleguide: "Baseline - Master",
	verdict: "Adds a referral page; mostly on-system.",
	findings: [
		{ severity: "consider", title: "Spacing: close match", file: "src/App.tsx", line: 12, body: "Close to a token.", guideline: { title: "Spacing", url: "https://zh.example/p/3" } },
		{
			severity: "must",
			title: "Button: one primary per surface",
			file: "src/pages/Referral.tsx",
			line: 3,
			body: "Two primaries. cc @design-team",
			guideline: { title: "Button", url: "https://zh.example/p/1" },
			suggestion: '  return <Button hierarchy="Secondary" label="Copy" />;',
		},
		{ severity: "should", title: "Off the diff", file: "src/App.tsx", line: 40, body: "Not in a hunk.", guideline: { title: "Color", url: "https://zh.example/p/2" } },
		{ severity: "must", title: "No citation", file: "src/App.tsx", line: 12, body: "Uncited.", guideline: { title: "Nothing" } },
	],
	on_system: ["Uses Button from the package."],
};

test("normaliseReport sorts, drops uncited findings and checks lines against the diff", () => {
	const report = normaliseReport(raw, files, { maxInlineComments: 25 });
	assert.deepEqual(report.dropped, ["No citation"]);
	assert.deepEqual(report.findings.map((f) => f.severity), ["must", "should", "consider"]);
	const [must, should] = report.findings;
	assert.ok(must.inline);
	assert.ok(!should.inline, "a line outside every hunk can't take an inline comment");
	assert.match(must.body, /@​design-team/, "mentions are defanged");
	assert.equal(exitCodeFor(report, "none"), 0);
	assert.equal(exitCodeFor(report, "must"), 1);
});

test("maxInlineComments moves the overflow to the summary", () => {
	const report = normaliseReport(raw, files, { maxInlineComments: 1 });
	assert.equal(report.findings.filter((f) => f.inline).length, 1);
});

test("rendering: suggestion styles, hidden markers, summary details", () => {
	const report = normaliseReport(raw, files, { maxInlineComments: 25 });
	const must = report.findings[0];
	const gh = renderInline(must, "github");
	assert.match(gh, /```suggestion\n/);
	assert.equal(markerKey(gh), must.key);
	assert.match(renderInline(must, "gitlab"), /```suggestion:-0\+0\n/);
	assert.match(renderInline(must, "none"), /Suggested change:/);
	const summary = renderSummary(report, { styleguideName: "Baseline - Master", pagesRead: 3, provider: "Anthropic" });
	assert.ok(summary.startsWith(SUMMARY_MARKER));
	assert.match(summary, /\| Must fix \| 1 \|/);
	assert.match(summary, /Details for findings without an inline comment/);
	assert.match(summary, /3 pages read · Anthropic/);
});

test("alreadyPosted: same subject and severity on overlapping lines, nothing else", () => {
	const prev = (title, start, end, label = "Must fix") =>
		existingComment({ path: "a.tsx", start, end, body: `**${label} · ${title}**\n\nx\n\n${inlineMarker("k")}` });
	const existing = [prev("Button: two primaries", 105, 109), prev("Banner: hand-built strip", 75, 86)];
	const f = (title, line, endLine = null, severity = "must") => ({ file: "a.tsx", title, line, endLine, severity });
	assert.ok(alreadyPosted(f("Button: two Primary buttons on one surface", 107), existing), "reworded, pinned inside the old range");
	assert.ok(!alreadyPosted(f("Button: icon-only button has no name", 79, 85), existing), "different subject inside the Banner range");
	assert.ok(!alreadyPosted(f("Button: two primaries", 107, null, "should"), existing), "different severity inside the range");
	assert.ok(alreadyPosted(f("Button used for navigation", 105, 109, "should"), existing), "same range, whatever the wording or severity");
	assert.ok(alreadyPosted(f("Hardcoded values", 75, 80, "should"), existing), "same start line");
	assert.ok(!alreadyPosted(f("Button: two primaries", 120), existing), "no overlap");
	assert.equal(existingComment({ path: "a.tsx", end: 3, body: "someone else's comment" }), null);
});
