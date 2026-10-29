# Troubleshooting

The job log shows each step: the files it's auditing, the zeroheight check,
every zeroheight tool the model calls, the finding counts and what was posted.
Start there.

### "zeroheight didn't respond" or "didn't name a styleguide"

- **MCP via remote link** is off for the styleguide, or the link was
  regenerated. Turn it on and update the `ZEROHEIGHT_MCP_URL` secret.
- The secret holds the main server (`https://mcp.zeroheight.com/mcp`) instead
  of the styleguide's link. The main server needs a browser login, which a CI
  runner can't do. zeroheight API keys don't work for the MCP either: they're
  for the REST API.
- The secret is empty in this run. On GitHub, check it's a repository or
  organization secret (not an environment secret) and that the pull request
  isn't from a fork. On GitLab, check the variable isn't protected.

### "No merge base" or "Couldn't find the base"

The checkout is shallow. Use `fetch-depth: 0` (GitHub), `GIT_DEPTH: 0`
(GitLab) or `clone: depth: full` (Bitbucket).

### "No UI files changed"

Nothing in the diff matched `include` (or everything matched `exclude`). Check
the globs against the paths in the log.

### "The model didn't call any zeroheight tools"

The audit refuses to post a review that isn't grounded in your docs. Usually
the provider couldn't reach the MCP link (a network policy or proxy), or the
model ignored the tools. Re-run once. If it keeps happening, try a larger model.

### Inline comments are missing but the summary is there

Comments can only attach to lines in the diff. Anything the model pinned to a
line outside it goes in the summary under "Details for findings without an
inline comment". The log lists each one it moved. The summary also holds
anything past `maxInlineComments`.

### Line numbers look off

On GitHub, check the workflow checks out `github.event.pull_request.head.sha`.
The default checkout is GitHub's merge commit, whose line numbers can differ
from the pull request's.

### Comments repeat on every push

They shouldn't. Before posting, the audit checks its own earlier comments and
skips a finding when one already sits on overlapping lines in the same file
with the same severity and subject (the part of the title before the colon,
like "Button"). That catches the usual re-run drift, where the model rewords a
title or pins it a line or two away. A finding that changes severity between
runs, or that a later run groups differently, can still get a second comment.
The summary always reflects the latest run.

### Rate limits

The remote MCP link allows about 30 requests per 30 seconds. A normal audit
uses well under that. Several big pull requests auditing at once can hit it,
and the provider retries.

### The workflow change didn't take effect (GitHub)

GitHub runs a pull request against a merge of the pull request and its base,
and that merge can lag behind a freshly merged workflow change for a few
minutes. Use **Update branch** on the pull request rather than closing and
reopening it.

### Copilot: "exited with" an auth error

The token has to be a fine-grained PAT with **Copilot Requests**, owned by
someone with an active Copilot seat. Classic tokens don't work, and an
organization policy can block the CLI.
