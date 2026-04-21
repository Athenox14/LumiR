import type { AnyTRPCRouter } from '@trpc/server'
import { createJiti } from 'jiti'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getExternalPluginsDir, getRepoPluginsDir } from '../../shared/pluginPaths'

type PluginServerModule = {
  trpcRouters?: Record<string, AnyTRPCRouter>
}

const jiti = createJiti(import.meta.url)
let cachedRouters: Record<string, AnyTRPCRouter> | null = null

function loadPluginModules(): PluginServerModule[] {
  const pluginRoots = [getRepoPluginsDir(), getExternalPluginsDir()]

  return pluginRoots.flatMap((pluginsRoot) => {
    if (!existsSync(pluginsRoot)) return []

    return readdirSync(pluginsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map((entry) => {
        const pluginFile = join(pluginsRoot, entry.name, 'server', 'plugin.ts')
        if (!existsSync(pluginFile)) return null
        try {
          const mod = jiti(pluginFile) as PluginServerModule | { default?: PluginServerModule }
          const resolved = 'default' in mod && mod.default ? mod.default : mod

          if (!resolved?.trpcRouters) {
            console.warn(`[plugins] No trpcRouters exported by ${entry.name}`)
          }

          return resolved
        } catch (error) {
          console.error(`[plugins] Failed to load server plugin ${entry.name}:`, error)
          return null
        }
      })
      .filter((plugin): plugin is PluginServerModule => Boolean(plugin))
  })
}

export function getPluginTrpcRouters(): Record<string, AnyTRPCRouter> {
  if (cachedRouters) return cachedRouters

  cachedRouters = loadPluginModules().reduce<Record<string, AnyTRPCRouter>>((acc, mod) => {
    if (mod.trpcRouters) {
      Object.assign(acc, mod.trpcRouters)
    }
    return acc
  }, {})

  return cachedRouters
}
