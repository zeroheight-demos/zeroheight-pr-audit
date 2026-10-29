# Set up on GitLab

Works on GitLab.com and self-managed GitLab (16.0 or later), in merge request
pipelines.

## 1. Turn on the remote MCP link in zeroheight

In the styleguide's settings, turn on **MCP via remote link** and copy the link
(`https://mcp.zeroheight.com/mcp/<key>`).

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
| `ZEROHEIGHT_MCP_URL` | The link from step 1 |
| `GITLAB_TOKEN` | The token from step 2 |
| `ZH_AUDIT_PROVIDER` | `anthropic`, `openai` or `copilot` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `COPILOT_GITHUB_TOKEN` | The key for your provider |
| `ZH_AUDIT_MODEL` | Optional. A model ID |

## 4. Add the job

Include the template from your `.gitlab-ci.yml`:

```yaml
include:
  - remote: "https://raw.githubusercontent.com/zeroheight/zeroheight-pr-audit/v1/templates/gitlab/zeroheight-audit.gitlab-ci.yml"
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
  github.com (to fetch the script), mcp.zeroheight.com and your provider's API.
- **Pinning.** `#v1` follows the latest 1.x release. Pin to a tag like `#v1.0.0`
  or a commit SHA if you want changes only when you choose.
