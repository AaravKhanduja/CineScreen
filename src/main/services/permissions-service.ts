import type { Platform } from '../../platform';
import type {
  DetailedPermissionStatus,
  PermissionRequestResult,
  PermissionStatus,
  SystemPreferencesPanel,
} from '../../types';

type InitPlatform = () => Promise<Platform>;

export async function checkAllPermissions(
  initPlatform: InitPlatform
): Promise<PermissionStatus> {
  const platform = await initPlatform();
  return platform.permissions.checkAll();
}

export async function requestMissingPermissions(
  initPlatform: InitPlatform
): Promise<void> {
  const platform = await initPlatform();
  await platform.permissions.requestMissing();
}

export async function getDetailedPermissions(
  initPlatform: InitPlatform
): Promise<DetailedPermissionStatus> {
  const platform = await initPlatform();
  return platform.permissions.getDetailedStatus();
}

export async function requestPermissionByType(
  initPlatform: InitPlatform,
  type: SystemPreferencesPanel
): Promise<PermissionRequestResult> {
  const platform = await initPlatform();

  switch (type) {
    case 'screen-recording':
      return platform.permissions.requestScreenRecordingWithResult();
    case 'accessibility':
      return platform.permissions.requestAccessibilityWithResult();
    case 'microphone':
      return platform.permissions.requestMicrophoneWithResult();
    default:
      throw new Error(`Unknown permission type: ${type}`);
  }
}

export async function openSystemPreferencesPanel(
  initPlatform: InitPlatform,
  panel: SystemPreferencesPanel
): Promise<void> {
  const platform = await initPlatform();
  await platform.permissions.openSystemPreferences(panel);
}

export function hasRequiredRecordingPermissions(
  permissions: DetailedPermissionStatus
): boolean {
  return (
    permissions.screenRecording.state === 'granted' &&
    permissions.accessibility.state === 'granted'
  );
}
