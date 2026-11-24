# zeroheight PR audit

Checks every pull request's UI changes against the design system guidelines
your team has documented in zeroheight, and comments on the pull request with
what it finds. Each finding links to the zeroheight page that backs it, so the
review is grounded in your own docs rather than a model's opinion of good
design.

It runs on **GitHub**, **GitLab** and **Bitbucket**, with **Anthropic**,
**OpenAI** or **GitHub Copilot** doing the reviewing.

## What it checks

Only the lines the pull request adds or changes:

- **Component rules**: the `MUST` and `MUST NOT` statements on each component's
  page (one primary button per surface, links for navigation, accessible names
  on icon-only buttons, and so on)
- **Variants, props and icon sizes** against what the page documents
- **Content guidelines**: label length, casing, verbs
- **Hardcoded values** that have an exact match in your zeroheight token set
- **Token references that don't exist**, which silently fall back to nothing.
  The script checks every `var(--…)` the change adds against your token set
  and the repo, so this part doesn't depend on the model

Findings come in three levels: **Must fix**, **Should fix** and **Consider**.
You get one summary comment (updated in place on every push) and an inline
comment per finding, with a one-click suggestion where the fix is a straight
swap.

## How it works

```
pull request ──► CI job ──► diff + changed files
                               │
                               ▼
                 model (Anthropic / OpenAI / Copilot)
                               │  asks for pages and tokens
                               ▼
              the script runs those read-only tools itself
              ├─ pages:  zeroheight MCP  (mcp.zeroheight.com)
              └─ tokens: zeroheight API  (open_api/v3)
                               │
                               ▼
                 JSON report ──► script checks it ──► comments on the PR
```

The model never gets a credential. It asks for a page or a token lookup, and
the script makes that call to zeroheight with your API token and hands back
the result, so your zeroheight credentials never leave the CI runner. The
model only has four read-only tools: list pages, get a page, list tokens and
match values to tokens. It returns a JSON report, and the script checks every
finding cites a zeroheight page and points at a line that's actually in the
diff before posting it. Findings without a citation are dropped.

## Set it up

You need three things wherever you run it:

1. **A zeroheight API token.** In zeroheight, create an API token with just
   the `page:read` and `token_set:read` scopes, and keep its Client ID and
   Access Token as secrets (`ZEROHEIGHT_CLIENT_ID`, `ZEROHEIGHT_ACCESS_TOKEN`).
   With only those scopes it can read your docs and tokens but can't change
   anything. The zeroheight API is part of the Enterprise plan.
2. **A key for one model provider.** See [providers](docs/providers.md).
3. **A token that can comment** on pull requests. On GitHub the built-in one
   does.

Then follow the guide for your platform:

- [GitHub](docs/setup-github.md) (about 5 minutes)
- [GitLab](docs/setup-gitlab.md) (about 10 minutes)
- [Bitbucket](docs/setup-bitbucket.md) (about 10 minutes)

And add a `zeroheight-audit.config.json` to your repo root to say which files
to audit ([configuration](docs/configuration.md)).

## Run it locally

Same audit, printed in your terminal instead of posted:

```bash
ZEROHEIGHT_CLIENT_ID=... ZEROHEIGHT_ACCESS_TOKEN=... ANTHROPIC_API_KEY=... \
  npx --yes github:zeroheight-demos/zeroheight-pr-audit#v2 --base main
```

Or install the [Claude Code skill](skill/zeroheight-pr-audit/SKILL.md) and ask
"audit my changes against the design system" before you open the pull request.

## Upgrading from v1

v1 used the styleguide's remote MCP link (`ZEROHEIGHT_MCP_URL`), which zeroheight
is retiring. v2 uses an API token instead: create one, add `ZEROHEIGHT_CLIENT_ID`
and `ZEROHEIGHT_ACCESS_TOKEN` as secrets, replace `zeroheight-mcp-url` with the two
new inputs (or variables), and move from `@v1` / `#v1` to `@v2` / `#v2`. Add
`styleguideId` and `tokenSetId` to your config if your token can see more than
one styleguide or token set.

## Docs

- [Providers](docs/providers.md): Anthropic, OpenAI, GitHub Copilot
- [Configuration](docs/configuration.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Using the Claude Code GitHub Action instead](docs/claude-code-action.md)

## Requirements

- Node 20 or later (the CI templates use `node:22`)
- A zeroheight Enterprise plan (for the API token), and a styleguide and
  token set the token can read
- Component pages with clear rules get the most out of it. A **For Agents** tab
  with `MUST` / `MUST NOT` bullets is the single biggest improvement you can
  make to what the audit catches.

## License

MIT
