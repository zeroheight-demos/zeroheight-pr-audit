#!/usr/bin/env node
import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(err) => {
		console.error(`zeroheight-pr-audit: ${err.message}`);
		if (process.env.ZH_AUDIT_DEBUG) console.error(err.stack);
		process.exit(1);
	},
);
