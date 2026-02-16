import { readFileSync } from 'fs'
import { join } from 'path'

export default defineEventHandler(async (event) => {
  // Check admin auth
  const session = await getUserSession(event)
  const role = (session?.user as any)?.role
  if (role !== 'admin' && role !== 'super_admin') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  let commitSha = 'dev'
  let version = 'dev'

  const cwd = process.cwd()

  // Try root first, then .output/ (zip extracts build info inside .output/)
  for (const base of [cwd, join(cwd, '.output')]) {
    if (commitSha === 'dev') {
      try {
        commitSha = readFileSync(join(base, 'BUILD_SHA'), 'utf-8').trim()
      } catch {}
    }
    if (version === 'dev') {
      try {
        version = readFileSync(join(base, 'BUILD_VERSION'), 'utf-8').trim()
      } catch {}
    }
  }

  return { commitSha, version }
})
