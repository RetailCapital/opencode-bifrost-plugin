# Bifrost OpenCode Plugin

Private OpenCode integration for Retail Capital's Bifrost gateway.

At OpenCode startup, the plugin:

- confirms that `BIFROST_URL` is reachable and really is a Bifrost gateway, and
  skips all setup when it is not;
- discovers non-deprecated agentic models from `GET /v1/models`;
- injects the Bifrost provider when it is not already configured;
- injects the Memento MCP server at `/mcp`;
- preserves explicit provider, model, MCP, and `enabled: false` overrides; and
- logs one warning and leaves the existing configuration unchanged when setup fails.

## Prerequisites

The plugin needs the Bifrost base URL and virtual key in the environment.
Secrets are read at runtime; the plugin itself never writes them anywhere.

### Guided setup (recommended)

Run the interactive setup once. It prompts only for values that are not
already set in the environment (the key is typed without echo) and saves them
to `~/.bashrc` so every new shell has them. If both variables are already set,
it exits without prompting or touching any file:

```bash
npx --package @retailcapital/bifrost-opencode-plugin bifrost-opencode-setup
# or, from a local checkout:
npm run setup
```

The values are written inside a managed block delimited by
`# >>> bifrost-opencode-plugin >>>` and `# <<< bifrost-opencode-plugin <<<`.
Re-running setup replaces that block in place, offers any saved values as
defaults, and leaves the rest of `~/.bashrc` untouched. If `~/.bashrc` already
exports these variables elsewhere, setup warns you, because later lines win.
Bash login shells (SSH sessions, macOS Terminal, some Linux terminals) do not
read `~/.bashrc`. They read only the first of `~/.bash_profile`,
`~/.bash_login` and `~/.profile` that exists. After saving, setup checks that
file and warns, with the fix, when it does not source `~/.bashrc`:

```bash
[ -f ~/.bashrc ] && . ~/.bashrc
```
The file is created with mode `0600` when it does not exist. Open a new shell
(or `source ~/.bashrc`) afterwards.

### Manual setup

```bash
export BIFROST_URL="http://bifrost.private.example"
export BIFROST_API_KEY="<virtual-key>"
```

### Reachability check

Before sending the key or changing any configuration, the plugin makes two
unauthenticated requests (3 second timeout, redirects not followed):

- `GET /health` must return Bifrost's status document
  (`{"status":"ok","components":{...}}`); and
- `GET /v1/models` without credentials must be refused with Bifrost's
  `virtual_key_required` error.

Both must match. An address that is unreachable, or where another service
answers (captive portal, reused IP, open catalog), fails the check, and the
plugin logs one warning and leaves the configuration unchanged. The API key is
sent only after the check passes. There is no VPN or network-interface check,
so this works the same on every platform.

## Private GitHub Package Installation

Authenticate npm to GitHub Packages once in `~/.npmrc`:

```ini
@retailcapital:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

Then add the package to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@retailcapital/bifrost-opencode-plugin@0.1.1"]
}
```

The package can be published manually by a repository maintainer with:

```bash
npm publish
```

No publishing automation is installed by this repository.

## Local Private Checkout

For development before publishing the package, clone the private repository
and reference its entry point directly:

```json
{
  "plugin": [
    "file:///home/your-user/workspace/bifrost-opencode-plugin/src/index.js"
  ]
}
```

OpenCode 1.19 does not load this plugin from a `git+ssh` npm specification.
Use the GitHub Package for team distribution and the file URL only for local
plugin development.

## Explicit Overrides

The plugin's discovered settings have lower precedence than `opencode.json`.
Use explicit entries for native provider adapters, reasoning variants, custom
timeouts, display names, or models that Bifrost does not advertise.

```json
{
  "provider": {
    "bifrost": {
      "models": {
        "anthropic/claude-opus-5": {
          "reasoning": true,
          "provider": {
            "npm": "@ai-sdk/anthropic",
            "api": "http://bifrost.private.example/anthropic/v1"
          }
        }
      }
    }
  },
  "mcp": {
    "memento_memory": {
      "enabled": false
    }
  }
}
```

## Options

OpenCode supports package options using tuple syntax:

```json
{
  "plugin": [
    [
      "@retailcapital/bifrost-opencode-plugin@0.1.1",
      {
        "timeoutMs": 10000,
        "providerId": "bifrost",
        "mementoServerName": "memento_memory",
        "injectMemento": true
      }
    ]
  ]
}
```

## Development

```bash
npm test
npm run check
```

The Bifrost catalog does not currently expose a universal tool-calling flag.
The filter in `src/discovery.js` therefore admits known text/reasoning families
and excludes deprecated, image, audio, embedding, realtime, moderation, and
specialized generation models.
