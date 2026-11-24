import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function systemPrompt() {
	return readFileSync(fileURLToPath(new URL("../prompts/audit.md", import.meta.url)), "utf8");
}

export function userPrompt({ zh, config, pr, input, references = [] }) {
	const parts = [
		`Styleguide: ${zh.styleguide.name} (the zeroheight tools are already scoped to it)`,
		`Tools available: ${zh.tools.map((t) => t.name).join(", ")}`,
		zh.tokens
			? `Token set: ${zh.tokens.setName}, ${zh.tokens.size} tokens`
			: `Tokens: not available for this run (${zh.tokenNote}). Skip token matching and say so in on_system.`,
	];
	if (!zh.canSearch) parts.push("search-pages isn't available, so find pages with list-pages.");
	if (pr?.title) parts.push(`Pull request: ${pr.title}`);
	if (config.extraInstructions) parts.push(`\nTeam notes for this audit:\n${config.extraInstructions}`);
	if (input.notes.length) parts.push(`\nNotes:\n${input.notes.map((n) => `- ${n}`).join("\n")}`);
	if (references.length) {
		const lines = references.map((r) =>
			r.token
				? `- ${r.name}: matches zeroheight token ${r.token}`
				: r.definedIn.length
					? `- ${r.name}: not a zeroheight token, but defined in this repo (${r.definedIn.join(", ")})`
					: `- ${r.name}: NOT FOUND, matches no zeroheight token and isn't defined anywhere in this repo`,
		);
		parts.push(`\n## Token references in the added lines (checked by the script)\n\n${lines.join("\n")}`);
	}
	parts.push(
		"\n## Diff\n\nOnly lines starting with `+` are in scope.\n\n```diff\n" + input.patch.trimEnd() + "\n```",
		"\n## Changed files in full, with line numbers\n\nUse these numbers for `line` and `end_line`.\n\n```\n" + input.context.trimEnd() + "\n```",
		"\nRun the audit and return the JSON object.",
	);
	return parts.join("\n");
}
