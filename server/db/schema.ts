import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

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
export type OnlineWatchProgress = typeof onlineWatchProgress.$inferSelect
export type Download = typeof downloads.$inferSelect
export type Announcement = typeof announcements.$inferSelect
export type NewAnnouncement = typeof announcements.$inferInsert
