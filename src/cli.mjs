import { parseArgs } from "node:util";
import { loadConfig, makeFileFilter } from "./config.mjs";
import { buildAuditInput, getDiff, parseDiff, resolveBase } from "./diff.mjs";
import { redact } from "./http.mjs";
import { checkZeroheight } from "./mcp.mjs";
import { systemPrompt, userPrompt } from "./prompt.mjs";
import { counts, exitCodeFor, extractJson, normaliseReport, renderInline, renderSummary } from "./report.mjs";

const PROVIDERS = {
	anthropic: { load: () => import("./providers/anthropic.mjs"), key: "ANTHROPIC_API_KEY", label: "Anthropic" },
	openai: { load: () => import("./providers/openai.mjs"), key: "OPENAI_API_KEY", label: "OpenAI" },
	copilot: { load: () => import("./providers/copilot.mjs"), key: "COPILOT_GITHUB_TOKEN", label: "GitHub Copilot" },
};

const PLATFORMS = {
	github: () => import("./platforms/github.mjs"),
	gitlab: () => import("./platforms/gitlab.mjs"),
	bitbucket: () => import("./platforms/bitbucket.mjs"),
};

const HELP = `zeroheight-pr-audit: audit a pull request's UI changes against your zeroheight guidelines.

Usage: zeroheight-pr-audit [options]

Options:
  --provider <name>    anthropic | openai | copilot (env ZH_AUDIT_PROVIDER, default anthropic)
  --model <id>         Model to use (env ZH_AUDIT_MODEL; each provider has a default)
  --platform <name>    github | gitlab | bitbucket | local (detected from CI env vars)
  --base <ref>         Branch or commit to diff against (detected in CI; default origin/main locally)
  --config <path>      Config file (default zeroheight-audit.config.json)
  --dry-run            Print the report instead of posting it
  -h, --help           Show this help

Environment:
  ZEROHEIGHT_MCP_URL   The styleguide's remote MCP link (required)
  ANTHROPIC_API_KEY | OPENAI_API_KEY | COPILOT_GITHUB_TOKEN   For the chosen provider
  GITHUB_TOKEN | GITLAB_TOKEN | BITBUCKET_TOKEN               For posting comments
`;

function detectPlatform(env) {
	if (env.GITHUB_ACTIONS === "true") return "github";
	if (env.GITLAB_CI === "true") return "gitlab";
	if (env.BITBUCKET_BUILD_NUMBER) return "bitbucket";
	return "local";
}

export async function main(argv, env = process.env) {
	const { values } = parseArgs({
		args: argv,
		options: {
			provider: { type: "string" },
			model: { type: "string" },
			platform: { type: "string" },
			base: { type: "string" },
			config: { type: "string" },
			"dry-run": { type: "boolean" },
			help: { type: "boolean", short: "h" },
		},
	});
	if (values.help) {
		process.stdout.write(HELP);
		return 0;
	}
	const log = (msg) => console.error(msg);

	const providerName = (values.provider || env.ZH_AUDIT_PROVIDER || "anthropic").toLowerCase();
	const provider = PROVIDERS[providerName];
	if (!provider) throw new Error(`Unknown provider "${providerName}". Use one of: ${Object.keys(PROVIDERS).join(", ")}.`);
	const platformName = (values.platform || env.ZH_AUDIT_PLATFORM || detectPlatform(env)).toLowerCase();
	if (platformName !== "local" && !PLATFORMS[platformName]) throw new Error(`Unknown platform "${platformName}".`);
	const dryRun = values["dry-run"] || platformName === "local";
	const model = values.model || env.ZH_AUDIT_MODEL || undefined;

	const mcpUrl = env.ZEROHEIGHT_MCP_URL;
	if (!mcpUrl) throw new Error("ZEROHEIGHT_MCP_URL isn't set. Add the styleguide's remote MCP link as a CI secret.");
	const apiKey = env[provider.key];
	if (!apiKey) throw new Error(`${provider.key} isn't set, and the ${provider.label} provider needs it.`);

	const config = loadConfig(values.config || env.ZH_AUDIT_CONFIG || "zeroheight-audit.config.json");
	if (!config._found) log("No zeroheight-audit.config.json found; using the defaults.");

	// 1. Which pull request, and what changed.
	const platform = platformName === "local" ? null : await PLATFORMS[platformName]();
	const ctx = platform ? platform.context(env) : { number: null, title: null, base: values.base || "main", headSha: null };
	if (values.base) ctx.base = values.base;
	if (platformName === "bitbucket" && !ctx.title) ctx.title = await platform.title(env);
	log(`Platform: ${platformName}${ctx.number ? ` · #${ctx.number}` : ""} · provider: ${provider.label}${model ? ` (${model})` : ""}`);

	const baseRef = resolveBase(ctx.base);
	const filter = makeFileFilter(config.include, config.exclude);
	const files = parseDiff(getDiff(baseRef)).filter((f) => !f.binary && f.newPath && f.added.size && filter(f.path));
	if (!files.length) {
		log("No UI files changed (nothing matched include/exclude). Nothing to audit.");
		return 0;
	}
	log(`Auditing ${files.length} file${files.length === 1 ? "" : "s"}: ${files.map((f) => f.path).join(", ")}`);

	// 2. zeroheight is the source of truth, so stop if it can't be reached.
	const styleguideName = await checkZeroheight(mcpUrl);
	log(`zeroheight access OK: ${styleguideName} (${redact(mcpUrl)})`);
	if (config.styleguideName && config.styleguideName !== styleguideName) {
		log(`warning: the config names "${config.styleguideName}" but the MCP link serves "${styleguideName}". Auditing against "${styleguideName}".`);
	}

	// 3. Run the audit.
	const input = buildAuditInput(files, config);
	const impl = await provider.load();
	const result = await impl.run({
		system: systemPrompt(),
		user: userPrompt({ styleguideName, config, pr: ctx, input }),
		mcpUrl,
		model,
		apiKey,
		log,
	});
	if (result.toolCalls && !result.toolCalls.length) {
		throw new Error("The model didn't call any zeroheight tools, so the audit isn't grounded in your docs. Not posting.");
	}

	let raw;
	try {
		raw = extractJson(result.text);
	} catch (err) {
		log(`${err.message}\nAsking the model to fix its JSON…`);
		raw = extractJson(await impl.repair({ apiKey, model, badText: result.text, log }));
	}

	const report = normaliseReport(raw, files, config);
	if (report.dropped.length) log(`Dropped ${report.dropped.length} finding(s) with no zeroheight page cited: ${report.dropped.join("; ")}`);
	const pagesRead = result.toolCalls ? result.toolCalls.filter((t) => t === "get-page").length : null;
	const summary = () => renderSummary(report, { styleguideName, pagesRead, provider: provider.label });
	const c = counts(report);
	log(`Findings: ${c.must} must fix, ${c.should} should fix, ${c.consider} consider`);

	// 4. Report.
	if (dryRun) {
		for (const f of report.findings.filter((f) => f.inline)) {
			process.stdout.write(`\n----- ${f.file}:${f.line}${f.endLine ? `-${f.endLine}` : ""} -----\n${renderInline(f, "github")}\n`);
		}
		process.stdout.write(`\n===== Summary =====\n${summary()}\n`);
	} else {
		await platform.publish({ ctx, report, summary, files, log, env });
	}
	return exitCodeFor(report, config.failOn);
}
