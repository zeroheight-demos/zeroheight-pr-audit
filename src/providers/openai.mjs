// OpenAI Responses API with a remote MCP tool: OpenAI's servers call the
// zeroheight MCP directly.
// https://developers.openai.com/api/docs/guides/tools-connectors-mcp
import { request } from "../http.mjs";
import { ZEROHEIGHT_TOOLS } from "../prompt.mjs";
import { repairPrompt } from "./anthropic.mjs";

export const DEFAULT_MODEL = "gpt-6.1-sol";

const baseUrl = () => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

function outputText(data) {
	if (typeof data.output_text === "string") return data.output_text;
	return (data.output || [])
		.filter((item) => item.type === "message")
		.flatMap((item) => item.content || [])
		.filter((c) => c.type === "output_text")
		.map((c) => c.text)
		.join("");
}

export async function run({ system, user, mcpUrl, model, apiKey, log }) {
	if (!apiKey) throw new Error("OPENAI_API_KEY isn't set.");
	const { data } = await request(`${baseUrl()}/responses`, {
		method: "POST",
		timeoutMs: 15 * 60 * 1000,
		headers: { Authorization: `Bearer ${apiKey}` },
		body: {
			model: model || DEFAULT_MODEL,
			instructions: system,
			input: user,
			max_output_tokens: 32000,
			tools: [
				{
					type: "mcp",
					server_label: "zeroheight",
					server_description: "The team's design system documentation and tokens in zeroheight.",
					server_url: mcpUrl,
					require_approval: "never",
					allowed_tools: ZEROHEIGHT_TOOLS,
				},
			],
		},
	});
	if (data.status && data.status !== "completed") {
		log(`  warning: response status ${data.status}${data.incomplete_details ? ` (${JSON.stringify(data.incomplete_details)})` : ""}`);
	}
	const toolCalls = [];
	for (const item of data.output || []) {
		if (item.type === "mcp_call") {
			toolCalls.push(item.name);
			log(`  zeroheight: ${item.name}${item.error ? " (error)" : ""}`);
		}
	}
	return { text: outputText(data), toolCalls };
}

export async function repair({ apiKey, model, badText }) {
	const { data } = await request(`${baseUrl()}/responses`, {
		method: "POST",
		timeoutMs: 5 * 60 * 1000,
		headers: { Authorization: `Bearer ${apiKey}` },
		body: { model: model || DEFAULT_MODEL, input: repairPrompt(badText), max_output_tokens: 32000 },
	});
	return outputText(data);
}
