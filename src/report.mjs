import { createHash } from "node:crypto";

export const SEVERITIES = {
	must: { label: "Must fix", rank: 0 },
	should: { label: "Should fix", rank: 1 },
	consider: { label: "Consider", rank: 2 },
};

// Hidden in rendered Markdown on GitHub, GitLab and Bitbucket alike.
export const SUMMARY_MARKER = "[//]: # (zeroheight-pr-audit:summary)";
export const inlineMarker = (key) => `[//]: # (zeroheight-pr-audit:${key})`;
// Re-runs word findings differently, so an existing audit comment is matched on
// where it sits, not on what it says.
export const anchorKey = (path, line) => `${path}:${line}`;
export const anchorLine = (f) => f.endLine || f.line;
export const markerKey = (body) => /\[\/\/\]: # \(zeroheight-pr-audit:([^)]+)\)/.exec(body || "")?.[1] ?? null;

/** Pulls the JSON object out of a model reply, tolerating a code fence or stray prose. */
export function extractJson(text) {
	if (!text) throw new Error("The model returned an empty reply.");
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
	const candidates = [text.trim(), fenced?.[1]?.trim()];
	const first = text.indexOf("{");
	const last = text.lastIndexOf("}");
	if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
	for (const c of candidates) {
		if (!c) continue;
		try {
			return JSON.parse(c);
		} catch {}
	}
	throw new Error(`The model's reply wasn't valid JSON: ${text.slice(0, 300)}`);
}

// Stops findings from pinging people or teams when posted.
const defang = (s) => String(s ?? "").replace(/@(?=[\w-])/g, "@​");

/**
 * Validates the model's report against the diff. Findings without a cited
 * page are dropped (the audit's core rule). Findings on lines the platform
 * can't comment on stay in the summary but don't get an inline comment.
 */
export function normaliseReport(raw, files, { maxInlineComments }) {
	const byPath = new Map(files.map((f) => [f.path, f]));
	const dropped = [];
	const findings = [];
	for (const f of Array.isArray(raw?.findings) ? raw.findings : []) {
		const severity = String(f.severity || "").toLowerCase();
		const url = f.guideline?.url;
		if (!SEVERITIES[severity] || !f.title || !/^https?:\/\//.test(url || "")) {
			dropped.push(f.title || "(untitled)");
			continue;
		}
		const file = byPath.get(f.file);
		const line = Number.isInteger(f.line) ? f.line : null;
		let endLine = Number.isInteger(f.end_line) && f.end_line > line ? f.end_line : null;
		let inline = Boolean(file && line && file.commentable.has(line));
		if (inline && endLine) {
			for (let l = line; l <= endLine; l++) {
				if (!file.commentable.has(l)) {
					endLine = null;
					break;
				}
			}
		}
		findings.push({
			severity,
			title: defang(f.title),
			file: f.file || null,
			line,
			endLine,
			body: defang(f.body),
			guideline: { title: defang(f.guideline.title || "Guideline"), url },
			// A suggestion only makes sense when it replaces exactly the lines commented on.
			suggestion: inline && typeof f.suggestion === "string" && f.suggestion.length ? f.suggestion : null,
			inline,
			key: createHash("sha1").update(`${f.file}|${severity}|${f.title}`).digest("hex").slice(0, 12),
		});
	}
	findings.sort((a, b) => SEVERITIES[a.severity].rank - SEVERITIES[b.severity].rank);
	let inlineCount = 0;
	for (const f of findings) {
		if (f.inline && ++inlineCount > maxInlineComments) f.inline = false;
	}
	return {
		styleguide: defang(raw?.styleguide),
		verdict: defang(raw?.verdict),
		findings,
		onSystem: (Array.isArray(raw?.on_system) ? raw.on_system : []).map(defang),
		dropped,
	};
}

export function counts(report) {
	const c = { must: 0, should: 0, consider: 0 };
	for (const f of report.findings) c[f.severity]++;
	return c;
}

const where = (f) => (f.file ? `\`${f.file}${f.line ? `:${f.line}${f.endLine ? `-${f.endLine}` : ""}` : ""}\`` : "General");
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n+/g, " ");

export function renderSummary(report, { styleguideName, pagesRead, provider }) {
	const c = counts(report);
	const name = report.styleguide || styleguideName;
	const out = [SUMMARY_MARKER, "", `## Design system audit · ${name}`, ""];
	if (report.verdict) out.push(report.verdict, "");
	out.push("| | Count |", "|---|---|", `| Must fix | ${c.must} |`, `| Should fix | ${c.should} |`, `| Consider | ${c.consider} |`, "");
	if (report.findings.length) {
		out.push("### Findings", "", "| Severity | Where | Finding | Guideline |", "|---|---|---|---|");
		for (const f of report.findings) {
			out.push(`| ${SEVERITIES[f.severity].label} | ${where(f)} | ${cell(f.title)} | [${cell(f.guideline.title)}](${f.guideline.url}) |`);
		}
		out.push("");
		const notInline = report.findings.filter((f) => !f.inline);
		if (notInline.length) {
			out.push("<details><summary>Details for findings without an inline comment</summary>", "");
			for (const f of notInline) out.push(`**${SEVERITIES[f.severity].label} · ${f.title}** (${where(f)})`, "", f.body, "");
			out.push("</details>", "");
		}
	}
	if (report.onSystem.length) {
		out.push("### On-system", "", ...report.onSystem.map((s) => `- ${s}`), "");
	}
	const read = Number.isInteger(pagesRead) ? ` · ${pagesRead} page${pagesRead === 1 ? "" : "s"} read` : "";
	out.push(`<sub>Checked against ${name} in zeroheight${read} · ${provider} · re-runs on every push</sub>`);
	return out.join("\n");
}

/**
 * Renders one inline comment. `suggestionStyle` is "github", "gitlab" or
 * "none" (Bitbucket has no suggestion blocks, so it gets a plain code block).
 */
export function renderInline(f, suggestionStyle) {
	const out = [`**${SEVERITIES[f.severity].label} · ${f.title}**`, "", f.body, ""];
	if (f.suggestion) {
		const code = f.suggestion.replace(/\n$/, "");
		if (suggestionStyle === "github") {
			out.push("```suggestion", code, "```", "");
		} else if (suggestionStyle === "gitlab") {
			const span = f.endLine ? f.endLine - f.line : 0;
			out.push(`\`\`\`suggestion:-0+${span}`, code, "```", "");
		} else {
			out.push("Suggested change:", "", "```", code, "```", "");
		}
	}
	out.push(`[${f.guideline.title} guidelines](${f.guideline.url})`, "", inlineMarker(f.key));
	return out.join("\n");
}

export function exitCodeFor(report, failOn) {
	const c = counts(report);
	if (failOn === "must" && c.must) return 1;
	if (failOn === "should" && (c.must || c.should)) return 1;
	return 0;
}
