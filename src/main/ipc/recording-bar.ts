/**
 * Recording bar IPC handlers
 */

import { ipcMain, BrowserWindow } from 'electron';
import type { Platform } from '../../platform';
import type { CursorConfig, ZoomConfig } from '../../types';
import { createLogger } from '../../utils/logger';
import { hasRequiredRecordingPermissions } from '../services/permissions-service';
import {
  cleanupFailedRecordingStart,
  createDefaultCursorConfig,
  createDefaultZoomConfig,
  createTempRecordingPaths,
  finalizeRecordingOutput,
  startCaptureSession,
  stopCaptureAndCollectData,
} from '../services/recording-service';
import {
  hideMainWindow,
  openMainWindowAndShowToast,
  openOrCreateMainWindow,
  setContentProtection,
} from '../services/window-feedback-service';
import {
  getRecordingState,
  getCurrentRecordingConfig,
  getConfiguredOutputPath,
  setRecordingState,
  setCurrentRecordingConfig,
  getScreenCapture,
  getMouseTracker,
  createScreenCapture,
  createMouseTracker,
  cleanupRecording,
  loadConfig,
} from '../state';
import {
  showRecordingBar,
  hideRecordingBar,
  stopRecordingBarTimer,
  showRecordingBarIdle,
} from '../recording-bar-window';

const logger = createLogger('IPC:RecordingBar');

/**
 * Register recording bar IPC handlers
 * @param initPlatform - Function to initialize/get platform instance
 * @param getMainWindow - Function to get main window
 * @param createWindow - Function to create main window
 */
export function registerRecordingBarHandlers(
  initPlatform: () => Promise<Platform>,
  getMainWindow: () => BrowserWindow | null,
  createWindow: () => void
): void {
  // Stop recording from recording bar (same as normal stop)
  ipcMain.handle('recording-bar-stop', async () => {
    logger.info('IPC: recording-bar-stop called');

    const recordingState = getRecordingState();
    if (!recordingState.isRecording) {
      logger.warn('No recording in progress');
      return;
    }

    // Stop the timer immediately so UI shows recording has ended
    stopRecordingBarTimer();

    // Load configs from persistent store
    const userConfig = loadConfig();

    const cursorConfig: CursorConfig = createDefaultCursorConfig(userConfig);
    const zoomConfig: ZoomConfig = createDefaultZoomConfig(userConfig);

    const mainWindow = getMainWindow();
    const screenCapture = getScreenCapture();
    const mouseTracker = getMouseTracker();
    const currentRecordingConfig = getCurrentRecordingConfig();

    try {
      const platform = await initPlatform();

      const { videoPath, mouseEvents } = await stopCaptureAndCollectData({
        platform,
        screenCapture,
        mouseTracker,
        recordingState,
      });

      // Disable content protection on main window if it exists
      setContentProtection(mainWindow, false);

      // Show recording bar in idle mode
      showRecordingBarIdle();

      const { finalVideoPath, metadataPath } = await finalizeRecordingOutput({
        videoPath,
        mouseEvents,
        recordingState,
        currentRecordingConfig,
        userConfig,
        cursorConfig,
        zoomConfig,
      });

      logger.info('Recording completed successfully');

      setRecordingState({
        isRecording: false,
        tempVideoPath: videoPath,
        metadataPath,
      });

      // Notify main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recording-completed', {
          success: true,
          outputPath: finalVideoPath,
          metadataPath,
        });
      }

      return { success: true, outputPath: finalVideoPath, metadataPath };
    } catch (error) {
      logger.error('Error stopping recording:', error);
      const platform = await initPlatform();
      await cleanupRecording(platform, mainWindow, false);
      throw error;
    }
  });

  // Restart recording from recording bar (cancel current and start new)
  ipcMain.handle('recording-bar-restart', async () => {
    logger.info('IPC: recording-bar-restart called');

    const recordingState = getRecordingState();
    if (!recordingState.isRecording) {
      logger.warn('No recording in progress to restart');
      return;
    }

    // Store the config for restarting
    const configToRestart = getCurrentRecordingConfig();

    // Cleanup without saving
    const platform = await initPlatform();
    const mainWindow = getMainWindow();
    await cleanupRecording(platform, mainWindow, false);

    // Start new recording if we have the config
    if (configToRestart) {
      // Short delay to ensure cleanup is complete
      await new Promise(resolve => setTimeout(resolve, 200));

      // Trigger new recording through main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('restart-recording', configToRestart);
      }
    }
  });

  // Cancel recording from recording bar (discard without saving)
  ipcMain.handle('recording-bar-cancel', async () => {
    logger.info('IPC: recording-bar-cancel called');

    const recordingState = getRecordingState();
    if (!recordingState.isRecording) {
      logger.warn('No recording in progress to cancel');
      return;
    }

    // Stop the timer immediately so UI shows recording has ended
    stopRecordingBarTimer();

    const platform = await initPlatform();
    const mainWindow = getMainWindow();
    await cleanupRecording(platform, mainWindow, false);
    logger.info('Recording cancelled and discarded');

    // Notify main window
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recording-cancelled');
    }
  });

  // Open main window from recording bar menu
  ipcMain.handle('open-main-window', async () => {
    logger.info('IPC: open-main-window called');
    openOrCreateMainWindow(getMainWindow, createWindow);
  });

  // Start recording from recording bar
  ipcMain.handle('recording-bar-start', async () => {
    logger.info('IPC: recording-bar-start called');

    const recordingState = getRecordingState();
    if (recordingState.isRecording) {
      logger.warn('Recording already in progress');
      return;
    }

    // Initialize platform
    const platform = await initPlatform();

    // Check permissions first
    logger.debug('Checking permissions...');
    const permissions = platform.permissions.getDetailedStatus();
    logger.debug('Permissions check result:', permissions);
    if (!hasRequiredRecordingPermissions(permissions)) {
      logger.error('Required permissions not granted');
      openMainWindowAndShowToast({
        getMainWindow,
        createWindow,
        toast: {
          message: 'Please grant Screen Recording and Accessibility permissions before recording',
          type: 'warning',
          switchTab: 'permissions',
        },
      });
      return { success: false, reason: 'permissions' };
    }

    // Check for output path
    const configuredOutputPath = getConfiguredOutputPath();
    if (!configuredOutputPath) {
      logger.error('Output path not configured');
      openMainWindowAndShowToast({
        getMainWindow,
        createWindow,
        toast: {
          message: 'Please set an output path before recording',
          type: 'warning',
          switchTab: 'recording',
        },
      });
      return { success: false, reason: 'output-path' };
    }

    // Initialize components
    logger.info('Initializing screen capture and mouse tracker');
    const screenCapture = createScreenCapture();
    const mouseTracker = createMouseTracker();

    // Generate temp file paths
    const { tempVideoPath, tempMouseDataPath } = createTempRecordingPaths();

    setRecordingState({
      isRecording: true,
      startTime: Date.now(),
      tempVideoPath,
      tempMouseDataPath,
      outputPath: configuredOutputPath,
    });

    // Create recording config from persisted settings
    const userConfig = loadConfig();
    const recordingConfig = {
      outputPath: configuredOutputPath,
      frameRate: parseInt(userConfig.frameRate, 10) || 60,
    };
    setCurrentRecordingConfig(recordingConfig);

    const mainWindow = getMainWindow();

    try {
      // Hide the main window during recording
      setContentProtection(mainWindow, true);
      hideMainWindow(mainWindow);

      const mouseToVideoOffset = await startCaptureSession({
        platform,
        screenCapture,
        mouseTracker,
        recordingConfig,
        tempVideoPath,
      });

      const currentState = getRecordingState();
      setRecordingState({
        ...currentState,
        mouseToVideoOffset,
      });

      // Hide the recording bar completely during recording
      hideRecordingBar();

      return { success: true };
    } catch (error) {
      logger.error('Error starting recording from bar:', error);
      setRecordingState({ isRecording: false });
      await cleanupFailedRecordingStart({ platform, mouseTracker, mainWindow });
      // Show recording bar again in idle mode on error
      showRecordingBarIdle();
      throw error;
    }
  });
}
