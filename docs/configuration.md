# Configuration

Put `zeroheight-audit.config.json` in the repo root. Every field is optional;
without the file the audit runs with the defaults below and says so in the log.

```json
{
  "styleguideName": "Acme Design System",
  "tokenSetId": 16490,
  "include": ["src/**/*.{tsx,ts,css}"],
  "exclude": ["**/*.test.*", "**/*.stories.*"],
  "failOn": "none",
  "maxInlineComments": 25,
  "extraInstructions": "Our Button is imported from @acme/ui. Ignore anything under src/legacy."
}
```

| Field | Default | What it does |
|---|---|---|
| `styleguideName` | | The styleguide you expect. The remote MCP link decides which styleguide is used. If the two differ, the log warns you, which usually means the secret points at the wrong link. |
| `tokenSetId` | | The token set for `suggest-tokens`. Without it, the model looks the set up with `list-token-sets` each run. Find the ID in the token set's URL in zeroheight, or ask an agent connected to the MCP to call `list-token-sets`. |
| `include` | common UI source files under `src/` | Globs for files to audit. Supports `**`, `*`, `?` and `{a,b}`. |
| `exclude` | tests, specs, stories, snapshots | Globs to skip, applied after `include`. |
| `failOn` | `none` | `none` only comments. `must` fails the job when there's a Must fix. `should` fails on Must fix or Should fix. Pair with a required check to block merges. |
| `maxInlineComments` | `25` | Cap on inline comments per run, most severe first. The rest still appear in the summary. |
| `maxDiffChars` | `120000` | How much diff is sent to the model. Files past the limit are left out and the summary says so. |
| `maxContextChars` | `200000` | How much full-file context is sent, for line numbers and surrounding code. |
| `extraInstructions` | | Plain-language notes added to the prompt: package names, folders to ignore, house rules that aren't in zeroheight yet. |

## Environment variables

These work on every platform. On GitHub, the action's inputs set them for you.

| Variable | |
|---|---|
| `ZEROHEIGHT_MCP_URL` | The remote MCP link (required) |
| `ZH_AUDIT_PROVIDER` | `anthropic`, `openai` or `copilot` |
| `ZH_AUDIT_MODEL` | Model ID |
| `ZH_AUDIT_CONFIG` | Path to the config file |
| `ZH_AUDIT_PLATFORM` | Force `github`, `gitlab`, `bitbucket` or `local` instead of detecting it |
| `ZH_AUDIT_PLATFORM_TOKEN` | Token for commenting, if you'd rather not use the platform-specific name |
| `ZH_AUDIT_DEBUG` | Print stack traces on errors |

## Command line

```
zeroheight-pr-audit [--provider <name>] [--model <id>] [--platform <name>]
                    [--base <ref>] [--config <path>] [--dry-run]
```

`--dry-run` prints the inline comments and summary instead of posting. Outside
CI it's always a dry run.

## Getting more out of it

The audit can only enforce what your docs say clearly. In our testing, the
biggest jump in what it caught came from component pages with a **For Agents**
tab (or section) listing hard rules as `MUST` / `MUST NOT` bullets, for
example:

- MUST NOT use Button for navigation. Use Link.
- MUST have an accessible name when the label is hidden.
- Only one Primary button per surface.

Rules written as prose in a usage section still get picked up, but less
reliably.
