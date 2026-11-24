// OpenAI Responses API with function tools. The model asks for a zeroheight
// tool, this script runs it (with the zeroheight credentials, which never
// leave the runner) and sends the result back.
// https://developers.openai.com/api/docs/guides/function-calling
import { request } from "../http.mjs";
import { repairPrompt } from "./anthropic.mjs";

export const DEFAULT_MODEL = "gpt-6.1-sol";
const MAX_TURNS = 40;

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

export async function run({ system, user, model, apiKey, log, zh }) {
	if (!apiKey) throw new Error("OPENAI_API_KEY isn't set.");
	const tools = zh.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.input_schema, strict: false }));
	const toolCalls = [];
	let previous = null;
	let input = user;
	let data;

	for (let turn = 0; turn < MAX_TURNS; turn++) {
		({ data } = await request(`${baseUrl()}/responses`, {
			method: "POST",
			timeoutMs: 10 * 60 * 1000,
			headers: { Authorization: `Bearer ${apiKey}` },
			body: {
				model: model || DEFAULT_MODEL,
				instructions: system,
				input,
				tools,
				max_output_tokens: 32000,
				...(previous ? { previous_response_id: previous } : {}),
			},
		}));
		const calls = (data.output || []).filter((item) => item.type === "function_call");
		if (!calls.length) break;
		input = [];
		for (const call of calls) {
			toolCalls.push(call.name);
			let args = {};
			try {
				args = JSON.parse(call.arguments || "{}");
			} catch {}
			const r = await zh.exec(call.name, args);
			log(`  zeroheight: ${call.name}${r.isError ? " (error)" : ""}`);
			input.push({ type: "function_call_output", call_id: call.call_id, output: r.isError ? `Error: ${r.text}` : r.text || "(empty)" });
		}
		previous = data.id;
		if (turn === MAX_TURNS - 1) log(`  warning: stopped after ${MAX_TURNS} turns`);
	}
	if (data?.status && data.status !== "completed") {
		log(`  warning: response status ${data.status}${data.incomplete_details ? ` (${JSON.stringify(data.incomplete_details)})` : ""}`);
	}
	return { text: data ? outputText(data) : "", toolCalls };
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
