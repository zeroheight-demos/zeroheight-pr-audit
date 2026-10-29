import { request } from "../http.mjs";
import { markerKey, renderInline, SUMMARY_MARKER } from "../report.mjs";

export function context(env = process.env) {
	if (!env.CI_MERGE_REQUEST_IID) {
		throw new Error("CI_MERGE_REQUEST_IID isn't set. Run this job in a merge request pipeline (rules: if: $CI_PIPELINE_SOURCE == \"merge_request_event\").");
	}
	return {
		number: env.CI_MERGE_REQUEST_IID,
		title: env.CI_MERGE_REQUEST_TITLE,
		base: env.CI_MERGE_REQUEST_DIFF_BASE_SHA || env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
		headSha: env.CI_COMMIT_SHA,
	};
}

function client(env) {
	const token = env.ZH_AUDIT_PLATFORM_TOKEN || env.GITLAB_TOKEN;
	if (!token) throw new Error("GITLAB_TOKEN isn't set. It needs a project access token with the api scope (CI_JOB_TOKEN can't post comments).");
	const api = (env.CI_API_V4_URL || "https://gitlab.com/api/v4").replace(/\/$/, "");
	const base = `${api}/projects/${encodeURIComponent(env.CI_PROJECT_ID)}/merge_requests/${env.CI_MERGE_REQUEST_IID}`;
	const call = (path, opts = {}) => request(`${base}${path}`, { ...opts, headers: { "PRIVATE-TOKEN": token } });
	const all = async (path) => {
		const out = [];
		for (let page = 1; page < 50; page++) {
			const { data, headers } = await call(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
			out.push(...data);
			if (!headers.get("x-next-page")) break;
		}
		return out;
	};
	return { call, all };
}

export async function publish({ ctx, report, summary, files, log, env = process.env }) {
	const { call, all } = client(env);
	const byPath = new Map(files.map((f) => [f.path, f]));

	const { data: mr } = await call("");
	const refs = mr.diff_refs;
	const inline = report.findings.filter((f) => f.inline);
	const discussions = await all("/discussions");
	const existing = new Set(discussions.flatMap((d) => d.notes || []).map((n) => markerKey(n.body)).filter(Boolean));
	let posted = 0;
	for (const f of inline) {
		if (existing.has(f.key)) continue;
		const file = byPath.get(f.file);
		const position = {
			position_type: "text",
			base_sha: refs.base_sha,
			start_sha: refs.start_sha,
			head_sha: refs.head_sha,
			new_path: file.newPath,
			old_path: file.oldPath || file.newPath,
			new_line: f.line,
		};
		// A comment on an unchanged line has to name its old line number too.
		if (!file.added.has(f.line)) position.old_line = file.contextOld.get(f.line);
		try {
			await call("/discussions", { method: "POST", body: { body: renderInline(f, "gitlab"), position } });
			posted++;
		} catch (err) {
			f.inline = false;
			log(`  couldn't comment on ${f.file}:${f.line} (${err.status ?? err.message}); it's in the summary instead`);
		}
	}
	log(`Inline comments: ${posted} new, ${inline.length - posted} already there or moved to the summary`);

	const notes = await all("/notes?sort=asc");
	const mine = notes.find((n) => n.body?.startsWith(SUMMARY_MARKER));
	const text = summary();
	if (mine) {
		await call(`/notes/${mine.id}`, { method: "PUT", body: { body: text } });
		log("Summary comment updated");
	} else {
		await call("/notes", { method: "POST", body: { body: text } });
		log("Summary comment posted");
	}
}
