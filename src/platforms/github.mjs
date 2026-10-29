import { readFileSync } from "node:fs";
import { request } from "../http.mjs";
import { anchorKey, anchorLine, markerKey, renderInline, SUMMARY_MARKER } from "../report.mjs";

export function context(env = process.env) {
	if (!env.GITHUB_EVENT_PATH) throw new Error("GITHUB_EVENT_PATH isn't set: this doesn't look like a GitHub Actions run.");
	const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
	const pr = event.pull_request;
	if (!pr) throw new Error("This run wasn't triggered by a pull request event.");
	return {
		number: pr.number,
		title: pr.title,
		base: pr.base.sha,
		headSha: pr.head.sha,
	};
}

function client(env) {
	const token = env.ZH_AUDIT_PLATFORM_TOKEN || env.GITHUB_TOKEN;
	if (!token) throw new Error("GITHUB_TOKEN isn't set. Pass github-token to the action, or set GITHUB_TOKEN.");
	const api = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
	const repo = env.GITHUB_REPOSITORY;
	const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
	const call = (path, opts = {}) => request(`${api}/repos/${repo}${path}`, { ...opts, headers });
	const all = async (path) => {
		const out = [];
		for (let page = 1; page < 50; page++) {
			const { data } = await call(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
			out.push(...data);
			if (data.length < 100) break;
		}
		return out;
	};
	return { call, all };
}

export async function publish({ ctx, report, summary, files, log, env = process.env }) {
	const { call, all } = client(env);

	const inline = report.findings.filter((f) => f.inline);
	const existing = new Set(
		(await all(`/pulls/${ctx.number}/comments`)).filter((c) => markerKey(c.body) && c.line).map((c) => anchorKey(c.path, c.line)),
	);
	let posted = 0;
	for (const f of inline) {
		if (existing.has(anchorKey(f.file, anchorLine(f)))) continue;
		const body = {
			body: renderInline(f, "github"),
			commit_id: ctx.headSha,
			path: f.file,
			side: "RIGHT",
			line: f.endLine || f.line,
		};
		if (f.endLine) Object.assign(body, { start_line: f.line, start_side: "RIGHT" });
		try {
			await call(`/pulls/${ctx.number}/comments`, { method: "POST", body });
			posted++;
		} catch (err) {
			f.inline = false;
			log(`  couldn't comment on ${f.file}:${f.line} (${err.status ?? err.message}); it's in the summary instead`);
		}
	}
	log(`Inline comments: ${posted} new, ${inline.length - posted} already there or moved to the summary`);

	const comments = await all(`/issues/${ctx.number}/comments`);
	const mine = comments.find((c) => c.body?.startsWith(SUMMARY_MARKER));
	const text = summary();
	if (mine) {
		await call(`/issues/comments/${mine.id}`, { method: "PATCH", body: { body: text } });
		log("Summary comment updated");
	} else {
		await call(`/issues/${ctx.number}/comments`, { method: "POST", body: { body: text } });
		log("Summary comment posted");
	}
}
