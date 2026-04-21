import { db } from '../db'
import { settings } from '../db/schema'
import { eq } from 'drizzle-orm'
import type { FileMetadata } from './ffmpeg'

async function getGroqApiKey(): Promise<string | null> {
  const [setting] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, 'groqApiKey'))
    .limit(1)

  const key = setting?.value as string | undefined
  return key?.trim() || null
}

async function getGroqModel(): Promise<string> {
  const [setting] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, 'groqModel'))
    .limit(1)

  const model = setting?.value as string | undefined
  return model?.trim() || 'llama-3.1-8b-instant'
}

/**
 * Ask Groq AI to identify a movie/TV show title from the file path and metadata.
 * Used as a last resort when filename parsing and metadata title both fail.
 */
export async function askGroqForTitle(
  filePath: string,
  metadata: FileMetadata | null,
  parsedTitle: string
): Promise<string | null> {
  const apiKey = await getGroqApiKey()
  if (!apiKey) {
    console.log('[Groq] No API key configured, skipping AI title resolution')
    return null
  }

  let Groq: any
  try {
    const mod = await import('groq-sdk')
    Groq = mod.default || mod.Groq || mod
  } catch {
    console.error('[Groq] groq-sdk not installed. Run: npm install groq-sdk')
    return null
  }

  try {
    const client = new Groq({ apiKey })
    const model = await getGroqModel()

    const metaInfo = metadata
      ? `\nMetadonnees du fichier:\n- Titre embarque: ${metadata.title || 'aucun'}\n- Duree: ${metadata.duration ? Math.round(metadata.duration / 60) + ' min' : 'inconnue'}\n- Resolution: ${metadata.width && metadata.height ? `${metadata.width}x${metadata.height}` : 'inconnue'}\n- Codec video: ${metadata.videoCodec || 'inconnu'}\n- Codec audio: ${metadata.audioCodec || 'inconnu'}\n- Date: ${metadata.date || 'inconnue'}`
      : ''

    const prompt = `Tu es un expert en identification de films et series TV a partir de noms de fichiers.

Chemin du fichier: ${filePath}
Titre extrait du nom de fichier: "${parsedTitle}"${metaInfo}

A partir de ces informations, identifie le titre exact du film ou de la serie TV.
Reponds UNIQUEMENT avec le titre du film/serie, rien d'autre. Pas d'explication, pas de guillemets, juste le titre.
Si c'est un episode de serie, retourne uniquement le nom de la serie (sans numero de saison/episode).
Si tu ne peux pas identifier le contenu, reponds "UNKNOWN".`

    console.log(`[Groq] Asking AI to identify: "${parsedTitle}" (path: ${filePath})`)

    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 100,
    })

    const answer = completion.choices?.[0]?.message?.content?.trim()

    if (!answer || answer === 'UNKNOWN' || answer.length > 200) {
      console.log(`[Groq] Could not identify: "${parsedTitle}" → response: "${answer}"`)
      return null
    }

    console.log(`[Groq] Identified: "${parsedTitle}" → "${answer}"`)
    return answer
  } catch (error: any) {
    console.error('[Groq] Error:', error.message)
    return null
  }
}
