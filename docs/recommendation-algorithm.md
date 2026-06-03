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

## Implemented improvements

All of the following are now live (see `server/utils/recoScoring.ts`,
`mediaStatsEngine.ts`, `analyticsEngine.ts`, `recoEval.ts`):

1. **Cold-start & exploration.** When a user has no learned taste,
   `youMightAlsoLike` returns a trending/popular fallback rail (ordered by
   popularity → rating → vote count). For everyone, an **ε-greedy exploration
   slot** (~15% of results) is filled from genres *outside* the user's top
   genres so the model keeps discovering instead of collapsing.
2. **Recency decay.** `applyRecencyDecay()` exponentially decays every taste map
   (genre/actor/keyword/director/composer/certification/collection/decade,
   genre×moment, genre×month, household) with a ~75-day half-life, tracked via
   `profileData.decayAt`. Negligible entries are pruned.
3. **Calibrated 0–100 score + "why".** `scoreCandidate()` accumulates labeled
   contributions, maps the raw sum through a saturating curve to 0–100, and
   returns the top 1–2 presentable reasons. The reasons render on `MediaCard`
   ("Because you like …", "Popular right now", "Continue the … saga", …),
   localized in fr/en/de under `reco.reason.*`.
4. **Negative-keyword / anti-genre.** `negScore()` actively demotes candidates
   sharing genres/keywords/actors/directors/certifications the user has soured
   on (scores gone negative via dislikes).
5. **Diversity / MMR.** `applyMMR()` re-ranks with Maximal Marginal Relevance
   (genre/collection similarity, λ≈0.72) to avoid near-duplicate rails.
6. **Per-household / co-viewing.** `recordHousehold()` maintains kids vs adult
   genre sub-profiles and detects rapid class flips as co-viewing; scoring blends
   the kids sub-profile during likely family moments.
7. **Seasonality.** `genreMonth` affinity is recorded and applied via a month
   term (e.g. horror in October), plus raw month/hour/weekday activity context.
8. **Sessions-to-finish effort.** High average sessions-to-finish demotes long /
   epic titles for non-bingers and boosts them for committed bingers.
9. **Offline evaluation harness.** `evaluateRecommendations()` (admin endpoint
   `analytics.evaluateReco`) replays known positives against distractors and
   reports precision@k, recall@k, NDCG@k and MRR.
10. **Hot reads off the request path.** Per-title stats are served from a
    cached materialized snapshot (`getAllMediaStatsCached()`, 60 s TTL) instead
    of per-request SQLite reads.

### 100% signal coverage

Every field tracked in `profileData` is consumed by the scorer — either as a
per-candidate term or folded into a global "user style" (`deriveUserStyle()`:
finisher, short/epic bias, cinephile, explorer, popularity-seeker, binger,
planner, recent-caution, trust). Raw temporal buckets, navigation paths/session
timing, search deliberation, hover/scroll engagement, playback interruptions,
audio/subtitle usage, churn cadence and the recent-signal log all feed the score.

### Further ideas (not yet done)

- Learned (regression/GBDT) weights trained on the offline harness labels.
- Bandit-tuned exploration rate per user.
- Embedding-based similarity for MMR instead of genre overlap.
