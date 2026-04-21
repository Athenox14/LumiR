import { resolve } from 'node:path'

export const DEFAULT_EXTERNAL_PLUGINS_DIR = '../lumir-plugins'

export function getExternalPluginsDir() {
  return resolve(process.cwd(), process.env.LUMIR_PLUGINS_DIR || DEFAULT_EXTERNAL_PLUGINS_DIR)
}

export function getRepoPluginsDir() {
  return resolve(process.cwd(), 'plugins')
}
