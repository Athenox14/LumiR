import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { db } from '../../db'
import { settings } from '../../db/schema'
import { eq } from 'drizzle-orm'

const logEntrySchema = z.object({
  level: z.enum(['error', 'warn']),
  message: z.string(),
  timestamp: z.string(),
})

const clientInfoSchema = z.object({
  userAgent: z.string().optional(),
  viewport: z.string().optional(),
  screen: z.string().optional(),
  language: z.string().optional(),
  onLine: z.boolean().optional(),
})

function truncate(str: string, max: number) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}

function formatLogs(logs: z.infer<typeof logEntrySchema>[]): string {
  if (!logs.length) return '_No logs captured_'
  return logs
    .slice(-15)
    .map((l) => {
      const time = l.timestamp.slice(11, 19) // HH:MM:SS
      const tag = l.level === 'error' ? '🔴' : '🟡'
      return `${tag} \`${time}\` ${l.message.slice(0, 200)}`
    })
    .join('\n')
}

export const bugReportRouter = router({
  // Check if bug reports are enabled
  isEnabled: protectedProcedure
    .query(async () => {
      const [setting] = await db
        .select()
        .from(settings)
        .where(eq(settings.key, 'bugReportEnabled'))
        .limit(1)

      return { enabled: setting?.value === true }
    }),

  // Submit a bug report via Discord webhook
  submit: protectedProcedure
    .input(z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      page: z.string().optional(),
      errorStack: z.string().optional(),
      automatic: z.boolean().optional(),
      logs: z.array(logEntrySchema).optional(),
      clientInfo: clientInfoSchema.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Check if bug reports are enabled
      const [enabledSetting] = await db
        .select()
        .from(settings)
        .where(eq(settings.key, 'bugReportEnabled'))
        .limit(1)

      if (enabledSetting?.value !== true) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Bug reports are currently disabled',
        })
      }

      // Get webhook URL
      const [webhookSetting] = await db
        .select()
        .from(settings)
        .where(eq(settings.key, 'bugReportWebhookUrl'))
        .limit(1)

      const webhookUrl = webhookSetting?.value as string | null
      if (!webhookUrl) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Bug report webhook URL is not configured',
        })
      }

      const isAuto = input.automatic === true

      // Build description
      const descriptionPrefix = isAuto
        ? '> ⚙️ **This report was submitted automatically by the error handler.**\n\n'
        : ''
      const fullDescription = truncate(descriptionPrefix + input.description, 4096)

      // Build fields
      const fields: Array<{ name: string; value: string; inline?: boolean }> = [
        {
          name: 'Reported by',
          value: `${ctx.user.displayName} (${ctx.user.email})`,
          inline: true,
        },
      ]

      if (input.page) {
        fields.push({ name: 'Page', value: truncate(input.page, 1024), inline: true })
      }

      if (input.clientInfo) {
        const ci = input.clientInfo
        const parts: string[] = []
        if (ci.userAgent) parts.push(`**UA:** ${ci.userAgent}`)
        if (ci.viewport) parts.push(`**Viewport:** ${ci.viewport}`)
        if (ci.screen) parts.push(`**Screen:** ${ci.screen}`)
        if (ci.language) parts.push(`**Lang:** ${ci.language}`)
        if (ci.onLine !== undefined) parts.push(`**Online:** ${ci.onLine ? 'yes' : 'no'}`)
        if (parts.length) {
          fields.push({ name: 'Browser / Environment', value: truncate(parts.join('\n'), 1024) })
        }
      }

      if (input.errorStack) {
        fields.push({
          name: 'Stack Trace',
          value: '```\n' + truncate(input.errorStack, 990) + '\n```',
        })
      }

      if (input.logs && input.logs.length > 0) {
        fields.push({
          name: `Recent Logs (last ${Math.min(input.logs.length, 15)})`,
          value: truncate(formatLogs(input.logs), 1024),
        })
      }

      // Build Discord embed
      const embed = {
        title: truncate(`${isAuto ? '⚙️ Auto Report' : '🐛 Bug Report'}: ${input.title}`, 256),
        description: fullDescription,
        color: isAuto ? 0xff8c00 : 0xff4444,
        fields,
        timestamp: new Date().toISOString(),
      }

      // Send to Discord webhook
      await $fetch(webhookUrl, {
        method: 'POST',
        body: {
          embeds: [embed],
        },
      })

      return { success: true }
    }),
})
