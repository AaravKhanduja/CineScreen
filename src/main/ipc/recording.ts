/**
 * Recording-related IPC handlers for start/stop recording
 */

import { ipcMain, BrowserWindow } from 'electron';
import type { Platform } from '../../platform';
import type { RecordingConfig, CursorConfig, ZoomConfig, MouseEffectsConfig } from '../../types';
import { createLogger } from '../../utils/logger';
import { hasRequiredRecordingPermissions } from '../services/permissions-service';
import {
  cleanupFailedRecordingStart,
  createDefaultCursorConfig,
  createTempRecordingPaths,
  finalizeRecordingOutput,
  startCaptureSession,
  stopCaptureAndCollectData,
} from '../services/recording-service';
import {
  hideMainWindow,
  setContentProtection,
  showMainWindow,
} from '../services/window-feedback-service';
import {
  getRecordingState,
  getCurrentRecordingConfig,
  setRecordingState,
  setCurrentRecordingConfig,
  getScreenCapture,
  getMouseTracker,
  createScreenCapture,
  createMouseTracker,
  loadConfig,
} from '../state';
import { showRecordingBar, hideRecordingBar, stopRecordingBarTimer } from '../recording-bar-window';

const logger = createLogger('IPC:Recording');

/**
 * Register recording-related IPC handlers
 * @param initPlatform - Function to initialize/get platform instance
 * @param getMainWindow - Function to get main window
 */
export function registerRecordingHandlers(
  initPlatform: () => Promise<Platform>,
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle('start-recording', async (_, config: RecordingConfig) => {
    logger.info('IPC: start-recording called with config:', config);
    const recordingState = getRecordingState();

    if (recordingState.isRecording) {
      logger.error('Recording already in progress');
      throw new Error('Recording is already in progress');
    }

    // Initialize platform
    const platform = await initPlatform();

    // Check permissions first (microphone is optional - only needed for audio recording)
    logger.debug('Checking permissions...');
    const permissions = platform.permissions.getDetailedStatus();
    logger.debug('Permissions check result:', permissions);
    if (!hasRequiredRecordingPermissions(permissions)) {
      logger.error('Required permissions not granted');
      throw new Error('Required permissions not granted. Please grant Screen Recording and Accessibility permissions.');
    }

    // Initialize components
    logger.info('Initializing screen capture and mouse tracker');
    const screenCapture = createScreenCapture();
    const mouseTracker = createMouseTracker();

    // Generate temp file paths
    const { tempVideoPath, tempMouseDataPath } = createTempRecordingPaths();
    logger.debug('Temp video path:', tempVideoPath);
    logger.debug('Temp mouse data path:', tempMouseDataPath);

    setRecordingState({
      isRecording: true,
      startTime: Date.now(),
      tempVideoPath,
      tempMouseDataPath,
      outputPath: config.outputPath,
    });
    setCurrentRecordingConfig(config);

    const mainWindow = getMainWindow();

    try {
      // Hide the app window from screen capture to prevent it from appearing in recordings
      logger.info('Enabling content protection to hide app from recording...');
      setContentProtection(mainWindow, true);
      const mouseToVideoOffset = await startCaptureSession({
        platform,
        screenCapture,
        mouseTracker,
        recordingConfig: config,
        tempVideoPath,
      });

      const currentState = getRecordingState();
      setRecordingState({
        ...currentState,
        mouseToVideoOffset,
      });
      // Hide main window and show recording bar
      hideMainWindow(mainWindow);
      showRecordingBar(getRecordingState().startTime || Date.now());

      return { success: true };
    } catch (error) {
      logger.error('Error starting recording:', error);
      setRecordingState({ isRecording: false });
      await cleanupFailedRecordingStart({ platform, mouseTracker, mainWindow });
      throw error;
    }
  });

  ipcMain.handle('stop-recording', async (_, config: {
    cursorConfig?: CursorConfig;
    zoomConfig?: ZoomConfig;
    mouseEffectsConfig?: MouseEffectsConfig;
  } | CursorConfig) => {
    // Handle both old format (just CursorConfig) and new format (object with cursorConfig)
    const userConfig = loadConfig();
    let cursorConfig: CursorConfig = createDefaultCursorConfig(userConfig);
    let zoomConfig: ZoomConfig | undefined;
    let mouseEffectsConfig: MouseEffectsConfig | undefined;

    if (config && 'cursorConfig' in config) {
      // New format
      if (config.cursorConfig) {
        cursorConfig = config.cursorConfig;
      }
      zoomConfig = config.zoomConfig;
      mouseEffectsConfig = config.mouseEffectsConfig;
    } else if (config && 'size' in config) {
      // Old format - just CursorConfig
      cursorConfig = config as CursorConfig;
    }

    logger.info('IPC: stop-recording called with config:', { cursorConfig, zoomConfig, mouseEffectsConfig });

    const recordingState = getRecordingState();
    if (!recordingState.isRecording) {
      logger.error('No recording in progress');
      throw new Error('No recording in progress');
    }

    // Stop the timer immediately so UI shows recording has ended
    stopRecordingBarTimer();

    const mainWindow = getMainWindow();
    const screenCapture = getScreenCapture();
    const mouseTracker = getMouseTracker();
    const currentRecordingConfig = getCurrentRecordingConfig();

    try {
      // Initialize platform
      const platform = await initPlatform();

      const { videoPath, mouseEvents } = await stopCaptureAndCollectData({
        platform,
        screenCapture,
        mouseTracker,
        recordingState,
      });

      // Hide recording bar and show main window
      hideRecordingBar();
      showMainWindow(mainWindow);

      // Disable content protection so window is visible again
      logger.info('Disabling content protection...');
      setContentProtection(mainWindow, false);

      const { finalVideoPath, metadataPath } = await finalizeRecordingOutput({
        videoPath,
        mouseEvents,
        recordingState,
        currentRecordingConfig,
        userConfig,
        cursorConfig,
        zoomConfig,
        mouseEffectsConfig,
      });

      setRecordingState({
        isRecording: false,
        tempVideoPath: videoPath,
        metadataPath,
      });

      logger.info('Recording completed successfully');
      return {
        success: true,
        outputPath: finalVideoPath, // Return final video path
        metadataPath, // Return metadata path (saved alongside video)
      };
    } catch (error) {
      logger.error('Error processing recording:', error);
      setRecordingState({ isRecording: false });
      // Ensure content protection is disabled even on error
      setContentProtection(mainWindow, false);
      throw error;
    }
  });

  ipcMain.handle('get-recording-state', () => {
    return getRecordingState();
  });
}
