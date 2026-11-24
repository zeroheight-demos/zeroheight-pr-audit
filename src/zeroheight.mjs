// Everything that talks to zeroheight. The audit authenticates with a
// zeroheight API token (Client ID + Access Token, sent as the X-API-CLIENT and
// X-API-KEY headers) and makes every zeroheight call from here, on the runner:
//
// - Pages come from the zeroheight MCP (mcp.zeroheight.com/mcp).
// - Tokens come from the zeroheight REST API (open_api/v3), because the MCP
//   doesn't offer its token tools to API-token auth.
//
// The model never gets the credentials. It gets a small set of read-only
// tools, and this module runs them.
import { spawnSync } from "node:child_process";
import { request } from "./http.mjs";

export const DEFAULT_MCP_URL = "https://mcp.zeroheight.com/mcp";
export const DEFAULT_API_URL = "https://zeroheight.com/open_api/v3";
const MAX_RESULT_CHARS = 60000;

export function credentials(env) {
	const clientId = (env.ZEROHEIGHT_CLIENT_ID || "").trim();
	const accessToken = (env.ZEROHEIGHT_ACCESS_TOKEN || "").trim();
	if (!clientId || !accessToken) {
		const link = /mcp\.zeroheight\.com\/mcp\/./.test(env.ZEROHEIGHT_MCP_URL || "");
		throw new Error(
			(link ? "ZEROHEIGHT_MCP_URL is a remote MCP link, and MCP via link is being retired. " : "") +
				"Set ZEROHEIGHT_CLIENT_ID and ZEROHEIGHT_ACCESS_TOKEN: a zeroheight API token with the page:read and token_set:read scopes.",
		);
	}
	return { clientId, accessToken };
}

const authHeaders = ({ clientId, accessToken }) => ({ "X-API-CLIENT": clientId, "X-API-KEY": accessToken });

// ---------------------------------------------------------------------------
// MCP client (Streamable HTTP), throttled under the server's 30 calls / 30 s.

export class McpClient {
	constructor({ url = DEFAULT_MCP_URL, creds, fetchImpl = fetch }) {
		this.url = url;
		this.headers = authHeaders(creds);
		this.fetch = fetchImpl;
		this.nextId = 1;
		this.sessionId = null;
		this.calls = [];
	}

	async throttle() {
		const now = Date.now();
		this.calls = this.calls.filter((t) => now - t < 30000);
		if (this.calls.length >= 25) await new Promise((r) => setTimeout(r, 30000 - (now - this.calls[0]) + 250));
		this.calls.push(Date.now());
	}

	async rpc(method, params, { notify = false } = {}) {
		const message = { jsonrpc: "2.0", method, params };
		if (!notify) message.id = this.nextId++;
		for (let attempt = 0; ; attempt++) {
			await this.throttle();
			const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...this.headers };
			if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
			const res = await this.fetch(this.url, { method: "POST", headers, body: JSON.stringify(message), signal: AbortSignal.timeout(60000) });
			const text = await res.text();
			if ((res.status === 429 || res.status >= 500) && attempt < 3) {
				await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt));
				continue;
			}
			if (!res.ok) throw new Error(`zeroheight MCP ${method} → HTTP ${res.status}: ${text.slice(0, 300)}`);
			this.sessionId = res.headers.get("mcp-session-id") || this.sessionId;
			if (notify) return null;
			let payload = null;
			if ((res.headers.get("content-type") || "").includes("text/event-stream")) {
				for (const line of text.split("\n")) {
					if (!line.startsWith("data:")) continue;
					try {
						const data = JSON.parse(line.slice(5).trim());
						if (data.id === message.id) payload = data;
					} catch {}
				}
			} else if (text.trim()) {
				payload = JSON.parse(text);
			}
			if (!payload) throw new Error(`zeroheight MCP gave no response to ${method}: ${text.slice(0, 300)}`);
			if (payload.error) throw new Error(`zeroheight MCP ${method}: ${payload.error.message || JSON.stringify(payload.error)}`);
			return payload.result;
		}
	}

	async init() {
		const result = await this.rpc("initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "zeroheight-pr-audit", version: "2" },
		});
		await this.rpc("notifications/initialized", {}, { notify: true });
		return result;
	}

	async listTools() {
		return (await this.rpc("tools/list", {})).tools || [];
	}

	/** Returns { text, isError } rather than throwing on tool errors. */
	async call(name, args = {}) {
		const result = await this.rpc("tools/call", { name, arguments: args });
		const text = (result?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
		return { text, isError: Boolean(result?.isError) };
	}
}

// ---------------------------------------------------------------------------
// REST API, for tokens.

export class RestClient {
	constructor({ url = DEFAULT_API_URL, creds, requestImpl = request }) {
		this.url = url.replace(/\/$/, "");
		this.headers = authHeaders(creds);
		this.request = requestImpl;
	}

	async get(path) {
		const { data } = await this.request(`${this.url}${path}`, { headers: { ...this.headers, Accept: "application/json" } });
		if (data?.status !== "success") throw new Error(`zeroheight API ${path}: ${data?.message || JSON.stringify(data).slice(0, 200)}`);
		return data.data;
	}

	tokenSets() {
		return this.get("/token_collections").then((d) => d.token_sets || []);
	}

	/** All tokens of a set, in each collection's default mode. */
	async tokens(tokenSetId) {
		const first = await this.get(`/tokens?token_set_id=${tokenSetId}&limit=500`);
		if ((first.total_count || 0) <= (first.tokens || []).length) return first.tokens || [];
		// More than 500: fetch collection by collection.
		const set = (await this.tokenSets()).find((s) => s.id === Number(tokenSetId));
		const all = [];
		for (const c of set?.collections || []) {
			const d = await this.get(`/tokens?token_set_id=${tokenSetId}&collection_key=${encodeURIComponent(c.key)}&limit=500`);
			all.push(...(d.tokens || []));
		}
		return all;
	}
}

// ---------------------------------------------------------------------------
// Token matching. Values are compared exactly, after normalising.

export function normaliseValue(raw) {
	if (raw === null || raw === undefined) return null;
	let v = String(raw).trim().toLowerCase();
	const hex = v.match(/^#([0-9a-f]{3,8})$/);
	if (hex) {
		let h = hex[1];
		if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
		if (h.length === 8 && h.endsWith("ff")) h = h.slice(0, 6);
		return `#${h}`;
	}
	const rgb = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
	if (rgb) {
		const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
		const h = [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
		return alpha >= 1 ? `#${h}` : `#${h}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
	}
	const px = v.match(/^(-?[\d.]+)px$/);
	if (px) return String(Number(px[1]));
	const rem = v.match(/^(-?[\d.]+)rem$/);
	if (rem) return String(Number(rem[1]) * 16);
	if (/^-?[\d.]+$/.test(v)) return String(Number(v));
	return v.replace(/\s+/g, " ").replace(/^["']|["']$/g, "");
}

function rgbOf(hex) {
	const m = /^#([0-9a-f]{6})/.exec(hex || "");
	if (!m) return null;
	return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}

// Semantic tokens first, then brand, then primitives.
const tierRank = (path) => (/^semantic\./i.test(path) ? 0 : /^brand\./i.test(path) ? 1 : /^primitive\./i.test(path) ? 3 : 2);

// Words in a token path that suit a CSS property, so `gap: 24px` ranks spacing
// tokens above a radius that happens to be 24 too.
const PROPERTY_WORDS = [
	[/^(gap|row-gap|column-gap|margin|padding|inset|top|right|bottom|left)/, ["spacing", "space", "gap"]],
	[/radius/, ["radius", "corner"]],
	[/^font-size/, ["font-size", "fontsize", "size"]],
	[/^font-weight/, ["weight"]],
	[/^font-family|^font$/, ["font-family", "family"]],
	[/^line-height/, ["line-height", "lineheight"]],
	[/^letter-spacing/, ["letter-spacing", "tracking"]],
	[/border-width|outline-width|stroke/, ["stroke", "border-width", "width"]],
	[/^(background|background-color)$/, ["background", "surface"]],
	[/^(border|border-color|outline|outline-color)/, ["border", "outline"]],
	[/^color$|fill/, ["typography", "text", "foreground", "icon"]],
	[/shadow/, ["shadow", "elevation"]],
	[/duration|transition|animation/, ["duration", "motion"]],
	[/^(width|height|min-|max-)/, ["sizing", "size"]],
];

function propertyFit(property) {
	const p = String(property || "").toLowerCase();
	const words = PROPERTY_WORDS.find(([re]) => re.test(p))?.[1] || [];
	return (path) => {
		const lower = path.toLowerCase();
		return words.some((w) => lower.includes(w)) ? 1 : 0;
	};
}

/** The CSS custom property names a token path could be built as: the full path, or with leading segments dropped. */
export function cssNames(path) {
	const segs = String(path).toLowerCase().split(".");
	const out = [];
	for (let i = 0; i < segs.length - 1 || (i === 0 && segs.length === 1); i++) out.push(`--${segs.slice(i).join("-")}`);
	return out;
}

export class TokenIndex {
	constructor(tokens, { setName = null } = {}) {
		this.setName = setName;
		this.tokens = tokens.map((t) => ({ path: t.path, type: t.type || null, value: t.value, norm: normaliseValue(typeof t.value === "object" ? JSON.stringify(t.value) : t.value) }));
		this.byName = new Map();
		for (const t of this.tokens) for (const n of cssNames(t.path)) if (!this.byName.has(n)) this.byName.set(n, t.path);
	}

	get size() {
		return this.tokens.length;
	}

	search({ query, type, limit = 200 } = {}) {
		const q = (query || "").toLowerCase();
		const hits = this.tokens.filter((t) => (!q || t.path.toLowerCase().includes(q)) && (!type || t.type === type));
		return { total: hits.length, tokens: hits.slice(0, limit).map(({ path, type, value }) => ({ path, type, value })) };
	}

	/** Exact matches for a raw value, best first, plus close colours when there's no exact match. */
	match(value, property) {
		const norm = normaliseValue(value);
		const fit = propertyFit(property);
		const exact = this.tokens
			.filter((t) => t.norm === norm)
			.sort((a, b) => fit(b.path) - fit(a.path) || tierRank(a.path) - tierRank(b.path) || a.path.localeCompare(b.path));
		const out = { value, exact: exact.slice(0, 8).map((t) => t.path) };
		if (!exact.length) {
			const rgb = rgbOf(norm);
			if (rgb) {
				const close = this.tokens
					.map((t) => ({ t, c: rgbOf(t.norm) }))
					.filter((x) => x.c)
					.map((x) => ({ path: x.t.path, value: x.t.value, distance: Math.round(Math.hypot(rgb[0] - x.c[0], rgb[1] - x.c[1], rgb[2] - x.c[2])) }))
					.filter((x) => x.distance <= 24)
					.sort((a, b) => a.distance - b.distance)
					.slice(0, 3);
				if (close.length) out.close = close;
			}
		}
		return out;
	}

	/** Does a CSS custom property correspond to a zeroheight token? */
	reference(name) {
		const n = name.startsWith("--") ? name.toLowerCase() : `--${name.toLowerCase()}`;
		return this.byName.get(n) || null;
	}
}

/** Files in the checkout that define a custom property, e.g. `--ds-radius-card:`. */
export function definedInRepo(name, cwd = process.cwd()) {
	const res = spawnSync("git", ["grep", "-l", "-F", "-e", `${name}:`, "--", "."], { cwd, encoding: "utf8" });
	return res.status === 0 ? res.stdout.split("\n").filter(Boolean).slice(0, 5) : [];
}

/** Checks every custom property an added line references. */
export function checkTokenReferences(addedText, index, { cwd } = {}) {
	if (!index) return [];
	const names = [...new Set([...addedText.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map((m) => m[1]))].sort();
	return names.map((name) => {
		const token = index.reference(name);
		return token ? { name, token } : { name, token: null, definedIn: definedInRepo(name, cwd) };
	});
}

// ---------------------------------------------------------------------------
// The session: connect, pin the styleguide, load tokens, expose tools.

function parseJson(text, what) {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`zeroheight returned something unexpected for ${what}: ${text.slice(0, 200)}`);
	}
}

export function pickStyleguide(styleguides, { styleguideId, styleguideName }) {
	if (styleguideId) {
		const s = styleguides.find((g) => g.id === Number(styleguideId));
		if (!s) throw new Error(`This API token can't see styleguide ${styleguideId}. It can see: ${styleguides.map((g) => `${g.name} (${g.id})`).join(", ") || "none"}.`);
		return s;
	}
	if (!styleguideName || styleguideName === "Your Styleguide") {
		if (styleguides.length === 1) return styleguides[0];
		throw new Error(`Set styleguideId (or styleguideName) in the config. This API token can see: ${styleguides.map((g) => `${g.name} (${g.id})`).join(", ")}.`);
	}
	const matches = styleguides.filter((g) => g.name === styleguideName);
	if (matches.length === 1) return matches[0];
	if (matches.length > 1) throw new Error(`More than one styleguide is called "${styleguideName}" (${matches.map((g) => g.id).join(", ")}). Set styleguideId in the config instead.`);
	throw new Error(`No styleguide called "${styleguideName}" for this API token. It can see: ${styleguides.map((g) => `${g.name} (${g.id})`).join(", ")}.`);
}

const TOOL_LIST_TOKENS = {
	name: "list-tokens",
	description:
		"List the design tokens in the team's zeroheight token set, with resolved values (each collection's default mode). Filter by `query` (text in the token path) and/or `type` (e.g. color, number).",
	input_schema: {
		type: "object",
		properties: { query: { type: "string", description: "Only tokens whose path contains this text, ignoring case" }, type: { type: "string" } },
	},
};

const TOOL_SUGGEST_TOKENS = {
	name: "suggest-tokens",
	description:
		"Match raw style values (hex/rgb colours, px/rem sizes, font names, durations) against the zeroheight token set. Returns exact matches (semantic tokens first) and, for colours with no exact match, close matches with their RGB distance. At most 30 values per call.",
	input_schema: {
		type: "object",
		properties: {
			values: {
				type: "array",
				maxItems: 30,
				items: { type: "object", properties: { value: { type: "string" }, property: { type: "string", description: "The CSS property it's used for" } }, required: ["value"] },
			},
		},
		required: ["values"],
	},
};

/**
 * Connects to zeroheight and returns a session with `tools` (provider-neutral
 * definitions) and `exec(name, args)`.
 */
export async function connect({ env = process.env, config = {}, log = () => {}, fetchImpl, requestImpl, cwd } = {}) {
	const creds = credentials(env);
	const mcp = new McpClient({ url: env.ZEROHEIGHT_MCP_URL && !/\/mcp\/./.test(env.ZEROHEIGHT_MCP_URL) ? env.ZEROHEIGHT_MCP_URL : DEFAULT_MCP_URL, creds, fetchImpl });
	const rest = new RestClient({ url: env.ZEROHEIGHT_API_URL || DEFAULT_API_URL, creds, requestImpl });

	try {
		await mcp.init();
	} catch (err) {
		throw new Error(`Couldn't connect to the zeroheight MCP (${err.message}).`);
	}
	const serverTools = new Map((await mcp.listTools()).map((t) => [t.name, t]));

	const sgList = await mcp.call("list-styleguides");
	if (sgList.isError) {
		throw new Error(`zeroheight rejected the API token (${sgList.text.trim()}). Check ZEROHEIGHT_CLIENT_ID and ZEROHEIGHT_ACCESS_TOKEN, and that the token has the page:read scope.`);
	}
	const styleguide = pickStyleguide(parseJson(sgList.text, "list-styleguides").styleguides || [], config);

	// Semantic search isn't on every plan. Find out once, up front.
	let canSearch = serverTools.has("search-pages");
	if (canSearch) {
		const probe = await mcp.call("search-pages", { styleguideId: styleguide.id, searchTerm: "button" });
		canSearch = !probe.isError;
	}

	// Tokens, from the REST API.
	let tokens = null;
	let tokenSetId = null;
	let tokenNote = null;
	try {
		const sets = await rest.tokenSets();
		let set = config.tokenSetId ? sets.find((s) => s.id === Number(config.tokenSetId)) : null;
		if (config.tokenSetId && !set) tokenNote = `token set ${config.tokenSetId} isn't visible to this API token`;
		if (!config.tokenSetId) {
			const withTokens = sets.filter((s) => s.token_count);
			if (withTokens.length === 1) set = withTokens[0];
			else if (withTokens.length > 1) tokenNote = `no tokenSetId in the config, and this API token can see ${withTokens.length} token sets: ${withTokens.map((s) => `${s.name} (${s.id})`).join(", ")}`;
			else tokenNote = "this API token can't see any token sets";
		}
		if (set) {
			tokens = new TokenIndex(await rest.tokens(set.id), { setName: `${set.name} (${set.id})` });
			tokenSetId = set.id;
		}
	} catch (err) {
		tokenNote = /403|scope/i.test(err.message) ? "the API token is missing the token_set:read scope" : err.message;
	}

	const pin = (args) => ({ ...args, styleguideId: styleguide.id });
	const tools = [];
	const local = new Map();
	const expose = (name, def, run) => {
		tools.push({ name, description: def.description, input_schema: def.input_schema });
		local.set(name, run);
	};
	const fromServer = (name, props) => {
		const t = serverTools.get(name);
		const schema = { type: "object", properties: {}, required: [] };
		for (const p of props) {
			if (t?.inputSchema?.properties?.[p]) schema.properties[p] = t.inputSchema.properties[p];
			if (t?.inputSchema?.required?.includes(p)) schema.required.push(p);
		}
		return { description: t?.description || name, input_schema: schema };
	};

	if (serverTools.has("list-pages")) expose("list-pages", fromServer("list-pages", []), () => mcp.call("list-pages", pin({})));
	if (canSearch) expose("search-pages", fromServer("search-pages", ["searchTerm"]), (a) => mcp.call("search-pages", pin({ searchTerm: String(a.searchTerm || "") })));
	if (serverTools.has("get-page")) expose("get-page", fromServer("get-page", ["pageId"]), (a) => mcp.call("get-page", { pageId: Number(a.pageId) }));
	if (tokens) {
		expose("list-tokens", TOOL_LIST_TOKENS, (a) => ({ text: JSON.stringify({ tokenSet: tokens.setName, ...tokens.search(a) }) }));
		expose("suggest-tokens", TOOL_SUGGEST_TOKENS, (a) => {
			const values = (Array.isArray(a.values) ? a.values : []).slice(0, 30);
			return { text: JSON.stringify({ tokenSet: tokens.setName, results: values.map((v) => ({ property: v.property || null, ...tokens.match(v.value, v.property) })) }) };
		});
	}

	async function exec(name, args = {}) {
		const run = local.get(name);
		if (!run) return { text: `Unknown tool ${name}. Available: ${[...local.keys()].join(", ")}`, isError: true };
		try {
			const r = await run(args || {});
			const text = r.text.length > MAX_RESULT_CHARS ? `${r.text.slice(0, MAX_RESULT_CHARS)}\n…(truncated)` : r.text;
			return { text, isError: Boolean(r.isError) };
		} catch (err) {
			return { text: `Tool error: ${err.message}`, isError: true };
		}
	}

	return { styleguide, tools, exec, tokens, tokenSetId, tokenNote, canSearch, checkReferences: (added) => checkTokenReferences(added, tokens, { cwd }) };
}
