// End-to-end check: two browsers, each on a different app instance.
//   node e2e/smoke.mjs            (needs `docker compose up -d` first)
// Env: APP1 / APP2 base URLs, CHROME = path to a Chrome/Chromium binary,
//      SHOTS = folder for screenshots (optional).
import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'

const APP1 = process.env.APP1 ?? 'http://localhost:3001'
const APP2 = process.env.APP2 ?? 'http://localhost:3002'
const CHROME =
  process.env.CHROME ??
  ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find(existsSync)
const SHOTS = process.env.SHOTS
const room = `smoke-${Date.now().toString(36)}`

let failures = 0
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures++
}

const browser = await chromium.launch({ executablePath: CHROME })
async function join(base, name) {
  const page = await (await browser.newContext()).newPage()
  await page.goto(`${base}/rooms/${room}`)
  await page.fill('input[name=name]', name)
  await page.click('button[type=submit]')
  await page.locator('.status.live').waitFor({ timeout: 10_000 })
  return page
}
const say = async (page, text) => {
  await page.fill('input[name=text]', text)
  await page.press('input[name=text]', 'Enter')
}
const sees = (page, text, timeout = 5_000) =>
  page.locator('.messages li:not(.pending) p', { hasText: text }).waitFor({ timeout }).then(() => true, () => false)

try {
  const ana = await join(APP1, 'Ana')
  const ben = await join(APP2, 'Ben')
  check((await ana.locator('.status').textContent()).includes('app1'), 'Ana streams from app1')
  check((await ben.locator('.status').textContent()).includes('app2'), 'Ben streams from app2')

  const t0 = Date.now()
  await say(ana, 'hello from app1')
  check(await sees(ben, 'hello from app1'), `Ben (app2) got Ana's message live (${Date.now() - t0} ms)`)
  await say(ben, 'hi back from app2')
  check(await sees(ana, 'hi back from app2'), "Ana (app1) got Ben's reply live")
  check((await ana.locator('.messages li p', { hasText: 'hello from app1' }).count()) === 1, 'no duplicate of own message')

  // Kill app2 while Ben is connected, send while it's down, bring it back:
  // EventSource reconnects with Last-Event-ID and the server replays the gap.
  execSync('docker compose stop app2', { stdio: 'ignore' })
  await ben.locator('.status.reconnecting').waitFor({ timeout: 10_000 })
  check(true, 'Ben shows "reconnecting" while app2 is down')
  await say(ana, 'sent while app2 was down')
  await sees(ana, 'sent while app2 was down')
  execSync('docker compose start app2', { stdio: 'ignore' })
  check(await sees(ben, 'sent while app2 was down', 20_000), 'Ben got the missed message after reconnecting')

  await ben.reload()
  check(await sees(ben, 'sent while app2 was down'), 'history survives a reload (server-rendered from Redis)')

  const times = await ben.locator('.messages time').allTextContents()
  const expected = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  check(times.at(-1) === expected, `times shown in the browser's time zone (${times.at(-1)})`)

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true })
    await ana.screenshot({ path: `${SHOTS}/ana-app1.png` })
    await ben.screenshot({ path: `${SHOTS}/ben-app2.png` })
  }
} catch (err) {
  console.error(err)
  failures++
} finally {
  await browser.close()
  try {
    execSync(`docker compose exec -T redis redis-cli del chat:room:${room}:seq chat:room:${room}:messages`, { stdio: 'ignore' })
  } catch {}
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
