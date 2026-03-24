import { HLSController, StreamType, VideoQualityEnum, AudioQualityEnum } from '@eleven-am/transcoder'
import type { SegmentStream } from '@eleven-am/transcoder'
import { join } from 'path'
import { tmpdir } from 'os'

// ===== HLSController singleton =====

let hlsController: HLSController | null = null
let initPromise: Promise<void> | null = null

function createController(): HLSController {
  const cacheDir = join(tmpdir(), 'lumir-hls-cache')
  return new HLSController({
    cacheDirectory: cacheDir,
    hwAccel: true,
    maxSegmentBatchSize: 50,
    videoQualities: [
      VideoQualityEnum.P480,
      VideoQualityEnum.P720,
      VideoQualityEnum.P1080,
      VideoQualityEnum.ORIGINAL,
    ],
    audioQualities: [
      AudioQualityEnum.AAC,
      AudioQualityEnum.ORIGINAL,
    ],
    config: {
      disposeTimeout: 5 * 60 * 1000, // 5 minutes (matches old CLEANUP_AFTER_MS)
      enableHardwareAccelFallback: true,
      retryFailedSegments: true,
      maxRetries: 3,
      segmentTimeout: 120,
      metricsInterval: 30000,
    },
  })
}

export async function getHLSController(): Promise<HLSController> {
  if (!hlsController) {
    hlsController = createController()

    // Log session changes
    hlsController.onSessionChange((session) => {
      console.log(`[HLS] Session change: client=${session.clientId}, status=${session.status}, video=${session.videoProfile.value}, audio=${session.audioProfile.value}`)
    })

    // Log stream metrics
    hlsController.onStreamMetrics((event) => {
      if (event.segmentsCompleted % 10 === 0 && event.segmentsCompleted > 0) {
        const hwLabel = event.isUsingHardwareAcceleration ? event.currentAccelerationMethod : 'CPU'
        console.log(`[HLS] Progress: ${event.segmentsCompleted}/${event.totalSegments} segments (${hwLabel}), avg=${Math.round(event.averageSegmentDuration)}ms/seg`)
      }
    })
  }

  if (!initPromise) {
    initPromise = hlsController.initialize().then(() => {
      console.log('[HLS] @eleven-am/transcoder initialized (hardware acceleration detection complete)')
    }).catch((err) => {
      console.error('[HLS] Failed to initialize transcoder:', err.message)
      initPromise = null
      throw err
    })
  }

  await initPromise
  return hlsController
}

// ===== Exported API used by route handlers =====

export async function getMasterPlaylist(filePath: string, clientId: string): Promise<string> {
  const controller = await getHLSController()
  return controller.getMasterPlaylist(filePath, clientId)
}

export async function getIndexPlaylist(
  filePath: string,
  clientId: string,
  type: StreamType,
  quality: string,
  streamIndex: number,
): Promise<string> {
  const controller = await getHLSController()
  return controller.getIndexPlaylist(filePath, clientId, type, quality, streamIndex)
}

export async function getSegmentStream(
  filePath: string,
  clientId: string,
  type: StreamType,
  quality: string,
  streamIndex: number,
  segmentNumber: number,
): Promise<SegmentStream> {
  const controller = await getHLSController()
  return controller.getSegmentStream(filePath, clientId, type, quality, streamIndex, segmentNumber)
}

export async function getVTTSubtitle(filePath: string, streamIndex: number): Promise<string> {
  const controller = await getHLSController()
  return controller.getVTTSubtitle(filePath, streamIndex)
}

export async function getVTTSubtitleStream(filePath: string, streamIndex: number): Promise<NodeJS.ReadableStream> {
  const controller = await getHLSController()
  return controller.getVTTSubtitleStream(filePath, streamIndex)
}

export async function preCreateMetadata(filePath: string): Promise<void> {
  const controller = await getHLSController()
  return controller.createMetadata(filePath)
}

export { StreamType } from '@eleven-am/transcoder'
