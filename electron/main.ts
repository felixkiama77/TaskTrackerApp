import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  net,
  Notification,
  powerMonitor,
  protocol,
  session,
  shell,
  Tray,
} from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runMaintenance } from '../src/domain/commands'
import type { AppData } from '../src/domain/types'
import { Channels, type AlertMessage, type NavigateMessage } from '../src/shared/api'
import { registerIpc, snapshotOf } from './ipc'
import { createElectronNotifier } from './notifier'
import { SoundLibrary } from './soundLibrary'
import { ReminderScheduler, type NotificationRequest, type Notifier } from './scheduler'
import { Store } from './store'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.cjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

/** Must match `appId` in electron-builder.json5; Windows ties notifications to it. */
const APP_ID = 'io.github.felixkiama77.tasktracker'

// Automated tests point the data folder at a throwaway directory. Otherwise the folder is pinned to
// %APPDATA%/tasktracker so it stays stable even if the product name changes.
const TEST_MODE = Boolean(process.env.TASK_TRACKER_USER_DATA)
app.setPath(
  'userData',
  process.env.TASK_TRACKER_USER_DATA ?? path.join(app.getPath('appData'), 'tasktracker'),
)

// Tests may move the clock (TASK_TRACKER_FAKE_NOW, an ISO timestamp). Ignored outside test mode.
const fakeNow = TEST_MODE ? Date.parse(process.env.TASK_TRACKER_FAKE_NOW ?? '') : NaN
const clockOffsetMs = Number.isNaN(fakeNow) ? 0 : fakeNow - Date.now()
const now = () => Date.now() + clockOffsetMs

const iconPath = path.join(
  process.env.VITE_PUBLIC,
  process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png',
)
const devOrigin = VITE_DEV_SERVER_URL ? new URL(VITE_DEV_SERVER_URL).origin : null
const indexFileUrl = pathToFileURL(path.join(RENDERER_DIST, 'index.html')).href

// Sounds the user added are served to the page as tt-sound://sound/<folder>/<file>, only from the
// app's sounds folder. Must be registered before the app is ready; "stream" lets audio seek.
protocol.registerSchemesAsPrivileged([
  { scheme: 'tt-sound', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
])
/** Launched by "Start at login": stay in the tray until the user opens the window. */
const startHidden = process.argv.includes('--hidden')

let win: BrowserWindow | null = null
let tray: Tray | null = null
let store: Store | null = null
let scheduler: ReminderScheduler | null = null
let notifier: Notifier | null = null
let quitting = false
let readyToExit = false
let trayHintShown = false
/** Notification kinds whose sound the window plays itself (see AudioReport). */
let customNotificationSounds = new Set<string>()

/** True only for the app's own page: the dev server in development, dist/index.html when built. */
function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (devOrigin) return parsed.origin === devOrigin
    parsed.hash = ''
    parsed.search = ''
    return parsed.href === indexFileUrl
  } catch {
    return false
  }
}

function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'Task Tracker',
    backgroundColor: '#F8FAFC',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true,
      // Notification sounds must play while the window sits hidden in the tray.
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  win.once('ready-to-show', () => {
    if (!startHidden) win?.show()
  })

  win.on('close', (event) => {
    if (quitting || !tray || store?.get().settings.closeBehavior !== 'tray') return
    // Keep running in the tray so reminders still fire.
    event.preventDefault()
    win?.hide()
    if (!trayHintShown) {
      trayHintShown = true
      notifier?.show({
        title: 'Task Tracker is still running',
        body: 'Reminders will keep working. Use the tray icon to open or quit Task Tracker.',
        silent: true,
      })
    }
  })

  // Tell the page when it is really on screen; Chromium keeps reporting "visible" for a hidden window.
  const reportShown = () => send(Channels.windowVisibility, Boolean(win?.isVisible() && !win.isMinimized()))
  for (const event of ['show', 'hide', 'minimize', 'restore'] as const) win.on(event as 'show', reportShown)

  win.on('closed', () => {
    win = null
  })

  void (VITE_DEV_SERVER_URL
    ? win.loadURL(VITE_DEV_SERVER_URL)
    : win.loadFile(path.join(RENDERER_DIST, 'index.html')))
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('Task Tracker')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Task Tracker', click: showWindow },
      { type: 'separator' },
      { label: 'Quit Task Tracker', click: () => app.quit() },
    ]),
  )
  tray.on('click', showWindow)
}

/** Registers or removes "Start at login". Only for installed builds, never the dev Electron binary. */
function applyLoginItem(settings: AppData['settings']) {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: ['--hidden'] })
}

/** Security hardening that applies to every page the app creates. */
function hardenWebContents() {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
  // The page never needs camera, microphone, location, web notifications and so on; native
  // notifications come from the main process.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
}

/**
 * Test-only notifier: records notifications in the main process instead of showing them, so the
 * automated tests don't put real notifications on the desktop. Never used outside test mode.
 */
function recordingNotifier(): Notifier {
  const log: NotificationRequest[] = []
  ;(globalThis as { __taskTrackerNotifications?: NotificationRequest[] }).__taskTrackerNotifications = log
  return {
    show(request) {
      log.push(request)
      return true
    },
  }
}

async function maintain() {
  if (!store) return
  const result = runMaintenance(store.get(), now())
  if (!result.changed) return
  await store.replace(result.data)
  send(Channels.snapshot, snapshotOf(result.data, []))
}

async function start() {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
  if (app.isPackaged && process.platform !== 'darwin') Menu.setApplicationMenu(null)
  hardenWebContents()

  const opened = await Store.open(app.getPath('userData'), now())
  const sounds = new SoundLibrary(path.join(app.getPath('userData'), 'sounds'))
  protocol.handle('tt-sound', (request) => {
    const url = new URL(request.url)
    const [, folder = '', file = ''] = url.pathname.split('/')
    const full = url.host === 'sound' ? sounds.resolve(folder, decodeURIComponent(file)) : null
    if (!full) return new Response('Not found', { status: 404 })
    // Forward headers such as Range so audio can stream and seek.
    return net.fetch(pathToFileURL(full).toString(), { headers: request.headers })
  })
  const openedStore = opened.store
  store = openedStore
  await maintain()
  setInterval(() => {
    maintain().catch((error: unknown) => console.error('[main] Maintenance failed:', error))
  }, 3_600_000)

  const activeNotifier: Notifier =
    TEST_MODE && process.env.TASK_TRACKER_TEST_NOTIFIER === 'record'
      ? recordingNotifier()
      : createElectronNotifier({
          iconPath,
          isSilent: (request) =>
            request.silent === true ||
            !openedStore.get().settings.playSound ||
            (request.kind !== undefined && customNotificationSounds.has(request.kind)),
          onClick: (request) => {
            showWindow()
            if (request.taskId && request.occurrenceKey) {
              const target: NavigateMessage = { taskId: request.taskId, occurrenceKey: request.occurrenceKey }
              send(Channels.navigate, target)
            }
          },
        })
  notifier = activeNotifier

  const activeScheduler = new ReminderScheduler({
    getData: () => openedStore.get(),
    saveAlerts: (alerts) => openedStore.replace({ ...openedStore.get(), alerts }),
    notifier: activeNotifier,
    onAlert: (message: AlertMessage) => send(Channels.alert, message),
    now,
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
  })
  scheduler = activeScheduler

  registerIpc({
    store: openedStore,
    issues: opened.issues,
    now,
    newId: randomUUID,
    isTrustedSender: (frame) => frame !== null && isAppUrl(frame.url),
    onChanged: (previous, next, command) => {
      send(Channels.snapshot, snapshotOf(next, []))
      void activeScheduler.check()
      if (
        command?.type === 'settings/update' &&
        previous.settings.launchAtLogin !== next.settings.launchAtLogin
      ) {
        applyLoginItem(next.settings)
      }
    },
    testNotification: () =>
      activeNotifier.show({
        title: 'Test notification',
        body: 'Notifications from Task Tracker are working.',
        kind: 'reminder',
      })
        ? { ok: true }
        : {
            ok: false,
            error:
              'Notifications aren’t available. Check that notifications are turned on for Task Tracker in your system settings.',
          },
    appInfo: () => ({
      version: app.getVersion(),
      dataDirectory: app.getPath('userData'),
      platform: process.platform,
      clockOffsetMs,
      notificationsSupported: Notification.isSupported(),
      isPackaged: app.isPackaged,
    }),
    sounds,
    pickSoundFiles: async (multiple) => {
      // Tests supply files instead of the system dialog, which automation can't operate.
      const testFiles = TEST_MODE ? process.env.TASK_TRACKER_TEST_PICK_FILES : undefined
      if (testFiles !== undefined) return testFiles.split(path.delimiter).filter(Boolean)
      const options: Electron.OpenDialogOptions = {
        title: multiple ? 'Add music tracks' : 'Choose a sound',
        filters: [{ name: 'Audio files', extensions: ['mp3', 'ogg', 'wav', 'm4a'] }],
        properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      return result.canceled ? [] : result.filePaths
    },
    setAudioReport: (report) => {
      customNotificationSounds = new Set(report.customNotificationSounds)
    },
    openDataFolder: async () => {
      const error = await shell.openPath(app.getPath('userData'))
      if (error) throw new Error(error)
    },
  })

  createWindow()
  createTray()
  applyLoginItem(openedStore.get().settings)
  activeScheduler.start()

  // Re-check reminders after sleep or a locked session (FR-23, FR-29).
  powerMonitor.on('resume', () => void activeScheduler.check())
  powerMonitor.on('unlock-screen', () => void activeScheduler.check())
}

if (!app.requestSingleInstanceLock()) {
  // Another copy is already running; it shows its window (see 'second-instance').
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.on('before-quit', (event) => {
    quitting = true
    if (readyToExit || !store) return
    // Let pending writes finish before the process exits.
    event.preventDefault()
    scheduler?.stop()
    void store.flush().finally(() => {
      readyToExit = true
      app.quit()
    })
  })

  // With "keep running in tray" the window is hidden rather than closed, so this only fires when
  // the user chose to quit on close.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', showWindow)

  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      console.error('[main] Startup failed:', error)
      dialog.showErrorBox(
        'Task Tracker couldn’t start',
        `Something went wrong while opening your data. Nothing was deleted.\n\n${String(error)}`,
      )
      app.exit(1)
    })
}
