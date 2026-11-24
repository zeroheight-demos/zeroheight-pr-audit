# Set up on Bitbucket

For Bitbucket Cloud with Pipelines.

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

## 2. Create a repository access token

**Repository settings → Security → Access tokens → Create access token**:

- **Name:** something like "Design system audit". Comments appear under this
  name.
- **Scopes:** **Pull requests: Write** (which includes read)

Copy the token. Bitbucket only shows it once.

## 3. Add repository variables

**Repository settings → Pipelines → Repository variables**. Tick **Secured**
for every secret.

| Name | Value |
|---|---|
| `ZEROHEIGHT_CLIENT_ID` | The Client ID from step 1 |
| `ZEROHEIGHT_ACCESS_TOKEN` | The Access Token from step 1 |
| `BITBUCKET_TOKEN` | The token from step 2 |
| `ZH_AUDIT_PROVIDER` | `anthropic`, `openai` or `copilot` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `COPILOT_GITHUB_TOKEN` | The key for your provider |
| `ZH_AUDIT_MODEL` | Optional. A model ID |

Pipelines must be turned on for the repository.

## 4. Add the step

Merge the `pull-requests` section of
[`templates/bitbucket/bitbucket-pipelines.yml`](../templates/bitbucket/bitbucket-pipelines.yml)
into your `bitbucket-pipelines.yml`, and set `clone: depth: full` (or at least
deep enough to reach the destination branch). Change `includePaths` to match
where your UI code lives.

If you already have a `pull-requests` section, add the step alongside your
existing ones. If you use a different default image, add `image: node:22` to
the step.

## 5. Add the config

Copy [`templates/zeroheight-audit.config.json`](../templates/zeroheight-audit.config.json)
to the repo root and fill it in ([configuration](configuration.md)).

## 6. Open a pull request

Open a pull request that touches a UI file. You'll get a summary comment and an
inline comment per finding.

## Notes

- **No suggestion blocks.** Bitbucket doesn't support one-click suggestions, so
  fixes are shown as a code block under "Suggested change".
- **Forks.** Secured variables aren't available to pull requests from forks.
- **Build minutes.** A run usually takes two to five minutes, most of it the
  model reading your zeroheight pages.
- **Pinning.** `#v2` follows the latest 2.x release. Pin to a tag like `#v2.0.0`
  or a commit SHA if you want changes only when you choose.
