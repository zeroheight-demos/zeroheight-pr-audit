import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The read-only zeroheight tools the audit may call. Write tools aren't
// available on a remote MCP link anyway; listing them keeps it explicit.
export const ZEROHEIGHT_TOOLS = ["list-pages", "search-pages", "get-page", "list-token-sets", "list-tokens", "suggest-tokens"];

export function systemPrompt() {
	return readFileSync(fileURLToPath(new URL("../prompts/audit.md", import.meta.url)), "utf8");
}

export function userPrompt({ styleguideName, config, pr, input }) {
	const parts = [
		`Styleguide: ${styleguideName}`,
		config.tokenSetId ? `Token set ID: ${config.tokenSetId}` : "Token set ID: not configured (find it with list-token-sets)",
	];
	if (pr?.title) parts.push(`Pull request: ${pr.title}`);
	if (config.extraInstructions) parts.push(`\nTeam notes for this audit:\n${config.extraInstructions}`);
	if (input.notes.length) parts.push(`\nNotes:\n${input.notes.map((n) => `- ${n}`).join("\n")}`);
	parts.push(
		"\n## Diff\n\nOnly lines starting with `+` are in scope.\n\n```diff\n" + input.patch.trimEnd() + "\n```",
		"\n## Changed files in full, with line numbers\n\nUse these numbers for `line` and `end_line`.\n\n```\n" + input.context.trimEnd() + "\n```",
		"\nRun the audit and return the JSON object.",
	);
	return parts.join("\n");
}
