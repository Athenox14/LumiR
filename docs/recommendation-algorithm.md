# Recommendation Algorithm

LumiR builds personalized recommendations from three layers that are combined
into a single match score per candidate title:

1. **Taste model** (`server/utils/preferences.ts`) — genre / decade weights from
   watch history, ratings, and the watchlist. Produces the `baseScore`.
2. **Behavioral profile** (`server/utils/analyticsEngine.ts`) — a rich per-user
   `profileData` document continuously updated from UI events.
3. **Title-level audience stats** (`server/utils/mediaStatsEngine.ts`) — anonymous
   cross-user aggregates describing how everyone behaves with a title.

The final blend lives in `scoreCandidateWithProfile()` in
`server/trpc/routers/media.ts`, consumed by `youMightAlsoLike`.

## Signals taken into account

| Signal | Source | Where it's used |
| --- | --- | --- |
| **Likes** of films | `media_ratings` (rating = 1), `MEDIA_LIKE` event | `preferences` genre weights (+5), profile genre/actor/keyword/… scores (+8) |
| **Dislikes** | `media_ratings` (rating = -1), `MEDIA_DISLIKE` | genre penalty (-5/-8); disliked titles excluded from discovery |
| **Watchlist** | `watchlist` table, `WATCHLIST_ADD/REMOVE` events | `preferences` genre/decade weight (+4); profile scores (+7); genre affinity boost (+3); own home rail; excluded from discovery |
| **Abandonment curve per title** (normalized position) | `media_stats.abandon_buckets` (10 deciles) | `mediaQualityModifier()` — early-abandon penalty |
| **Effective completion (>75%)** | `media_stats.effective_completes`, profile `engagement.effectiveCompletions` | strongest title-quality term (±6) |
| **Sessions to finish** | derived from `WATCH_START` count at completion → `media_stats.sessions_to_finish_total` | binge-ability boost when avg ≤ 1.3 |
| **Active vs idle playback** | `WATCH_PROGRESS` metadata (`paused`/`idle`) → `engagement.activeWatchSeconds` / `idleWatchSeconds` | quality of attention (exposed for future weighting) |
| **Impressions without click** | `IMPRESSION` event / `CATALOG_BROWSE` → `media_stats.impressions` vs `detail_opens` | low CTR penalty, high CTR boost |
| **Hover without opening** | `HOVER` event (no `clickedAfterHover`) → `media_stats.hover_no_open` | hesitation penalty |
| **Collection / saga** | `media.collection_id/name`, profile `collectionScores` | franchise affinity boost (+12 normalized) |
| **Keywords / themes** | `media.keywords` (TMDB), profile `keywordScores` | theme overlap (+10 normalized) |
| **Director / composer** | `media.director` / `media.composer` (TMDB crew), profile scores | author affinity (+8 / +5) |
| **Age rating** | `media.certification` (TMDB), profile `certificationScores` | rating affinity (+5) |
| **Popularity / novelty** | `media.popularity` (TMDB), `year` | crowd boost `log10`, recent-release novelty (+2) |
| **Genre × moment** | `temporal.genreMoment` keyed `weekday-daypart` | boost genres watched at the *current* moment (+8 normalized) |
| **Binge / session** | `binge.bingeSessions`, streaks | saga-continuation boost during binge streaks (+3) |
| **Co-viewing** | `WATCH_COMPLETE` metadata `coViewing` → `binge.coViewingSignals` | captured for household profiling |
| **Seasonality & churn** | `temporal.monthBuckets`, `churn.{longestGapMs,reactivations,activeDays}` | re-activation / seasonal weighting hooks |

Daypart buckets: `night` (0–6), `morning` (6–12), `afternoon` (12–18),
`evening` (18–24). A "moment" is `"<weekday>-<daypart>"`, e.g. action on
Saturday evening is `6-evening`; cartoons on Wednesday afternoon is `3-afternoon`.

## Data model additions

- `media`: `keywords`, `director`, `composer`, `certification`, `popularity`
  (enriched in `tmdb.ts` via `append_to_response=keywords,credits,release_dates|content_ratings`).
- `watchlist(user_id, media_id, created_at)`.
- `media_stats(media_id, impressions, hover_no_open, detail_opens, plays,
  completes, effective_completes, abandons, abandon_buckets[10],
  sessions_to_finish_total, finishers)`.

All migrations are idempotent (`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE … ADD
COLUMN` in `server/db/index.ts`), so existing databases upgrade in place.
Newly-enriched TMDB columns populate on the next library scan / metadata refresh.

## Proposed improvements

These are intentionally **not** implemented yet — they are the recommended next
steps, roughly in priority order:

1. **Cold-start & exploration.** New users get nothing until they interact. Add a
   trending/popular fallback rail and an ε-greedy exploration slot (~10–15% of
   recommendations) so the model keeps discovering new tastes instead of
   collapsing onto the top genre.
2. **Recency decay on the behavioral profile.** `profileData` scores accumulate
   forever. Apply the same time-decay already used in `preferences.ts` (half-life
   ~60–90 days) so last year's binge doesn't dominate today's tastes.
3. **Normalize the score to 0–100 and expose "why".** The blended score is an
   unbounded sum of heterogeneous terms. Convert each term to a calibrated
   contribution and surface the top 1–2 reasons ("Because you like Nolan",
   "Popular this week") for transparency and debuggability.
4. **Negative-keyword / anti-genre modeling.** Today dislikes only dampen genre
   weights. Track keyword/director/actor scores that go *negative* and actively
   demote candidates that share them.
5. **Diversity / re-ranking (MMR).** The current sort is pure score-descending,
   which produces near-duplicate rails. Apply Maximal Marginal Relevance to
   trade a little relevance for variety across genre/collection.
6. **Per-household profiles & co-viewing.** `coViewingSignals` is captured but
   unused. Detect multi-person sessions (e.g. kids' content interleaved with
   adult content) and split into sub-profiles.
7. **Seasonality weighting.** `monthBuckets` is recorded but not yet applied;
   boost seasonal content (horror in October, family films in December) using a
   month-affinity term.
8. **Sessions-to-finish as effort signal.** Use a high average sessions-to-finish
   as a mild negative ("hard to finish") for users who rarely complete long
   titles, and a positive for committed bingers.
9. **Offline evaluation harness.** Replay `user_events` to measure
   precision@k / NDCG when tuning weights, instead of hand-picking constants.
10. **Move hot reads out of the request path.** `youMightAlsoLike` does several
    synchronous SQLite reads per call; precompute candidate stats into a cached
    materialized view refreshed on a timer.
