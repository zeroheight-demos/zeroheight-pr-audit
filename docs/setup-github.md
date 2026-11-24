# Set up on GitHub

## 1. Create a zeroheight API token

In zeroheight, go to your organization's (or workspace's) settings →
**Developers** and create an authentication token:

- **Name:** something like "PR audit"
- **Scopes:** only `page:read` and `token_set:read` (granular scopes are on
  the Enterprise plan). That's all the audit needs, and it means the token
  can't change anything.

Copy the **Client ID** and **Access Token**. The access token is only shown
once. The token acts as the person who created it, so they need to be able to
see the styleguide and token set you'll audit against.

## 2. Add repository secrets

**Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `ZEROHEIGHT_CLIENT_ID` | The Client ID from step 1 |
| `ZEROHEIGHT_ACCESS_TOKEN` | The Access Token from step 1 |
| `ANTHROPIC_API_KEY` | If you're using Anthropic |
| `OPENAI_API_KEY` | If you're using OpenAI |
| `COPILOT_GITHUB_TOKEN` | If you're using Copilot: a fine-grained PAT with the **Copilot Requests** permission ([providers](providers.md#github-copilot)) |

Use repository secrets (or organization secrets shared with the repo). Don't
use environment secrets unless the job names that environment.

You don't need a token for commenting: the workflow uses the built-in
`GITHUB_TOKEN` with `pull-requests: write`.

## 3. Add the workflow

Copy [`templates/github/zeroheight-audit.yml`](../templates/github/zeroheight-audit.yml)
to `.github/workflows/zeroheight-audit.yml`. Keep the provider you're using and
delete the other two. Change the `paths` filter to match where your UI code
lives.

## 4. Add the config

Copy [`templates/zeroheight-audit.config.json`](../templates/zeroheight-audit.config.json)
to the repo root and set `styleguideId` (or `styleguideName`), `tokenSetId` and
the `include` globs
([configuration](configuration.md)).

## 5. Merge, then open a pull request

Merge the workflow and config to your default branch first. GitHub runs
`pull_request` workflows from the pull request's branch, so a branch made
before the merge won't have the workflow until you update it from the default
branch.

Open a pull request that touches a UI file. Within a few minutes you should see
the summary comment and inline comments. The job log shows each zeroheight
tool call (`zeroheight: get-page`, and so on) and the finding counts.

## Options

Inputs for `zeroheight-demos/zeroheight-pr-audit@v2`:

| Input | Default | |
|---|---|---|
| `zeroheight-client-id` | (required) | The zeroheight API token's Client ID |
| `zeroheight-access-token` | (required) | The zeroheight API token's Access Token |
| `provider` | `anthropic` | `anthropic`, `openai` or `copilot` |
| `model` | provider default | Any model ID the provider accepts |
| `anthropic-api-key` / `openai-api-key` / `copilot-token` | | The key for your provider |
| `github-token` | `github.token` | Token used to comment |
| `config` | `zeroheight-audit.config.json` | Config path |
| `dry-run` | `false` | Print the report in the log instead of commenting |

## Notes

- **Forks.** Pull requests from forks don't get secrets, so the template skips
  them. If you need fork coverage, ask a maintainer to run the audit locally.
- **Drafts** are skipped until marked ready for review.
- **Blocking merges.** The audit only comments by default. Set `failOn` in the
  config to `must` and make the check required in branch protection if you
  want Must fix findings to block.
