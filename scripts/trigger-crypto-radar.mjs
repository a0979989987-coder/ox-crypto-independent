// Home PC: starts the hourly radar snapshot right after each 1H close, instead of
// waiting for GitHub's late or dropped schedule (.github/workflows/update-crypto-radar.yml).
// Meant for a Windows scheduled task that runs it every hour at about hh:00.
//   node trigger-crypto-radar.mjs            one dispatch for the current close
//   node trigger-crypto-radar.mjs --watch    stay running; dispatch after every close
//   --log-dir <dir>  where the daily log goes (default: %USERPROFILE%\ox-crypto-radar-logs)
//   --dry-run        log the decision without starting anything
// A run created in the last 10 minutes, or a snapshot of this close that is already
// published, means there is nothing to start.
import { appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const GH = 'C:/Users/a0909/tools/gh/bin/gh.exe', REPO = 'a0979989987-coder/ox-crypto-independent', WORKFLOW = 'update-crypto-radar.yml';
export const SNAPSHOT_URL = `https://raw.githubusercontent.com/${REPO}/live-data/crypto-radar.json`;
const HOUR = 3600000, RECENT_MS = 10 * 60000, AFTER_CLOSE_MS = 15000;

const clock = (at = Date.now()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(at)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
};

// The decision, kept pure for the tests: runs = [{createdAt}], published = snapshot or null.
export function decide({ now, runs = [], published = null }) {
  const close = Math.floor(now / HOUR) * HOUR;
  const recent = runs.find(run => now - Date.parse(run.createdAt) < RECENT_MS && Date.parse(run.createdAt) <= now + 60000);
  if (recent) return { start: false, reason: `已有 ${clock(Date.parse(recent.createdAt)).time} 開始的更新（${recent.status || '執行中'}）` };
  if (published?.closes?.['1H'] >= close) return { start: false, reason: `${clock(close).time.slice(0, 5)} 收盤的雷達已發布` };
  return { start: true, reason: `${clock(close).time.slice(0, 5)} 收盤` };
}

export function createTrigger({ gh = GH, repo = REPO, dryRun = false, logDir = join(homedir(), 'ox-crypto-radar-logs'), run = (file, args) => execFileSync(file, args, { stdio: 'pipe', encoding: 'utf8', timeout: 60000 }), fetcher = fetch, now = () => Date.now() } = {}) {
  mkdirSync(logDir, { recursive: true });
  const log = message => { const { date, time } = clock(now()); const line = `${time} ${message}`; console.log(line); appendFileSync(join(logDir, `trigger-crypto-radar-${date}.log`), line + '\n'); };
  const runs = () => JSON.parse(run(gh, ['run', 'list', '--workflow', WORKFLOW, '-R', repo, '--limit', '5', '--json', 'createdAt,status,event,databaseId']) || '[]');
  async function published() {
    try { const response = await fetcher(SNAPSHOT_URL, { cache: 'no-store', signal: AbortSignal.timeout(15000) }); return response.ok ? await response.json() : null; } catch { return null; }
  }
  async function once() {
    let recentRuns = [];
    try { recentRuns = runs(); } catch (error) { log(`讀取 GitHub 執行紀錄失敗：${String(error.stderr || error.message).trim().slice(0, 160)}`); }
    const decision = decide({ now: now(), runs: recentRuns, published: await published() });
    if (!decision.start) { log(`略過：${decision.reason}`); return false; }
    if (dryRun) { log(`（試跑）會觸發「${WORKFLOW}」：${decision.reason}`); return false; }
    try { run(gh, ['workflow', 'run', WORKFLOW, '-R', repo]); log(`觸發「${WORKFLOW}」：${decision.reason}`); return true; }
    catch (error) { log(`觸發失敗：${String(error.stderr || error.message).trim().slice(0, 200)}`); return false; }
  }
  return { once, log };
}

const sleep = ms => new Promise(done => setTimeout(done, ms));
// Started just before the hour (a scheduled task a little early): wait for the close.
const untilAfterClose = at => { const next = Math.ceil(at / HOUR) * HOUR, last = next - HOUR; return at - last < AFTER_CLOSE_MS ? last + AFTER_CLOSE_MS - at : next - at < 60000 ? next + AFTER_CLOSE_MS - at : 0; };

async function main() {
  const option = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  const trigger = createTrigger({ dryRun: process.argv.includes('--dry-run'), ...(option('--log-dir') ? { logDir: option('--log-dir') } : {}) });
  if (!process.argv.includes('--watch')) { await sleep(untilAfterClose(Date.now())); await trigger.once(); return; }
  trigger.log('開始：每個整點收盤後觸發');
  for (;;) {
    await sleep(untilAfterClose(Date.now()) || Math.ceil(Date.now() / HOUR) * HOUR + AFTER_CLOSE_MS - Date.now());
    await trigger.once();
    await sleep(60000);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1; });
