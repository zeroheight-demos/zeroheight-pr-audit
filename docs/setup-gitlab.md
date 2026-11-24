# Set up on GitLab

Works on GitLab.com and self-managed GitLab (16.0 or later), in merge request
pipelines.

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

## 2. Create a project access token

`CI_JOB_TOKEN` can't post merge request comments, so the audit needs its own
token.

**Settings → Access tokens → Add new token**:

- **Role:** Reporter (enough to comment)
- **Scopes:** `api`
- **Expiry:** whatever your policy allows. Note the date somewhere, because the
  audit stops commenting when it expires.

Comments will appear from the token's bot user, so give it a recognizable name
like "Design system audit".

## 3. Add CI/CD variables

**Settings → CI/CD → Variables → Add variable**. Tick **Mask variable** for
each one, and leave **Protect variable** off (merge request pipelines on
feature branches can't read protected variables).

| Key | Value |
|---|---|
| `ZEROHEIGHT_CLIENT_ID` | The Client ID from step 1 |
| `ZEROHEIGHT_ACCESS_TOKEN` | The Access Token from step 1 |
| `GITLAB_TOKEN` | The token from step 2 |
| `ZH_AUDIT_PROVIDER` | `anthropic`, `openai` or `copilot` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `COPILOT_GITHUB_TOKEN` | The key for your provider |
| `ZH_AUDIT_MODEL` | Optional. A model ID |

## 4. Add the job

Include the template from your `.gitlab-ci.yml`:

```yaml
include:
  - remote: "https://raw.githubusercontent.com/zeroheight-demos/zeroheight-pr-audit/v2/templates/gitlab/zeroheight-audit.gitlab-ci.yml"
```

Or copy the job from
[`templates/gitlab/zeroheight-audit.gitlab-ci.yml`](../templates/gitlab/zeroheight-audit.gitlab-ci.yml)
into your file. Either way, change `rules: changes:` to match where your UI
code lives. To override parts of an included job, redefine the keys you want
under the same job name:

```yaml
zeroheight-audit:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        - packages/web/**/*
```

The job needs a `test` stage. If your pipeline defines its own `stages`, add
`test` or set `stage:` on the job.

## 5. Add the config

Copy [`templates/zeroheight-audit.config.json`](../templates/zeroheight-audit.config.json)
to the repo root and fill it in ([configuration](configuration.md)).

## 6. Open a merge request

Open a merge request that touches a UI file. The job appears in the merge
request pipeline. It posts a summary note and a diff discussion per finding,
with suggestions you can apply from the merge request.

## Notes

- **Merge request pipelines only.** The job keys off
  `CI_PIPELINE_SOURCE == "merge_request_event"`. If your project only runs
  branch pipelines, the job never starts.
- **Forks.** Pipelines for merge requests from forks run in the fork and don't
  get the parent project's variables.
- **Runners.** The job uses the `node:22` image and needs outbound HTTPS to
  github.com (to fetch the script), mcp.zeroheight.com, zeroheight.com and your provider's API.
- **Pinning.** `#v2` follows the latest 2.x release. Pin to a tag like `#v2.0.0`
  or a commit SHA if you want changes only when you choose.
