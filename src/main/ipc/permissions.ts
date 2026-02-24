/**
 * Permission-related IPC handlers
 */

import { ipcMain } from 'electron';
import type { Platform } from '../../platform';
import { createLogger } from '../../utils/logger';
import {
  checkAllPermissions,
  getDetailedPermissions,
  openSystemPreferencesPanel,
  requestMissingPermissions,
  requestPermissionByType,
} from '../services/permissions-service';

const logger = createLogger('IPC:Permissions');

/**
 * Register permission-related IPC handlers
 * @param initPlatform - Function to initialize/get platform instance
 */
export function registerPermissionHandlers(
  initPlatform: () => Promise<Platform>
): void {
  ipcMain.handle('check-permissions', async () => {
    logger.debug('IPC: check-permissions called');
    const permissions = await checkAllPermissions(initPlatform);
    logger.debug('Permissions result:', permissions);
    return permissions;
  });

  ipcMain.handle('request-permissions', async () => {
    logger.debug('IPC: request-permissions called');
    await requestMissingPermissions(initPlatform);
    logger.debug('Request permissions completed');
  });

  ipcMain.handle('get-detailed-permissions', async () => {
    logger.debug('IPC: get-detailed-permissions called');
    const detailedStatus = await getDetailedPermissions(initPlatform);
    logger.debug('Detailed permissions result:', detailedStatus);
    return detailedStatus;
  });

  ipcMain.handle('request-permission', async (_, type: 'screen-recording' | 'accessibility' | 'microphone') => {
    logger.debug(`IPC: request-permission called for: ${type}`);
    const result = await requestPermissionByType(initPlatform, type);
    logger.debug(`Request permission result for ${type}:`, result);
    return result;
  });

  ipcMain.handle('open-system-preferences', async (_, panel: 'screen-recording' | 'accessibility' | 'microphone') => {
    logger.debug(`IPC: open-system-preferences called for: ${panel}`);
    await openSystemPreferencesPanel(initPlatform, panel);
    logger.debug('System preferences opened');
  });
}
