import { fileURLToPath } from "node:url"

import {
  bifrostApiUrl,
  bifrostMcpUrl,
  discoverBifrostModels,
} from "./discovery.js"

const SERVICE = "bifrost-opencode-plugin"
// Ships with this package; registered via the `skills` config key so only
// sessions running this plugin discover it.
const SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url))

export function createBifrostPlugin({
  discover = discoverBifrostModels,
  env = process.env,
} = {}) {
  return async function bifrostPlugin({ client }, options = {}) {
    let warned = false

    const log = async (level, message) => {
      try {
        await client.app.log({ body: { service: SERVICE, level, message } })
      } catch {
        console[level === "warn" ? "warn" : "info"](`[${SERVICE}] ${message}`)
      }
    }

    const warnOnce = async (message) => {
      if (warned) return
      warned = true
      await log("warn", message)
    }

    return {
      config: async (config) => {
        const baseUrl = env.BIFROST_URL?.trim()
        const apiKey = env.BIFROST_API_KEY?.trim()
        if (!baseUrl || !apiKey) {
          await warnOnce("Setup skipped because the Bifrost environment variables are not set. Run `npx --package @retailcapital/bifrost-opencode-plugin bifrost-opencode-setup` (or `npm run setup` in a local checkout) to save them to ~/.bashrc, then start a new shell")
          return
        }

        try {
          const discovered = await discover({
            baseUrl,
            apiKey,
            timeoutMs: positiveInteger(options.timeoutMs) || 8_000,
          })
          const providerId = stringOption(options.providerId, "bifrost")
          const mementoServerName = stringOption(options.mementoServerName, "memento_memory")
          const configuredModels = config.provider?.[providerId]?.models || {}

          config.provider ??= {}
          config.provider[providerId] = mergeProvider(
            baseUrl,
            apiKey,
            discovered,
            config.provider[providerId],
          )

          if (options.injectMemento !== false) {
            config.mcp ??= {}
            config.mcp[mementoServerName] = mergeMemento(
              baseUrl,
              apiKey,
              config.mcp[mementoServerName],
            )
          }

          // OpenCode <= 1.19 validates `skills` as an object ({ paths, urls })
          // and rejects the newer array form outright, so the object form is
          // the safe default; newer versions still accept it (deprecated).
          // An array is only extended when it is already present, which means
          // the running version accepted it from the user's own config.
          if (Array.isArray(config.skills)) {
            if (!config.skills.includes(SKILLS_DIR)) config.skills.push(SKILLS_DIR)
          } else {
            config.skills ??= {}
            config.skills.paths ??= []
            if (!config.skills.paths.includes(SKILLS_DIR)) config.skills.paths.push(SKILLS_DIR)
          }

          await log(
            "info",
            `Configured ${Object.keys(discovered).length} discovered models and preserved ${Object.keys(configuredModels).length} explicit model configurations`,
          )
        } catch (error) {
          await warnOnce(`Setup skipped: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    }
  }
}

export function mergeProvider(baseUrl, apiKey, discovered, configured = {}) {
  const defaults = {
    npm: "@ai-sdk/openai-compatible",
    api: bifrostApiUrl(baseUrl),
    name: "Bifrost",
    options: { apiKey },
    models: discovered,
  }

  return {
    ...defaults,
    ...configured,
    options: { ...defaults.options, ...configured.options },
    models: { ...discovered, ...configured.models },
  }
}

export function mergeMemento(baseUrl, apiKey, configured = {}) {
  const defaults = {
    type: "remote",
    url: bifrostMcpUrl(baseUrl),
    oauth: false,
    headers: { "x-bf-vk": apiKey },
  }

  return {
    ...defaults,
    ...configured,
    headers: { ...defaults.headers, ...configured.headers },
  }
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function stringOption(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}
