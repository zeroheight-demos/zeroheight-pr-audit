import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseDiff } from "../src/diff.mjs";
import * as bitbucket from "../src/platforms/bitbucket.mjs";
import * as github from "../src/platforms/github.mjs";
import * as gitlab from "../src/platforms/gitlab.mjs";
import { inlineMarker, normaliseReport, renderSummary, SUMMARY_MARKER } from "../src/report.mjs";

const DIFF = `diff --git a/src/App.tsx b/src/App.tsx
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -10,3 +10,4 @@
 const a = 1;
+const b = <Button hierarchy="Primary" />;
+const c = <Button hierarchy="Primary" />;
 const d = 4;
`;
const files = parseDiff(DIFF);
const raw = {
	findings: [
		{ severity: "must", title: "One primary", file: "src/App.tsx", line: 11, end_line: 12, body: "Two.", guideline: { title: "Button", url: "https://zh.example/p/1" } },
		{ severity: "should", title: "Context line", file: "src/App.tsx", line: 13, body: "On an unchanged line.", guideline: { title: "Button", url: "https://zh.example/p/1" } },
	],
};

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

/** Records every request and answers from `routes` (first matching method + URL regex). */
function mockFetch(routes) {
	const calls = [];
	globalThis.fetch = async (url, opts = {}) => {
		const method = opts.method || "GET";
		calls.push({ method, url: String(url), body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers });
		const route = routes.find((r) => r.method === method && r.url.test(String(url)));
		const data = route ? (typeof route.data === "function" ? route.data() : route.data) : {};
		return new Response(JSON.stringify(data), { status: route?.status ?? 200, headers: { "content-type": "application/json", ...(route?.headers || {}) } });
	};
	return calls;
}

const run = (platform, ctx, env) => {
	const report = normaliseReport(raw, files, { maxInlineComments: 25 });
	const summary = () => renderSummary(report, { styleguideName: "Baseline", pagesRead: 2, provider: "Test" });
	return platform.publish({ ctx, report, summary, files, log: () => {}, env });
};

test("github: multi-line comment payload, skips existing, updates summary", async () => {
	const calls = mockFetch([
		// Same place as the second finding, worded differently by an earlier run.
		{ method: "GET", url: /\/pulls\/7\/comments/, data: [{ path: "src/App.tsx", line: 13, body: `**Should fix · Context line: older wording**\n\nx\n\n${inlineMarker("0ld")}` }] },
		{ method: "GET", url: /\/issues\/7\/comments/, data: [{ id: 99, body: `${SUMMARY_MARKER}\n\nold` }] },
	]);
	await run(github, { number: 7, headSha: "abc" }, { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r" });
	const posts = calls.filter((c) => c.method === "POST");
	assert.equal(posts.length, 1, "the finding that already has a comment isn't posted again");
	assert.deepEqual(
		{ ...posts[0].body, body: undefined },
		{ body: undefined, commit_id: "abc", path: "src/App.tsx", side: "RIGHT", line: 12, start_line: 11, start_side: "RIGHT" },
	);
	const patch = calls.find((c) => c.method === "PATCH");
	assert.match(patch.url, /\/issues\/comments\/99$/);
	assert.equal(patch.headers.Authorization, "Bearer t");
});

test("gitlab: positions carry diff refs, and old_line for unchanged lines", async () => {
	const calls = mockFetch([
		{ method: "GET", url: /merge_requests\/5$/, data: { diff_refs: { base_sha: "b", start_sha: "s", head_sha: "h" } } },
		{ method: "GET", url: /\/discussions/, data: [] },
		{ method: "GET", url: /\/notes/, data: [] },
	]);
	await run(gitlab, { number: 5 }, { GITLAB_TOKEN: "t", CI_API_V4_URL: "https://gitlab.example/api/v4", CI_PROJECT_ID: "12", CI_MERGE_REQUEST_IID: "5" });
	const discussions = calls.filter((c) => c.method === "POST" && /discussions/.test(c.url));
	assert.equal(discussions.length, 2);
	assert.deepEqual(discussions[0].body.position, {
		position_type: "text",
		base_sha: "b",
		start_sha: "s",
		head_sha: "h",
		new_path: "src/App.tsx",
		old_path: "src/App.tsx",
		new_line: 11,
	});
	assert.equal(discussions[1].body.position.old_line, 11);
	assert.match(discussions[0].body.body, /```suggestion|Two\./);
	assert.ok(calls.some((c) => c.method === "POST" && /\/notes$/.test(c.url)), "summary posted as a note");
	assert.equal(calls[0].headers["PRIVATE-TOKEN"], "t");
});

test("bitbucket: inline anchor uses `to`, summary found and updated", async () => {
	const calls = mockFetch([
		{ method: "GET", url: /\/comments\?pagelen/, data: { values: [{ id: 3, content: { raw: `${SUMMARY_MARKER}\n\nold` } }] } },
	]);
	await run(bitbucket, { number: 9 }, { BITBUCKET_TOKEN: "t", BITBUCKET_WORKSPACE: "w", BITBUCKET_REPO_SLUG: "r", BITBUCKET_PR_ID: "9" });
	const inline = calls.filter((c) => c.method === "POST");
	assert.equal(inline.length, 2);
	assert.deepEqual(inline[0].body.inline, { path: "src/App.tsx", to: 11 });
	const put = calls.find((c) => c.method === "PUT");
	assert.match(put.url, /\/pullrequests\/9\/comments\/3$/);
});

test("a rejected inline comment falls back to the summary", async () => {
	const calls = mockFetch([
		{ method: "GET", url: /\/pulls\/7\/comments/, data: [] },
		{ method: "POST", url: /\/pulls\/7\/comments/, status: 422, data: { message: "line must be part of the diff" } },
		{ method: "GET", url: /\/issues\/7\/comments/, data: [] },
	]);
	await run(github, { number: 7, headSha: "abc" }, { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r" });
	const summary = calls.find((c) => c.method === "POST" && /\/issues\/7\/comments$/.test(c.url));
	assert.match(summary.body.body, /Details for findings without an inline comment/);
});
