# Bifrost OpenCode Plugin

Private OpenCode integration for Retail Capital's Bifrost gateway.

At OpenCode startup, the plugin:

- confirms that `BIFROST_URL` is reachable and really is a Bifrost gateway, and
  skips all setup when it is not;
- discovers non-deprecated agentic models from `GET /v1/models`;
- injects the Bifrost provider when it is not already configured, including
  each model's context limits and per-token pricing so OpenCode can show the
  cost of each request and of the session (see [Cost tracking](#cost-tracking));
- injects the Memento MCP server at `/mcp`;
- registers the bundled `bifrost-usage` skill (query the gateway's request-log
  and spend API) so only sessions running this plugin discover it;
- preserves explicit provider, model, MCP, and `enabled: false` overrides; and
- logs one warning and leaves the existing configuration unchanged when setup fails.

## Prerequisites

The plugin needs the Bifrost base URL and virtual key in the environment.
Secrets are read at runtime; the plugin itself never writes them anywhere.

### Guided setup (recommended)

Run the interactive setup once. It does two things:

1. Prompts only for values that are not already set in the environment (the
   key is typed without echo) and saves them to `~/.bashrc` so every new shell
   has them. If both are already set, it leaves `~/.bashrc` alone.
2. Offers to register the plugin in your global OpenCode config (see below).

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

#### Registering the plugin with OpenCode

After the environment step, setup asks `Add the plugin to <path>? [Y/n]`. The
target is `opencode.jsonc` (preferred) or `opencode.json` in
`$XDG_CONFIG_HOME/opencode` (default `~/.config/opencode`); a new
`opencode.json` is created if neither exists. The entry it adds depends on how
setup was run:

- from `npx` or `node_modules`: `@retailcapital/bifrost-opencode-plugin@<version>`;
- from a local checkout: a `file://` URL to that checkout's `src/index.js`.

The file is edited in place as text, so comments, formatting and every other
setting are preserved, and symlinks (dotfile managers) and file permissions are
kept. The plugin is added only when it is not already registered under any
form (package name with or without a version, or a `file://` path to any
checkout of this package), so re-running is safe. If the file cannot be parsed
or has a non-array `plugin`, setup leaves it untouched and prints the line to
add by hand. Project-level `opencode.json` files are never modified. Restart
OpenCode afterwards.

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

## Cost tracking

Bifrost's `GET /v1/models` returns a `pricing` object in USD per token, as
decimal strings. The plugin converts it to the `cost` block OpenCode uses
(USD per million tokens):

| Bifrost `pricing` | OpenCode `cost` |
| --- | --- |
| `prompt` | `input` |
| `completion` | `output` |
| `input_cache_read` | `cache_read` |
| `input_cache_write` | `cache_write` |

OpenCode multiplies these rates by the token counts the provider reports, so
the per-message and session totals match Bifrost's list prices. Reasoning
tokens are billed at the `output` rate.

Limits:

- Models with no usable `prompt` and `completion` price (for example the
  `dev.meta.ai/muse-spark-*` models) get no `cost`, and OpenCode shows $0 for
  them. A partial cost is never injected.
- `web_search` and `image` fees are per call, not per token, and OpenCode has
  no field for them, so they are not included.
- The figures are Bifrost's catalog prices at startup. Discounts, negotiated
  rates or later price changes are not reflected, and the plugin does not read
  Bifrost's own spend logs.
- An explicit entry for a model in `opencode.json` replaces the whole
  discovered entry (name, limits and cost), not just the keys you set. If you
  override a model, such as to set `reasoning` or a native provider adapter,
  repeat its `cost` or the model shows $0.
- The nested `cache: { read, write }` form is silently ignored by OpenCode 1.19.
  Use the flat `cache_read` and `cache_write` keys when overriding.

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
