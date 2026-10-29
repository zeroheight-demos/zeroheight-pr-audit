import { existsSync, readFileSync } from "node:fs";

export const DEFAULT_CONFIG = {
	styleguideName: "",
	tokenSetId: null,
	include: ["src/**/*.{tsx,ts,jsx,js,vue,svelte,css,scss,less}"],
	exclude: ["**/*.test.*", "**/*.spec.*", "**/*.stories.*", "**/__snapshots__/**"],
	// "none" never fails the job; "must" fails it on any Must fix; "should" on Must or Should fix.
	failOn: "none",
	maxInlineComments: 25,
	// Size limits for what's sent to the model, in characters.
	maxDiffChars: 120000,
	maxContextChars: 200000,
	// Anything team-specific the audit should know, in plain words.
	extraInstructions: "",
};

const FAIL_ON = new Set(["none", "must", "should"]);

export function loadConfig(path) {
	if (!existsSync(path)) return { ...DEFAULT_CONFIG, _found: false };
	let raw;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		throw new Error(`Couldn't parse ${path}: ${err.message}`);
	}
	const config = { ...DEFAULT_CONFIG, ...raw, _found: true };
	if (!FAIL_ON.has(config.failOn)) {
		throw new Error(`failOn in ${path} must be one of: ${[...FAIL_ON].join(", ")}`);
	}
	for (const key of ["include", "exclude"]) {
		if (!Array.isArray(config[key])) throw new Error(`${key} in ${path} must be an array of globs`);
	}
	return config;
}

/** Converts a glob (`**`, `*`, `?`, `{a,b}`) to a RegExp matching a repo-relative path. */
export function globToRegExp(glob) {
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === "*") {
			if (glob[i + 1] === "*") {
				// `**/` matches zero or more directories; a trailing `**` matches everything.
				if (glob[i + 2] === "/") {
					re += "(?:.*/)?";
					i += 2;
				} else {
					re += ".*";
					i += 1;
				}
			} else {
				re += "[^/]*";
			}
		} else if (c === "?") {
			re += "[^/]";
		} else if (c === "{") {
			const end = glob.indexOf("}", i);
			if (end === -1) {
				re += "\\{";
			} else {
				const options = glob.slice(i + 1, end).split(",").map((o) => o.replace(/[.+^$()|[\]\\]/g, "\\$&"));
				re += `(?:${options.join("|")})`;
				i = end;
			}
		} else if (".+^$()|[]\\".includes(c)) {
			re += `\\${c}`;
		} else {
			re += c;
		}
	}
	return new RegExp(`^${re}$`);
}

export function makeFileFilter(include, exclude) {
	const inc = include.map(globToRegExp);
	const exc = exclude.map(globToRegExp);
	return (path) => inc.some((r) => r.test(path)) && !exc.some((r) => r.test(path));
}
