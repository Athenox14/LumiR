import { installRelease, resolveReleaseForInstall } from '../../utils/updateInstaller'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const role = (session?.user as any)?.role
  if (role !== 'admin' && role !== 'super_admin') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const body = await readBody(event)
  const requestedVersion = body?.version as string | undefined

  try {
    const release = await resolveReleaseForInstall(requestedVersion)
    await installRelease(release.downloadUrl, release.version)

    return { success: true, message: 'Update applied, restarting...' }
  } catch (err) {
    throw createError({
      statusCode: 500,
      statusMessage: `Update failed: ${(err as Error).message}`,
    })
  }
})
