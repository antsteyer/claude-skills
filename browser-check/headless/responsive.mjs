// Responsive pass of /browser-check: loads one screen fresh at each width (so the SSR → mounted
// flash of the WindowWidth mixin is caught too), screenshots it and reports horizontal overflow
// and console problems. Prints one `RESULT{json}` line.
//
//   node responsive.mjs --url <path> --out <scratchpad dir> \
//     [--widths 375,800,1280] [--height 900] [--as <user uuid>] [--wait 2500]
import { mkdirSync } from 'node:fs'

import {
  BASE_URL,
  collectConsoleProblems,
  launchBrowser,
  signedInState,
  sleep,
} from './headless.mjs'

const readArgument = (name, fallback = null) => {
  const index = process.argv.indexOf(`--${name}`)

  return index === -1 ? fallback : process.argv[index + 1]
}

const url = readArgument('url')
const out = readArgument('out')
const widths = readArgument('widths', '375,800,1280').split(',').map(Number)
const height = Number(readArgument('height', '900'))
const impersonatedUuid = readArgument('as')
const waitAfterLoad = Number(readArgument('wait', '2500'))

if (!url || !out) {
  throw new Error('--url and --out are required')
}

mkdirSync(out, { recursive: true })

const browser = await launchBrowser()
const storageState = await signedInState({ browser, impersonatedUuid })
const results = []

for (const width of widths) {
  const context = await browser.newContext({ storageState, viewport: { width, height } })
  const page = await context.newPage()
  const consoleProblems = collectConsoleProblems(page)

  await page.goto(url.startsWith('http') ? url : `${BASE_URL}${url}`, {
    waitUntil: 'networkidle',
    timeout: 120000,
  })
  await sleep(waitAfterLoad)

  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    finalPath: location.pathname,
    horizontalScroll:
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
    // starts inside the viewport and sticks out of it: off-canvas panels parked at the right are skipped
    overflowingElements: [...document.querySelectorAll('body *')]
      .filter(element => {
        const rect = element.getBoundingClientRect()

        return rect.width > 0 && rect.left < window.innerWidth && rect.right > window.innerWidth + 1
      })
      .slice(0, 5)
      .map(element => `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`),
  }))
  const screenshot = `${out}/responsive-${width}.png`

  await page.screenshot({ path: screenshot, fullPage: false })
  results.push({ width, ...metrics, screenshot, consoleProblems })
  await context.close()
}

await browser.close()
console.log(`RESULT${JSON.stringify(results)}`)
