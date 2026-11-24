# Troubleshooting

The job log shows each step: the files it's auditing, the zeroheight check,
every zeroheight tool the model calls, the finding counts and what was posted.
Start there.

### "Set ZEROHEIGHT_CLIENT_ID and ZEROHEIGHT_ACCESS_TOKEN"

The API token isn't reaching the job. On GitHub, check both are repository or
organization secrets (not environment secrets) and that the pull request isn't
from a fork. On GitLab, check the variables aren't protected. If the message
also mentions a remote MCP link, you're on v1 settings: see "Upgrading from
v1" in the README.

### "zeroheight rejected the API token"

The Client ID or Access Token is wrong, the token was revoked, or it's missing
the `page:read` scope. Create a new one under your organization's settings →
**Developers**.

### "This API token can't see styleguide …" or "No styleguide called …"

The token acts as the person who created it, so that person needs access to
the styleguide. The message lists the styleguides the token can see; copy the
right ID into `styleguideId`.

### "Tokens: not checked"

The log says why: no `tokenSetId` while the token can see several sets (the
message lists them), a wrong `tokenSetId`, or a token without the
`token_set:read` scope. The audit still runs on your pages; it just skips token
matching and says so in the summary.

### "No merge base" or "Couldn't find the base"

The checkout is shallow. Use `fetch-depth: 0` (GitHub), `GIT_DEPTH: 0`
(GitLab) or `clone: depth: full` (Bitbucket).

### "No UI files changed"

Nothing in the diff matched `include` (or everything matched `exclude`). Check
the globs against the paths in the log.

### "The model didn't call any zeroheight tools"

The audit refuses to post a review that isn't grounded in your docs. Usually
the model ignored the tools, or every zeroheight call failed (the log shows
each call and whether it errored). Re-run once. If it keeps happening, try a larger model.

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

Mostly not. Before posting, the audit checks its own earlier comments and
skips a finding when one in the same file starts or ends on the same line, or
overlaps it with the same severity and subject (the part of the title before
the colon, like "Button"). That covers the usual re-run drift, where the model
rewords a title, shifts a severity or pins a finding a line or two away.

A later run can still split or regroup findings (one comment per missing token
instead of one for all of them, say), and those get new comments. The summary
always reflects the latest run.

### Rate limits

The zeroheight MCP allows about 30 requests per 30 seconds per token. The
script paces its own calls under that and retries if it's still told to slow
down, so the worst case is a slower run. Several big pull requests auditing at
once with the same token share that allowance.

### The workflow change didn't take effect (GitHub)

GitHub runs a pull request against a merge of the pull request and its base,
and that merge can lag behind a freshly merged workflow change for a few
minutes. Use **Update branch** on the pull request rather than closing and
reopening it.

### Copilot: "exited with" an auth error

The token has to be a fine-grained PAT with **Copilot Requests**, owned by
someone with an active Copilot seat. Classic tokens don't work, and an
organization policy can block the CLI.
