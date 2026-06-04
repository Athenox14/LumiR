/**
 * Synopsis embedding engine — multilingual-e5-small, int8 ONNX.
 *
 * The model (~90 MB) is downloaded from HuggingFace Hub on first use and
 * cached in data/models/. Subsequent starts load from disk (< 1 s).
 *
 * Only the embed-job functions touch the model. The recommendation path only
 * reads pre-computed BLOB vectors from the DB, so no model is loaded at query
 * time.
 *
 * E5 convention: documents are prefixed with "passage: ", queries with "query: ".
 */

import { join } from 'path'

export const MODEL_ID = 'Xenova/multilingual-e5-small'
export const MODEL_VERSION = 'multilingual-e5-small-int8'
export const DIMS = 384

let pipelineInstance: any = null
let pipelinePromise: Promise<any> | null = null

export function isModelLoaded(): boolean {
  return pipelineInstance !== null
}

/**
 * Returns the (lazily loaded) embedding pipeline.
 * Downloads the model on the very first call.
 */
export async function getEmbeddingPipeline(onProgress?: (msg: string) => void): Promise<any> {
  if (pipelineInstance) return pipelineInstance
  if (pipelinePromise) return await pipelinePromise

  pipelinePromise = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = join(process.cwd(), 'data', 'models')
    env.allowLocalModels = false

    const progress_callback = (p: any) => {
      if (p.status === 'downloading') {
        const pct = p.total ? Math.round((p.loaded / p.total) * 100) : 0
        const msg = `Downloading ${p.file}: ${pct}%`
        onProgress?.(msg)
        process.stdout.write(`\r[Embed] ${msg}`)
      } else if (p.status === 'done' && p.file) {
        console.log(`\n[Embed] Loaded: ${p.file}`)
      }
    }

    pipelineInstance = await pipeline('feature-extraction', MODEL_ID, {
      dtype: 'q8',           // int8 quantized
      progress_callback,
    })
    return pipelineInstance
  })()

  return await pipelinePromise
}

/** Embed a single piece of text (synopsis). Returns a normalized Float32Array. */
export async function embedText(text: string, pipe?: any): Promise<Float32Array> {
  const model = pipe ?? await getEmbeddingPipeline()
  const output = await model(`passage: ${text}`, { pooling: 'mean', normalize: true })
  // output.data is a flat Float32Array of shape [DIMS]
  return new Float32Array(output.data)
}

/** Cosine similarity. Vectors must already be L2-normalized (normalize: true above). */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) dot += a[i] * b[i]
  return Math.max(-1, Math.min(1, dot))
}

/** Weighted average of multiple embeddings, then re-normalize. */
export function weightedAverageEmbedding(vecs: Array<{ vec: Float32Array; weight: number }>): Float32Array | null {
  if (!vecs.length) return null
  const avg = new Float32Array(DIMS)
  let totalW = 0
  for (const { vec, weight } of vecs) {
    for (let i = 0; i < DIMS; i++) avg[i] += vec[i] * weight
    totalW += weight
  }
  if (totalW === 0) return null
  let norm = 0
  for (let i = 0; i < DIMS; i++) { avg[i] /= totalW; norm += avg[i] * avg[i] }
  norm = Math.sqrt(norm)
  if (norm < 1e-9) return null
  for (let i = 0; i < DIMS; i++) avg[i] /= norm
  return avg
}

export function float32ToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}

export function bufferToFloat32(buf: Buffer): Float32Array {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Float32Array(ab)
}
