// Anthropic Messages API with the MCP connector: Anthropic's servers call the
// zeroheight MCP directly, so nothing here needs an MCP client.
// https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
import { request } from "../http.mjs";
import { ZEROHEIGHT_TOOLS } from "../prompt.mjs";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
const BETA = "mcp-client-2025-11-20";
const MAX_CONTINUATIONS = 8;

export async function run({ system, user, mcpUrl, model, apiKey, log }) {
	if (!apiKey) throw new Error("ANTHROPIC_API_KEY isn't set.");
	const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
	const messages = [{ role: "user", content: user }];
	const toolCalls = [];
	const send = () =>
		request(`${base}/v1/messages`, {
			method: "POST",
			timeoutMs: 15 * 60 * 1000,
			headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-beta": BETA },
			body: {
				model: model || DEFAULT_MODEL,
				max_tokens: 16000,
				system,
				messages,
				mcp_servers: [{ type: "url", url: mcpUrl, name: "zeroheight" }],
				tools: [
					{
						type: "mcp_toolset",
						mcp_server_name: "zeroheight",
						default_config: { enabled: false },
						configs: Object.fromEntries(ZEROHEIGHT_TOOLS.map((t) => [t, { enabled: true }])),
					},
				],
			},
		});

	let text = "";
	for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
		const { data } = await send();
		for (const block of data.content || []) {
			if (block.type === "mcp_tool_use") {
				toolCalls.push(block.name);
				log(`  zeroheight: ${block.name}`);
			}
			if (block.type === "mcp_tool_result" && block.is_error) log("  zeroheight tool returned an error");
		}
		text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
		// A long server-side tool loop can pause; send the turn back to let it continue.
		if (data.stop_reason === "pause_turn") {
			messages.push({ role: "assistant", content: data.content });
			continue;
		}
		if (data.stop_reason === "max_tokens") log("  warning: the reply hit max_tokens and may be cut off");
		break;
	}
	return { text, toolCalls };
}

/** Asks for the JSON again when the first reply didn't parse. */
export async function repair({ apiKey, model, badText }) {
	const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
	const { data } = await request(`${base}/v1/messages`, {
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
