import type { BrowserWindow } from 'electron';

type MainWindowGetter = () => BrowserWindow | null;
type MainWindowCreator = () => void;

type ToastPayload = {
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  switchTab?: string;
};

export function setContentProtection(
  mainWindow: BrowserWindow | null,
  enabled: boolean
): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setContentProtection(enabled);
  }
}

export function showMainWindow(mainWindow: BrowserWindow | null): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

export function hideMainWindow(mainWindow: BrowserWindow | null): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

export function openOrCreateMainWindow(
  getMainWindow: MainWindowGetter,
  createWindow: MainWindowCreator
): BrowserWindow | null {
  let mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    mainWindow = getMainWindow();
  } else {
    showMainWindow(mainWindow);
  }
  return mainWindow;
}

export function openMainWindowAndShowToast(options: {
  getMainWindow: MainWindowGetter;
  createWindow: MainWindowCreator;
  toast: ToastPayload;
}): void {
  const { getMainWindow, createWindow, toast } = options;
  const mainWindow = openOrCreateMainWindow(getMainWindow, createWindow);
  if (!mainWindow) {
    return;
  }

  const sendToast = () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('show-toast', toast);
    }
  };

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', sendToast);
  } else {
    sendToast();
  }
}
