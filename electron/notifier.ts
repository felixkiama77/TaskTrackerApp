import { Notification } from 'electron'
import type { NotificationRequest, Notifier } from './scheduler'

/**
 * Native OS notifications through Electron's built-in API (FR-22). Notifications are created in the
 * main process only. References are kept until a notification is clicked or closed, otherwise it
 * can be garbage-collected and lose its click handler.
 */
export function createElectronNotifier(options: {
  iconPath: string
  isSilent: (request: NotificationRequest) => boolean
  onClick: (request: NotificationRequest) => void
}): Notifier {
  const active = new Set<Notification>()

  return {
    show(request) {
      if (!Notification.isSupported()) {
        console.warn('[notifier] Native notifications are not supported on this system.')
        return false
      }
      try {
        const notification = new Notification({
          title: request.title,
          body: request.body,
          icon: options.iconPath,
          silent: options.isSilent(request),
        })
        const release = () => active.delete(notification)
        notification.on('click', () => {
          release()
          options.onClick(request)
        })
        notification.on('close', release)
        notification.on('failed', (_event, error) => {
          release()
          console.error('[notifier] Notification failed:', error)
        })
        active.add(notification)
        // Bound the set in case the OS never reports close events.
        if (active.size > 50) active.delete(active.values().next().value as Notification)
        notification.show()
        return true
      } catch (error) {
        console.error('[notifier] Could not show notification:', error)
        return false
      }
    },
  }
}
