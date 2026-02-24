import type { BrowserWindow } from 'electron';
import { app } from 'electron';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type { Platform } from '../../platform';
import { MetadataExporter } from '../../processing/metadata-exporter';
import type {
  CursorConfig,
  MouseEffectsConfig,
  MouseEvent,
  RecordingConfig,
  RecordingState,
  ZoomConfig,
} from '../../types';
import { createLogger } from '../../utils/logger';
import type { MouseTracker } from '../mouse-tracker';
import type { ScreenCapture } from '../screen-capture';
import type { UserConfig } from '../state';

const logger = createLogger('RecordingService');

export function createTempRecordingPaths(): {
  tempVideoPath: string;
  tempMouseDataPath: string;
} {
  const tempDir = join(app.getPath('temp'), 'screen-recorder');
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const timestamp = Date.now();
  return {
    tempVideoPath: join(tempDir, `recording_${timestamp}.mkv`),
    tempMouseDataPath: join(tempDir, `mouse_${timestamp}.json`),
  };
}

export function createDefaultCursorConfig(userConfig: UserConfig): CursorConfig {
  return {
    size: userConfig.cursorSize,
    shape: userConfig.cursorShape as CursorConfig['shape'],
  };
}

export function createDefaultZoomConfig(userConfig: UserConfig): ZoomConfig {
  return {
    enabled: userConfig.zoomEnabled,
    level: userConfig.zoomLevel,
    transitionSpeed: 300,
    padding: 0,
    followSpeed: 1.0,
  };
}

export async function startCaptureSession(options: {
  platform: Platform;
  screenCapture: ScreenCapture;
  mouseTracker: MouseTracker;
  recordingConfig: RecordingConfig;
  tempVideoPath: string;
}): Promise<number> {
  const {
    platform,
    screenCapture,
    mouseTracker,
    recordingConfig,
    tempVideoPath,
  } = options;

  logger.info('Hiding system cursor...');
  await platform.cursor.hide();

  await new Promise(resolve => setTimeout(resolve, 100));

  logger.info('Starting mouse tracking...');
  const mouseTrackingStartTime = Date.now();
  await mouseTracker.startTracking();
  logger.info('Mouse tracking started');

  logger.info('Starting screen recording...');
  await screenCapture.startRecording({
    ...recordingConfig,
    outputPath: tempVideoPath,
  });
  const videoStartTime = Date.now();
  const mouseToVideoOffset = videoStartTime - mouseTrackingStartTime;
  logger.info(`Screen recording started successfully. Mouse-to-video offset: ${mouseToVideoOffset}ms`);

  return mouseToVideoOffset;
}

export async function cleanupFailedRecordingStart(options: {
  platform: Platform;
  mouseTracker: MouseTracker | null;
  mainWindow: BrowserWindow | null;
}): Promise<void> {
  const { platform, mouseTracker, mainWindow } = options;
  mouseTracker?.stopTracking();
  await platform.cursor.show();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setContentProtection(false);
  }
}

export async function stopCaptureAndCollectData(options: {
  platform: Platform;
  screenCapture: ScreenCapture | null;
  mouseTracker: MouseTracker | null;
  recordingState: RecordingState;
}): Promise<{
  videoPath: string;
  mouseEvents: MouseEvent[];
}> {
  const { platform, screenCapture, mouseTracker, recordingState } = options;

  logger.info('Stopping screen recording...');
  const videoPath = await screenCapture?.stopRecording();
  logger.info('Screen recording stopped, video path:', videoPath);

  logger.info('Showing system cursor...');
  await platform.cursor.ensureVisible();

  if (!videoPath) {
    throw new Error('Failed to stop recording');
  }

  logger.info('Stopping mouse tracking...');
  mouseTracker?.stopTracking();

  if (mouseTracker && recordingState.tempMouseDataPath) {
    mouseTracker.saveToFile(recordingState.tempMouseDataPath);
  }

  const mouseEvents = mouseTracker?.getEvents() || [];

  return {
    videoPath,
    mouseEvents,
  };
}

export async function finalizeRecordingOutput(options: {
  videoPath: string;
  mouseEvents: MouseEvent[];
  recordingState: RecordingState;
  currentRecordingConfig: RecordingConfig | null;
  userConfig: UserConfig;
  cursorConfig: CursorConfig;
  zoomConfig?: ZoomConfig;
  mouseEffectsConfig?: MouseEffectsConfig;
}): Promise<{
  finalVideoPath: string;
  metadataPath: string;
}> {
  const {
    videoPath,
    mouseEvents,
    recordingState,
    currentRecordingConfig,
    userConfig,
    cursorConfig,
    zoomConfig,
    mouseEffectsConfig,
  } = options;

  const recordingDuration = Date.now() - (recordingState.startTime || 0);
  const finalOutputPath =
    recordingState.outputPath ||
    join(app.getPath('downloads'), `recording_${Date.now()}.mp4`);

  const outputDir = dirname(finalOutputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const videoExtension = videoPath.split('.').pop() || 'mkv';
  const finalVideoPath = finalOutputPath.replace(
    /\.(mp4|mov|mkv|avi|webm)$/i,
    `.${videoExtension}`
  );

  logger.info('Copying video to final location:', finalVideoPath);
  copyFileSync(videoPath, finalVideoPath);

  let screenDimensions: { width: number; height: number } | undefined;
  try {
    const { getScreenDimensions } = await import('../../processing/video-utils');
    screenDimensions = await getScreenDimensions();
  } catch (error) {
    logger.warn('Could not get screen dimensions for metadata export:', error);
  }

  const mouseToVideoOffset = recordingState.mouseToVideoOffset || 0;
  const adjustedMouseEvents = mouseEvents.map(event => ({
    ...event,
    timestamp: Math.max(0, event.timestamp - mouseToVideoOffset),
  }));

  const exporter = new MetadataExporter();
  const metadataPath = await exporter.exportMetadata({
    videoPath: finalVideoPath,
    mouseEvents: adjustedMouseEvents,
    cursorConfig,
    zoomConfig,
    mouseEffectsConfig,
    frameRate: parseInt(userConfig.frameRate, 10) || 60,
    videoDuration: recordingDuration,
    screenDimensions,
    recordingRegion: currentRecordingConfig?.region,
  });

  logger.info('Metadata exported successfully to:', metadataPath);
  return { finalVideoPath, metadataPath };
}
