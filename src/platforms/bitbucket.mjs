import { request } from "../http.mjs";
import { alreadyPosted, existingComment, renderInline, SUMMARY_MARKER } from "../report.mjs";

export function context(env = process.env) {
	if (!env.BITBUCKET_PR_ID) {
		throw new Error("BITBUCKET_PR_ID isn't set. Run this step under the pull-requests section of bitbucket-pipelines.yml.");
	}
	return {
		number: env.BITBUCKET_PR_ID,
		title: null,
		base: env.BITBUCKET_PR_DESTINATION_BRANCH,
		headSha: env.BITBUCKET_COMMIT,
	};
}

function client(env) {
	const token = env.ZH_AUDIT_PLATFORM_TOKEN || env.BITBUCKET_TOKEN;
	if (!token) throw new Error("BITBUCKET_TOKEN isn't set. It needs a repository access token with the Pull requests: Write scope.");
	const base = `https://api.bitbucket.org/2.0/repositories/${env.BITBUCKET_WORKSPACE}/${env.BITBUCKET_REPO_SLUG}/pullrequests/${env.BITBUCKET_PR_ID}`;
	const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
	const call = (path, opts = {}) => request(`${base}${path}`, { ...opts, headers });
	const all = async (path) => {
		const out = [];
		let url = `${base}${path}?pagelen=100`;
		for (let i = 0; url && i < 50; i++) {
			const { data } = await request(url, { headers });
			out.push(...(data.values || []));
			url = data.next;
		}
		return out;
	};
	return { call, all };
}

export async function title(env = process.env) {
	try {
		const { data } = await client(env).call("");
		return data.title;
	} catch {
		return null;
	}
}

export async function publish({ ctx, report, summary, log, env = process.env }) {
	const { call, all } = client(env);

	const comments = (await all("/comments")).filter((c) => !c.deleted);
	const existing = comments.map((c) => existingComment({ path: c.inline?.path, end: c.inline?.to, body: c.content?.raw }));
	const inline = report.findings.filter((f) => f.inline);
	let posted = 0;
	for (const f of inline) {
		if (alreadyPosted(f, existing)) continue;
		try {
			// Bitbucket has no suggestion blocks, so the fix is shown as a code block.
			await call("/comments", { method: "POST", body: { content: { raw: renderInline(f, "none") }, inline: { path: f.file, to: f.line } } });
			posted++;
		} catch (err) {
			f.inline = false;
			log(`  couldn't comment on ${f.file}:${f.line} (${err.status ?? err.message}); it's in the summary instead`);
		}
	}
	log(`Inline comments: ${posted} new, ${inline.length - posted} already there or moved to the summary`);

	const mine = comments.find((c) => !c.inline && c.content?.raw?.startsWith(SUMMARY_MARKER));
	const text = summary();
	if (mine) {
		await call(`/comments/${mine.id}`, { method: "PUT", body: { content: { raw: text } } });
		log("Summary comment updated");
	} else {
		await call("/comments", { method: "POST", body: { content: { raw: text } } });
		log("Summary comment posted");
	}
}
