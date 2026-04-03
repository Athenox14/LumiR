import { db } from '../db'
import { settings } from '../db/schema'
import { eq } from 'drizzle-orm'
import { serverLogs, formatAllLogs } from './serverLogger'

const COOLDOWN_MS = 5 * 60 * 1000
const reportedKeys = new Set<string>()
let lastReportAt = 0

/**
 * Auto-report a server-side error directly to the Discord webhook,
 * without going through tRPC. Should only be called for unexpected
 * errors (INTERNAL_SERVER_ERROR) — not for expected ones like FORBIDDEN.
 */
export async function serverAutoReport(opts: {
  title: string
  description: string
  stack?: string
}) {
  const now = Date.now()
  if (now - lastReportAt < COOLDOWN_MS) return

  const key = opts.title.slice(0, 100)
  if (reportedKeys.has(key)) return
  reportedKeys.add(key)
  setTimeout(() => reportedKeys.delete(key), COOLDOWN_MS)

  try {
    const [enabledSetting] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'bugReportEnabled'))
      .limit(1)

    if (enabledSetting?.value !== true) return

    const [webhookSetting] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'bugReportWebhookUrl'))
      .limit(1)

    const webhookUrl = webhookSetting?.value as string | null
    if (!webhookUrl) return

    lastReportAt = now

    const fields: Array<{ name: string; value: string }> = []

    if (opts.stack) {
      fields.push({
        name: 'Stack Trace',
        value: '```\n' + opts.stack.slice(0, 990) + '\n```',
      })
    }

    fields.push({
      name: `Server Logs (last ${Math.min(serverLogs.length, 20)})`,
      value: formatRecentLogs() || '_No server logs captured_',
    })

    const embed = {
      title: `⚙️ Auto Report: ${opts.title}`.slice(0, 256),
      description: `> ⚙️ **This report was submitted automatically by the server error handler.**\n\n${opts.description}`.slice(0, 4096),
      color: 0xff8c00,
      fields,
      timestamp: new Date().toISOString(),
    }

    const formData = new FormData()
    formData.append('payload_json', JSON.stringify({ embeds: [embed] }))

    const logContent = formatAllLogs()
    formData.append(
      'files[0]',
      new Blob([logContent], { type: 'text/plain' }),
      'server-logs.txt',
    )

    await $fetch(webhookUrl, { method: 'POST', body: formData })
  }
  catch {
    // Fail silently — must not create infinite error loops
  }
}

function formatRecentLogs(): string {
  const icons: Record<string, string> = { error: '🔴', warn: '🟡', log: '⚪' }
  return serverLogs
    .slice(-20)
    .map((l) => {
      const time = l.timestamp.slice(11, 19)
      return `${icons[l.level] ?? '⚪'} \`${time}\` ${l.message.slice(0, 200)}`
    })
    .join('\n')
}
