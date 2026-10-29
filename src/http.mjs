const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with JSON handling and retries on rate limits and server errors.
 * Throws with the response body on any other failure.
 */
export async function request(url, { method = "GET", headers = {}, body, timeoutMs = 60000, retries = 3 } = {}) {
	for (let attempt = 0; ; attempt++) {
		let res;
		try {
			res = await fetch(url, {
				method,
				headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
				body: body !== undefined ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (err) {
			if (attempt < retries) {
				await sleep(2000 * 2 ** attempt);
				continue;
			}
			throw new Error(`${method} ${redact(url)} failed: ${err.message}`);
		}
		const text = await res.text();
		if (res.ok) {
			return { status: res.status, headers: res.headers, data: text ? safeJson(text) : null };
		}
		if ((res.status === 429 || res.status >= 500) && attempt < retries) {
			const retryAfter = Number(res.headers.get("retry-after"));
			await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
			continue;
		}
		const err = new Error(`${method} ${redact(url)} → ${res.status}: ${text.slice(0, 500)}`);
		err.status = res.status;
		throw err;
	}
}

function safeJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

// Keeps secret path segments (like a remote MCP link key) out of logs.
export function redact(url) {
	return String(url).replace(/(mcp\.zeroheight\.com\/mcp\/)[^/?#\s]+/g, "$1***");
}
