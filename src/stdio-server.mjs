#!/usr/bin/env node
// A small local MCP server (stdio) that serves the audit's zeroheight tools.
// The Copilot provider points the Copilot CLI at it, so the CLI gets exactly
// the same read-only tools as the other providers, and the zeroheight
// credentials stay in this process.
//
// Reads ZEROHEIGHT_CLIENT_ID / ZEROHEIGHT_ACCESS_TOKEN, plus
// ZH_AUDIT_STYLEGUIDE_ID and ZH_AUDIT_TOKEN_SET_ID (already resolved by the
// main run).
import { createInterface } from "node:readline";
import { connect } from "./zeroheight.mjs";

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const log = (msg) => process.stderr.write(`${msg}\n`);

let session = null;
async function getSession() {
	if (!session) {
		session = connect({
			env: process.env,
			config: { styleguideId: process.env.ZH_AUDIT_STYLEGUIDE_ID, tokenSetId: process.env.ZH_AUDIT_TOKEN_SET_ID || null },
			cwd: process.env.ZH_AUDIT_CWD || process.cwd(),
			log,
		});
	}
	return session;
}

async function handle(msg) {
	const { id, method, params } = msg;
	if (id === undefined) return; // notifications
	try {
		if (method === "initialize") {
			return send({
				jsonrpc: "2.0",
				id,
				result: {
					protocolVersion: params?.protocolVersion || "2025-06-18",
					capabilities: { tools: { listChanged: false } },
					serverInfo: { name: "zeroheight-pr-audit", version: "2" },
				},
			});
		}
		if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
		if (method === "tools/list") {
			const zh = await getSession();
			return send({
				jsonrpc: "2.0",
				id,
				result: { tools: zh.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema, annotations: { readOnlyHint: true } })) },
			});
		}
		if (method === "tools/call") {
			const zh = await getSession();
			const r = await zh.exec(params?.name, params?.arguments || {});
			return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: r.text }], isError: r.isError } });
		}
		send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
	} catch (err) {
		send({ jsonrpc: "2.0", id, error: { code: -32000, message: err.message } });
	}
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
	if (!line.trim()) return;
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		return;
	}
	handle(msg);
});
