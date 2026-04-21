import type { AnyTRPCRouter } from '@trpc/server'
import { trpcRouters as remoteMediaRouters } from '../../plugins/remote-media/server/plugin'

const pluginModules: Array<{ trpcRouters?: Record<string, AnyTRPCRouter> }> = [
  { trpcRouters: remoteMediaRouters },
]

export function getPluginTrpcRouters(): Record<string, AnyTRPCRouter> {
  return pluginModules.reduce<Record<string, AnyTRPCRouter>>((acc, mod) => {
    if (mod.trpcRouters) {
      Object.assign(acc, mod.trpcRouters)
    }
    return acc
  }, {})
}
