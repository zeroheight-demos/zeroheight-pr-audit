# Using the Claude Code GitHub Action instead

If your team already runs [Claude Code in GitHub Actions](https://github.com/anthropics/claude-code-action),
you can run the audit as a skill instead of this repo's action. Claude reads
the diff with `gh`, calls zeroheight and posts the comments itself. It's GitHub
and Anthropic only, and the setup is more involved, so the main action is the
simpler choice for most teams.

## Setup

1. Copy [`skill/zeroheight-pr-audit/SKILL.md`](../skill/zeroheight-pr-audit/SKILL.md)
   to `.claude/skills/zeroheight-pr-audit/SKILL.md` in your repo, and add a
   "Reporting in CI" section telling it to post inline comments with
   `mcp__github_inline_comment__create_inline_comment` and the summary with
   `gh pr comment <number> --body-file zh-audit.md --edit-last --create-if-none`.
2. Add `ZEROHEIGHT_MCP_URL` and `ANTHROPIC_API_KEY` as repository secrets.
3. Add this workflow:

```yaml
name: Design system audit

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
    paths: ["src/**", "zeroheight-audit.config.json"]

jobs:
  audit:
    if: github.event.pull_request.head.repo.full_name == github.repository && !github.event.pull_request.draft
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
      pull-requests: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          prompt: |
            REPO: ${{ github.repository }}
            PR NUMBER: ${{ github.event.pull_request.number }}

            Run the design system audit in .claude/skills/zeroheight-pr-audit/SKILL.md
            on this pull request, using the CI reporting steps.
          claude_args: |
            --mcp-config '{"mcpServers":{"zeroheight":{"type":"http","url":"${{ secrets.ZEROHEIGHT_MCP_URL }}"}}}'
            --allowedTools "Read,Glob,Grep,Write,Bash(gh pr diff:*),Bash(gh pr view:*),Bash(gh pr comment:*),mcp__github_inline_comment__create_inline_comment,mcp__zeroheight__list-pages,mcp__zeroheight__search-pages,mcp__zeroheight__get-page,mcp__zeroheight__list-token-sets,mcp__zeroheight__list-tokens,mcp__zeroheight__suggest-tokens"
```

## Gotchas we hit

- **Pass the MCP config as inline JSON.** When the action adds its own MCP
  servers, it drops a `--mcp-config` given as a file path without saying so.
- **Claude can only write inside the checkout**, so the summary body has to be
  written to a file there (`zh-audit.md`), not `/tmp`.
- **The action loads `.claude/` from the default branch**, not from the pull
  request. Skill changes only take effect once merged.
- **A green check doesn't prove the audit ran.** Add a step before the action
  that calls the MCP link with `curl` and fails if it doesn't return a
  `styleguideName`, or a broken link passes silently.
