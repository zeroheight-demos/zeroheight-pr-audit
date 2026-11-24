// Anthropic Messages API with client-side tools. The model asks for a
// zeroheight tool, this script runs it (with the zeroheight credentials, which
// never leave the runner) and sends the result back.
// https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
import { request } from "../http.mjs";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
const MAX_TURNS = 40;

const baseUrl = () => (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");

export async function run({ system, user, model, apiKey, log, zh }) {
	if (!apiKey) throw new Error("ANTHROPIC_API_KEY isn't set.");
	const tools = zh.tools.map((t, i) => ({
		name: t.name,
		description: t.description,
		input_schema: t.input_schema,
		...(i === zh.tools.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
	}));
	// The diff is the big, unchanging part of every turn, so cache it.
	const messages = [{ role: "user", content: [{ type: "text", text: user, cache_control: { type: "ephemeral" } }] }];
	const toolCalls = [];
	let text = "";

	for (let turn = 0; turn < MAX_TURNS; turn++) {
		const { data } = await request(`${baseUrl()}/v1/messages`, {
			method: "POST",
			timeoutMs: 10 * 60 * 1000,
			headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
			body: {
				model: model || DEFAULT_MODEL,
				max_tokens: 16000,
				system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
				messages,
				tools,
			},
		});
		const content = data.content || [];
		text = content.filter((b) => b.type === "text").map((b) => b.text).join("");
		if (data.stop_reason !== "tool_use") {
			if (data.stop_reason === "max_tokens") log("  warning: the reply hit max_tokens and may be cut off");
			break;
		}
		messages.push({ role: "assistant", content });
		const results = [];
		for (const block of content.filter((b) => b.type === "tool_use")) {
			toolCalls.push(block.name);
			const r = await zh.exec(block.name, block.input);
			log(`  zeroheight: ${block.name}${r.isError ? " (error)" : ""}`);
			results.push({ type: "tool_result", tool_use_id: block.id, content: r.text || "(empty)", ...(r.isError ? { is_error: true } : {}) });
		}
		messages.push({ role: "user", content: results });
		if (turn === MAX_TURNS - 1) log(`  warning: stopped after ${MAX_TURNS} turns`);
	}
	return { text, toolCalls };
}

/** Asks for the JSON again when the first reply didn't parse. */
export async function repair({ apiKey, model, badText }) {
	const { data } = await request(`${baseUrl()}/v1/messages`, {
		method: "POST",
		timeoutMs: 5 * 60 * 1000,
		headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
		body: {
			model: model || DEFAULT_MODEL,
			max_tokens: 16000,
			messages: [{ role: "user", content: repairPrompt(badText) }],
		},
	});
	return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

export const repairPrompt = (badText) =>
	`This should have been a single JSON object matching the audit report shape (styleguide, verdict, findings, on_system), but it didn't parse. Return only the corrected JSON object, with no prose and no code fence. Don't change any findings.\n\n${badText}`;
