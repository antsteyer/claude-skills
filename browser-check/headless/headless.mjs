// Shared Playwright helpers for /browser-check: headless Chrome on the local stack, signed in as the
// super admin test account, optionally impersonating another user. Import it by absolute path from
// a take script kept in the session scratchpad.
import { chromium } from './node_modules/playwright-core/index.mjs'

const { SUPER_ADMIN_EMAIL, SIGN_IN_PATH, USERS_INDEX_PATH, LOGIN_AS_PATH } = await import(
  './local-config.mjs'
).catch(() => {
  throw new Error(
    'Missing headless/local-config.mjs (gitignored): export SUPER_ADMIN_EMAIL, SIGN_IN_PATH, USERS_INDEX_PATH and LOGIN_AS_PATH',
  )
})

export const BASE_URL = 'http://localhost'
const SYSTEM_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

export const launchBrowser = () =>
  chromium.launch({ executablePath: SYSTEM_CHROME, headless: true })

// Signs in on the legacy page in a throwaway context and returns its storageState, to pass to the
// contexts that do the real work (recorded or not). `impersonatedUuid` runs « Login as » on top.
// The local legacy sign-in page never fires `load` (missing webpack-dev-server assets): wait for
// `domcontentloaded` only.
export const signedInState = async ({ browser, impersonatedUuid = null }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`${BASE_URL}${SIGN_IN_PATH}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  })
  await page.fill('input[name="user[email]"]', SUPER_ADMIN_EMAIL)
  await page.fill('input[name="user[password]"]', SUPER_ADMIN_EMAIL)
  await Promise.all([
    page.waitForURL(url => !url.pathname.includes(SIGN_IN_PATH), { timeout: 60000 }),
    page.press('input[name="user[password]"]', 'Enter'),
  ])

  if (impersonatedUuid) {
    await page.goto(`${BASE_URL}${USERS_INDEX_PATH}`, { waitUntil: 'domcontentloaded' })
    const status = await page.evaluate(
      ({ uuid, loginAsPath }) =>
        fetch(loginAsPath, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: { uuid }, meta: { admin_url: location.href } }),
        }).then(response => response.status),
      { uuid: impersonatedUuid, loginAsPath: LOGIN_AS_PATH },
    )

    if (status !== 201) {
      throw new Error(`Impersonation answered ${status}`)
    }
  }

  const storageState = await context.storageState()
  await context.close()

  return storageState
}

// Playwright videos show no mouse: draw one that follows the real pointer events.
export const addFakeCursor = context =>
  context.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const cursor = document.createElement('div')
      Object.assign(cursor.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '18px',
        height: '18px',
        marginLeft: '-9px',
        marginTop: '-9px',
        borderRadius: '50%',
        background: 'rgba(255, 64, 129, 0.55)',
        border: '2px solid rgba(255, 255, 255, 0.9)',
        boxShadow: '0 0 6px rgba(0, 0, 0, 0.4)',
        pointerEvents: 'none',
        zIndex: '2147483647',
        transition: 'transform 0.1s',
      })
      document.body.appendChild(cursor)
      document.addEventListener('mousemove', event => {
        cursor.style.left = `${event.clientX}px`
        cursor.style.top = `${event.clientY}px`
      })
      document.addEventListener('mousedown', () => {
        cursor.style.transform = 'scale(0.7)'
      })
      document.addEventListener('mouseup', () => {
        cursor.style.transform = 'scale(1)'
      })
    })
  })

// Records one take: `take({ page, markStart })` drives the page and calls `markStart()` once the
// entry screen is ready, so the page load can be cut. Returns the .webm path and the seconds to cut:
//   ffmpeg -y -loglevel error -ss <trimStart> -i <videoPath> -c:v libx264 -pix_fmt yuv420p \
//     -crf 20 -movflags +faststart <feature>_demo.mp4
export const recordTake = async ({
  browser,
  storageState,
  out,
  take,
  viewport = { width: 1440, height: 860 },
}) => {
  const context = await browser.newContext({
    viewport,
    storageState,
    recordVideo: { dir: out, size: viewport },
  })

  await addFakeCursor(context)

  const page = await context.newPage()
  const startedAt = Date.now()
  let trimStart = 0

  await take({
    page,
    markStart: () => {
      trimStart = (Date.now() - startedAt) / 1000
    },
  })

  const video = page.video()

  await context.close()

  return { videoPath: await video.path(), trimStart }
}

// Moves the pointer to the centre of the first match, in visible steps for a video.
export const moveTo = async ({ page, selector, steps = 25 }) => {
  const box = await page.locator(selector).first().boundingBox()

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps })
}

// Ignores the intlify « named interpolation with modulo » flood.
export const collectConsoleProblems = page => {
  const problems = []

  page.on('console', message => {
    const text = message.text()

    if (
      (message.type() === 'error' || text.includes('[Vue warn]')) &&
      !text.includes('intlify')
    ) {
      problems.push(text.slice(0, 300))
    }
  })
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))

  return problems
}
