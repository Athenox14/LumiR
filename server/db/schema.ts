import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// Users & Auth
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  role: text('role', { enum: ['super_admin', 'admin', 'user'] }).notNull().default('user'),
  permissions: text('permissions', { mode: 'json' }).$type<string[]>(),
  avatarUrl: text('avatar_url'),
  bio: text('bio'),
  isProfilePublic: integer('is_profile_public', { mode: 'boolean' }).default(false),
  showWatchedFilms: integer('show_watched_films', { mode: 'boolean' }).default(false),
  showLikedFilms: integer('show_liked_films', { mode: 'boolean' }).default(false),
  favoriteActorId: integer('favorite_actor_id'),
  favoriteActorName: text('favorite_actor_name'),
  favoriteActorImage: text('favorite_actor_image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

// Media
export const media = sqliteTable('media', {
  id: text('id').primaryKey(),
  filePath: text('file_path').notNull().unique(),
  fileName: text('file_name').notNull(),
  fileSize: integer('file_size'),
  tmdbId: integer('tmdb_id'),
  mediaType: text('media_type', { enum: ['movie', 'tv', 'unknown'] }).notNull().default('unknown'),
  title: text('title').notNull(),
  originalTitle: text('original_title'),
  year: integer('year'),
  overview: text('overview'),
  posterPath: text('poster_path'),
  backdropPath: text('backdrop_path'),
  genres: text('genres', { mode: 'json' }).$type<string[]>(),
  runtime: integer('runtime'),
  rating: real('rating'),
  voteCount: integer('vote_count'),
  tagline: text('tagline'),
  status: text('status'),
  season: integer('season'),
  episode: integer('episode'),
  cast: text('cast', { mode: 'json' }).$type<Array<{ id?: number; name: string; character: string; profilePath: string | null }>>(),
  collectionId: integer('collection_id'),
  collectionName: text('collection_name'),
  // Recommendation signals enriched from TMDB
  keywords: text('keywords', { mode: 'json' }).$type<string[]>(),
  director: text('director'),
  composer: text('composer'),
  certification: text('certification'), // Age rating, e.g. "PG-13", "12", "TV-MA"
  popularity: real('popularity'),
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  lastScannedAt: integer('last_scanned_at', { mode: 'timestamp' }),
})

export const audioTracks = sqliteTable('audio_tracks', {
  id: text('id').primaryKey(),
  mediaId: text('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
  trackIndex: integer('track_index').notNull(),
  language: text('language'),
  codec: text('codec'),
  channels: integer('channels'),
  title: text('title'),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
})

export const subtitleTracks = sqliteTable('subtitle_tracks', {
  id: text('id').primaryKey(),
  mediaId: text('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
  trackIndex: integer('track_index').notNull(),
  language: text('language'),
  codec: text('codec'),
  title: text('title'),
  filePath: text('file_path'), // External subtitle file
  content: text('content'), // Pre-extracted VTT content (from library scan)
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  isForced: integer('is_forced', { mode: 'boolean' }).default(false),
})

// Watch Progress
export const watchProgress = sqliteTable('watch_progress', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mediaId: text('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0), // seconds
  duration: integer('duration'), // seconds
  completed: integer('completed', { mode: 'boolean' }).default(false),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

// Media Ratings (like/dislike)
export const mediaRatings = sqliteTable('media_ratings', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mediaId: text('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(), // 1 = like, -1 = dislike
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

// Watchlist (explicit "watch later" intent — strong recommendation signal)
export const watchlist = sqliteTable('watchlist', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mediaId: text('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

// Per-title aggregated playback statistics (cross-user, anonymous).
// Powers title-level quality signals: abandonment curve, effective completion,
// sessions-to-finish, impression/hover click-through.
export const mediaStats = sqliteTable('media_stats', {
  mediaId: text('media_id').primaryKey().references(() => media.id, { onDelete: 'cascade' }),
  impressions: integer('impressions').notNull().default(0),     // shown in a rail/list
  hoverNoOpen: integer('hover_no_open').notNull().default(0),   // hovered, never opened
  detailOpens: integer('detail_opens').notNull().default(0),    // opened the detail page
  plays: integer('plays').notNull().default(0),                 // playback started
  completes: integer('completes').notNull().default(0),         // reached the end
  effectiveCompletes: integer('effective_completes').notNull().default(0), // watched > 75%
  abandons: integer('abandons').notNull().default(0),
  // Normalized-position abandonment histogram (10 deciles, 0-10%..90-100%)
  abandonBuckets: text('abandon_buckets', { mode: 'json' }).$type<number[]>().default(sql`'[0,0,0,0,0,0,0,0,0,0]'`),
  sessionsToFinishTotal: integer('sessions_to_finish_total').notNull().default(0),
  finishers: integer('finishers').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Settings
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

// Scan History
export const scanHistory = sqliteTable('scan_history', {
  id: text('id').primaryKey(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  status: text('status', { enum: ['running', 'completed', 'failed', 'stopped'] }).notNull(),
  totalFiles: integer('total_files').default(0),
  newFiles: integer('new_files').default(0),
  updatedFiles: integer('updated_files').default(0),
  errors: text('errors', { mode: 'json' }).$type<string[]>(),
})

// Online Watch Progress (for streaming from catalog)
export const onlineWatchProgress = sqliteTable('online_watch_progress', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tmdbId: integer('tmdb_id').notNull(),
  episodeId: text('episode_id'),
  mediaType: text('media_type', { enum: ['movie', 'tv'] }).notNull(),
  title: text('title').notNull(),
  posterPath: text('poster_path'),
  season: integer('season'),
  episode: integer('episode'),
  position: integer('position').notNull().default(0),
  duration: integer('duration'),
  completed: integer('completed', { mode: 'boolean' }).default(false),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

// Downloads
export const downloads = sqliteTable('downloads', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tmdbId: integer('tmdb_id').notNull(),
  episodeId: text('episode_id'),
  mediaType: text('media_type', { enum: ['movie', 'tv'] }).notNull(),
  title: text('title').notNull(),
  posterPath: text('poster_path'),
  season: integer('season'),
  episode: integer('episode'),
  status: text('status', { enum: ['pending', 'downloading', 'completed', 'failed'] }).notNull().default('pending'),
  progress: real('progress').default(0),
  filePath: text('file_path'),
  mediaId: text('media_id').references(() => media.id),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
})

// Announcements
export const announcements = sqliteTable('announcements', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  message: text('message').notNull(),
  type: text('type', { enum: ['info', 'warning', 'success', 'error'] }).notNull().default('info'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  dismissible: integer('dismissible', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// User Behavioral Analytics
export const userProfiles = sqliteTable('user_profiles', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  scores: text('scores', { mode: 'json' }).$type<Record<string, number>>().default('{}'),
  recentGenres: text('recent_genres', { mode: 'json' }).$type<string[]>().default('[]'),
  profileData: text('profile_data', { mode: 'json' }).$type<Record<string, any>>().default('{}'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

export const userEvents = sqliteTable('user_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  mediaId: text('media_id'),
  metadata: text('metadata', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Type exports
export type User = typeof users.$inferSelect

export type NewUser = typeof users.$inferInsert
export type Media = typeof media.$inferSelect
export type NewMedia = typeof media.$inferInsert
export type AudioTrack = typeof audioTracks.$inferSelect
export type SubtitleTrack = typeof subtitleTracks.$inferSelect
export type WatchProgress = typeof watchProgress.$inferSelect
export type Setting = typeof settings.$inferSelect
export type MediaRating = typeof mediaRatings.$inferSelect
export type NewMediaRating = typeof mediaRatings.$inferInsert
export type Watchlist = typeof watchlist.$inferSelect
export type NewWatchlist = typeof watchlist.$inferInsert
export type MediaStats = typeof mediaStats.$inferSelect
export type OnlineWatchProgress = typeof onlineWatchProgress.$inferSelect
export type Download = typeof downloads.$inferSelect
export type Announcement = typeof announcements.$inferSelect
export type NewAnnouncement = typeof announcements.$inferInsert
