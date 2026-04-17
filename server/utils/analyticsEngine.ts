import { db } from '../db'
import { userProfiles, media } from '../db/schema'
import { eq } from 'drizzle-orm'

// Système de poids (on peut ajuster ces valeurs)
const WEIGHTS = {
  MEDIA_VIEW: 1,
  WATCH_COMPLETE: 10,
  WATCH_PROGRESS: 2,   // par tranche de visionnage
  SEARCH_CLICK: 5,
  HOVER: 0.5,
  ABANDON: -5,
}

export async function processEvent(userId: string, event: { type: string, mediaId?: string | null, metadata?: any }) {
  // 1. Récupérer ou créer le profil
  let [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId))
  if (!profile) {
    [profile] = await db.insert(userProfiles).values({ userId, scores: {} }).returning()
  }

  const scores = profile.scores || {}

  // 2. Si l'événement concerne un média, on récupère ses genres
  let mediaGenres: string[] = []
  if (event.mediaId) {
    const [m] = await db.select({ genres: media.genres }).from(media).where(eq(media.id, event.mediaId))
    if (m?.genres) mediaGenres = m.genres
  }

  // 3. Calculer l'impact
  const weight = WEIGHTS[event.type as keyof typeof WEIGHTS] || 0
  if (weight === 0 || mediaGenres.length === 0) return

  // 4. Mettre à jour les scores des genres
  for (const genre of mediaGenres) {
    scores[genre] = (scores[genre] || 0) + weight
  }

  // 5. Sauvegarder
  await db.update(userProfiles)
    .set({ scores, updatedAt: new Date() })
    .where(eq(userProfiles.userId, userId))
}
