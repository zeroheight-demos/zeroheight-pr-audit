# Providers

Pick one. They all follow the same instructions
([`prompts/audit.md`](../prompts/audit.md)) and return the same report, so you
can switch by changing one setting.

| | Anthropic | OpenAI | GitHub Copilot |
|---|---|---|---|
| Setting | `anthropic` (default) | `openai` | `copilot` |
| Secret | `ANTHROPIC_API_KEY` | `OPENAI_API_KEY` | `COPILOT_GITHUB_TOKEN` |
| Default model | `claude-sonnet-5-5` | `gpt-6.1-sol` | The Copilot CLI's default |
| Who calls zeroheight | Anthropic's API (MCP connector) | OpenAI's API (remote MCP tool) | The Copilot CLI on your runner |
| Billing | API usage | API usage | Copilot premium requests |
| Pages-read count in the summary | Yes | Yes | No |

Change the model with the `model` input on GitHub, or `ZH_AUDIT_MODEL`
elsewhere. Bigger models catch more of the subtle rules (hierarchy, content
guidelines). Smaller ones are fine for token checks.

## Anthropic

1. Create a key in the [Claude Console](https://platform.claude.com/settings/keys).
   A workspace just for CI keys makes spend easy to track and cap.
2. Store it as `ANTHROPIC_API_KEY`.

The audit uses the Messages API with the
[MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
(beta header `mcp-client-2025-11-20`). Anthropic's servers connect to your
zeroheight link directly, and only the read tools listed in
[`src/prompt.mjs`](../src/prompt.mjs) are turned on. The MCP connector isn't
eligible for zero data retention.

If you route through a gateway, set `ANTHROPIC_BASE_URL`.

## OpenAI

1. Create a key in the [OpenAI dashboard](https://platform.openai.com/api-keys).
   A project just for CI keeps spend separate.
2. Store it as `OPENAI_API_KEY`.

The audit uses the Responses API with a
[remote MCP tool](https://developers.openai.com/api/docs/guides/tools-connectors-mcp),
`require_approval: "never"` and `allowed_tools` limited to the read tools.
OpenAI's servers connect to your zeroheight link directly.

For Azure OpenAI or a gateway, set `OPENAI_BASE_URL` to the base that serves
`/responses`.

## GitHub Copilot

Use this if your organization already pays for Copilot and would rather not
manage another API key. It works from GitHub, GitLab and Bitbucket alike.

1. As someone with a Copilot seat, create a
   [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new).
   Under **Permissions**, add **Copilot Requests**. Nothing else is needed.
   Classic tokens (`ghp_…`) don't work.
2. Store it as `COPILOT_GITHUB_TOKEN`.

The audit runs the [Copilot CLI](https://docs.github.com/en/copilot/reference/cli-command-reference)
in prompt mode (`npx @github/copilot@1.0.105` unless `copilot` is already on
the runner; set `ZH_AUDIT_COPILOT_VERSION` to change it). The CLI connects to
zeroheight from your runner, with:

- the zeroheight link passed as session-only MCP config, kept outside the
  checkout
- the built-in GitHub MCP server turned off
- shell, write, URL and memory tools denied, so it can only read the input file
  and call zeroheight
- no other tokens in its environment

Each run uses Copilot premium requests from the token owner's allowance. If
your organization limits models or turns off the CLI by policy, the run fails
with the CLI's message in the log.

## Self-hosted and other models

Anything that speaks the Anthropic Messages API or the OpenAI Responses API,
including remote MCP tools, can be used through `ANTHROPIC_BASE_URL` or
`OPENAI_BASE_URL`. The model has to be able to reach `mcp.zeroheight.com`.
