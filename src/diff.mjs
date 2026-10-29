import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function git(args, opts = {}) {
	return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
}

/**
 * Resolves the commit to diff against. `base` can be a SHA, a branch name or
 * `origin/<branch>`. Fetches the branch when it isn't available locally,
 * which CI clones often need.
 */
export function resolveBase(base) {
	const candidates = base.startsWith("origin/") || /^[0-9a-f]{7,40}$/.test(base) ? [base] : [`origin/${base}`, base];
	for (const ref of candidates) {
		try {
			git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { stdio: ["ignore", "pipe", "ignore"] });
			return ref;
		} catch {}
	}
	const branch = base.replace(/^origin\//, "");
	try {
		git(["fetch", "--no-tags", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { stdio: "ignore" });
		return `origin/${branch}`;
	} catch {}
	try {
		git(["fetch", "--no-tags", "origin", base], { stdio: "ignore" });
		return "FETCH_HEAD";
	} catch {}
	throw new Error(`Couldn't find the base "${base}". Make sure the CI checkout fetches full history (see the setup guide).`);
}

/** Returns the unified diff of HEAD against its merge base with `base`. */
export function getDiff(baseRef) {
	let mergeBase;
	try {
		mergeBase = git(["merge-base", baseRef, "HEAD"]).trim();
	} catch {
		throw new Error(
			`No merge base between ${baseRef} and HEAD. The clone is probably shallow: fetch full history (fetch-depth: 0, GIT_DEPTH: 0, or clone depth: full).`,
		);
	}
	return git(["diff", "--no-color", "--no-ext-diff", "--unified=3", "--find-renames", mergeBase, "HEAD"]);
}

/**
 * Parses a unified diff into files with the new-side lines that were added
 * and every new-side line visible in a hunk (the lines a review comment can
 * attach to).
 */
export function parseDiff(diffText) {
	const files = [];
	let file = null;
	let newLine = 0;
	let oldLine = 0;
	const lines = diffText.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.startsWith("diff --git ")) {
			// `contextOld` maps an unchanged line's new number to its old number (GitLab needs both).
			const header = / b\/(.+)$/.exec(line);
			file = { oldPath: null, newPath: null, headerPath: header?.[1] ?? null, added: new Set(), commentable: new Set(), contextOld: new Map(), patch: [line], binary: false };
			files.push(file);
			continue;
		}
		if (!file) continue;
		if (line.startsWith("--- ") && !file.hunkStarted) {
			file.oldPath = line.slice(4) === "/dev/null" ? null : line.slice(4).replace(/^a\//, "");
		} else if (line.startsWith("+++ ") && !file.hunkStarted) {
			file.newPath = line.slice(4) === "/dev/null" ? null : line.slice(4).replace(/^b\//, "");
		} else if (line.startsWith("Binary files ")) {
			file.binary = true;
		} else if (line.startsWith("@@")) {
			file.hunkStarted = true;
			const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
			oldLine = m ? Number(m[1]) : 0;
			newLine = m ? Number(m[2]) : 0;
		} else if (file.hunkStarted) {
			if (line.startsWith("+")) {
				file.added.add(newLine);
				file.commentable.add(newLine);
				newLine++;
			} else if (line.startsWith(" ")) {
				file.commentable.add(newLine);
				file.contextOld.set(newLine, oldLine);
				newLine++;
				oldLine++;
			} else if (line.startsWith("-")) {
				oldLine++;
			} else if (line.startsWith("\\")) {
				// "\ No newline at end of file" doesn't move either side.
			} else if (line === "" && i === lines.length - 1) {
				continue;
			}
		}
		file.patch.push(line);
	}
	return files
		.map(({ hunkStarted, headerPath, patch, ...f }) => ({ ...f, path: f.newPath ?? f.oldPath ?? headerPath, patch: patch.join("\n") }))
		.filter((f) => f.path);
}

/** Prefixes each line of a file with its line number, for the model to cite. */
export function numberLines(text) {
	const lines = text.split("\n");
	const width = String(lines.length).length;
	return lines.map((l, i) => `${String(i + 1).padStart(width, " ")}  ${l}`).join("\n");
}

/**
 * Builds the material the model audits: the filtered patch and the full
 * changed files with line numbers, both trimmed to the configured budgets.
 */
export function buildAuditInput(files, config) {
	const notes = [];
	let patch = "";
	let truncatedPatch = false;
	for (const f of files) {
		if (patch.length + f.patch.length > config.maxDiffChars) {
			truncatedPatch = true;
			continue;
		}
		patch += `${f.patch}\n`;
	}
	if (truncatedPatch) notes.push("The diff was too large to send in full; some files were left out of the audit.");

	let context = "";
	const skipped = [];
	for (const f of files) {
		if (!f.newPath || f.binary || !existsSync(f.newPath)) continue;
		const text = readFileSync(f.newPath, "utf8");
		const block = `===== ${f.newPath} =====\n${numberLines(text)}\n\n`;
		if (context.length + block.length > config.maxContextChars) {
			skipped.push(f.newPath);
			continue;
		}
		context += block;
	}
	if (skipped.length) notes.push(`Full contents left out to stay within limits: ${skipped.join(", ")}.`);
	return { patch, context, notes };
}
