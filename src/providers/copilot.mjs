// GitHub Copilot through the Copilot CLI in prompt mode. The CLI is the MCP
// client here, so the zeroheight server is passed as session-only config.
// https://docs.github.com/en/copilot/reference/cli-command-reference
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repairPrompt } from "./anthropic.mjs";

export const DEFAULT_MODEL = null; // The CLI's own default unless ZH_AUDIT_MODEL is set.
const CLI_VERSION = process.env.ZH_AUDIT_COPILOT_VERSION || "1.0.105";
const INPUT_FILE = ".zeroheight-pr-audit-input.md";

// Built-in tools the audit never needs. Only `view` (to read the input file)
// and the zeroheight MCP tools are left.
const EXCLUDED_TOOLS = ["bash", "powershell", "write_bash", "write_powershell", "create", "edit", "apply_patch", "web_fetch", "task", "write_agent"];
const DENIED = ["shell", "write", "url", "memory"];

function command() {
	const found = spawnSync(process.platform === "win32" ? "where" : "which", ["copilot"], { encoding: "utf8" });
	if (found.status === 0) return { cmd: "copilot", pre: [] };
	return { cmd: "npx", pre: ["--yes", `@github/copilot@${CLI_VERSION}`] };
}

// The agent gets the Copilot token and nothing else that could write anywhere.
function childEnv(token) {
	const env = { ...process.env, COPILOT_GITHUB_TOKEN: token };
	for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "GITLAB_TOKEN", "BITBUCKET_TOKEN", "ZH_AUDIT_PLATFORM_TOKEN", "COPILOT_ALLOW_ALL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) {
		delete env[k];
	}
	return env;
}

function runCli(args, token, log) {
	const { cmd, pre } = command();
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, [...pre, ...args], { env: childEnv(token), stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		let err = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (err += d));
		const timer = setTimeout(() => child.kill("SIGTERM"), 15 * 60 * 1000);
		child.on("error", reject);
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0) return reject(new Error(`Copilot CLI exited with ${code}: ${(err || out).slice(-800)}`));
			if (err.trim()) log(`  copilot: ${err.trim().split("\n").slice(-3).join(" | ")}`);
			resolve(out);
		});
	});
}

export async function run({ system, user, mcpUrl, model, apiKey, log }) {
	if (!apiKey) throw new Error("COPILOT_GITHUB_TOKEN isn't set. It needs a fine-grained PAT with the Copilot Requests permission.");
	const dir = mkdtempSync(join(tmpdir(), "zh-audit-"));
	const mcpConfig = join(dir, "mcp.json");
	// The MCP link is a secret, so its config stays outside the checkout.
	writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { zeroheight: { type: "http", url: mcpUrl, tools: ["*"] } } }));
	writeFileSync(INPUT_FILE, `${system}\n\n---\n\n${user}\n`);
	try {
		const args = [
			"-p",
			`Read ${INPUT_FILE} in the current directory. It has your instructions and the pull request to audit. Follow it exactly, using the zeroheight MCP tools, and reply with only the JSON object it asks for.`,
			"-s",
			"--no-ask-user",
			"--allow-all-tools",
			"--disable-builtin-mcps",
			`--additional-mcp-config=@${mcpConfig}`,
			`--excluded-tools=${EXCLUDED_TOOLS.join(",")}`,
			...DENIED.map((d) => `--deny-tool=${d}`),
		];
		if (model) args.push(`--model=${model}`);
		const text = await runCli(args, apiKey, log);
		// Prompt mode in silent output doesn't report tool calls, so pages read is unknown.
		return { text, toolCalls: null };
	} finally {
		rmSync(dir, { recursive: true, force: true });
		rmSync(INPUT_FILE, { force: true });
	}
}

export async function repair({ apiKey, model, badText, log }) {
	writeFileSync(INPUT_FILE, repairPrompt(badText));
	try {
		const args = [
			"-p",
			`Read ${INPUT_FILE} and do what it says. Reply with only the JSON object.`,
			"-s",
			"--no-ask-user",
			"--allow-all-tools",
			"--disable-builtin-mcps",
			`--excluded-tools=${EXCLUDED_TOOLS.join(",")}`,
			...DENIED.map((d) => `--deny-tool=${d}`),
		];
		if (model) args.push(`--model=${model}`);
		return await runCli(args, apiKey, log);
	} finally {
		rmSync(INPUT_FILE, { force: true });
	}
}
