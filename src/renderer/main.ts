import '@fontsource-variable/inter'
import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/layout.css'
import '../styles/components.css'
import '../styles/views.css'
import { startApp } from './app'

const root = document.getElementById('app')!

function showFatal(message: string) {
  root.replaceChildren()
  const box = document.createElement('div')
  box.className = 'empty-state'
  const title = document.createElement('h1')
  title.textContent = 'Task Tracker couldn’t start'
  const text = document.createElement('p')
  text.textContent = message
  box.append(title, text)
  root.append(box)
}

if (typeof window.taskTracker === 'undefined') {
  showFatal('This page must be opened inside the Task Tracker app.')
} else {
  startApp(root, window.taskTracker).catch((error: unknown) => {
    console.error('[renderer] Startup failed', error)
    showFatal(
      'Your data was not changed. Please restart the app; if this keeps happening, check the data folder in %APPDATA%\\tasktracker.',
    )
  })
}
