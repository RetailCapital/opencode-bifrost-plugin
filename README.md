# Bifrost OpenCode Plugin

Private OpenCode integration for Retail Capital's Bifrost gateway.

At OpenCode startup, the plugin:

- verifies that Linux routes Bifrost through a VPN interface;
- discovers non-deprecated agentic models from `GET /v1/models`;
- injects the Bifrost provider when it is not already configured;
- injects the Memento MCP server at `/mcp`;
- preserves explicit provider, model, MCP, and `enabled: false` overrides; and
- logs one warning and leaves the existing configuration unchanged when setup fails.

## Prerequisites

Users must export the Bifrost base URL and virtual key. Secrets are read at
runtime and are never stored by the plugin.

```bash
export BIFROST_URL="http://bifrost.private.example"
export BIFROST_API_KEY="<virtual-key>"
```

On Linux, the Bifrost host must route through an interface whose name starts
with `ppp`, `tun`, `tap`, `wg`, `tailscale`, `zt`, `vpn`, `globalprotect`, or
`gp`. macOS and other platforms skip this Linux-specific route check.

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
