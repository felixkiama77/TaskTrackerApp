import { expect, test } from '@playwright/test'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Manual check that the installed program is locked down by Electron fuses (run `npm run build`, then
 * `MANUAL=1 npx playwright test tests/manual/fuses.spec.ts`). It launches the packaged executable the
 * way an attacker might and confirms the escape hatches are closed, using a throwaway data folder.
 */
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
const exe = path.join('release', version, 'win-unpacked', 'Task Tracker.exe')

function launch(args: string[], extraEnv: Record<string, string>) {
  const userData = mkdtempSync(path.join(tmpdir(), 'tasktracker-fuses-'))
  const child = spawn(exe, args, { env: { ...process.env, TASK_TRACKER_USER_DATA: userData, ...extraEnv } })
  let stdout = ''
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
  return { child, userData, output: () => stdout }
}

function stop(child: ChildProcess, userData: string) {
  // Ends exactly the process tree this test started.
  if (child.pid !== undefined) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'])
  // The just-killed app can hold its files for a while on Windows; a leftover temp folder is harmless.
  try {
    rmSync(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  } catch {
    console.log(`Note: couldn't remove ${userData} yet; it's a temporary folder and can be deleted later.`)
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isListening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })

test.describe('installed program is locked down', () => {
  test.skip(!existsSync(exe), `Build the installer first (${exe} not found).`)

  test('cannot be used to run arbitrary Node.js code (ELECTRON_RUN_AS_NODE)', async () => {
    const run = launch(['-e', 'process.stdout.write("NODE-RAN")'], { ELECTRON_RUN_AS_NODE: '1' })
    try {
      await wait(6000)
      expect(run.output()).not.toContain('NODE-RAN')
      // Instead it starts as the normal app, which creates its data file.
      expect(existsSync(path.join(run.userData, 'task-tracker-data.json'))).toBe(true)
    } finally {
      stop(run.child, run.userData)
    }
  })

  test('ignores debugger flags (--inspect)', async () => {
    const port = 9339
    const run = launch([`--inspect=${port}`], {})
    try {
      await wait(6000)
      expect(await isListening(port)).toBe(false)
      expect(existsSync(path.join(run.userData, 'task-tracker-data.json'))).toBe(true)
    } finally {
      stop(run.child, run.userData)
    }
  })
})
