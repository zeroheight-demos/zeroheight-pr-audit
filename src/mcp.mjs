// A minimal MCP client over Streamable HTTP, used only for the preflight
// check. The audit itself reaches zeroheight through the model provider.

let nextId = 1;

async function rpc(url, message, sessionId) {
	const headers = {
		"Content-Type": "application/json",
		Accept: "application/json, text/event-stream",
	};
	if (sessionId) headers["Mcp-Session-Id"] = sessionId;
	const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(message), signal: AbortSignal.timeout(30000) });
	const text = await res.text();
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
	if (message.id === undefined) return { sessionId: res.headers.get("mcp-session-id") };

	let payload = null;
	if ((res.headers.get("content-type") || "").includes("text/event-stream")) {
		for (const line of text.split("\n")) {
			if (!line.startsWith("data:")) continue;
			try {
				const data = JSON.parse(line.slice(5).trim());
				if (data.id === message.id) payload = data;
			} catch {}
		}
	} else {
		payload = JSON.parse(text);
	}
	if (!payload) throw new Error(`No response to ${message.method}: ${text.slice(0, 300)}`);
	if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
	return { result: payload.result, sessionId: res.headers.get("mcp-session-id") || sessionId };
}

export async function callTool(url, name, args = {}) {
	const init = await rpc(url, {
		jsonrpc: "2.0",
		id: nextId++,
		method: "initialize",
		params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "zeroheight-pr-audit", version: "1" } },
	});
	const sessionId = init.sessionId;
	await rpc(url, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId);
	const { result } = await rpc(url, { jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }, sessionId);
	const text = (result?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
	if (result?.isError) throw new Error(text || `${name} returned an error`);
	return text;
}

/**
 * Checks the zeroheight MCP is reachable and returns the styleguide name.
 * The remote MCP link is scoped to one styleguide, so `list-pages` names it.
 */
export async function checkZeroheight(url) {
	let text;
	try {
		text = await callTool(url, "list-pages");
	} catch (err) {
		throw new Error(
			`zeroheight didn't respond (${err.message}). Check that MCP via remote link is turned on for the styleguide and that ZEROHEIGHT_MCP_URL is current.`,
		);
	}
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error(`zeroheight returned something unexpected: ${text.slice(0, 200)}`);
	}
	if (!data.styleguideName) {
		throw new Error(
			"zeroheight answered but didn't name a styleguide. Use the styleguide's remote MCP link (https://mcp.zeroheight.com/mcp/<key>), not the main server.",
		);
	}
	return data.styleguideName;
}
