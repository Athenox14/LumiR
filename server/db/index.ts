import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { join, dirname  } from 'path'

// Ensure data directory exists
import { mkdirSync } from 'fs'

const dbPath = process.env.DATABASE_PATH || join(process.cwd(), 'data', 'pipouflix.db')
try {
  mkdirSync(dirname(dbPath), { recursive: true })
} catch (e) {
  // Directory already exists
}

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })
export { sqlite }

// Initialize database tables
export function initializeDatabase() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      permissions TEXT,
      avatar_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      file_size INTEGER,
      tmdb_id INTEGER,
      media_type TEXT NOT NULL DEFAULT 'unknown',
      title TEXT NOT NULL,
      original_title TEXT,
      year INTEGER,
      overview TEXT,
      poster_path TEXT,
      backdrop_path TEXT,
      genres TEXT,
      runtime INTEGER,
      rating REAL,
      vote_count INTEGER,
      tagline TEXT,
      status TEXT,
      season INTEGER,
      episode INTEGER,
      cast TEXT,
      added_at INTEGER NOT NULL,
      last_scanned_at INTEGER
    );


    CREATE TABLE IF NOT EXISTS audio_tracks (
      id TEXT PRIMARY KEY,
      media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      track_index INTEGER NOT NULL,
      language TEXT,
      codec TEXT,
      channels INTEGER,
      title TEXT,
      is_default INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS subtitle_tracks (
      id TEXT PRIMARY KEY,
      media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      track_index INTEGER NOT NULL,
      language TEXT,
      codec TEXT,
      title TEXT,
      file_path TEXT,
      is_default INTEGER DEFAULT 0,
      is_forced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS watch_progress (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      duration INTEGER,
      completed INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      cover_path TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_group_items (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES media_groups(id) ON DELETE CASCADE,
      media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_group_members (
      id TEXT PRIMARY KEY,
      user_group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      grantee_type TEXT NOT NULL,
      grantee_id TEXT NOT NULL,
      access_level TEXT NOT NULL DEFAULT 'view',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_history (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      status TEXT NOT NULL,
      total_files INTEGER DEFAULT 0,
      new_files INTEGER DEFAULT 0,
      updated_files INTEGER DEFAULT 0,
      errors TEXT
    );

    CREATE TABLE IF NOT EXISTS online_watch_progress (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tmdb_id INTEGER NOT NULL,
      episode_id TEXT,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      poster_path TEXT,
      season INTEGER,
      episode INTEGER,
      position INTEGER NOT NULL DEFAULT 0,
      duration INTEGER,
      completed INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tmdb_id INTEGER NOT NULL,
      episode_id TEXT,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      poster_path TEXT,
      season INTEGER,
      episode INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      progress REAL DEFAULT 0,
      file_path TEXT,
      media_id TEXT REFERENCES media(id),
      error TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_media_tmdb_id ON media(tmdb_id);
    CREATE INDEX IF NOT EXISTS idx_media_year ON media(year);
    CREATE INDEX IF NOT EXISTS idx_media_title ON media(title);
    CREATE INDEX IF NOT EXISTS idx_watch_progress_user ON watch_progress(user_id);
    CREATE INDEX IF NOT EXISTS idx_watch_progress_media ON watch_progress(media_id);
    CREATE INDEX IF NOT EXISTS idx_online_wp_user ON online_watch_progress(user_id);
    CREATE INDEX IF NOT EXISTS idx_online_wp_tmdb ON online_watch_progress(tmdb_id);
    CREATE INDEX IF NOT EXISTS idx_downloads_user ON downloads(user_id);
    CREATE INDEX IF NOT EXISTS idx_media_collection ON media(collection_id);

    CREATE TABLE IF NOT EXISTS media_ratings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_media_ratings_user_media ON media_ratings(user_id, media_id);
    CREATE INDEX IF NOT EXISTS idx_media_ratings_media ON media_ratings(media_id);
  `)

  // Add columns for existing databases (safe to fail if already exist)
  const migrations = [
    'ALTER TABLE media ADD COLUMN season INTEGER',
    'ALTER TABLE media ADD COLUMN episode INTEGER',
    'ALTER TABLE media ADD COLUMN cast TEXT',
    'ALTER TABLE media ADD COLUMN collection_id INTEGER',
    'ALTER TABLE media ADD COLUMN collection_name TEXT',
    // User profile columns
    'ALTER TABLE users ADD COLUMN bio TEXT',
    'ALTER TABLE users ADD COLUMN is_profile_public INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN show_watched_films INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN favorite_actor_id INTEGER',
    'ALTER TABLE users ADD COLUMN favorite_actor_name TEXT',
    'ALTER TABLE users ADD COLUMN favorite_actor_image TEXT',
    'ALTER TABLE users ADD COLUMN show_liked_films INTEGER DEFAULT 0',
    // Pre-extracted subtitle content
    'ALTER TABLE subtitle_tracks ADD COLUMN content TEXT',
  ]
  for (const migration of migrations) {
    try { sqlite.exec(migration) } catch (_) { /* column already exists */ }
  }

  // Migrate old TMDB image URLs to local proxy URLs
  try {
    const tmdbPrefix = 'https://image.tmdb.org/t/p'
    const localPrefix = '/api/images'
    sqlite.exec(`
      UPDATE media SET poster_path = REPLACE(poster_path, '${tmdbPrefix}', '${localPrefix}') WHERE poster_path LIKE '${tmdbPrefix}%';
      UPDATE media SET backdrop_path = REPLACE(backdrop_path, '${tmdbPrefix}', '${localPrefix}') WHERE backdrop_path LIKE '${tmdbPrefix}%';
      UPDATE media SET cast = REPLACE(cast, '${tmdbPrefix}', '${localPrefix}') WHERE cast LIKE '%${tmdbPrefix}%';
      UPDATE online_watch_progress SET poster_path = REPLACE(poster_path, '${tmdbPrefix}', '${localPrefix}') WHERE poster_path LIKE '${tmdbPrefix}%';
      UPDATE downloads SET poster_path = REPLACE(poster_path, '${tmdbPrefix}', '${localPrefix}') WHERE poster_path LIKE '${tmdbPrefix}%';
      UPDATE users SET favorite_actor_image = REPLACE(favorite_actor_image, '${tmdbPrefix}', '${localPrefix}') WHERE favorite_actor_image LIKE '${tmdbPrefix}%';
    `)
  } catch (_) { /* tables might not exist yet */ }

  console.log('Database initialized successfully')
}

export { schema }
