import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { Channels, type TaskTrackerApi } from '../src/shared/api'

// Exposes a fixed, typed API to the page. Raw ipcRenderer and Node APIs are never exposed.
function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.off(channel, wrapped)
}

const api: TaskTrackerApi = {
  getSnapshot: () => ipcRenderer.invoke(Channels.getSnapshot),
  dispatch: (command) => ipcRenderer.invoke(Channels.dispatch, command),
  importLegacy: (raw) => ipcRenderer.invoke(Channels.importLegacy, raw),
  testNotification: () => ipcRenderer.invoke(Channels.testNotification),
  getAppInfo: () => ipcRenderer.invoke(Channels.getAppInfo),
  openDataFolder: () => ipcRenderer.invoke(Channels.openDataFolder),
  reportAudio: (report) => ipcRenderer.invoke(Channels.reportAudio, report),
  onSnapshot: (listener) => subscribe(Channels.snapshot, listener),
  onAlert: (listener) => subscribe(Channels.alert, listener),
  onNavigate: (listener) => subscribe(Channels.navigate, listener),
  onWindowVisibility: (listener) => subscribe(Channels.windowVisibility, listener),
}

contextBridge.exposeInMainWorld('taskTracker', api)
