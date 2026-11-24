# Providers

Pick one. They all follow the same instructions
([`prompts/audit.md`](../prompts/audit.md)) and return the same report, so you
can switch by changing one setting.

| | Anthropic | OpenAI | GitHub Copilot |
|---|---|---|---|
| Setting | `anthropic` (default) | `openai` | `copilot` |
| Secret | `ANTHROPIC_API_KEY` | `OPENAI_API_KEY` | `COPILOT_GITHUB_TOKEN` |
| Default model | `claude-sonnet-5-5` | `gpt-6.1-sol` | The Copilot CLI's default |
| Who calls zeroheight | The action, on your runner | The action, on your runner | The action's local MCP server, on your runner |
| Billing | API usage | API usage | Copilot premium requests |
| Pages-read count in the summary | Yes | Yes | No |

Change the model with the `model` input on GitHub, or `ZH_AUDIT_MODEL`
elsewhere. Bigger models catch more of the subtle rules (hierarchy, content
guidelines). Smaller ones are fine for token checks.

## Anthropic

1. Create a key in the [Claude Console](https://platform.claude.com/settings/keys).
   A workspace just for CI keys makes spend easy to track and cap.
2. Store it as `ANTHROPIC_API_KEY`.

The audit uses the Messages API with
[client-side tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview).
When Claude asks for a page or a token lookup, the action makes that call to
zeroheight itself and sends the result back, so your zeroheight credentials
never go to Anthropic. The system prompt, tools and diff are cached between
turns to keep the cost down.

If you route through a gateway, set `ANTHROPIC_BASE_URL`.

## OpenAI

1. Create a key in the [OpenAI dashboard](https://platform.openai.com/api-keys).
   A project just for CI keeps spend separate.
2. Store it as `OPENAI_API_KEY`.

The audit uses the Responses API with
[function tools](https://developers.openai.com/api/docs/guides/function-calling).
The action runs each zeroheight call itself and sends the result back, so your
zeroheight credentials never go to OpenAI.

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
the runner; set `ZH_AUDIT_COPILOT_VERSION` to change it), with:

- one MCP server: the action's own local server
  ([`src/stdio-server.mjs`](../src/stdio-server.mjs)), which serves the same four
  read-only zeroheight tools as the other providers and holds the zeroheight
  credentials itself
- the built-in GitHub MCP server turned off
- shell, write, URL and memory tools denied, so it can only read the input file
  and call zeroheight
- no other tokens in its environment

Each run uses Copilot premium requests from the token owner's allowance. If
your organization limits models or turns off the CLI by policy, the run fails
with the CLI's message in the log.

## Self-hosted and other models

Anything that speaks the Anthropic Messages API or the OpenAI Responses API
with tool calling can be used through `ANTHROPIC_BASE_URL` or
`OPENAI_BASE_URL`. Only the runner needs to reach zeroheight
(`mcp.zeroheight.com` and `zeroheight.com`); the model never does.
