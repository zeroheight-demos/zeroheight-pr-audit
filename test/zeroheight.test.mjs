import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { checkTokenReferences, connect, cssNames, normaliseValue, pickStyleguide, TokenIndex } from "../src/zeroheight.mjs";

const TOKENS = [
	{ path: "semantic.color.border.default", type: "color", value: "#292CBD" },
	{ path: "primitive.color.azure.700", type: "color", value: "#292CBD" },
	{ path: "primitive.spacing.scale.100", type: "number", value: 24 },
	{ path: "primitive.sizing.radius.300", type: "number", value: 24 },
	{ path: "brand.color.brand.150", type: "color", value: "#AA076C" },
];

test("normaliseValue: hex, rgb, px and rem compare equal to token values", () => {
	assert.equal(normaliseValue("#FFF"), "#ffffff");
	assert.equal(normaliseValue("#292CBDff"), "#292cbd");
	assert.equal(normaliseValue("rgb(41, 44, 189)"), "#292cbd");
	assert.equal(normaliseValue("24px"), "24");
	assert.equal(normaliseValue("1.5rem"), "24");
	assert.equal(normaliseValue(24), "24");
});

test("cssNames: full path, then with leading segments dropped", () => {
	assert.deepEqual(cssNames("primitive.color.grey.100"), ["--primitive-color-grey-100", "--color-grey-100", "--grey-100"]);
});

test("TokenIndex: semantic first, property decides ties, close colours when no exact match", () => {
	const idx = new TokenIndex(TOKENS);
	assert.deepEqual(idx.match("#292cbd", "border-color").exact, ["semantic.color.border.default", "primitive.color.azure.700"]);
	assert.equal(idx.match("24px", "gap").exact[0], "primitive.spacing.scale.100");
	assert.equal(idx.match("24px", "border-radius").exact[0], "primitive.sizing.radius.300");
	const near = idx.match("#2a2dbf", "color");
	assert.deepEqual(near.exact, []);
	assert.equal(near.close[0].distance, 2);
	assert.equal(idx.reference("--color-border-default"), "semantic.color.border.default");
	assert.equal(idx.reference("--semantic-color-border-primary-default"), null);
	assert.equal(idx.search({ query: "BORDER" }).total, 1);
});

test("checkTokenReferences: found, defined in the repo, or not found", () => {
	const idx = new TokenIndex(TOKENS);
	const added = "+ border: 1px solid var(--color-border-default);\n+ gap: var(--spacing-scale-200);\n+ color: var( --brand-color-brand-150 );";
	const refs = checkTokenReferences(added, idx, { cwd: "/nonexistent" });
	assert.deepEqual(
		refs.map((r) => [r.name, r.token]),
		[
			["--brand-color-brand-150", "brand.color.brand.150"],
			["--color-border-default", "semantic.color.border.default"],
			["--spacing-scale-200", null],
		],
	);
	assert.deepEqual(refs[2].definedIn, []);
});

test("pickStyleguide: by id, by unique name, and clear errors otherwise", () => {
	const list = [
		{ id: 1, name: "Baseline" },
		{ id: 2, name: "Demo" },
		{ id: 3, name: "Demo" },
	];
	assert.equal(pickStyleguide(list, { styleguideId: 2 }).id, 2);
	assert.equal(pickStyleguide(list, { styleguideName: "Baseline" }).id, 1);
	assert.throws(() => pickStyleguide(list, { styleguideName: "Demo" }), /More than one/);
	assert.throws(() => pickStyleguide(list, { styleguideId: 9 }), /can't see styleguide 9/);
	assert.throws(() => pickStyleguide(list, {}), /Set styleguideId/);
});

// A fake zeroheight: the MCP over fetch, the REST API over the request helper.
function fakeZeroheight({ searchWorks = false } = {}) {
	const seen = [];
	const fetchImpl = async (url, init) => {
		const msg = JSON.parse(init.body);
		seen.push({ headers: init.headers, msg });
		const reply = (result) => new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }), { headers: { "content-type": "application/json" } });
		if (msg.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "zeroheight" } });
		if (msg.method === "notifications/initialized") return new Response("", { status: 202 });
		if (msg.method === "tools/list") {
			const schema = (props) => ({ type: "object", properties: props });
			return reply({
				tools: [
					{ name: "list-styleguides", inputSchema: schema({}) },
					{ name: "list-pages", description: "List pages", inputSchema: schema({ styleguideId: { type: "integer" } }) },
					{ name: "get-page", description: "Get a page", inputSchema: { ...schema({ pageId: { type: "integer" } }), required: ["pageId"] } },
					{ name: "search-pages", inputSchema: schema({ styleguideId: { type: "integer" }, searchTerm: { type: "string" } }) },
				],
			});
		}
		const { name, arguments: args } = msg.params;
		const text = (t, isError = false) => reply({ content: [{ type: "text", text: t }], isError });
		if (name === "list-styleguides") return text(JSON.stringify({ styleguides: [{ id: 137930, name: "Baseline - Master" }, { id: 2, name: "Other" }] }));
		if (name === "search-pages") return searchWorks ? text("[]") : text("Semantic search is not available for this organisation.", true);
		if (name === "list-pages") return text(JSON.stringify({ styleguideId: args.styleguideId }));
		if (name === "get-page") return text(`page ${args.pageId}`);
		return text("unknown", true);
	};
	const requestImpl = async (url) => {
		if (url.endsWith("/token_collections")) return { data: { status: "success", data: { token_sets: [{ id: 16490, name: "Baseline", token_count: TOKENS.length }] } } };
		if (url.includes("/tokens?")) return { data: { status: "success", data: { tokens: TOKENS, total_count: TOKENS.length } } };
		throw new Error(`unexpected ${url}`);
	};
	return { fetchImpl, requestImpl, seen };
}

const ENV = { ZEROHEIGHT_CLIENT_ID: "zhci_test", ZEROHEIGHT_ACCESS_TOKEN: "zhat_test" };

test("connect: sends the API headers, pins the styleguide, drops search when the plan lacks it, loads tokens", async () => {
	const fake = fakeZeroheight();
	const zh = await connect({ env: ENV, config: { styleguideName: "Baseline - Master" }, ...fake });
	assert.equal(zh.styleguide.id, 137930);
	assert.deepEqual(zh.tools.map((t) => t.name), ["list-pages", "get-page", "list-tokens", "suggest-tokens"]);
	assert.ok(fake.seen.every((s) => s.headers["X-API-CLIENT"] === "zhci_test" && s.headers["X-API-KEY"] === "zhat_test"));
	// The model can't point list-pages at another styleguide.
	assert.equal(JSON.parse((await zh.exec("list-pages", { styleguideId: 2 })).text).styleguideId, 137930);
	assert.equal((await zh.exec("get-page", { pageId: "42" })).text, "page 42");
	const s = JSON.parse((await zh.exec("suggest-tokens", { values: [{ value: "#292cbd", property: "border-color" }] })).text);
	assert.equal(s.results[0].exact[0], "semantic.color.border.default");
	assert.equal((await zh.exec("delete-page", {})).isError, true);
});

test("connect: keeps search-pages when it works, and explains a missing token set", async () => {
	const fake = fakeZeroheight({ searchWorks: true });
	fake.requestImpl = async () => ({ data: { status: "success", data: { token_sets: [{ id: 1, name: "A", token_count: 3 }, { id: 2, name: "B", token_count: 4 }] } } });
	const zh = await connect({ env: ENV, config: { styleguideId: 137930 }, ...fake });
	assert.ok(zh.tools.some((t) => t.name === "search-pages"));
	assert.equal(zh.tokens, null);
	assert.match(zh.tokenNote, /no tokenSetId/);
});

test("connect: a remote MCP link without an API token gets a clear error", async () => {
	await assert.rejects(connect({ env: { ZEROHEIGHT_MCP_URL: "https://mcp.zeroheight.com/mcp/abc" } }), /being retired.*ZEROHEIGHT_CLIENT_ID/);
});

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

test("anthropic provider: runs tool calls locally and returns the final text", async () => {
	const { run } = await import("../src/providers/anthropic.mjs");
	const bodies = [];
	let call = 0;
	globalThis.fetch = async (url, init) => {
		bodies.push(JSON.parse(init.body));
		const reply =
			call++ === 0
				? { stop_reason: "tool_use", content: [{ type: "text", text: "Reading." }, { type: "tool_use", id: "t1", name: "get-page", input: { pageId: 7 } }] }
				: { stop_reason: "end_turn", content: [{ type: "text", text: '{"findings":[]}' }] };
		return new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } });
	};
	const executed = [];
	const zh = {
		tools: [{ name: "get-page", description: "Get a page", input_schema: { type: "object", properties: { pageId: { type: "integer" } } } }],
		exec: async (name, args) => (executed.push([name, args]), { text: "the page", isError: false }),
	};
	const out = await run({ system: "sys", user: "user", apiKey: "k", log: () => {}, zh });
	assert.equal(out.text, '{"findings":[]}');
	assert.deepEqual(out.toolCalls, ["get-page"]);
	assert.deepEqual(executed, [["get-page", { pageId: 7 }]]);
	assert.equal(bodies[0].mcp_servers, undefined);
	assert.deepEqual(bodies[1].messages.at(-1).content[0], { type: "tool_result", tool_use_id: "t1", content: "the page" });
});
