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

  try {
    commitSha = readFileSync(join(process.cwd(), 'BUILD_SHA'), 'utf-8').trim()
  } catch {
    // dev mode - no BUILD_SHA file
  }

  try {
    version = readFileSync(join(process.cwd(), 'BUILD_VERSION'), 'utf-8').trim()
  } catch {
    // dev mode - no BUILD_VERSION file
  }

  return { commitSha, version }
})
