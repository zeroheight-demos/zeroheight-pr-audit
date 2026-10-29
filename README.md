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
- **Hardcoded values** that have an exact design token match, using
  zeroheight's `suggest-tokens`
- **Token references that don't exist**, which silently fall back to nothing

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
                               │  reads guidelines and tokens
                               ▼
                   zeroheight MCP (remote link, read-only)
                               │
                               ▼
                 JSON report ──► script checks it ──► comments on the PR
```

The model never gets a token that can write to your repository. It reads your
zeroheight docs through the styleguide's read-only remote MCP link and returns
a JSON report. The script then checks every finding cites a zeroheight page and
points at a line that's actually in the diff, and only then posts it. Findings
without a citation are dropped.

## Set it up

You need three things wherever you run it:

1. **The styleguide's remote MCP link.** In zeroheight, open the styleguide's
   settings, turn on **MCP via remote link** and copy the link
   (`https://mcp.zeroheight.com/mcp/<key>`). It's read-only and serves the
   published version of that one styleguide. It also grants access on its own,
   so store it as a secret.
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
ZEROHEIGHT_MCP_URL=... ANTHROPIC_API_KEY=... npx --yes github:zeroheight/zeroheight-pr-audit#v1 --base main
```

Or install the [Claude Code skill](skill/zeroheight-pr-audit/SKILL.md) and ask
"audit my changes against the design system" before you open the pull request.

## Docs

- [Providers](docs/providers.md): Anthropic, OpenAI, GitHub Copilot
- [Configuration](docs/configuration.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Using the Claude Code GitHub Action instead](docs/claude-code-action.md)

## Requirements

- Node 20 or later (the CI templates use `node:22`)
- A zeroheight styleguide with MCP via remote link turned on
- Component pages with clear rules get the most out of it. A **For Agents** tab
  with `MUST` / `MUST NOT` bullets is the single biggest improvement you can
  make to what the audit catches.

## License

MIT
