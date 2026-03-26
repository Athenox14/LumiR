import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { db } from '../../db'
import { settings } from '../../db/schema'
import { eq } from 'drizzle-orm'

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

      // Build Discord embed
      const embed = {
        title: `Bug Report: ${input.title}`,
        description: input.description,
        color: 0xff4444,
        fields: [
          {
            name: 'Reported by',
            value: `${ctx.user.displayName} (${ctx.user.email})`,
            inline: true,
          },
          ...(input.page ? [{
            name: 'Page',
            value: input.page,
            inline: true,
          }] : []),
        ],
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
