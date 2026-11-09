import { runPredictionJob } from '../utils/visitPredictor'

// Keeps every user's pending next-visit / next-film prediction fresh (hourly),
// so a prediction always exists *before* the visit it will be compared with.
export default defineNitroPlugin(() => {
  const run = () => {
    try { runPredictionJob() } catch (err) { console.error('[Algorithm] prediction job failed:', err) }
  }
  setTimeout(run, 60_000)
  const timer = setInterval(run, 60 * 60 * 1000)
  timer.unref?.()
})
