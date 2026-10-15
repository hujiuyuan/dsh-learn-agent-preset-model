#!/usr/bin/env node
// learn —— 学习教练预设的进度脚本。
// 所有进度只通过本脚本读写；输出是给模型看的精简中文文本。
// 数据目录：$LEARN_HOME，缺省为 $DSH_HOME/learning，再缺省为 ~/.dsh/learning。
// 只用 Node 内置模块，不依赖任何第三方包。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const VERSION = 1
const INTERVALS = [1, 3, 7, 14] // 错题复习间隔（天），按 stage 取；通过 stage 4 后移出错题本
const SESSION_GAP_HOURS = 2 // 距上次活动超过这么久，视为新的一次学习
const METHODS = ['worked-example', 'first-principles', 'diagnose', 'coach', 'feynman']
const METHOD_NAMES = {
  'worked-example': '示范例题',
  'first-principles': '第一性原理',
  diagnose: '诊断纠偏',
  coach: '练习批改',
  feynman: '费曼',
}
const LESSON_STATUS = ['todo', 'in_progress', 'mastered', 'review', 'skipped']
const STATUS_NAMES = { todo: '未开始', in_progress: '进行中', mastered: '已掌握', review: '需复习', skipped: '跳过' }
const STEP_STATUS = ['todo', 'in_progress', 'done']

// 学习者画像（跨课程）：只记技能、档位和证据
const LEVELS = ['none', 'partial', 'mastered'] // 下标越大越高
const LEVEL_NAMES = { mastered: '已会', partial: '会一点', none: '不会' }
const EVIDENCE_NAMES = { self: '自述', quiz: '题目验证', lesson: '先修节通过', course: '结业' }
const STALE_DAYS = 180 // 最近一次验证超过这么久，标「久未验证」，用之前先复核
const MAX_SKILLS = 50
const MAX_EVIDENCE = 8
const MAX_DETAIL = 120
// 模型自己写的说明里不许出现的、描述水平的绝对化词（用户原话放在「」里不查）
const BANNED_WORDS = ['精通', '专家', '完全掌握', '熟练掌握', '完全理解', '完美']
// 常见别名：同一组归为第一个
const ALIAS_GROUPS = [
  ['javascript', 'js', 'ecmascript', 'es6'], ['typescript', 'ts'], ['python', 'py', 'python3'],
  ['go', 'golang'], ['kubernetes', 'k8s'], ['postgresql', 'postgres', 'pgsql'], ['nodejs', 'node'],
  ['vue', 'vuejs', 'vue3'], ['react', 'reactjs'], ['c#', 'csharp'], ['c++', 'cpp'], ['java', 'javase', 'jdk'],
  ['rust', 'rustlang'], ['shell', 'bash', 'shellscript'], ['html', 'html5'], ['css', 'css3'],
  ['machinelearning', 'ml', '机器学习'], ['sql', '结构化查询语言'], ['c', 'c语言'],
  ['express', 'expressjs'], ['nextjs', 'next'], ['nuxt', 'nuxtjs'], ['nestjs', 'nest'], ['svelte', 'sveltejs'], ['net', 'dotnet'],
]

// 先修问答
const PREREQ_BUDGET = 4 // 每批最多出这么多道验证题（问会不会、问怎么补都不算）
const ROLES = ['core', 'general', 'related']
const ROLE_NAMES = { core: '必需', general: '有帮助', related: '可类比' }
const ROLE_CAPS = { core: 3, general: 2, related: 2 }
const DECISIONS = ['learn-first', 'inline', 'separate', 'skip']
const DECISION_NAMES = {
  known: '已会，不用补', anchor: '可拿来打比方', dropped: '不拿来打比方', enough: '够用，不用补',
  'learn-first': '先补（加先修节）', inline: '边学边补', separate: '先单独学一门', skip: '跳过',
}
const ANSWER_LEVEL = { A: 'mastered', B: 'partial', C: 'none' }

// ---------- 基础 ----------

class UserError extends Error {}
const warnings = []
const fail = (msg) => { throw new UserError(msg) }

const HOME = process.env.LEARN_HOME
  || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'learning')
const INDEX = path.join(HOME, 'index.json')
const GLOBAL_SKILLS = path.join(path.dirname(HOME), 'learn-skills')
const PROFILE = path.join(HOME, 'profile.json')
const PROFILE_BAK = `${PROFILE}.bak`
const PROFILE_LOCK = `${PROFILE}.lock`
const SELF = fileURLToPath(import.meta.url)
const SYNC_FILE = path.join(HOME, '.sync.json') // 这台电脑的同步状态（不进 git）
const SYNC_LOCK = path.join(HOME, '.sync.lock')
const DATA_LOCK = path.join(HOME, '.learn.lock') // 每条命令读写数据目录时都拿着它
const MERGE_MARK = path.join(HOME, '.git', 'learn-merge-pending.json') // 合并做到一半的记号：{ head, commit }
// 画像默认不进 git：清空画像要能真的清空；连了同步仓库才进 git，跟进度一起同步
// 系统自己生成的文件（访达的 .DS_Store、Windows 的 Thumbs.db 等）也不进 git，免得打开过课程文件夹就算改了这门课
const OS_JUNK = ['.DS_Store', '._*', 'Thumbs.db', 'desktop.ini']
const isJunk = (p) => /(^|\/)(\.DS_Store|\._[^/]*|Thumbs\.db|desktop\.ini)$/i.test(p)
const GITIGNORE_BASE = ['*.tmp', '.current', 'profile.json.bak', 'profile.json.lock', '.sync.json', '.sync.lock', '.local.json', '.learn.lock', ...OS_JUNK]

function now() { return new Date() }

function isoLocal(d = now()) {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const pad = (n) => String(Math.abs(n)).padStart(2, '0')
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19)
  return `${local}${sign}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`
}

function dateLocal(d = now()) { return isoLocal(d).slice(0, 10) }

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const t = new Date(y, m - 1, d + days)
  return dateLocal(t)
}

// 按本地日历日算相隔几天（昨晚 23 点到今早 1 点算 1 天）
function daysBetween(fromIso, to = now()) {
  const a = dateLocal(new Date(fromIso)).split('-').map(Number)
  const b = dateLocal(to).split('-').map(Number)
  return Math.round((new Date(b[0], b[1] - 1, b[2]) - new Date(a[0], a[1] - 1, a[2])) / 86400000)
}

function hoursSince(iso) { return (now() - new Date(iso)) / 3600000 }

function shortTime(iso) { return iso ? iso.slice(5, 16).replace('T', ' ') : '' }

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }

function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp` // 后台推送和前台命令可能同时写同一个文件
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

function git(args, opts = {}) {
  try {
    return execFileSync('git', args, { cwd: HOME, stdio: ['ignore', 'pipe', 'ignore'], ...opts }).toString()
  } catch {
    return null
  }
}

function slug(s) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(s)) fail(`课程名只能用小写字母、数字和连字符，且以字母或数字开头：${s}`)
  return s
}

// ---------- 参数 ----------

const BOOL_FLAGS = new Set(['pass', 'fail', 'global', 'course', 'all', 'json-out', 'partial', 'append', 'all-recommended'])

function parseArgs(argv) {
  const pos = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue }
      const k = a.slice(2)
      if (BOOL_FLAGS.has(k)) flags[k] = true
      else {
        if (i + 1 >= argv.length) fail(`--${k} 缺少取值`)
        flags[k] = argv[++i]
      }
    } else pos.push(a)
  }
  return { pos, flags }
}

// JSON 可以来自 --json '<文本>'、--file <路径>，或 --json - 从标准输入读
function readJsonArg(flags) {
  let text
  if (flags.file) text = fs.readFileSync(flags.file, 'utf8')
  else if (flags.json === '-') text = fs.readFileSync(0, 'utf8')
  else if (flags.json) text = flags.json
  else fail('需要 --json \'<JSON>\'、--json -（从标准输入读）或 --file <路径>')
  try { return JSON.parse(text) } catch (e) { fail(`JSON 解析失败：${e.message}`) }
}

function need(v, what) {
  if (v === undefined || v === null || v === '' || v === true) fail(`缺少${what}`)
  return v
}

function intArg(v, what) {
  const n = Number(need(v, what))
  if (!Number.isInteger(n)) fail(`${what}必须是整数：${v}`)
  return n
}

// ---------- 索引与课程 ----------

function ensureHome() {
  if (!fs.existsSync(GLOBAL_SKILLS)) fs.mkdirSync(GLOBAL_SKILLS, { recursive: true })
  if (!fs.existsSync(HOME)) fs.mkdirSync(HOME, { recursive: true })
  if (!fs.existsSync(path.join(HOME, '.git')) && git(['--version']) !== null) git(['init', '-q'])
  const gi = path.join(HOME, '.gitignore')
  const have = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8').split(/\r?\n/).filter((x) => x !== '') : []
  const synced = !!hasRemote()
  const want = synced ? GITIGNORE_BASE : [...GITIGNORE_BASE, 'profile.json']
  const next = [...have.filter((x) => x !== 'profile.json' || want.includes(x)), ...want.filter((x) => !have.includes(x))]
  if (!fs.existsSync(gi) || next.join('\n') !== have.join('\n')) fs.writeFileSync(gi, next.join('\n') + '\n')
  const junk = (git(['ls-files', '-z']) || '').split('\0').filter((x) => x && isJunk(x))
  if (junk.length) git(['rm', '-q', '--cached', '--ignore-unmatch', '--', ...junk])
  if (!fs.existsSync(INDEX)) writeJson(INDEX, { version: VERSION, current: null, courses: {} })
  relinkCurrent()
}

// 当前课程以这台电脑自己记的为准（见 .local.json）
function loadIndex() {
  if (!fs.existsSync(INDEX)) return { version: VERSION, current: null, courses: {} }
  const idx = readJson(INDEX)
  for (const k of Object.keys(idx.courses || {})) if (!fs.existsSync(courseDir(k))) delete idx.courses[k] // 课程目录已经不在了
  const cur = loadLocal().current
  if (cur && idx.courses?.[cur] && fs.existsSync(stateFile(cur))) idx.current = cur
  return idx
}

function courseDir(name) { return path.join(HOME, name) }
function stateFile(name) { return path.join(courseDir(name), 'state.json') }

function pickCourse(flags) {
  const idx = loadIndex()
  const name = flags.c || flags['course-name'] || idx.current
  if (!name) fail('还没有任何课程。先运行 learn init <课程名>')
  if (!fs.existsSync(stateFile(name))) fail(`找不到课程 ${name}。已有课程：${Object.keys(idx.courses).join('、') || '无'}`)
  return name
}

function validateState(s) {
  const errs = []
  if (typeof s !== 'object' || !s) return ['不是对象']
  if (s.version !== VERSION) errs.push(`version 应为 ${VERSION}`)
  for (const k of ['lessons', 'mistakes', 'questions', 'sessions', 'baseline']) {
    if (!Array.isArray(s[k])) errs.push(`${k} 应为数组`)
  }
  for (const l of s.lessons || []) {
    if (!Number.isInteger(l.id)) errs.push(`节 id 应为整数：${l.id}`)
    if (!LESSON_STATUS.includes(l.status)) errs.push(`第 ${l.id} 节状态非法：${l.status}`)
  }
  return errs
}

// 读状态：旧档案补上批号；分不到验证题名额的先修项当场定掉（结果是确定的，各命令看到的一致）
function loadState(name) {
  const s = readState(name)
  if (s.prereq) {
    migratePrereq(s.prereq)
    settleQuizzes(s)
  }
  return s
}

// 读 state.json；坏了就从 git 最近一次提交恢复
function readState(name) {
  const file = stateFile(name)
  let s, errs
  try { s = readJson(file); errs = validateState(s) } catch (e) { errs = [e.message] }
  if (errs.length === 0) return s
  const rel = path.relative(HOME, file).split(path.sep).join('/')
  const prev = git(['show', `HEAD:${rel}`])
  if (prev) {
    try {
      const r = JSON.parse(prev)
      if (validateState(r).length === 0) {
        writeJson(file, r)
        warnings.push(`课程 ${name} 的 state.json 已损坏（${errs.join('；')}），已从上一次提交恢复。文件：${file}`)
        return r
      }
    } catch {}
  }
  fail(`课程 ${name} 的 state.json 已损坏且无法自动恢复：${errs.join('；')}。文件：${file}`)
}


// 写状态：更新活动时间、追加日志、提交
function saveState(name, s, logLine, { session = true } = {}) {
  s.updatedAt = isoLocal()
  if (session) touchSession(s)
  writeJson(stateFile(name), s)
  const idx = loadIndex()
  if (idx.courses[name]) idx.courses[name].lastActive = s.updatedAt
  idx.current = name
  saveIndex(idx)
  if (logLine) {
    fs.appendFileSync(path.join(courseDir(name), 'log.md'), `- ${shortTime(s.updatedAt)} ${logLine}\n`)
  }
  commitAll(`${name}: ${logLine || '更新'}`)
}

// 改别的课程（不切换当前课程、不算一次学习）
function saveOtherState(name, s, logLine) {
  s.updatedAt = isoLocal()
  writeJson(stateFile(name), s)
  fs.appendFileSync(path.join(courseDir(name), 'log.md'), `- ${shortTime(s.updatedAt)} ${logLine}\n`)
  commitAll(`${name}: ${logLine}`)
}

function setCurrentLink(name) {
  const link = path.join(HOME, '.current')
  try { fs.rmSync(link, { force: true, recursive: false }) } catch {}
  try { fs.unlinkSync(link) } catch {}
  try { fs.symlinkSync(courseDir(name), link, process.platform === 'win32' ? 'junction' : 'dir') } catch {}
}

// 当前课程按电脑各自记在 .local.json（不进 git）：两台电脑可以各学各的，同步不会互相换掉。
// index.json 里的 current 只给第一次拉到这份记录的电脑当初始值
const LOCAL_FILE = path.join(HOME, '.local.json')
function loadLocal() { try { const v = readJson(LOCAL_FILE); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} } }
function setLocalCurrent(name) {
  const l = loadLocal()
  if (name && l.current !== name) writeJson(LOCAL_FILE, { ...l, current: name })
}

function saveIndex(idx) {
  writeJson(INDEX, idx)
  setLocalCurrent(idx.current)
}

// .current 跟着这台电脑的当前课程走
function relinkCurrent() {
  const cur = loadIndex().current
  if (!cur || !fs.existsSync(courseDir(cur))) return
  let have = null
  try { have = fs.readlinkSync(path.join(HOME, '.current')).replace(/^\\\\\?\\/, '') } catch {}
  if (!have || path.resolve(HOME, have) !== path.resolve(courseDir(cur))) setCurrentLink(cur)
}

let committed = false // 这次运行有没有产生新提交（有就推到同步仓库）
let commitError = null

// 学习记录的 git 操作不用用户全局配的钩子（钩子目录指向一个不存在的目录）
const noHooks = () => ['-c', `core.hooksPath=${path.join(HOME, '.git', 'learn-no-hooks')}`]

// 学习记录的提交：不签名、不跑钩子（用户全局开了签名或钩子也不会卡住）；
// 这台电脑的 git 没配用户名和邮箱时用固定署名，免得提交失败
let identCache
function idArgs() {
  if (identCache === undefined) {
    const ident = git(['var', 'GIT_AUTHOR_IDENT']) !== null && git(['var', 'GIT_COMMITTER_IDENT']) !== null
      ? [] : ['-c', 'user.name=learn', '-c', 'user.email=learn@localhost']
    identCache = ['-c', 'commit.gpgsign=false', ...noHooks(), ...ident]
  }
  return identCache
}

function commitAll(msg) {
  if (!fs.existsSync(path.join(HOME, '.git'))) return
  let r = gitRun(['add', '-A'])
  if (r.ok) {
    if (git(['diff', '--cached', '--quiet']) !== null) return // 没有改动
    r = gitRun([...idArgs(), 'commit', '-q', '-m', msg])
  }
  if (r.ok) { committed = true; return }
  if (!commitError) warnings.push(`进度已经存到文件里，但没能提交进 git（${r.err}）`)
  commitError = r.err
}

// ---------- 多台电脑同步 ----------
// 用 git 远程仓库（建议 GitHub 私有库）同步整个数据目录，画像也在内。
// 只有 learn sync --remote 连成功后才算开了同步（记在 .sync.json），数据目录里原来就有的 origin 不算。
// 拉：status 每次都拉；其他命令距上次尝试超过 5 分钟（上次没连上就 30 分钟）、或上次推送被拒时才拉。
// 推：有新提交就在后台推；收尾（pause / finish）当场推，并告诉用户推没推上去。
// 合并：不重放历史，按「分叉点 / 这台 / 仓库」三份内容逐门课地合，生成一个合并提交（见 planMerge）。
// 同一门课两边都改了合不了，交给用户选这门课留哪边，其余课程和画像照常合上。
// 每条命令都在数据目录锁里跑（见 main），合并时不会有别的 learn 进程同时写。
const PULL_EVERY_MIN = 5 // 上次没连上时放宽到 30 分钟，免得断网时每条命令都等
const syncNotes = [] // 同步提示：status 放在最前面，其他命令放在最后
let syncCache

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
function loadSync() { try { return asObject(readJson(SYNC_FILE)) } catch { return {} } }
function updateSync(patch) { const st = { ...loadSync(), ...patch }; writeJson(SYNC_FILE, st); return st }

// 开了同步返回 { url, branch }；没开、或 origin 被改成了别的地址，返回 null
function syncConf() {
  if (syncCache === undefined) {
    const st = loadSync()
    const url = st.enabled && fs.existsSync(path.join(HOME, '.git')) ? (git(['config', '--get', 'remote.origin.url']) || '').trim() : ''
    syncCache = st.enabled && st.url && st.branch && url === st.url ? { url: st.url, branch: st.branch } : null
  }
  return syncCache
}
const hasRemote = () => syncConf()?.url || null

// 开了同步时，画像里新的 id 带上这台电脑的 3 个字母（如 e12kqx），两台电脑各记各的也不会撞号，合并时不用改号
function idTag() {
  if (!hasRemote()) return ''
  const l = loadLocal()
  if (/^[a-z]{3}$/.test(l.machine || '')) return l.machine
  const machine = [...randomBytes(3)].map((b) => String.fromCharCode(97 + (b % 26))).join('')
  writeJson(LOCAL_FILE, { ...l, machine })
  return machine
}

// 显示用：去掉 http(s) 地址里可能带的用户名和 token（ssh 地址里的 git@ 是登录名，要留着）
function safeUrl(url) { return String(url).replace(/^(https?:\/\/)[^/@]*@/i, '$1') }

// 联网的 git 命令：不弹密码提示，SSH 不等交互
function netEnv() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  if (!env.GIT_SSH_COMMAND && !env.GIT_SSH && !git(['config', '--get', 'core.sshCommand'])) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o ConnectTimeout=10'
  return env
}

// git 的报错只留最有用的一行：先找能说明原因的（仓库拒收、仓库不存在、没权限、连不上），再找 fatal / error
const ERR_CAUSE = /\[remote rejected\]|repository not found|permission denied|access denied|authentication failed|host key verification failed|could not resolve host|connection (refused|timed out)|unpack failed|protected branch|does not appear to be a git repository|\b403\b/i
function gitErr(text) {
  const lines = String(text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
  const remote = lines.filter((x) => /^remote:\s*\S/.test(x) && !/^remote:\s*(Enumerating|Counting|Compressing|Total|Resolving|Create a pull request|To create a merge request|https?:\/\/)/i.test(x))
  return (lines.find((x) => ERR_CAUSE.test(x)) || remote.find((x) => /error|fatal|denied|declined|reject/i.test(x)) || lines.find((x) => /^ERROR:/.test(x))
    || lines.find((x) => /^fatal:/.test(x)) || lines.find((x) => /^error:/.test(x)) || remote[0] || lines[0] || '原因不明').slice(0, 160)
}

function gitRun(args, { timeout, net = false, env = null, input } = {}) {
  const base = net ? netEnv() : process.env
  const r = spawnSync('git', args, { cwd: HOME, encoding: 'utf8', timeout, input, env: env ? { ...base, ...env } : base, windowsHide: true, maxBuffer: 256 * 1024 * 1024 })
  const raw = r.error ? (r.error.code === 'ETIMEDOUT' ? `超时（${Math.round(timeout / 1000)} 秒）` : r.error.message) : `${r.stderr || ''}\n${r.stdout || ''}`
  return { ok: !r.error && r.status === 0, out: (r.stdout || '').trim(), stdout: r.stdout || '', raw, err: gitErr(raw) }
}

function currentBranch() { return (git(['symbolic-ref', '--short', '-q', 'HEAD']) || '').trim() || null }
function refExists(ref) { return git(['rev-parse', '-q', '--verify', `${ref}^{commit}`]) !== null }
const revOf = (ref) => (git(['rev-parse', '-q', '--verify', `${ref}^{commit}`]) || '').trim() || null
const hasCommits = () => refExists('HEAD')
const rebaseInProgress = () => ['rebase-merge', 'rebase-apply'].some((d) => fs.existsSync(path.join(HOME, '.git', d)))

// 进程被强行杀掉时 git 留下的锁文件：超过 2 分钟（比任何一次 git 操作的超时都长）还在，就是没人用的，删掉
function clearStaleGitLocks() {
  const g = path.join(HOME, '.git')
  if (!fs.existsSync(g)) return
  const files = ['index.lock', 'HEAD.lock', 'packed-refs.lock', 'config.lock', 'shallow.lock'].map((x) => path.join(g, x))
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.lock')) files.push(p)
    }
  }
  try { walk(path.join(g, 'refs')) } catch {}
  try { for (const x of fs.readdirSync(g)) if (/^learn-merge-\d+\.index/.test(x)) files.push(path.join(g, x)) } catch {}
  for (const f of files) {
    try { if (Date.now() - fs.statSync(f).mtimeMs > 120000) fs.rmSync(f, { force: true }) } catch {}
  }
}

// 本脚本不再用 rebase 合并；数据目录停在 rebase 中间（旧版脚本或手动 git 留下的）就退回去，退不回去就不往下写
function recoverRebase() {
  if (!rebaseInProgress()) return
  git(['rebase', '--abort'])
  if (rebaseInProgress()) git(['rebase', '--quit'])
  if (rebaseInProgress()) fail(`学习记录停在 git 合并到一半的状态，自动退回失败，这次没有记录。把这句话告诉用户：需要在 ${HOME} 里手动处理（git status 查看）。`)
  warnings.push('学习记录之前停在 git 合并到一半的状态，已退回合并前的样子。')
}

// 这台比同步仓库多几条、少几条记录
function aheadBehind(rref) {
  const out = git(['rev-list', '--left-right', '--count', `HEAD...${rref}`])
  if (!out) return null
  const [ahead, behind] = out.trim().split(/\s+/).map(Number)
  return { ahead, behind }
}

// 要不要推：null 不用推；{ push: true } 要推；{ why } 推不了及原因
function pushState() {
  const conf = syncConf()
  if (!conf || !hasCommits()) return null
  if (rebaseInProgress() || !currentBranch()) return { why: '学习记录不在正常的分支上（可能是 git 操作被打断），先运行 learn sync 看情况' }
  if ((git(['--no-optional-locks', 'status', '--porcelain', '--ignore-submodules=dirty']) || '').trim()) return { why: `有改动没能提交进 git${commitError ? `（${commitError}）` : ''}` }
  const rref = `origin/${conf.branch}`
  if (!refExists(rref)) return { push: true }
  return (aheadBehind(rref)?.ahead || 0) > 0 ? { push: true } : null
}
const needsPush = () => pushState()?.push === true

function courseLabel(name) {
  const c = loadIndex().courses?.[name]
  return c?.title ? `「${c.title}」（${name}）` : name
}

function sideSummary(range, dir) {
  const only = dir ? ['--', `${dir}`] : []
  const count = Number((git(['rev-list', '--count', range, ...only]) || '0').trim())
  const recent = (git(['log', '--format=%s', '-n', '3', range, ...only]) || '').split('\n').filter(Boolean)
    .map((x) => x.replace(/^[a-z0-9][a-z0-9-]*: /, '').slice(0, 40))
  return { count, recent }
}

function describeConflict(rref, names) {
  return { at: isoLocal(), courses: names.map((name) => ({ name, local: sideSummary(`${rref}..HEAD`, name), remote: sideSummary(`HEAD..${rref}`, name) })) }
}

function conflictText(c) {
  const side = (x) => `${x.count} 条${x.recent.length ? `（最近：${x.recent.join(' | ')}）` : ''}`
  const names = (c.courses || []).map((x) => courseLabel(x.name)).join('、')
  return `⚠ 同步冲突：${names} 在这台电脑和同步仓库里都记了新内容，合不到一起。其他课程和画像不用选，选完一起合并；选之前，这台看不到仓库里的新记录，这台新记的也推不上去。\n`
    + (c.courses || []).map((x) => `  ${courseLabel(x.name)}：这台多出 ${side(x.local)}；仓库多出 ${side(x.remote)}`).join('\n')
    + '\n先把两边各记了什么告诉用户，问留哪边；选完再继续学：\n'
    + `  learn sync --keep remote：${names} 用仓库里的，这台多出的那些存进备份分支，不会丢\n`
    + `  learn sync --keep local：${names} 用这台的，仓库里多出的那些存进备份分支，不会丢`
}

const isTransient = (raw) => /cannot lock ref|unable to create '.*\.lock'|index\.lock/i.test(raw)

function fetchOrigin(timeout = 15000) {
  const run = () => gitRun(['fetch', '-q', '--prune', 'origin'], { timeout, net: true })
  let f = run()
  if (!f.ok && isTransient(f.raw)) { sleepMs(500); f = run() }
  return f
}

// ---- 按内容合并 index.json 和 profile.json ----
// ours 是仓库那边，theirs 是这台

// 课程列表：两边的课程都留，同一门课取最近活动的那份；当前课程跟这台走
function mergeIndex(base, ours, theirs) {
  if (ours === null || theirs === null) return null
  if (!ours || !theirs) return ours || theirs || null
  const out = { ...ours, courses: { ...(ours.courses || {}) } }
  for (const [k, v] of Object.entries(theirs.courses || {})) {
    const o = out.courses[k]
    if (!o || String(v.lastActive || '') > String(o.lastActive || '')) out.courses[k] = v
  }
  out.current = theirs.current || ours.current
  return out
}

const evKey = (e) => [e.type, e.level, e.at, e.course, e.ref, e.detail].join('\u0001')

// 证据的先后：日期 → 记录时刻 ts（UTC，旧数据没有，算最早）→ 编号 → id。
// 不靠数组顺序，也不只靠编号（两台电脑各自从同一个编号往下记），在哪台电脑上合并结果都一样
const evOrder = (a, b) => a.at.localeCompare(b.at) || (a.ts || '').localeCompare(b.ts || '')
  || parseInt(a.id.slice(1), 10) - parseInt(b.id.slice(1), 10) || a.id.localeCompare(b.id)

// 每个技能最多留 MAX_EVIDENCE 条：先丢最旧的自述，再丢最旧的非结业证据；keep 里的（两边新记的）不丢，裁不下就多留
function trimEvidence(sk, keep = new Set()) {
  sk.evidence.sort(evOrder)
  while (sk.evidence.length > MAX_EVIDENCE) {
    const pick = (f) => sk.evidence.findIndex((x) => !keep.has(evKey(x)) && f(x))
    let i = pick((x) => x.type === 'self')
    if (i < 0) i = pick((x) => x.type !== 'course')
    if (i < 0) break
    sk.evidence.splice(i, 1)
  }
}

// 画像三方合并（基线是两边的分叉点）：两边新加的证据都留；基线里有、任一边删掉的去掉；技能剩不下证据才删。
// 以这台为底；开了同步后新记的 id 带电脑标记，一般撞不上。两边同一个编号记的是不同的证据（开同步前各自记的）：
// 两条都换新号，旧号作废（按旧号删会被拒、列出现在的编号），不会删错。
// 暂停：只有一边改了就听那边的，两边都改了以暂停为准
function mergeProfile(base, ours, theirs) {
  if (base === null || ours === null || theirs === null) return null
  const blank = () => ({ ...emptyProfile(), enabled: base ? base.enabled !== false : true })
  ours = ours ?? blank()
  theirs = theirs ?? blank()
  if (!validProfile(ours) || !validProfile(theirs) || (base && !validProfile(base))) return null
  const key = (sk) => canonKey(sk.name)
  const bSk = new Map((base?.skills || []).map((sk) => [key(sk), sk]))
  const oSk = new Map(ours.skills.map((sk) => [key(sk), sk]))
  const tSk = new Map(theirs.skills.map((sk) => [key(sk), sk]))
  const seq = { s: Math.max(ours.seq.s, theirs.seq.s), e: Math.max(ours.seq.e, theirs.seq.e), v: Math.max(ours.seq.v || 0, theirs.seq.v || 0) }
  const usedS = new Set(theirs.skills.map((sk) => sk.id))
  const newId = (used, k) => {
    let n
    do { seq[k] += 1; n = `${k}${seq[k]}${idTag()}` } while (used.has(n))
    used.add(n)
    return n
  }
  const fresh = (used, id, k) => {
    if (!used.has(id)) { used.add(id); return id }
    return newId(used, k)
  }
  const allEv = (p) => p.skills.flatMap((sk) => sk.evidence)
  const tKey = new Map(allEv(theirs).map((e) => [e.id, evKey(e)]))
  const clash = new Set(allEv(ours).filter((e) => tKey.has(e.id) && tKey.get(e.id) !== evKey(e)).map((e) => e.id))
  const usedE = new Set([...tKey.keys(), ...allEv(ours).map((e) => e.id)])
  const eid = (e) => (clash.has(e.id) ? newId(usedE, 'e') : e.id)
  const skills = []
  for (const k of new Set([...tSk.keys(), ...oSk.keys()])) {
    const b = bSk.get(k)
    const o = oSk.get(k)
    const t = tSk.get(k)
    const bEv = new Set((b?.evidence || []).map(evKey))
    const oEv = new Set((o?.evidence || []).map(evKey))
    const tEv = new Set((t?.evidence || []).map(evKey))
    const seen = new Set()
    const evs = []
    for (const e of t?.evidence || []) {
      if ((bEv.has(evKey(e)) && !oEv.has(evKey(e))) || seen.has(evKey(e))) continue // 仓库那边删了
      seen.add(evKey(e))
      evs.push({ ...e, id: eid(e) })
    }
    for (const e of o?.evidence || []) {
      if ((bEv.has(evKey(e)) && !tEv.has(evKey(e))) || seen.has(evKey(e))) continue // 这台删了
      seen.add(evKey(e))
      evs.push({ ...e, id: eid(e) })
    }
    if (!evs.length) continue
    const sk = t ? { ...t } : { ...o, id: fresh(usedS, o.id, 's') }
    sk.evidence = evs.sort(evOrder)
    sk.aliases = [...new Set([...(t?.aliases || []), ...(o?.aliases || [])])]
    const used = [t?.lastUsedAt, o?.lastUsedAt].filter(Boolean).sort()
    if (used.length) sk.lastUsedAt = used[used.length - 1]
    trimEvidence(sk, new Set(evs.map(evKey).filter((x) => !bEv.has(x))))
    skills.push(sk)
  }
  const on = (p) => p.enabled !== false
  const oChanged = base ? on(ours) !== on(base) : true
  const tChanged = base ? on(theirs) !== on(base) : true
  const enabled = oChanged && tChanged ? on(ours) && on(theirs) : oChanged ? on(ours) : on(theirs)
  const later = [ours.updatedAt, theirs.updatedAt].filter(Boolean).sort()
  return { ...JSON.parse(JSON.stringify(theirs)), seq, skills, enabled, updatedAt: later[later.length - 1] || null }
}

function mergeJsonText(file, baseT, oursT, theirsT) {
  const parse = (t) => {
    if (t === undefined || t === null || !String(t).trim()) return undefined
    try { return JSON.parse(t) } catch { return null }
  }
  const [b, o, t] = [parse(baseT), parse(oursT), parse(theirsT)]
  if (file === 'index.json') return mergeIndex(b, o, t)
  if (file === 'profile.json') return mergeProfile(b, o, t)
  return null
}

// 一个提交里的全部文件：路径 → { mode, sha }
function treeFiles(rev) {
  const m = new Map()
  if (!rev) return m
  const r = gitRun(['ls-tree', '-r', '-z', '--full-tree', rev])
  for (const rec of r.stdout.split('\0').filter(Boolean)) {
    const tab = rec.indexOf('\t')
    const [mode, , sha] = rec.slice(0, tab).split(' ')
    if (!isJunk(rec.slice(tab + 1))) m.set(rec.slice(tab + 1), { mode, sha })
  }
  return m
}

// 算出「这台 + 仓库」合起来的样子，不动工作区和分支。
// 课程目录整门课地比：只有一边改了取那边；两边改得一样随便取；两边都改了、内容不同，算冲突
// （chosen 里的课程是用户已经选过的，按 prefer 取那一边）。根目录：index.json、profile.json 按内容合，
// .gitignore 取两边的并集，其他文件哪边改了取哪边。
// 返回 { ok: true, tree, head, other } / { ok: false, courses } / { ok: false, err }
function planMerge(rref, { prefer = null, chosen = [] } = {}) {
  const head = revOf('HEAD')
  const other = revOf(rref)
  const base = (git(['merge-base', head, other]) || '').trim() || null
  const B = treeFiles(base)
  const L = treeFiles(head)
  const R = treeFiles(other)
  const topOf = (p) => (p.includes('/') ? p.split('/')[0] : null)
  const sub = (M, d) => new Map([...M].filter(([p]) => p.startsWith(`${d}/`)))
  const same = (x, y) => x.size === y.size && [...x].every(([p, v]) => y.get(p)?.sha === v.sha && y.get(p)?.mode === v.mode)
  const result = new Map()
  const conflicts = []
  const dirs = new Set([...B.keys(), ...L.keys(), ...R.keys()].map(topOf).filter(Boolean))
  for (const d of dirs) {
    const b = sub(B, d)
    const l = sub(L, d)
    const r = sub(R, d)
    let pick
    if (same(l, r) || same(b, r)) pick = l // 两边一样，或者只有这台改了
    else if (same(b, l)) pick = r // 只有仓库那边改了
    else if (chosen.includes(d)) pick = prefer === 'remote' ? r : l
    else { conflicts.push(d); continue }
    for (const [p, v] of pick) result.set(p, v)
  }
  if (conflicts.length) return { ok: false, courses: conflicts.sort() }
  const blob = (M, p) => (M.has(p) ? (git(['cat-file', 'blob', M.get(p).sha]) ?? undefined) : undefined)
  const hash = (text) => gitRun(['hash-object', '-w', '--stdin'], { input: text }).out
  const eq = (x, y) => (x?.sha ?? null) === (y?.sha ?? null)
  const roots = new Set([...B.keys(), ...L.keys(), ...R.keys()].filter((p) => !p.includes('/')))
  for (const p of roots) {
    const b = B.get(p)
    const l = L.get(p)
    const r = R.get(p)
    if (eq(l, r) || eq(b, r)) { if (l) result.set(p, l); continue }
    if (eq(b, l)) { if (r) result.set(p, r); continue }
    let text
    if (p === 'index.json' || p === 'profile.json') {
      const merged = mergeJsonText(p, blob(B, p), blob(R, p), blob(L, p))
      if (!merged) return { ok: false, err: `${p} 两边的内容合不上（有一边不是有效的 JSON）` }
      text = JSON.stringify(merged, null, 2) + '\n'
    } else if (p === '.gitignore') {
      const lines = [...(blob(L, p) || '').split(/\r?\n/), ...(blob(R, p) || '').split(/\r?\n/)].filter(Boolean)
      text = [...new Set(lines)].join('\n') + '\n'
    } else { result.set(p, l || r); continue }
    result.set(p, { mode: '100644', sha: hash(text) })
  }
  // 用户选过的课程，课程列表里那一条也取选的那边（标题等跟着课程走）
  if (chosen.length && result.has('index.json')) {
    try {
      const idx = JSON.parse(git(['cat-file', 'blob', result.get('index.json').sha]))
      const side = JSON.parse(blob(prefer === 'remote' ? R : L, 'index.json') || '{}')
      let changed = false
      for (const c of chosen) {
        if (side.courses?.[c] && JSON.stringify(idx.courses?.[c]) !== JSON.stringify(side.courses[c])) { idx.courses[c] = side.courses[c]; changed = true }
      }
      if (changed) result.set('index.json', { mode: '100644', sha: hash(JSON.stringify(idx, null, 2) + '\n') })
    } catch {}
  }
  // 合并结果里已经没有这门课的目录（一边删了课、另一边没动，或者选的那边没有这门课）：课程清单里也去掉
  if (result.has('index.json')) {
    try {
      const idx = JSON.parse(git(['cat-file', 'blob', result.get('index.json').sha]))
      const gone = Object.keys(idx.courses || {}).filter((c) => !result.has(`${c}/state.json`))
      if (gone.length) {
        for (const c of gone) delete idx.courses[c]
        if (gone.includes(idx.current)) idx.current = null
        result.set('index.json', { mode: '100644', sha: hash(JSON.stringify(idx, null, 2) + '\n') })
      }
    } catch {}
  }
  // 用临时的暂存区拼出目录树
  const tmpIndex = path.join(HOME, '.git', `learn-merge-${process.pid}.index`)
  try {
    const env = { GIT_INDEX_FILE: tmpIndex }
    gitRun(['read-tree', '--empty'], { env })
    const info = [...result].map(([p, v]) => `${v.mode} ${v.sha}\t${p}\0`).join('')
    const u = gitRun(['update-index', '-z', '--index-info'], { env, input: info })
    if (!u.ok) return { ok: false, err: u.err }
    const w = gitRun(['write-tree'], { env })
    if (!w.ok) return { ok: false, err: w.err }
    return { ok: true, tree: w.out, head, other }
  } finally {
    fs.rmSync(tmpIndex, { force: true })
  }
}

// 拉下来或合并后工作区变了：当前课程链接、画像备份跟着更新
// （备份还是旧画像的话，画像文件坏了恢复时会把别的电脑删掉的条目带回来）
function afterTreeChange() {
  relinkCurrent()
  try {
    if (!fs.existsSync(PROFILE)) fs.rmSync(PROFILE_BAK, { force: true })
    else if (validProfile(readJson(PROFILE))) fs.copyFileSync(PROFILE, PROFILE_BAK)
  } catch {}
}

// 工作区现在的样子（按 .gitignore），存成一棵目录树，不动暂存区
function worktreeTree() {
  const tmp = path.join(HOME, '.git', `learn-merge-${process.pid}.index`)
  try {
    const env = { GIT_INDEX_FILE: tmp }
    if (!gitRun(['read-tree', 'HEAD'], { env }).ok || !gitRun(['add', '-A'], { env }).ok) return null
    const w = gitRun(['write-tree'], { env })
    return w.ok ? w.out : null
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

// 把做到一半的合并补完：工作区和暂存区换成合并结果，再挪分支。
// 工作区里既不是合并前、也不是合并结果的内容，先存进备份分支。返回 { ok, backup } / { ok: false, err }
function finishMerge(m) {
  const wt = worktreeTree()
  if (!wt) return { ok: false, err: '读不了工作区' }
  const H = treeFiles(m.head)
  const C = treeFiles(m.commit)
  const W = treeFiles(wt)
  const odd = [...new Set([...H.keys(), ...C.keys(), ...W.keys()])].some((p) => {
    const w = W.get(p)?.sha ?? null
    return w !== (H.get(p)?.sha ?? null) && w !== (C.get(p)?.sha ?? null)
  })
  let backup = null
  if (odd) {
    const bc = gitRun([...idArgs(), 'commit-tree', wt, '-p', m.head, '-m', '合并被打断时工作区里的内容'])
    if (!bc.ok) return { ok: false, err: bc.err }
    backup = `backup/interrupted-${stamp()}`
    git(['branch', '-f', backup, bc.out])
  }
  const r = gitRun(['read-tree', '--reset', '-u', m.commit])
  if (!r.ok) return { ok: false, err: r.err }
  const u = gitRun(['update-ref', '-m', 'learn: 补完被打断的合并', 'HEAD', m.commit, m.head])
  if (!u.ok) return { ok: false, err: u.err }
  fs.rmSync(MERGE_MARK, { force: true })
  committed = true
  afterTreeChange()
  return { ok: true, backup }
}

// 上次合并做到一半（进程被杀、断电）：补完它。分支已经挪过去了（或者早就不是那次合并了）就只删记号
function recoverMerge() {
  if (!fs.existsSync(MERGE_MARK)) return
  let m = null
  try { m = readJson(MERGE_MARK) } catch {}
  if (!m?.head || !m?.commit || revOf('HEAD') !== m.head || !refExists(m.commit)) { fs.rmSync(MERGE_MARK, { force: true }); return }
  const f = finishMerge(m)
  if (!f.ok) fail(`学习记录停在同步合并到一半的状态，自动补完失败（${f.err}），这次没有记录。把这句话告诉用户：需要在 ${HOME} 里手动处理（git status 查看）。`)
  warnings.push(`上次合并同步记录时被打断，已经补完。${f.backup ? `当时工作区里另有改动，存在备份分支 ${f.backup}。` : ''}`)
}

// 把算好的结果落下来：生成合并提交（两个父提交：这台、仓库），先改工作区再挪分支。
// 动手前在 .git 里留个记号，中途被打断时下一条命令先把合并补完（recoverMerge）。返回 null 或出错原因
function applyMerge(plan, msg) {
  const c = gitRun([...idArgs(), 'commit-tree', plan.tree, '-p', plan.head, '-p', plan.other, '-m', msg])
  if (!c.ok) return c.err
  const m = { head: plan.head, commit: c.out }
  writeJson(MERGE_MARK, m)
  const u = gitRun(['read-tree', '-m', '-u', plan.head, c.out])
  if (!u.ok) {
    // 一般是 git 检查不过、什么都没动；万一动了一半，补完它
    if (!(git(['status', '--porcelain', '--ignore-submodules=dirty']) || '').trim()) { fs.rmSync(MERGE_MARK, { force: true }); return u.err }
    const f = finishMerge(m)
    if (!f.ok) return u.err
    if (f.backup) warnings.push(`合并时工作区里另有改动，存在备份分支 ${f.backup}。`)
    return null
  }
  const r = gitRun(['update-ref', '-m', `learn: ${msg}`, 'HEAD', c.out, plan.head])
  if (!r.ok) {
    // 分支挪不过去：工作区退回合并前，和分支对上；退不回去就留着记号，下一条命令补完合并
    if (gitRun(['read-tree', '-m', '-u', c.out, plan.head]).ok) fs.rmSync(MERGE_MARK, { force: true })
    return r.err
  }
  fs.rmSync(MERGE_MARK, { force: true })
  committed = true
  afterTreeChange()
  return null
}

// 合并仓库里的新记录（这台也有新记录时）。返回 { ok: true } / { ok: false, courses } / { ok: false, err }
function mergeRemote(rref, opts = {}) {
  const plan = planMerge(rref, opts)
  if (!plan.ok) return plan
  const err = applyMerge(plan, '同步：合并另一台电脑的记录')
  return err ? { ok: false, err } : { ok: true }
}

// 把同步仓库里新的记录拉下来
function syncPull() {
  const conf = syncConf()
  if (!conf) return
  commitAll('同步前保存这台电脑上的改动')
  // 课程目录里放了别的 git 工作副本、里面有改动：学习记录的 git 提交不了它，不算没提交（--ignore-submodules=dirty）
  if ((git(['status', '--porcelain', '--ignore-submodules=dirty']) || '').trim()) {
    syncNotes.push(`⚠ 同步：这台有改动没能提交进 git${commitError ? `（${commitError}）` : ''}，这次没拉，免得冲掉。把这句话告诉用户。`)
    return
  }
  updateSync({ lastTryAt: isoLocal() })
  const f = fetchOrigin()
  if (!f.ok) {
    if (!isTransient(f.raw)) updateSync({ pullError: f.err })
    syncNotes.push(`同步：这次没连上同步仓库（${f.err}），用的是这台电脑上的进度，联网后会自动补上。`)
    return
  }
  updateSync({ pullError: null, lastPullAt: isoLocal(), needPull: false })
  const rref = `origin/${conf.branch}`
  if (!refExists(rref)) { // 仓库里还没有记录（或删掉重建了）：谈不上冲突，等推上去
    if (loadSync().conflict) updateSync({ conflict: null })
    return
  }
  if (!currentBranch()) { syncNotes.push('⚠ 同步：学习记录不在正常分支上，这次没合并。把这句话告诉用户。'); return }
  if (!hasCommits()) {
    gitRun(['reset', '-q', '--hard', rref])
    git(['branch', `--set-upstream-to=${rref}`])
    afterTreeChange()
    return
  }
  const ab = aheadBehind(rref)
  if (!ab) return
  if (!ab.behind) { if (loadSync().conflict) updateSync({ conflict: null }); return }
  if (!ab.ahead) {
    const r = gitRun([...idArgs(), 'merge', '-q', '--ff-only', rref])
    if (!r.ok) { syncNotes.push(`⚠ 同步：拉下来的记录没能合进来（${r.err}），这次用的是这台电脑上的进度。`); return }
    afterTreeChange()
    updateSync({ conflict: null })
    syncNotes.push(`同步：拉到了 ${ab.behind} 条在别的电脑上记的记录。`)
    return
  }
  const rr = mergeRemote(rref)
  if (rr.ok) {
    updateSync({ conflict: null })
    syncNotes.push(`同步：拉到了 ${ab.behind} 条在别的电脑上记的记录，和这台的 ${ab.ahead} 条合在一起了。`)
    return
  }
  if (!rr.courses) { syncNotes.push(`⚠ 同步：合并没成功（${rr.err}），这次用的是这台电脑上的进度，下次再试。`); return }
  const c = describeConflict(rref, rr.courses)
  updateSync({ conflict: c })
  syncNotes.push(conflictText(c))
}

// 后台推，不让用户等：只推这条命令写完时的那个提交（后台进程不拿数据锁，推当时的 HEAD 可能推到别的命令写了一半的状态）。
// 测试里设 LEARN_SYNC_FOREGROUND=1 当场推
function startPush() {
  if (process.env.LEARN_SYNC_FOREGROUND === '1') { pushNow({ wait: 35000 }); return }
  const sha = revOf('HEAD')
  if (!sha) return
  try { spawn(process.execPath, [SELF, '_push', sha], { cwd: HOME, detached: true, stdio: 'ignore', windowsHide: true, env: process.env }).unref() } catch {}
}

// 推到同步仓库。返回 null 表示推上去了（或没有要推的），否则返回没推上去的原因。
// wait：另一个进程正在推时最多等多久（毫秒）；0 表示后台推：不等，推不了也不记错误，交给前台命令。
// sha：后台推时只推这个提交（前台命令拿着数据锁，推当时的 HEAD）
function pushNow({ wait = 0, sha: only = null } = {}) {
  const deadline = Date.now() + wait
  let fd
  for (;;) {
    try { fd = fs.openSync(SYNC_LOCK, 'wx'); break } catch (e) {
      if (e.code !== 'EEXIST') return wait ? `写不了 ${SYNC_LOCK}：${e.message}` : null
      try { if (Date.now() - fs.statSync(SYNC_LOCK).mtimeMs > 90000) { fs.rmSync(SYNC_LOCK, { force: true }); continue } } catch {}
      if (Date.now() > deadline) return wait ? '另一个学习窗口正在推送，稍后运行 learn sync 确认' : null
      sleepMs(200)
    }
  }
  try {
    // 推的时候又有新提交：推完再看一眼（只推指定提交时推一次就够）
    for (let i = 0; i < (only ? 1 : 3); i++) {
      const ps = pushState()
      if (!ps) { updateSync({ pushError: null }); return null }
      if (ps.why) return wait ? ps.why : null
      const conf = syncConf()
      const sha = only || revOf('HEAD')
      if (!sha) return null
      if (only) {
        const rref = `origin/${conf.branch}`
        if (git(['merge-base', '--is-ancestor', only, 'HEAD']) === null) return null // 分支上已经没有这个提交
        if (refExists(rref) && git(['merge-base', '--is-ancestor', only, rref]) !== null) return null // 仓库里已经有了
      }
      const r = gitRun([...noHooks(), '-c', 'push.gpgSign=false', 'push', '-q', 'origin', `${sha}:refs/heads/${conf.branch}`], { timeout: 30000, net: true })
      if (!r.ok) {
        const rejected = /\[rejected\]|non-fast-forward|fetch first/i.test(r.raw)
        const why = rejected ? '同步仓库里有别的电脑新推的记录，要先拉下来' : r.err
        updateSync(rejected ? { pushError: why, needPull: true } : { pushError: why })
        return why
      }
      updateSync({ pushError: null, lastPushAt: isoLocal() })
    }
    return null
  } finally {
    fs.closeSync(fd)
    fs.rmSync(SYNC_LOCK, { force: true })
  }
}

function localHasData() {
  let skills = 0
  try { skills = loadProfile().skills.length } catch {}
  return Object.keys(loadIndex().courses || {}).length > 0 || skills > 0
}

function dataSummary() {
  const n = Object.keys(loadIndex().courses || {}).length
  let k = 0
  try { k = loadProfile().skills.length } catch {}
  return `${n} 门课，画像 ${k} 个技能`
}

const stamp = () => isoLocal().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')

// 仓库里的东西是不是学习记录：根目录的 index.json 是课程清单，每个子目录都是一门课
function looksLikeLearning(rref) {
  let idx = null
  try { idx = JSON.parse(git(['show', `${rref}:index.json`]) || 'null') } catch {}
  if (!idx || typeof idx !== 'object' || idx.version !== VERSION || !idx.courses || typeof idx.courses !== 'object') return false
  const dirs = (git(['ls-tree', '-d', '--name-only', rref]) || '').split('\n').filter(Boolean)
  return dirs.every((d) => git(['cat-file', '-e', `${rref}:${d}/state.json`]) !== null)
}

// learn sync --remote <地址>：连同步仓库。中途失败就退回连之前的样子（原来连着别的仓库的，照旧连着）
function syncSetup(url) {
  if (/^[a-z+]+:\/\/[^/]*@/i.test(url) && !/^ssh:\/\//i.test(url)) fail('仓库地址里不要带用户名、密码或 token。用 git@github.com:<用户名>/<仓库名>.git、ssh://git@github.com/<用户名>/<仓库名>.git 或 https://github.com/<用户名>/<仓库名>.git，登录交给这台电脑的 git')
  if (git(['--version']) === null) fail('这台电脑没有 git，装好 git 再连同步仓库')
  const old = (git(['config', '--get', 'remote.origin.url']) || '').trim() || null
  const brStart = currentBranch()
  const upstream = brStart ? ['remote', 'merge'].map((k) => [`branch.${brStart}.${k}`, (git(['config', '--get', `branch.${brStart}.${k}`]) || '').trim() || null]) : []
  const prevSync = loadSync()
  const prevRefs = (git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes/origin']) || '').split('\n').filter(Boolean).map((x) => x.split(' '))
  const undoRemote = () => {
    for (const ref of (git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin']) || '').split('\n').filter(Boolean)) git(['update-ref', '-d', ref])
    for (const [ref, sha] of prevRefs) git(['update-ref', ref, sha])
    if (old) gitRun(['remote', 'set-url', 'origin', old]); else gitRun(['remote', 'remove', 'origin'])
    writeJson(SYNC_FILE, prevSync)
    syncCache = undefined
  }
  if (old) gitRun(['remote', 'set-url', 'origin', url])
  else gitRun(['remote', 'add', 'origin', url])
  // 以前连过的仓库留下的远程分支记录先清掉，免得拿旧仓库的状态做判断
  for (const [ref] of prevRefs) git(['update-ref', '-d', ref])
  const f = fetchOrigin(30000)
  if (!f.ok) {
    undoRemote()
    fail(`连不上同步仓库：${f.err}\n检查：地址对不对、仓库是不是你的私有库、这台电脑的 git 能不能登录 GitHub（终端里运行 git ls-remote ${safeUrl(url)} 试试）。修好后再运行一次。`)
  }
  const branches = (git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']) || '')
    .split('\n').map((x) => x.trim()).filter((x) => x.startsWith('origin/') && x !== 'origin/HEAD')
  const local = currentBranch() || 'main'
  const rb = !branches.length ? local
    : branches.includes(`origin/${local}`) ? local
      : (['main', 'master'].find((b) => branches.includes(`origin/${b}`)) || branches[0].slice('origin/'.length))
  const rref = `origin/${rb}`
  if (branches.length && !looksLikeLearning(rref)) {
    undoRemote()
    fail('这个仓库里已经有别的内容，不是学习记录，没有连。换一个新建的空私有仓库再试（建仓库时什么都别勾，不要自动生成 README）。')
  }
  // 开同步：画像开始进 git。中途失败就退回连之前的样子
  const headBefore = revOf('HEAD')
  let headSetup = null // 「连上同步仓库」那次提交之后
  let renamed = null // 分支改过名：{ from, backup }
  const pausedHere = fs.existsSync(PROFILE) && loadProfile().enabled === false
  updateSync({ enabled: true, url, branch: rb, conflict: null, needPull: false, pullError: null, pushError: null, lastTryAt: isoLocal(), lastPullAt: isoLocal() })
  syncCache = undefined
  const rollback = (why) => {
    // 合并进来的别的电脑的课程先从工作区退掉，再退回连之前的提交（没提交的改动留在工作区）
    if (headSetup && revOf('HEAD') !== headSetup) gitRun(['read-tree', '-m', '-u', 'HEAD', headSetup])
    if (headBefore) git(['reset', '-q', '--mixed', headBefore])
    else { git(['update-ref', '-d', 'HEAD']); git(['read-tree', '--empty']) }
    if (renamed) {
      git(['branch', '-M', renamed.from])
      if (renamed.backup) { git(['branch', '-f', renamed.to, renamed.backup]); git(['branch', '-D', renamed.backup]) }
    }
    undoRemote()
    for (const [k, v] of upstream) { if (v) git(['config', k, v]); else git(['config', '--unset', k]) }
    ensureHome()
    afterTreeChange()
    fail(`${why}\n这次没有连上，${prevSync.enabled ? '还是连着原来的仓库' : '没有开同步'}；修好后再运行一次。`)
  }
  ensureHome()
  commitAll('连上同步仓库：画像和进度一起同步')
  headSetup = revOf('HEAD')
  const tail = '之后每次开场自动拉、每次记录自动推；收尾时会说推没推上去。'
  if (!branches.length) {
    // 仓库是空的：把这台的记录推上去
    if (!hasCommits()) gitRun([...idArgs(), 'commit', '-q', '--allow-empty', '-m', '建立学习记录'])
    const why = pushNow({ wait: 35000 })
    if (why) rollback(`连上了，但没推上去：${why}`)
    git(['branch', `--set-upstream-to=${rref}`])
    return `已连上同步仓库，这台电脑的进度和画像都推上去了（${dataSummary()}）。${tail}\n另一台电脑装好学习教练后，对它说「连上同步仓库 ${safeUrl(url)}」。`
  }
  if (!localHasData()) {
    // 这台还没学过：直接用仓库里的；用户在这台说过暂停画像的，保持暂停
    if (hasCommits()) git(['branch', '-f', `backup/local-${stamp()}`, 'HEAD'])
    git(['symbolic-ref', 'HEAD', `refs/heads/${rb}`])
    const r = gitRun(['reset', '-q', '--hard', rref])
    if (!r.ok) rollback(`拉取失败：${r.err}`)
    git(['branch', `--set-upstream-to=${rref}`])
    if (local !== rb && refExists(`refs/heads/${local}`)) git(['branch', '-D', local])
    ensureHome()
    afterTreeChange()
    let paused = ''
    if (pausedHere && loadProfile().enabled !== false) {
      withProfile((p) => { p.enabled = false })
      commitAll('画像：保持暂停')
      startPush()
      paused = '画像按你在这台电脑上说的保持暂停。'
    }
    return `已连上同步仓库，把仓库里的进度和画像拉到了这台电脑（${dataSummary()}）。${paused}${tail}`
  }
  // 两边都有记录：分支名跟仓库对齐，再试着合
  if (local !== rb) {
    renamed = { from: local, to: rb, backup: null }
    if (refExists(`refs/heads/${rb}`)) { renamed.backup = `backup/local-${rb}-${stamp()}`; git(['branch', '-f', renamed.backup, rb]) }
    git(['branch', '-M', rb])
  }
  git(['branch', `--set-upstream-to=${rref}`])
  // 推不上去：只是另一台刚推过（要先拉）就保持连着、之后自动拉了再推；仓库拒收、没权限等就退回连之前的样子
  const pushOrRollback = () => {
    const why = pushNow({ wait: 35000 })
    if (why && !loadSync().needPull) rollback(`连上了，但没推上去：${why}`)
    return why
  }
  const ab = aheadBehind(rref)
  if (ab && !ab.ahead && !ab.behind) return `已连上同步仓库，这台电脑和同步仓库已经一致（${dataSummary()}）。${tail}`
  if (ab && !ab.ahead) {
    gitRun([...idArgs(), 'merge', '-q', '--ff-only', rref])
    afterTreeChange()
    return `已连上同步仓库，拉到了 ${ab.behind} 条在别的电脑上记的记录（${dataSummary()}）。${tail}`
  }
  if (ab && !ab.behind) {
    const why = pushOrRollback()
    return `已连上同步仓库，${why ? `但这台多出的 ${ab.ahead} 条没推上去（${why}），之后会自动重试` : `把这台多出的 ${ab.ahead} 条记录推上去了`}（${dataSummary()}）。${tail}`
  }
  const rr = mergeRemote(rref)
  if (rr.ok) {
    const why = pushOrRollback()
    return `已连上同步仓库，这台电脑和仓库里原有的记录合在一起了（${dataSummary()}）。${why ? `但还没推上去（${why}），之后会自动重试。` : ''}${tail}`
  }
  if (!rr.courses) return `已连上同步仓库，但这次没合成（${rr.err}），之后会自动再试。${tail}`
  const c = describeConflict(rref, rr.courses)
  updateSync({ conflict: c })
  return `已连上同步仓库，但有课程两边都有记录、合不到一起。\n${conflictText(c)}`
}

// learn sync --keep local|remote：冲突的课程留哪边；其余课程和画像照常合并。被替换掉的那份存进备份分支。
// 冲突名单变了（用户选之前两边又改了别的课）就什么都不动，报新名单让用户重新选
function syncKeep(which) {
  if (!['local', 'remote'].includes(which)) fail('--keep 只能是 local（用这台电脑的）或 remote（用同步仓库里的）')
  const conf = syncConf()
  const st = loadSync()
  if (!conf || !st.conflict) fail('现在没有同步冲突，不用选')
  commitAll('选边前保存这台电脑上的改动')
  const f = fetchOrigin()
  if (!f.ok) fail(`没连上同步仓库：${f.err}。联网后再选`)
  const rref = `origin/${conf.branch}`
  const full = refExists(rref) ? planMerge(rref) : { ok: true }
  if (!full.ok && !full.courses) fail(`合并没成功：${full.err}。这台的记录没动，稍后再试`)
  if (full.ok) {
    // 仓库删掉重建了，或者两边已经不冲突了：不用选，照常合并、推送
    updateSync({ conflict: null })
    syncPull()
    const why = loadSync().conflict ? null : pushNow({ wait: 35000 })
    return ['现在已经没有冲突的课程了，不用选，照常同步。', ...syncNotes.splice(0), why ? `这台的记录还没推上去（${why}），之后会自动重试。` : ''].filter(Boolean).join('\n')
  }
  const chosen = (st.conflict.courses || []).map((x) => x.name)
  if (full.courses.some((x) => !chosen.includes(x))) {
    const c = describeConflict(rref, full.courses)
    updateSync({ conflict: c })
    return `⚠ 冲突的课程变了，这次没有改动任何记录。把新的情况告诉用户，重新问留哪边：\n${conflictText(c)}`
  }
  const names = full.courses.map(courseLabel).join('、')
  const backup = `backup/${which === 'remote' ? 'local' : 'remote'}-${stamp()}`
  git(['branch', '-f', backup, which === 'remote' ? 'HEAD' : rref])
  const rr = mergeRemote(rref, { prefer: which, chosen: full.courses })
  if (!rr.ok) {
    git(['branch', '-D', backup])
    fail(`合并没成功：${rr.err || '原因不明'}。这台的记录没动，稍后再试`)
  }
  updateSync({ conflict: null, needPull: false })
  const why = pushNow({ wait: 35000 })
  return `已合好：${names}用${which === 'remote' ? '同步仓库里的' : '这台电脑的'}，其他课程和画像两边的都留着。被替换掉的那份存在备份分支 ${backup}，不会丢。${why ? `还没推上去（${why}），之后会自动重试。` : ''}`
}

// ---------- 会话 ----------

function lastSession(s) { return s.sessions[s.sessions.length - 1] }

// 有活动时保证存在一个打开的会话
function touchSession(s) {
  const t = isoLocal()
  const last = lastSession(s)
  if (last && !last.closed && hoursSince(last.lastActive || last.start) < SESSION_GAP_HOURS) {
    last.lastActive = t
    return last
  }
  const sess = { start: t, lastActive: t, end: null, summary: null, nextStart: null, closed: false }
  s.sessions.push(sess)
  return sess
}

// ---------- 计划辅助 ----------

function lesson(s, id) {
  const l = s.lessons.find((x) => x.id === id)
  if (!l) fail(`没有第 ${id} 节。现有：${s.lessons.map((x) => x.id).join(', ') || '无（先 set-plan）'}`)
  return l
}

function isDone(l) { return l.status === 'mastered' || l.status === 'skipped' }

function unmetRequires(s, l) {
  return (l.requires || []).filter((r) => {
    const p = s.lessons.find((x) => x.id === r)
    return p && !isDone(p)
  })
}

// 当前节：进行中且前置都学完（或用 --force 硬开始的）→ 需复习 → 未开始
function nextLesson(s) {
  const ready = (l) => unmetRequires(s, l).length === 0
  return s.lessons.find((l) => l.status === 'in_progress' && (ready(l) || l.forced))
    || s.lessons.find((l) => l.status === 'review' && ready(l))
    || s.lessons.find((l) => l.status === 'todo' && ready(l))
    || null
}

function checkRequires(l) {
  if (l.requires != null && (!Array.isArray(l.requires) || !l.requires.every(Number.isInteger))) fail(`第 ${l.id} 节 requires 必须是节号（整数）数组，如 [1,2]`)
}

// 是否直接或间接依赖某一节
function dependsOn(s, l, targetId, seen = new Set()) {
  for (const r of l.requires || []) {
    if (r === targetId) return true
    if (seen.has(r)) continue
    seen.add(r)
    const p = s.lessons.find((x) => x.id === r)
    if (p && dependsOn(s, p, targetId, seen)) return true
  }
  return false
}

function checkPlan(lessons) {
  const ids = new Set()
  for (const l of lessons) {
    if (!Number.isInteger(l.id) || l.id < 1) fail(`节 id 必须是正整数：${JSON.stringify(l.id)}`)
    if (ids.has(l.id)) fail(`节 id 重复：${l.id}`)
    ids.add(l.id)
    if (!l.title || typeof l.title !== 'string') fail(`第 ${l.id} 节缺少 title`)
    if (l.method != null && !METHODS.includes(l.method)) fail(`第 ${l.id} 节教法非法：${l.method}。可选：${METHODS.join(', ')}`)
    checkRequires(l)
  }
  for (const l of lessons) {
    for (const r of l.requires || []) if (!ids.has(r)) fail(`第 ${l.id} 节的前置 ${r} 不存在`)
  }
  // 依赖成环检查
  const state = new Map()
  const byId = new Map(lessons.map((l) => [l.id, l]))
  const visit = (id, trail) => {
    if (state.get(id) === 2) return
    if (state.get(id) === 1) fail(`前置关系成环：${[...trail, id].join(' → ')}`)
    state.set(id, 1)
    for (const r of byId.get(id).requires || []) visit(r, [...trail, id])
    state.set(id, 2)
  }
  for (const l of lessons) visit(l.id, [])
}

function stepProgress(l) {
  if (!l.steps || l.steps.length === 0) return null
  const i = l.steps.findIndex((x) => x.status !== 'done')
  if (i === -1) return { idx: l.steps.length, total: l.steps.length, step: null, next: null }
  return { idx: i + 1, total: l.steps.length, step: l.steps[i], next: l.steps[i + 1] || null }
}

function positionLine(s) {
  const l = nextLesson(s)
  if (!l) return s.finished ? '📍 已结业' : '📍 计划里没有可学的节（全部完成，或先 set-plan）'
  const p = stepProgress(l)
  let line = `📍 第 ${l.id} 节「${l.title}」${l.kind === 'prereq' ? '（先修）' : ''}`
  if (l.status !== 'in_progress') {
    const k = (l.steps || []).filter((x) => x.status === 'done').length
    if (l.status === 'todo' && k) return `${line} · 已暂停，做完 ${k}/${l.steps.length} 步`
    return `${line} · ${STATUS_NAMES[l.status]}`
  }
  if (!p) return `${line} · 还没拆步骤`
  if (!p.step) return `${line} · 步骤已全部完成，待检验判定`
  line += ` · 第 ${p.idx}/${p.total} 步：${p.step.title}`
  if (p.next) line += ` · 下一步：${p.next.title}`
  else line += ' · 这是最后一步'
  return line
}

function dueMistakes(s, onDate = dateLocal()) {
  return s.mistakes.filter((m) => !m.graduated && m.due <= onDate)
    .sort((a, b) => a.due.localeCompare(b.due))
}

// ---------- 学习者画像 ----------
// profile.json 只由本脚本写。档位不存，每次按证据现算：
//   验证类证据（题目验证 / 先修节通过 / 结业）按时间顺序：往上可以直接升，往下一次只降一档；
//   只有自述时封顶「会一点」；用户自己说得比验证结果低，以自述为准。

// 技能名归一：小写，去掉空白和 . - _，保留 + 和 #（C、C++、C# 不能并成一个）
function norm(name) { return String(name).toLowerCase().replace(/[\s._-]+/g, '') }
function canonKey(name) {
  const n = norm(name)
  const g = ALIAS_GROUPS.find((x) => x.includes(n))
  return g ? g[0] : n
}
function skillKeys(sk) { return [sk.name, ...(sk.aliases || [])].map(canonKey) }

function daysAgo(dateStr) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  return daysBetween(isoLocal(new Date(y, m - 1, d)))
}
// 今年的日期只写月-日，往年的写全
function shortDate(dateStr) {
  if (!dateStr) return ''
  return dateStr.slice(0, 4) === dateLocal().slice(0, 4) ? dateStr.slice(5, 10) : dateStr.slice(0, 10)
}

function emptyProfile() {
  return {
    _readme: '学习者画像，由 learn 脚本维护，不要手改。查看：learn profile；删一条：learn profile forget <id> --name <技能名>；暂停：learn profile off；清空：learn profile reset --confirm yes。画像和课程进度互不影响：清空画像不会改动课程进度。',
    version: 1, enabled: true, seq: { s: 0, e: 0, v: 0 }, skills: [], createdAt: isoLocal(), updatedAt: null,
  }
}

// 逐条校验脚本会读到的字段；任何一处不对都按损坏处理（走 .bak 恢复）
function validProfile(p) {
  if (!p || typeof p !== 'object' || p.version !== 1 || !Array.isArray(p.skills)) return false
  if (!p.seq || !Number.isInteger(p.seq.s) || !Number.isInteger(p.seq.e)) return false
  return p.skills.every((sk) => sk && typeof sk.id === 'string' && typeof sk.name === 'string'
    && (sk.aliases === undefined || Array.isArray(sk.aliases)) && Array.isArray(sk.evidence)
    && typeof (sk.lastUsedAt || sk.createdAt) === 'string'
    && sk.evidence.every((e) => e && typeof e.id === 'string' && /^e\d+[a-z]*$/.test(e.id) && Object.hasOwn(EVIDENCE_NAMES, e.type)
      && LEVELS.includes(e.level) && typeof e.at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e.at)))
}

// 读画像；坏了用 .bak 恢复。forWrite 时恢复不了就报错（不覆盖用户的文件）
function loadProfile({ forWrite = false } = {}) {
  if (!fs.existsSync(PROFILE)) return emptyProfile()
  try {
    const p = readJson(PROFILE)
    if (validProfile(p)) return p
  } catch {}
  try {
    const b = readJson(PROFILE_BAK)
    if (validProfile(b)) {
      writeJson(PROFILE, b)
      warnings.push('profile.json 已损坏，已用上一个版本（profile.json.bak）恢复')
      return b
    }
  } catch {}
  if (forWrite) fail(`profile.json 已损坏且没有可用备份，先修好或删掉它：${PROFILE}`)
  warnings.push('profile.json 已损坏，本次按空画像处理')
  return emptyProfile()
}

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

// 画像锁：多个学习窗口同时写也不丢数据
function withProfileLock(fn) {
  ensureHome()
  const deadline = Date.now() + 3000
  let fd
  for (;;) {
    try { fd = fs.openSync(PROFILE_LOCK, 'wx'); break } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try { if (Date.now() - fs.statSync(PROFILE_LOCK).mtimeMs > 30000) { fs.rmSync(PROFILE_LOCK, { force: true }); continue } } catch {}
      if (Date.now() > deadline) fail('画像正被另一个学习窗口写入，稍后重试')
      sleepMs(50)
    }
  }
  try { return fn() } finally {
    fs.closeSync(fd)
    fs.rmSync(PROFILE_LOCK, { force: true })
  }
}

// 改画像：加锁 → 重新读 → 修改 → 备份旧版 → 写入。
// purgeBackup：删除类操作写完后用新内容覆盖备份，删掉的东西不会从备份里回来
function withProfile(fn, { purgeBackup = false } = {}) {
  return withProfileLock(() => {
    const p = loadProfile({ forWrite: true })
    const out = fn(p)
    p.updatedAt = isoLocal()
    if (fs.existsSync(PROFILE)) fs.copyFileSync(PROFILE, PROFILE_BAK)
    else fs.rmSync(PROFILE_BAK, { force: true }) // 画像被清空过（可能是在别的电脑上）：旧备份不能留着
    writeJson(PROFILE, p)
    if (purgeBackup) fs.copyFileSync(PROFILE, PROFILE_BAK)
    return out
  })
}

function findSkill(p, name) {
  const k = canonKey(name)
  return p.skills.find((sk) => skillKeys(sk).includes(k)) || null
}

// 现算一个技能的档位
function skillLevel(sk) {
  const ev = [...sk.evidence].sort(evOrder)
  let v = null
  let lastVerified = null
  let lastVerifiedIdx = -1
  let recheck = false
  ev.forEach((e, i) => {
    if (e.type === 'self') return
    const L = LEVELS.indexOf(e.level)
    if (v === null || L >= v) { v = L; recheck = false } else { const nv = Math.max(L, v - 1); recheck = nv > L; v = nv }
    lastVerified = e.at
    lastVerifiedIdx = i
  })
  const selfs = ev.filter((e) => e.type === 'self')
  const lastSelf = selfs[selfs.length - 1]
  const flags = []
  if (v === null) {
    if (!lastSelf) return null
    const L = Math.min(LEVELS.indexOf(lastSelf.level), 1)
    if (LEVELS.indexOf(lastSelf.level) > L) flags.push('自述已会，封顶会一点')
    flags.push('未验证')
    return { level: LEVELS[L], verified: false, stale: false, flags, basis: lastSelf }
  }
  let level = v
  let basis = ev.filter((e) => e.type !== 'self').pop()
  if (lastSelf && ev.indexOf(lastSelf) > lastVerifiedIdx && LEVELS.indexOf(lastSelf.level) < v) {
    level = LEVELS.indexOf(lastSelf.level)
    basis = lastSelf
    flags.push('用户自己说更低，按自述')
  }
  const stale = daysAgo(lastVerified) > STALE_DAYS
  if (stale) flags.push('久未验证，用前先复核 1 题')
  if (recheck) flags.push('上次验证降了档，需复核')
  return { level: LEVELS[level], verified: basis.type !== 'self', stale, flags, basis, lastVerified }
}

function levelText(lv) {
  if (!lv) return '没有记录'
  const b = lv.basis
  return `${LEVEL_NAMES[lv.level]}（${EVIDENCE_NAMES[b.type]} ${shortDate(b.at)}${lv.flags.length ? `；${lv.flags.join('；')}` : ''}）`
}

// 邮箱（版本号 vue@3.4、SSH 地址 git@github.com:a/b 不算）、手机号、身份证号
const PII_RES = [/[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-]|:[\w~/.])/, /(?<!\d)1[3-9]\d{9}(?!\d)/, /(?<!\d)\d{17}[\dXx](?!\d)/]

// 只检查模型自己写的文字；用户原话（「」里的）不查禁用词
function checkText(text, what, { quote = false } = {}) {
  const t = String(text)
  if (t.length > MAX_DETAIL) fail(`${what}超过 ${MAX_DETAIL} 字，写短一点：只写题目要点和结果`)
  for (const re of PII_RES) {
    const m = t.match(re)
    if (m) fail(`${what}里「${m[0]}」像是邮箱、手机号或证件号，画像不存这些。是版本号、仓库地址或题目数字就换个写法（如 vue 3.4）`)
  }
  if (!quote) {
    const bare = t.replace(/「[^」]*」/g, '')
    const hit = BANNED_WORDS.find((w) => bare.includes(w))
    if (hit) fail(`${what}里有「${hit}」这类绝对化的词（不能用：${BANNED_WORDS.join('、')}）。档位由脚本按证据算，说明里只写题目要点和结果；用户原话放在「」里`)
  }
  return t
}

// 技能名：不能为空、不超过 40 字、不能像邮箱手机号
function checkSkillName(name, what = '技能名') {
  const t = String(name ?? '').trim()
  if (!norm(t)) fail(`${what}不能为空或只有标点，写技术或主题名，如 Java、SQL`)
  if (t.length > 40) fail(`${what}太长：${t}（取技术或主题这一层，如 Java、SQL、HTTP 基础）`)
  checkText(t, what, { quote: true })
  return t
}

// 加一条证据；返回回执。调用方须在 withProfile 里
// brief：几条一起记时只返回这一条的短回执，由调用方合成一行
function addEvidence(p, { name, type, level, course = null, ref, detail }, { brief = false } = {}) {
  if (!LEVELS.includes(level)) fail(`档位非法：${level}（mastered / partial / none）`)
  name = checkSkillName(name)
  let sk = findSkill(p, name)
  let created = false
  if (!sk) {
    if (p.skills.length >= MAX_SKILLS) {
      const old = [...p.skills].sort((a, b) => (a.lastUsedAt || a.createdAt).localeCompare(b.lastUsedAt || b.createdAt)).slice(0, 5)
      fail(`画像里技能已满 ${MAX_SKILLS} 条。请用户选一条删掉（learn profile forget <id> --name "<技能名>"）：${old.map((x) => `${x.id} ${x.name}`).join('、')}`)
    }
    p.seq.s += 1
    sk = { id: `s${p.seq.s}${idTag()}`, name, aliases: [], evidence: [], createdAt: isoLocal(), lastUsedAt: null }
    p.skills.push(sk)
    created = true
  }
  // 同一次操作重复写入才算重复：编号相同、内容也相同（选边同步后课程里的编号可能退回去，同号的新结果要照记）
  if (ref && sk.evidence.some((e) => e.ref === ref && e.course === course && e.type === type && e.level === level && (e.detail || null) === (detail || null))) {
    return brief ? `「${sk.name}」已有这条记录，没有重复记入` : `画像：「${sk.name}」已有这条记录（${ref}），没有重复记入。`
  }
  p.seq.e += 1
  const e = { id: `e${p.seq.e}${idTag()}`, type, level, at: dateLocal(), ts: now().toISOString(), course, ref: ref || null, detail: detail || null }
  sk.evidence.push(e)
  sk.evidence.sort(evOrder)
  // 每个技能最多留 MAX_EVIDENCE 条：先丢最旧的自述，再丢最旧的验证；结业永远保留；刚记入的这条不丢
  while (sk.evidence.length > MAX_EVIDENCE) {
    const pick = (f) => sk.evidence.findIndex((x) => x !== e && f(x))
    let i = pick((x) => x.type === 'self')
    if (i < 0) i = pick((x) => x.type !== 'course')
    if (i < 0) break // 其余全是结业：允许多留这一条
    sk.evidence.splice(i, 1)
  }
  sk.lastUsedAt = isoLocal()
  const lv = skillLevel(sk)
  if (brief) return `「${sk.name}」${e.id} ${EVIDENCE_NAMES[type]}${LEVEL_NAMES[level]} → 现在算${levelText(lv)}`
  const first = p.skills.length === 1 && sk.evidence.length === 1 && created
  return `画像：已记入「${sk.name}」${e.id}（${EVIDENCE_NAMES[type]}：${LEVEL_NAMES[level]}），现在算${levelText(lv)}。不对就说「删掉这条」（learn profile forget ${e.id} --name "${sk.name}"）。`
    + (first ? `\n画像存在 ${PROFILE}，只记学习相关的技能；查看：learn profile` : '')
}

// 主命令里顺带写画像：写不进去只给警告，主命令照常成功
function profileWriteSafe(fn) {
  const p0 = loadProfile()
  if (!p0.enabled) return '画像：已暂停，这次没有记入（恢复：learn profile on）。'
  try { return withProfile(fn) } catch (e) {
    return `⚠ 画像未写入：${e.message}`
  }
}

// 主命令顺带写的画像回执：前面加一句给模型的指令（光靠人设，实测模型常常不转告或改写）
const relay = (receipt) => `把下面的画像回执一字不改贴给用户（用户靠它知道记了什么、怎么删）：\n${receipt}`

// ---------- 先修问答 ----------
// s.prereq = { setAt, none, asked, quizSeq, qStart, batchNo, batchKind,
//   items: [{ name, role, reason, cue, source, state, answer, decision, recommend, note, quizLevel, addedAt }] }
// state：ask 问会不会 / quiz 出验证题 / decide 问怎么补 / done 已定
// 会不会：本批所有待问项放进一次提问，不限题数；验证题按批限 PREREQ_BUDGET 道，一次一道
// 验证题按批计数：首次列清单、每次 --append 各一批（上一批还有项在问会不会、等出验证题时追加的并入上一批；
// 只剩待定怎么补的项不算没定完）；课中缺口（gap）不属于任何一批；
// batchNo 是当前批号，每项记 batch；qStart 是本批开始时的 quizSeq
// asked（问过几次会不会）和 quizSeq 只增不减，画像证据的 ref 用它们编号

function prereqItem(s, name) {
  const k = canonKey(name)
  const it = (s.prereq?.items || []).find((x) => [x.name, ...(x.aliases || [])].map(canonKey).includes(k))
  if (!it) fail(`先修清单里没有「${name}」。现有：${(s.prereq?.items || []).map((x) => x.name).join('、') || '无'}`)
  return it
}

function setDecide(it, recommend) { it.state = 'decide'; it.recommend = recommend; it.decision = null }
function setDone(it, decision) { it.state = 'done'; it.decision = decision }

// 按画像现状决定一项先修怎么处理
function classifyItem(it, p) {
  const sk = p.enabled ? findSkill(p, it.name) : null
  const lv = sk ? skillLevel(sk) : null
  const L = lv ? lv.level : null
  const solid = lv && lv.verified && !lv.stale // 有验证且不旧
  if (it.role === 'core') {
    if (solid && L === 'mastered') return setDone(it, 'known')
    if (solid && L === 'partial') return setDecide(it, 'inline')
    if (lv && L === 'none') return setDecide(it, 'learn-first')
    if (lv) { it.state = 'quiz'; return }
    it.state = 'ask'
  } else if (it.role === 'general') {
    // 有帮助的技能不出验证题：会一点就够用；久未验证的重问一次会不会
    if (lv && L !== 'none' && !lv.stale) return setDone(it, 'known')
    if (lv && L === 'none') return setDecide(it, 'inline')
    it.state = 'ask'
  } else {
    if (solid && L !== 'none') return setDone(it, 'anchor')
    if (lv && L === 'none') return setDone(it, 'dropped')
    if (lv) { it.state = 'quiz'; return }
    it.state = 'ask'
  }
}

const quizzesInBatch = (s) => (s.prereq.quizSeq || 0) - (s.prereq.qStart || 0)
const inBatch = (s, x) => (x.batch || 0) === (s.prereq.batchNo || 0) && x.source !== 'gap'

// v0.3 的档案没有批号：按还在问会不会、等出验证题的项推出当前这批（其中最早的一项之后加的都算），名额只算这批出过的题
function migratePrereq(pr) {
  if (pr.batchNo !== undefined) return
  const pend = pr.items.filter((x) => (x.state === 'ask' || x.state === 'quiz') && x.source !== 'gap')
  if (pend.length) {
    const from = pend.map((x) => x.addedAt || '').sort()[0]
    const batch = pr.items.filter((x) => x.source !== 'gap' && (x.addedAt || '') >= from)
    for (const x of batch) x.batch = 1
    pr.batchNo = 1
    pr.qStart = Math.max(0, (pr.quizSeq || 0) - batch.filter((x) => x.quizLevel).length)
  } else {
    pr.batchNo = 0
    pr.qStart = pr.quizSeq || 0
    pr.plannedBatch = 0
  }
  delete pr.batchStart
}

// 分不到验证题名额的项：必需项一律交给用户决定怎么补，不凭自述定成已会；可类比项不拿来打比方
const SELF_TEXT = { A: '自述能独立做', B: '自述会一点', D: '不确定' }
function exhaust(it) {
  if (it.role === 'core') setDecide(it, 'inline')
  else setDone(it, 'dropped')
  it.note = `${SELF_TEXT[it.answer] ? `${SELF_TEXT[it.answer]}，` : ''}名额用完没验证`
}

// 验证题名额的分配顺序：本批必需第 1 项 → 可类比第 1 项 → 其余必需 → 其余可类比
// （保证至少验证一个能拿来打比方的技能）。只排要出题和已经出过题的项，出过题的项也占着位置
function quizOrder(s) {
  const batch = s.prereq.items.filter((x) => inBatch(s, x) && (x.state === 'quiz' || x.quizLevel))
  const core = batch.filter((x) => x.role === 'core')
  const rel = batch.filter((x) => x.role === 'related')
  return [...core.slice(0, 1), ...rel.slice(0, 1), ...core.slice(1), ...rel.slice(1)].filter((x) => x.state === 'quiz')
}

// 会不会都问完后，分不到名额的项在这里定掉；返回本批还能出题的项（按顺序）。
// 新定掉的项记进 s.prereq.untold（存档），下一次给出「下一步」时让模型告诉用户，然后清掉
function settleQuizzes(s) {
  if (!s.prereq || s.prereq.items.some((x) => x.state === 'ask')) return []
  const order = quizOrder(s)
  const left = Math.max(0, PREREQ_BUDGET - quizzesInBatch(s))
  const gone = order.slice(left)
  for (const it of gone) exhaust(it)
  if (gone.length) s.prereq.untold = [...new Set([...(s.prereq.untold || []), ...gone.map((x) => x.name)])]
  return order.slice(0, left)
}

function exhaustedNotice(s) {
  const gone = (s.prereq.untold || []).map((n) => s.prereq.items.find((x) => x.name === n)).filter(Boolean)
  delete s.prereq.untold
  if (!gone.length) return ''
  const rel = gone.filter((x) => x.role !== 'core').map((x) => `「${x.name}」`)
  const core = gone.filter((x) => x.role === 'core').map((x) => `「${x.name}」`)
  return `先用一句话告诉用户：本批验证题名额用完了，${[rel.length && `${rel.join('、')}没验证，这门课不拿它打比方`, core.length && `${core.join('、')}没验证，之后问怎么补时一起问`].filter(Boolean).join('；')}。\n`
}

// 处理顺序：必需 → 可类比 → 有帮助
const ROLE_ORDER = { core: 0, related: 1, general: 2 }
function orderedItems(s) { return [...s.prereq.items].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) }

function pendingItems(s) { return (s.prereq?.items || []).filter((x) => x.state !== 'done') }

// 给出下一步该做什么；分不到验证题名额的项在这里自动定掉
function prereqNext(s) {
  settleQuizzes(s)
  const tell = exhaustedNotice(s)
  const next = prereqStep(s)
  return next ? tell + next : (tell.trim() || null)
}

function prereqStep(s) {
  const asks = orderedItems(s).filter((x) => x.state === 'ask')
  if (asks.length) {
    // 同一批已经记过答案：剩下的多半在刚才那次提问里答过了，直接记，别再问一遍
    const answered = s.prereq.items.some((x) => inBatch(s, x) && x.answer)
    const head = answered
      ? `下一步：下面 ${asks.length} 项还没记会不会。用户在刚才那次提问里已经答了的，直接记，不要再问；还没问过的，用 1 次 ask_user_question 一起问（问会不会不占验证题名额）：\n`
      : asks.length === 1
        ? `下一步：用 ask_user_question 问「${asks[0].name}」会不会（问会不会不占验证题名额）：\n`
        : `下一步：用 1 次 ask_user_question 一起问下面 ${asks.length} 项会不会，每项一题（问会不会不占验证题名额）：\n`
    return head
      + asks.map((x) => `  ${x.name}：本课用它${x.reason}${x.cue ? `（看到 ${x.cue} 才问的，题面说出来）` : ''}`).join('\n')
      + '\n每题题面问一个具体任务，不问笼统水平；选项固定：A 能独立做 / B 会一点，要查资料 / C 没接触过 / D 不确定。'
      + '\n答完用一条命令一起记：learn prereq answer --json \'[{"name":"<技能>","choice":"A|B|C|D","quote":"<用户原话，可省略>"}]\'（只有一项也可以 learn prereq answer "<技能>" <A|B|C|D>）'
  }
  const it = settleQuizzes(s)[0]
  if (it) {
    return `下一步：给「${it.name}」出 1 道验证题（本批验证题已出 ${quizzesInBatch(s)}/${PREREQ_BUDGET}）。一次只出这一题：ask_user_question 里只放这一题，记下结果再出下一题。\n`
      + `出题：考「${it.name}」本身，不考本课要学的新东西；预测输出、找错或解释为什么，不问定义，贴近本课用它的地方（${it.reason}）。用选择题时，有且只有一个选项是对的，选项只写选项本身、不加说明，最后一项是「不确定 / 说不清」。\n`
      + '判档：答错 none；答对但没说原因 partial（选择题选对了，先追问一句「为什么」再判：让用户用自己的话说，不给选项）；答对且原因说得通 mastered。\n'
      + `答完：learn prereq quiz "${it.name}" <mastered|partial|none> --detail "<题目要点和回答>"（--detail 里不写 ${BANNED_WORDS.join('、')}）`
  }
  const dec = s.prereq.items.filter((x) => x.state === 'decide')
  if (dec.length) {
    return `下一步：用一个问题问用户这几项先修怎么补（每项先说本课用它做什么，再给 4 个选项和各自后果，标出推荐项；多项时加一个「全部按推荐」）：\n`
      + dec.map((x) => `  ${x.name}：推荐「${DECISION_NAMES[x.recommend]}」${x.note ? `（${x.note}）` : ''}`).join('\n')
      + '\n选项：learn-first 先补 / inline 边学边补 / separate 先单独学一门 / skip 跳过'
      + '\n用户在刚才的问题里已经选过的，直接记，不要再问。'
      + '\n答完用一条命令一起记：learn prereq decide --json \'[{"name":"<技能>","decision":"learn-first|inline|separate|skip"}]\'；全部按推荐：learn prereq decide --all-recommended'
  }
  return null
}

function decisionName(it) {
  // 有帮助的技能不验证，会一点就算够用，不说「已会」
  return DECISION_NAMES[it.role === 'general' && it.decision === 'known' ? 'enough' : it.decision]
}

function prereqLine(it) {
  const head = `${it.name} [${ROLE_NAMES[it.role]}]${it.reason ? ` ${it.reason}` : ''}`
  if (it.state === 'done') return `${head} → ${decisionName(it)}${it.note ? `（${it.note}）` : ''}`
  if (it.state === 'decide') return `${head} → 待定怎么补（推荐：${DECISION_NAMES[it.recommend]}）`
  return `${head} → ${it.state === 'ask' ? '待问会不会' : '待出验证题'}`
}

function prereqReport(s, { withNext = true } = {}) {
  if (!s.prereq.items.length && s.prereq.none) return `先修：这门课不需要（${s.prereq.none}）。${withNext ? `下一步：${afterPrereq(s)}` : ''}`.trim()
  settleQuizzes(s)
  const items = orderedItems(s)
  const out = [`先修清单（${items.length} 项，本批验证题已出 ${quizzesInBatch(s)}/${PREREQ_BUDGET}）：`, ...items.map((x) => `  ${prereqLine(x)}`)]
  if (!withNext) return out.join('\n')
  const tell = exhaustedNotice(s)
  const next = prereqStep(s)
  if (next) out.push(tell + next)
  else out.push(`${tell}先修问答完成。下一步：${afterPrereq(s)}`)
  return out.join('\n')
}

const waitingItems = (s) => (s.prereq?.items || []).filter((x) => x.decision === 'separate')

// 有先修选了「先单独学一门」：这门课先放着；写清怎么解除
function waitText(s) {
  const names = waitingItems(s).map((x) => `「${x.name}」`).join('、')
  return `这门课在等先修${names}（用户选了先单独学一门）。先问用户那门学完没有：`
    + `还没开始就新开一门：learn init <短名> --title "<中文名>" --for ${s.skill}:<技能>（那门结业时自动解除等待）；`
    + `已经开了就 learn use <那门课>；用户在别处学会了：出 1 道验证题用 learn profile verify 记下，再 learn prereq decide "<技能>" known；`
    + `不想等了：learn prereq decide "<技能>" inline`
}

// 先修问答做完之后做什么
// 先修改成不先补了，路线里还留着它没学完的先修节
function orphanPrereqLessons(s) {
  return s.lessons.filter((l) => l.kind === 'prereq' && !isDone(l) && !l.doneAt && !(s.prereq?.items || []).some((x) => x.name === l.prereqSkill && x.decision === 'learn-first'))
}
function orphanText(ls) {
  return `路线里第 ${ls.map((l) => l.id).join('、')} 节是${[...new Set(ls.map((l) => `「${l.prereqSkill}」`))].join('、')}的先修节，但用户已经改成不先补了，不要开讲：用 learn set-plan 去掉这几节（learn plan 看当前路线；已经开始学的加 --force yes），别的节 requires 里的这几个节号会自动去掉`
}

function afterPrereq(s) {
  if (!s.lessons.length) return nextSetupStep(s)
  if (waitingItems(s).length) return waitText(s)
  const orphan = orphanPrereqLessons(s)
  if (orphan.length) return orphanText(orphan)
  const missing = s.prereq.items.filter((x) => x.decision === 'learn-first' && !s.lessons.some((l) => l.kind === 'prereq' && l.prereqSkill === x.name))
  if (missing.length) return `给${missing.map((x) => `「${x.name}」`).join('、')}加 1-2 节先修节（learn-plan 调整路线：learn plan 看当前路线，新节用没用过的 id，已有节不改号）`
  if (s.prereq.plannedBatch !== (s.prereq.batchNo || 0) && s.prereq.items.some((x) => x.source === 'append' && inBatch(s, x))) return '按 learn-plan 排新阶段的节，用到这些先修的节在 uses 里写上（learn plan 看当前路线）'
  return '接着当前节'
}

// 可以拿来打比方的技能：先修里已会 / 可类比、且画像里有验证证据的，最多 3 个
function anchorsOf(s, p) {
  if (!p.enabled || !s.prereq) return []
  const out = []
  const sorted = [...s.prereq.items].sort((a, b) => (a.role === 'related' ? 0 : 1) - (b.role === 'related' ? 0 : 1))
  for (const it of sorted) {
    if (!['known', 'anchor'].includes(it.decision)) continue
    const sk = findSkill(p, it.name)
    const lv = sk && skillLevel(sk)
    if (lv && lv.verified && lv.level !== 'none') out.push({ name: sk.name, lv })
  }
  out.sort((a, b) => LEVELS.indexOf(b.lv.level) - LEVELS.indexOf(a.lv.level))
  return out.slice(0, 3)
}

function bridgeGuide(names) {
  const a = names.join(' / ')
  return `可类比（用户会的技能）：${a}。讲本节新概念时，两边真有对应才打比方，按这个格式，缺一行不算讲完：
  〔用你会的 X 打个比方〕
  对应：本课的 … ≈ X 的 …
  相同：1-3 点
  不同：至少 1 点，附最小例子
  别套用：什么情况下按 X 的习惯会出错
（X 指上面某个技能）讲完接本课的正式说法和一个最小例子，再出 1 道针对「不同」的预测题。看着一样、行为不同的地方，先让用户按 X 的经验预测，答错再纠正，并 learn mistake <节> "<错>" "<对>" --from X。X 里没有对应物的，直说「这里别用 X 的思路」。`
}

// 跨课程统计各教法的首次检验通过率；每种满 3 节才算
function methodStats() {
  const idx = loadIndex()
  const by = {}
  for (const n of Object.keys(idx.courses || {})) {
    let s
    try { s = loadState(n) } catch { continue }
    for (const l of s.lessons) {
      // 首次检验是跳过讲解直接检验的，不算：跟教法无关
      if (!l.notes || !l.notes.length || l.kind === 'prereq' || l.notes[0].direct) continue
      const m = l.notes[0].method || l.methodHistory?.[0] || l.method
      if (!m || m === 'feynman') continue
      by[m] = by[m] || { lessons: 0, firstPass: 0 }
      by[m].lessons += 1
      if (l.notes[0].pass) by[m].firstPass += 1
    }
  }
  const shown = Object.entries(by).filter(([, v]) => v.lessons >= 3)
  let suggest = null
  for (const [m, v] of shown) {
    // 只有这两种适合当「其他内容」的默认教法；第一性原理、诊断纠偏有各自的适用范围
    if (!['coach', 'worked-example'].includes(m)) continue
    const r = v.firstPass / v.lessons
    if (r >= 0.6 && (!suggest || r > suggest.r)) suggest = { m, r, v }
  }
  return { shown, suggest }
}

// 结业后：找出在等这门课的其他课程（init --for 记下的关联优先，再按名字匹配）
function waitingCourses(self, s, skillNames) {
  const keys = skillNames.filter(Boolean).map(canonKey)
  const idx = loadIndex()
  const out = []
  for (const n of Object.keys(idx.courses || {})) {
    if (n === self) continue
    let st
    try { st = loadState(n) } catch { continue }
    for (const it of st.prereq?.items || []) {
      if (it.decision !== 'separate') continue
      const linked = (s.forPrereq || []).some((f) => f.course === n && canonKey(f.skill) === canonKey(it.name))
      if (linked || [it.name, ...(it.aliases || [])].map(canonKey).some((k) => keys.includes(k))) out.push({ course: n, st, it })
    }
  }
  return out
}

// ---------- 命令 ----------

const commands = {}

commands.init = ({ pos, flags }) => {
  const name = slug(need(pos[0], '课程名：learn init <课程名>'))
  ensureHome()
  if (fs.existsSync(stateFile(name))) fail(`课程 ${name} 已存在。要切换到它用 learn use ${name}`)
  // --for <课程>:<技能>：这门课是为另一门课的先修单独开的，结业时自动解除那门课的等待
  let forPrereq = null
  if (flags.for !== undefined) {
    const m = String(need(flags.for, '--for <课程>:<技能>')).match(/^([a-z0-9][a-z0-9-]*):(.+)$/)
    if (!m) fail('--for 的格式是 <课程名>:<先修技能>，如 --for spring-boot:Java')
    if (!fs.existsSync(stateFile(m[1]))) fail(`找不到课程 ${m[1]}`)
    const it = prereqItem(loadState(m[1]), m[2].trim())
    if (it.decision !== 'separate') fail(`课程 ${m[1]} 的先修「${it.name}」没有选「先单独学一门」（现在：${decisionName(it) || '未定'}）`)
    forPrereq = [{ course: m[1], skill: it.name }]
  }
  fs.mkdirSync(path.join(courseDir(name), 'skills'), { recursive: true })
  const s = {
    version: VERSION,
    skill: name,
    title: flags.title || name,
    createdAt: isoLocal(),
    goal: null,
    baseline: [],
    lessons: [],
    mistakes: [],
    questions: [],
    sessions: [],
    finished: false,
    forPrereq,
    updatedAt: null,
  }
  writeJson(stateFile(name), s)
  fs.writeFileSync(path.join(courseDir(name), 'log.md'), `# ${s.title} 学习日记\n\n`)
  const idx = loadIndex()
  idx.courses[name] = { title: s.title, createdAt: s.createdAt, lastActive: s.createdAt }
  idx.current = name
  saveIndex(idx)
  setCurrentLink(name)
  saveState(name, s, '创建课程')
  return `已创建课程 ${name}，并设为当前课程。${forPrereq ? `结业时会自动通知课程 ${forPrereq[0].course}（它在等「${forPrereq[0].skill}」）。` : ''}下一步：立目标（learn-intake 第 2 步，learn set-goal）。`
}

commands.use = ({ pos }) => {
  const name = slug(need(pos[0], '课程名'))
  if (!fs.existsSync(stateFile(name))) fail(`找不到课程 ${name}`)
  const idx = loadIndex()
  idx.current = name
  saveIndex(idx)
  setCurrentLink(name)
  return `已切换到 ${name}。\n\n` + commands.status({ pos: [], flags: {} })
}

commands.list = () => {
  const idx = loadIndex()
  const names = Object.keys(idx.courses)
  if (names.length === 0) return '还没有任何课程。'
  return names.map((n) => {
    const s = loadState(n)
    const total = s.lessons.length
    const done = s.lessons.filter(isDone).length
    const mark = n === idx.current ? '▶ ' : '  '
    const ago = daysBetween(idx.courses[n].lastActive)
    return `${mark}${n}「${s.title}」 ${s.finished ? '已结业' : `${done}/${total} 节`} · ${ago === 0 ? '今天' : `${ago} 天前`}学过`
  }).join('\n')
}

commands['set-goal'] = ({ flags }) => {
  const name = pickCourse(flags)
  const s = loadState(name)
  const g = readJsonArg(flags)
  need(g.exam, 'goal.exam（终点考核：做到什么就算学会）')
  if (g.profileSkill != null) g.profileSkill = checkSkillName(g.profileSkill, 'profileSkill')
  const regoal = !!s.goal && s.lessons.length > 0
  s.goal = {
    summary: g.summary || null,
    exam: g.exam,
    deadline: g.deadline || null,
    minutesPerSession: g.minutesPerSession || null,
    preferredMethod: g.preferredMethod || null,
    // 结业时写进画像的技能名：范围和终点考核一致，缺省用课程标题
    profileSkill: g.profileSkill || s.goal?.profileSkill || null,
  }
  if (s.goal.preferredMethod && !METHODS.includes(s.goal.preferredMethod)) fail(`preferredMethod 非法：${s.goal.preferredMethod}`)
  if (Array.isArray(g.baseline)) {
    for (const b of g.baseline) {
      if (!['mastered', 'partial', 'none'].includes(b.level)) fail(`摸底档位非法：${b.level}（mastered / partial / none）`)
      if (!b.evidence) fail(`摸底「${b.ability}」缺少依据 evidence`)
    }
    s.baseline = g.baseline
  }
  saveState(name, s, `定目标：${s.goal.exam}`)
  if (regoal) return '已改目标。下一步：新目标新用到的先修用 learn prereq set --append 补问；新增的能力补摸底（learn baseline，按能力合并）；然后按 learn-plan 用完整新路线 set-plan（learn plan 看当前路线，已掌握的节保留）。'
  return `已记录目标${s.baseline.length ? `和 ${s.baseline.length} 项摸底结果` : ''}。下一步：${nextSetupStep(s)}`
}

// 立课阶段的下一步：先修问答 → 摸底 → 出计划
function nextSetupStep(s) {
  if (!s.goal) return '立目标（learn-intake 第 2 步）'
  if (!s.prereq) return '问已会的技能和先修（learn-intake 第 3 步：learn cues，再 learn prereq set）'
  if (pendingItems(s).length) return '先修问答还没完（learn-intake 第 3 步），运行 learn prereq 看下一题'
  if (!s.lessons.length && waitingItems(s).length) return waitText(s)
  if (!s.baseline.length && !s.lessons.length) return '摸底（learn-intake 第 4 步），结果用 learn baseline 写入'
  if (!s.lessons.length) return '出计划（learn-plan）'
  return '继续当前节'
}

// 写摸底结果（课程内的能力，只存在课程里，不进画像）
commands.baseline = ({ flags }) => {
  const name = pickCourse(flags)
  const s = loadState(name)
  if (!s.goal) fail('还没立目标，先 learn set-goal')
  const input = readJsonArg(flags)
  const list = Array.isArray(input) ? input : input.baseline
  if (!Array.isArray(list) || !list.length) fail('摸底结果必须是非空数组：[{"ability":"…","level":"mastered|partial|none","evidence":"…"}]')
  for (const b of list) {
    if (!b.ability) fail('每项摸底都要有 ability')
    if (!['mastered', 'partial', 'none'].includes(b.level)) fail(`摸底档位非法：${b.level}（mastered / partial / none）`)
    if (!b.evidence) fail(`摸底「${b.ability}」缺少依据 evidence`)
  }
  // 按能力合并：同名的覆盖，其余保留（重定目标后补摸底不会冲掉原来的结果）
  const merged = [...s.baseline.filter((o) => !list.some((b) => b.ability === o.ability)), ...list]
  s.baseline = merged
  saveState(name, s, `摸底：${list.map((b) => `${b.ability}=${b.level}`).join('，')}`)
  return `已记录 ${list.length} 项摸底结果${merged.length > list.length ? `（连同之前的共 ${merged.length} 项）` : ''}。下一步：${nextSetupStep(s)}`
}

// 先修节和「本节要用的先修」：校验名字，并把先修节自动加进用到它的节的 requires
function wirePrereqLessons(s, list) {
  const items = s.prereq?.items || []
  const find = (name) => {
    const k = canonKey(name)
    return items.find((x) => [x.name, ...(x.aliases || [])].map(canonKey).includes(k))
  }
  for (const l of list) {
    checkRequires(l)
    if (l.kind != null && !['prereq', 'main'].includes(l.kind)) fail(`第 ${l.id} 节 kind 只能是 prereq 或 main`)
    if (l.kind === 'prereq') {
      const it = l.prereqSkill && find(l.prereqSkill)
      if (!it) fail(`第 ${l.id} 节是先修节，prereqSkill 必须是先修清单里的技能（现有：${items.map((x) => x.name).join('、') || '无'}）`)
      const learned = s.lessons.some((o) => o.id === l.id && o.kind === 'prereq' && o.prereqSkill === it.name && (isDone(o) || o.doneAt))
      if (it.decision !== 'learn-first' && !learned) {
        if (s.lessons.some((o) => o.id === l.id && o.kind === 'prereq')) fail(`先修「${it.name}」现在是「${decisionName(it) || '未定'}」，不用先修节了：第 ${l.id} 节从路线里去掉（已经开始学的加 --force yes）；用户要改回先补就先 learn prereq decide "${it.name}" learn-first`)
        if (DECISIONS.includes(it.decision)) fail(`先修「${it.name}」的决定是「${decisionName(it)}」，不用加先修节；用户要改成先补就先 learn prereq decide "${it.name}" learn-first`)
        fail(`先修「${it.name}」是「${decisionName(it) || '未定'}」，不需要先修节：第 ${l.id} 节去掉 kind:prereq（改成正课）或删掉`)
      }
      l.prereqSkill = it.name
    }
    if (l.uses != null && !Array.isArray(l.uses)) fail(`第 ${l.id} 节 uses 必须是数组`)
    l.uses = (l.uses || []).map((u) => {
      const it = find(u)
      if (!it) fail(`第 ${l.id} 节 uses 里的「${u}」不在先修清单里（现有：${items.map((x) => x.name).join('、') || '无'}）`)
      return it.name
    })
  }
  for (const it of items.filter((x) => x.decision === 'learn-first')) {
    const ps = list.filter((l) => l.kind === 'prereq' && l.prereqSkill === it.name)
    if (!ps.length) fail(`先修「${it.name}」选了先补：路线里要有 1-2 节 {"kind":"prereq","prereqSkill":"${it.name}"} 的先修节`)
    if (ps.length > 2) fail(`先修「${it.name}」最多 2 节先修节，只讲本课要用的部分（现在 ${ps.length} 节）`)
    for (const l of list) {
      if (l.kind === 'prereq' || !l.uses.includes(it.name)) continue
      l.requires = [...new Set([...(l.requires || []), ...ps.map((x) => x.id)])]
    }
  }
}

// 写入或替换路线；已有节保留学习记录，路线层只需 id / title / requires / summary
commands['set-plan'] = ({ flags }) => {
  const name = pickCourse(flags)
  const s = loadState(name)
  const input = readJsonArg(flags)
  const list = Array.isArray(input) ? input : input.lessons
  if (!Array.isArray(list) || list.length === 0) fail('计划必须是非空的节数组')
  if (!s.goal) fail('还没立目标，先 learn set-goal')
  // 第一次出路线前必须做完先修问答（老课程已有路线的不拦）
  if (!s.prereq && !s.lessons.length) fail('还没做先修问答。先 learn cues、learn prereq set（这门课用不到别的技能就 learn prereq set --none "<理由>"）')
  const pend = pendingItems(s)
  if (pend.length) fail(`先修还有 ${pend.length} 项没定：${pend.map((x) => x.name).join('、')}。运行 learn prereq 看下一步`)
  const old = new Map(s.lessons.map((l) => [l.id, l]))
  const hasRecord = (o) => o.status !== 'todo' || (o.steps || []).length || (o.notes || []).length || o.attempts
  const maxId = Math.max(0, ...s.lessons.map((l) => l.id))
  for (const n of list) {
    const o = old.get(n.id)
    if (!o || !hasRecord(o) || flags.force) continue
    const kindNow = n.kind === 'prereq' ? 'prereq' : 'main'
    if (n.title !== o.title || kindNow !== (o.kind || 'main')) {
      fail(`第 ${n.id} 节原来是「${o.title}」，已有学习记录；新路线把它写成了「${n.title}」${kindNow !== (o.kind || 'main') ? '（还改了 kind）' : ''}。已有节不要改号，新节用没用过的 id（现在最大是 ${maxId}）；只是改名就加 --force yes`)
    }
  }
  // 已有节没写 uses 就沿用原来的（包括 prereq gap 自动加的）；要清空写 "uses":[]
  const inherited = []
  for (const n of list) {
    const o = old.get(n.id)
    if (n.uses === undefined && o && (o.uses || []).length) { n.uses = [...o.uses]; inherited.push(`第 ${n.id} 节（${o.uses.join('、')}）`) }
  }
  // 去掉的先修节：别的节 requires 里的这个节号自动去掉（先修节是改成先补时自动加进 requires 的）
  const droppedPre = new Set(s.lessons.filter((l) => l.kind === 'prereq' && !list.some((x) => x.id === l.id)).map((l) => l.id))
  for (const n of list) if (Array.isArray(n.requires)) n.requires = n.requires.filter((r) => !droppedPre.has(r))
  wirePrereqLessons(s, list)
  checkPlan(list)
  const removed = s.lessons.filter((l) => !list.some((x) => x.id === l.id) && hasRecord(l))
  if (removed.length && !flags.force) {
    fail(`以下节已有学习记录，新计划里却没有：${removed.map((l) => `${l.id}「${l.title}」`).join('、')}。确认要删除就加 --force yes`)
  }
  s.lessons = list.map((n) => {
    const o = old.get(n.id) || {}
    return {
      id: n.id,
      title: n.title,
      summary: n.summary ?? o.summary ?? null,
      requires: n.requires || [],
      method: n.method ?? o.method ?? null,
      methodReason: n.methodReason ?? o.methodReason ?? null,
      passCriteria: n.passCriteria ?? o.passCriteria ?? null,
      check: n.check ?? o.check ?? null,
      status: o.status || 'todo',
      attempts: o.attempts || 0,
      methodHistory: o.methodHistory || [],
      steps: o.steps || [],
      doneAt: o.doneAt || null,
      notes: o.notes || [],
      kind: n.kind === 'prereq' ? 'prereq' : 'main',
      prereqSkill: n.prereqSkill || null,
      uses: n.uses || [],
      forced: o.forced || false,
      ...(o.directCheck ? { directCheck: true } : {}),
    }
  })
  // 进行中的节多了没学完的前置（新插的先修节或过渡节）：先暂停它，做过的步骤保留
  const paused = []
  for (const l of s.lessons) {
    const unmet = unmetRequires(s, l)
    if (l.status === 'in_progress' && !l.forced && unmet.length) { l.status = 'todo'; paused.push(`第 ${l.id} 节先暂停（做过的步骤保留），先学第 ${unmet.join('、')} 节；学完再 learn start ${l.id}（不带 --steps）接着做。`) }
  }
  if (s.prereq) s.prereq.plannedBatch = s.prereq.batchNo || 0 // 这一批先修之后排过路线了
  saveState(name, s, `${old.size ? '调整' : '制定'}计划：共 ${s.lessons.length} 节`)
  const n = nextLesson(s)
  const lines = [`计划已保存，共 ${s.lessons.length} 节。`]
  if (inherited.length) lines.push(`沿用原来的 uses：${inherited.join('；')}。要去掉就写 "uses":[]`)
  lines.push(...paused)
  if (n) lines.push(n.status === 'in_progress' ? `当前节：第 ${n.id} 节「${n.title}」。` : `下一节：第 ${n.id} 节「${n.title}」。开始时用 learn start ${n.id}${n.method && n.steps.length ? '' : ' 补全教法、达标标准和步骤'}。`)
  return lines.join('\n')
}

// 开始一节：此时才写完整字段（滚动细化）
commands.start = ({ pos, flags }) => {
  const name = pickCourse(flags)
  const s = loadState(name)
  const l = lesson(s, intArg(pos[0], '节号'))
  const unmet = unmetRequires(s, l)
  if (unmet.length && !flags.force) {
    const p = lesson(s, unmet[0])
    fail(`前置第 ${p.id} 节「${p.title}」还没掌握。确认要先学这节就加 --force yes`)
  }
  l.forced = unmet.length > 0
  const doneSteps = (x) => (x.steps || []).filter((st) => st.status === 'done').length
  if (flags.steps && l.status !== 'review' && doneSteps(l) && !flags.force) {
    fail(`第 ${l.id} 节已做完 ${doneSteps(l)}/${l.steps.length} 步，重新拆步骤会覆盖这些记录。接着做就去掉 --steps；确认要重新拆加 --force yes`)
  }
  if (l.status === 'review' && !flags.steps) fail(`第 ${l.id} 节是复习，要重新拆步骤：加 --steps '[…]'（教法和达标标准可以沿用）`)
  const extra = []
  const other = s.lessons.find((x) => x.status === 'in_progress' && x.id !== l.id)
  if (other) {
    const k = doneSteps(other)
    if (other.steps.length && k === other.steps.length && !flags.force) fail(`第 ${other.id} 节步骤都做完了还没检验：先 learn done ${other.id} --pass|--fail；确认要放下它加 --force yes`)
    other.status = 'todo'
    if (k) extra.push(`第 ${other.id} 节做到第 ${k}/${other.steps.length} 步还没检验，已暂停；回来用 learn start ${other.id}（不带 --steps）接着做。`)
  }
  if (flags.method) {
    if (!METHODS.includes(flags.method)) fail(`教法非法：${flags.method}。可选：${METHODS.join(', ')}`)
    l.method = flags.method
  }
  if (flags.reason) l.methodReason = flags.reason
  if (flags.criteria) l.passCriteria = flags.criteria
  if (flags.check) l.check = flags.check
  if (flags.steps) { l.steps = newSteps(parseSteps(flags.steps)); delete l.directCheck }
  if (!l.method) fail('这一节还没定教法，用 --method 指定')
  if (!l.passCriteria) fail('这一节还没有达标标准，用 --criteria 指定')
  if (!l.steps.length) fail('这一节还没拆步骤，用 --steps \'["...","..."]\' 指定（每步 10-15 分钟）')
  if (l.methodHistory[l.methodHistory.length - 1] !== l.method) l.methodHistory.push(l.method)
  l.status = 'in_progress'
  saveState(name, s, `开始第 ${l.id} 节「${l.title}」，教法：${METHOD_NAMES[l.method]}`)
  extra.push(criteriaLine(l))
  const byName = new Map((s.prereq?.items || []).map((x) => [x.name, x]))
  for (const u of l.uses || []) {
    const it = byName.get(u)
    if (it?.decision === 'inline') extra.push(`本节先补先修「${u}」：开讲前花 5-10 分钟，只讲本节要用的部分。`)
    if (it?.decision === 'skip') extra.push(`本节要用跳过的先修「${u}」：卡住时先回头补它。`)
  }
  const anchors = anchorsOf(s, loadProfile())
  if (anchors.length && l.kind !== 'prereq') extra.push(bridgeGuide(anchors.map((a) => a.name)))
  return `已开始。\n${extra.join('\n')}\n${positionLine(s)}`
}

function criteriaLine(l) { return `本节达标标准：${l.passCriteria}${l.check ? `；检验方式：${l.check}` : ''}` }

function parseSteps(raw) {
  let steps
  try { steps = JSON.parse(raw) } catch { fail('--steps 必须是 JSON 字符串数组，例如 \'["探测","纠偏","变体题","费曼检验"]\'') }
  if (!Array.isArray(steps) || steps.length === 0 || steps.some((x) => typeof x !== 'string' || !x.trim())) fail('--steps 必须是非空字符串数组')
  return steps
}
const newSteps = (titles) => titles.map((t, i) => ({ title: t, status: i === 0 ? 'in_progress' : 'todo', result: null }))

commands.step = ({ pos, flags }) => {
  const name = pickCourse(flags)
  const s = loadState(name)
  const l = lesson(s, intArg(pos[0], '节号'))
  const n = intArg(pos[1], '步号')
  if (l.status !== 'in_progress') fail(`第 ${l.id} 节现在不是进行中（${STATUS_NAMES[l.status]}）：先 learn start ${l.id}`)
  const st = l.steps[n - 1]
  if (!st) fail(`第 ${l.id} 节没有第 ${n} 步（共 ${l.steps.length} 步）`)
  // 默认就是「这一步做完了」；只有明确说这一步还没做完时才加 --partial
  if (flags.status) fail('step 不再接受 --status：做完一步直接 learn step <节> <步> --result "…"；这一步只做了一半才加 --partial')
  const status = flags.partial ? 'in_progress' : 'done'
  need(flags.result, '--result（这一步的结果：做对了什么、错在哪）')
  st.status = status
  st.result = flags.result
  if (status === 'done') {
    const nx = l.steps.find((x) => x.status === 'todo')
    if (nx && !l.steps.some((x) => x.status === 'in_progress')) nx.status = 'in_progress'
  }
  saveState(name, s, `第 ${l.id} 节第 ${n} 步「${st.title}」${status === 'done' ? '完成' : '进行到一半'}：${flags.result}`)
  return positionLine(s)
}

// 用户说这节会了、想跳过：讲解和练习的步骤记成「跳过」，位置条直接指到检验
commands.check = ({ pos, flags }) => {
  const name = pickCourse(flags)
  const s = loadState(name)
  const l = lesson(s, intArg(pos[0], '节号'))
  if (l.status === 'mastered') fail(`第 ${l.id} 节已经掌握了`)
  const unmet = unmetRequires(s, l)
  if (unmet.length && !flags.force) {
    const p = lesson(s, unmet[0])
    fail(`前置第 ${p.id} 节「${p.title}」还没掌握。确认要跳到这节的检验就加 --force yes`)
  }
  // 需复习的节上次的步骤都做完了：追加一步检验；别的节步骤都做完了就直接判
  const allDone = l.steps.length && l.steps.every((x) => x.status === 'done')
  if (allDone && l.status !== 'review') fail(`第 ${l.id} 节的步骤都做完了，直接 learn done ${l.id} --pass|--fail --note "…"`)
  const extra = []
  const other = s.lessons.find((x) => x.status === 'in_progress' && x.id !== l.id)
  if (other) {
    const k = other.steps.filter((x) => x.status === 'done').length
    if (other.steps.length && k === other.steps.length) fail(`第 ${other.id} 节步骤都做完了还没检验：先 learn done ${other.id} --pass|--fail`)
    other.status = 'todo'
    if (k) extra.push(`第 ${other.id} 节做到第 ${k}/${other.steps.length} 步还没检验，已暂停；回来用 learn start ${other.id}（不带 --steps）接着做。`)
  }
  const reason = flags.reason ? String(flags.reason).slice(0, 80) : '用户说这节会了，直接检验'
  const isCheck = (st) => /检验|考核/.test(st.title)
  const last = l.steps[l.steps.length - 1]
  for (const st of l.steps) {
    if (st.status === 'done' || (st === last && isCheck(st))) continue
    st.status = 'done'
    st.result = `跳过：${reason}`
  }
  if (!last || !isCheck(last) || allDone) l.steps.push(...newSteps(['直接检验']))
  for (const st of l.steps) if (st.status !== 'done') { st.status = 'in_progress'; break }
  l.status = 'in_progress'
  l.forced = unmet.length > 0
  l.directCheck = true
  saveState(name, s, `第 ${l.id} 节跳过讲解，直接检验：${reason}`)
  extra.push(`已跳到检验。过了就算掌握（learn done ${l.id} --pass --note "…"）；没过（learn done ${l.id} --fail --note "…"）就告诉用户哪里没过，问要不要学这一节：要学就 learn start ${l.id} --steps '[…]' --force yes 重新拆步骤，不学就按 done 追加的补练步骤只补没过的那一项。`)
  return `${extra.join('\n')}\n${positionLine(s)}`
}

commands.switch = ({ pos, flags }) => {
  const name = pickCourse(flags)
  const s = loadState(name)
  const l = lesson(s, intArg(pos[0], '节号'))
  const m = need(pos[1], '新教法')
  if (!METHODS.includes(m)) fail(`教法非法：${m}。可选：${METHODS.join(', ')}`)
  const reason = need(pos[2] || flags.reason, '换教法的原因')
  const from = l.method
  l.method = m
  l.methodReason = reason
  l.methodHistory.push(m)
  if (flags.steps) {
    const steps = parseSteps(flags.steps)
    const kept = l.steps.filter((x) => x.status === 'done')
    l.steps = [...kept, ...newSteps(steps)]
    delete l.directCheck
  }
  saveState(name, s, `第 ${l.id} 节换教法：${METHOD_NAMES[from] || '无'} → ${METHOD_NAMES[m]}，原因：${reason}`)
  return `已换成${METHOD_NAMES[m]}。\n${positionLine(s)}`
}

commands.done = ({ pos, flags }) => {
  const name = pickCourse(flags)
  const s = loadState(name)
  const l = lesson(s, intArg(pos[0], '节号'))
  if (!!flags.pass === !!flags.fail) fail('必须且只能给 --pass 或 --fail 之一')
  const note = need(flags.note, '--note（检验证据：做对了哪道题、费曼判分各项结果）')
  const remedy = flags.fail && flags.steps ? parseSteps(flags.steps) : null
  l.attempts += 1
  // 跳过讲解直接检验的这一次检验记在检验记录上：教法统计不算它（跟教法无关）
  l.notes.push({ at: isoLocal(), pass: !!flags.pass, note, method: l.method, ...(l.directCheck ? { direct: true } : {}) })
  delete l.directCheck
  let msg
  if (flags.pass) {
    l.status = 'mastered'
    l.forced = false
    l.doneAt = isoLocal()
    for (const st of l.steps) if (st.status !== 'done') st.status = 'done'
    const n = nextLesson(s)
    if (!n && s.lessons.every(isDone)) msg = '全部小节已完成。下一步：结业考核（learn finish）。'
    else msg = n ? `下一节：第 ${n.id} 节「${n.title}」${n.method ? '' : '（还没细化，开始时用 learn start 补全）'}` : '没有可开始的下一节，检查前置关系。'
  } else {
    l.status = 'in_progress'
    // 检验没过：检验那一步记完，后面追加「补练 → 重新检验」，位置条接着往下走
    const open = l.steps.filter((x) => x.status !== 'done')
    if (open.length === 1 && open[0] === l.steps[l.steps.length - 1]) { open[0].status = 'done'; open[0].result = open[0].result || `未达标：${note}` }
    let added = ''
    // 没拆过步骤（想跳过、直接检验没过）：不追加，开始这一节时再细化
    if (l.steps.length && l.steps.every((x) => x.status === 'done')) {
      const titles = remedy || ['补练没过的那一项', '重新检验']
      l.steps.push(...newSteps(titles))
      added = `已追加 ${titles.length} 步：${titles.join(' → ')}。`
    } else if (remedy) fail(`第 ${l.id} 节还有没做完的步骤，先做完再检验；要改剩下的步骤用 learn switch ${l.id} ${l.method} "<原因>" --steps '[…]'`)
    const stuck = l.notes.slice(-2).every((x) => !x.pass) && l.notes.length >= 2
    msg = stuck ? `${added}这一节已连续 2 次未达标：按规则换教法（learn switch，带 --steps 会替换没做的步骤）。仍不行：缺本课前面某节 → 退回前置节（learn review --lesson <节>）；缺本课以外的技能 → learn prereq gap "<技能>" --reason "…"。` : `未达标。${added}针对没过的那一项继续练。`
  }
  saveState(name, s, `第 ${l.id} 节检验${flags.pass ? '通过' : '未通过'}：${note}`)
  let receipt = ''
  if (flags.pass && l.kind === 'prereq' && l.prereqSkill) {
    // 先修节只讲了本课要用的部分，所以记「会一点」
    receipt = '\n' + relay(profileWriteSafe((p) => addEvidence(p, { name: l.prereqSkill, type: 'lesson', level: 'partial', course: name, ref: `prereq-lesson-${l.id}`, detail: `先修节通过：${l.title}`.slice(0, MAX_DETAIL) })))
  }
  return `${msg}${receipt}\n${positionLine(s)}`
}

commands.review = ({ pos, flags }) => {
  const name = pickCourse(flags)
  const s = loadState(name)
  // learn review <节号> --lesson：把一节标为需复习
  if (flags.lesson) {
    const l = lesson(s, intArg(flags.lesson, '节号'))
    l.status = 'review'
    // 正在学的节依赖它：先暂停，位置条切到要复习的这节
    const lines = [`第 ${l.id} 节已标为需复习。`]
    for (const c of s.lessons) {
      if (c.status === 'in_progress' && c.id !== l.id && dependsOn(s, c, l.id)) {
        c.status = 'todo'
        lines.push(`第 ${c.id} 节先暂停（做过的步骤保留），先复习第 ${l.id} 节：learn start ${l.id} --steps '[…]'（复习要重新拆步骤）；复习过了再 learn start ${c.id} 接着做。`)
      }
    }
    saveState(name, s, `第 ${l.id} 节标为需复习：${flags.reason || ''}`)
    return `${lines.join('\n')}\n${positionLine(s)}`
  }
  const id = need(pos[0], '错题 id（如 m1）')
  const m = s.mistakes.find((x) => x.id === id)
  if (!m) fail(`没有错题 ${id}`)
  if (!!flags.pass === !!flags.fail) fail('必须且只能给 --pass 或 --fail 之一')
  // 只复习到期的；课上又犯了同样的错，可以随时 --fail 打回 1 天
  if (flags.pass && m.graduated) fail(`${id} 已移出错题本，不用再复习`)
  if (flags.pass && m.due > dateLocal()) fail(`${id} 还没到期（${m.due} 才复习）。讲课时当场复测不用 learn review，到期后 learn due 会列出它`)
  if (flags.pass) {
    m.stage += 1
    if (m.stage >= INTERVALS.length) { m.graduated = true; m.due = null }
    else m.due = addDays(dateLocal(), INTERVALS[m.stage])
  } else {
    m.stage = 0
    m.graduated = false
    m.due = addDays(dateLocal(), INTERVALS[0])
  }
  m.history = m.history || []
  m.history.push({ at: isoLocal(), pass: !!flags.pass })
  saveState(name, s, `复习 ${id}${flags.pass ? '通过' : '未通过'}`)
  if (!flags.pass) return `${id} 未通过，${m.due} 再复习。`
  return m.graduated ? `${id} 连续通过，已移出错题本。` : `${id} 通过，下次复习：${m.due}`
}

commands.mistake = ({ pos, flags }) => {
  const name = pickCourse(flags)
  const s = loadState(name)
  const l = lesson(s, intArg(pos[0], '节号'))
  const wrong = need(pos[1], '错误理解（用户原话）')
  const right = need(pos[2], '正确理解')
  const id = `m${s.mistakes.length + 1}`
  // --from：这个误解是把用户会的哪门技能的习惯带过来了；名字按画像 / 先修清单归一
  let from = null
  let fromNote = ''
  if (flags.from !== undefined) {
    const raw = checkSkillName(need(flags.from, '--from 的技能名'), '--from')
    const p = loadProfile()
    const sk = p.enabled ? findSkill(p, raw) : null
    const it = (s.prereq?.items || []).find((x) => [x.name, ...(x.aliases || [])].map(canonKey).includes(canonKey(raw)))
    from = sk?.name || it?.name || raw
    if (!sk && !it) fromNote = `「${raw}」不在画像和先修清单里，确认是用户会的技能。`
  }
  s.mistakes.push({ id, lesson: l.id, wrong, right, from, stage: 0, due: addDays(dateLocal(), INTERVALS[0]), graduated: false, createdAt: isoLocal() })
  saveState(name, s, `记错题 ${id}（第 ${l.id} 节${from ? `，来自 ${from} 的习惯` : ''}）：${wrong}`)
  return `已记为 ${id}${from ? `（来自 ${from} 的习惯）` : ''}，${addDays(dateLocal(), INTERVALS[0])} 复习。${fromNote}`
}

commands.due = ({ flags }) => {
  const name = pickCourse(flags)
  const s = loadState(name)
  const list = dueMistakes(s)
  if (!list.length) return '今天没有到期的复习。'
  return `今天到期 ${list.length} 条${list.length > 5 ? '（一次最多复习 5 条，其余顺延）' : ''}：\n`
    + list.slice(0, 5).map((m) => `  ${m.id}（第 ${m.lesson} 节，到期 ${m.due}${m.from ? `，来自 ${m.from} 的习惯：出一道按 ${m.from} 的习惯会做错的新预测题` : ''}）错误理解：${m.wrong}｜正确：${m.right}`).join('\n')
}

commands.ask = ({ pos, flags }) => {
  const name = pickCourse(flags)
  const s = loadState(name)
  const text = need(pos[0], '疑问原话')
  const cur = nextLesson(s)
  const id = `q${s.questions.length + 1}`
  s.questions.push({ id, lesson: flags.lesson ? Number(flags.lesson) : cur?.id ?? null, text, status: 'open', askedAt: isoLocal(), answer: null })
  saveState(name, s, `疑问 ${id}：${text}`)
  return `已记为 ${id}（未解决）。问的是本课以外的技能（如「X 是什么」）且卡住了本节，再 learn prereq gap "X" --reason "…"。`
}

commands.answer = ({ pos, flags }) => {
  const name = pickCourse(flags)
  const s = loadState(name)
  const q = s.questions.find((x) => x.id === need(pos[0], '疑问 id（如 q1）'))
  if (!q) fail(`没有疑问 ${pos[0]}`)
  q.answer = need(pos[1], '一句话结论')
  q.status = 'answered'
  q.answeredAt = isoLocal()
  saveState(name, s, `解决疑问 ${q.id}：${q.answer}`)
  return `${q.id} 已解决。`
}

commands.pause = ({ flags }) => {
  const name = pickCourse(flags)
  const s = loadState(name)
  const sess = touchSession(s)
  sess.summary = need(flags.summary, '--summary（这次学得怎么样）')
  sess.nextStart = need(flags.next, '--next（下次从哪开始）')
  sess.end = isoLocal()
  sess.closed = true
  saveState(name, s, `收尾：${sess.summary}；下次：${sess.nextStart}`, { session: false })
  return '已记录本次学习。下次打开会从这里接上。'
}

commands.finish = ({ flags }) => {
  const name = pickCourse(flags)
  const s = loadState(name)
  if (!!flags.pass === !!flags.fail) fail('必须且只能给 --pass 或 --fail 之一')
  const note = need(flags.note, '--note（终点考核的结果和证据）')
  if (flags.pass) {
    s.finished = true
    s.finishedAt = isoLocal()
  }
  s.exams = s.exams || []
  s.exams.push({ at: isoLocal(), pass: !!flags.pass, note })
  saveState(name, s, `结业考核${flags.pass ? '通过' : '未通过'}：${note}`)
  if (!flags.pass) return '未通过。把没过的部分对应的节标为需复习（learn review --lesson <节号>），回到小节循环。'
  const skill = s.goal?.profileSkill || s.title
  const out = ['已结业。如果开了每日复习提醒，记得删掉（schedule_delete）。']
  out.push(profileWriteSafe((p) => addEvidence(p, { name: skill, type: 'course', level: 'mastered', course: name, ref: 'exam', detail: `结业：${(s.goal?.exam || '').slice(0, 60)}` })))
  // 在等这门课的课程：把那项先修改成已会；先修名和 profileSkill 不同的，先修名本身也记一条（只覆盖那门课要用的部分，记「会一点」）
  const waiting = waitingCourses(name, s, [skill, s.title, name])
  const written = new Set([canonKey(skill)])
  for (const w of waiting) {
    setDone(w.it, 'known')
    w.it.note = `已学完课程 ${name}`
    saveOtherState(w.course, w.st, `先修「${w.it.name}」已在课程 ${name} 学完，改为已会`)
    if (!written.has(canonKey(w.it.name))) {
      written.add(canonKey(w.it.name))
      out.push(profileWriteSafe((p) => addEvidence(p, { name: w.it.name, type: 'course', level: 'partial', course: name, ref: `exam-for-${w.course}`, detail: `为课程 ${w.course} 单独学的课结业：${s.title}`.slice(0, MAX_DETAIL) })))
    }
  }
  if (waiting.length) out.push(`这些课程在等这门课学完：${waiting.map((w) => `${w.course}（先修「${w.it.name}」）`).join('、')}，已改为已会。告诉用户可以回去接着学（learn use <课程名>）。`)
  return out.join('\n')
}

commands.now = ({ flags }) => positionLine(loadState(pickCourse(flags)))

commands.status = ({ flags }) => {
  const idx = loadIndex()
  const names = Object.keys(idx.courses || {})
  if (names.length === 0) return '还没有任何课程。用户想学什么，就从立目标开始（learn init <课程名>）。'
  const name = pickCourse(flags)
  const s = loadState(name)
  const out = []
  const others = names.filter((n) => n !== name).map((n) => {
    let wait = []
    try { wait = (loadState(n).prereq?.items || []).filter((x) => x.decision === 'separate').map((x) => x.name) } catch {}
    const ago = daysBetween(idx.courses[n].lastActive)
    return `${n}（${ago === 0 ? '今天学过' : `${ago} 天没学`}${wait.length ? `，在等先修 ${wait.join('、')}` : ''}）`
  })
  out.push(`当前课程：${name}「${s.title}」${others.length ? `（另有：${others.join('、')}）` : ''}`)
  if (!s.goal) { out.push(`状态：还没立目标。下一步：${nextSetupStep(s)}`); return out.join('\n') }
  const goalNotes = [s.goal.deadline && `期限 ${s.goal.deadline}`, s.goal.minutesPerSession && `每次约 ${s.goal.minutesPerSession} 分钟，快到时收尾`].filter(Boolean)
  out.push(`目标：${s.goal.exam}${goalNotes.length ? `（${goalNotes.join('；')}）` : ''}`)
  if (!s.lessons.length) {
    if (s.prereq) out.push(prereqReport(s, { withNext: false }))
    if (s.baseline.length) out.push(`摸底：${s.baseline.map((b) => `${b.ability}=${b.level}`).join('，')}`)
    if (waitingItems(s).length) out.push(`等待先修：${waitingItems(s).map((x) => x.name).join('、')}（用户选了先单独学一门，学完再回来）`)
    out.push(`状态：还没出计划。下一步：${nextSetupStep(s)}`)
    return out.join('\n')
  }
  if (s.finished) { out.push(`已于 ${s.finishedAt.slice(0, 10)} 结业。`); return out.join('\n') }

  const done = s.lessons.filter((l) => l.status === 'mastered').length
  const cur = nextLesson(s)
  let prog = `进度：${s.lessons.length} 节中已掌握 ${done} 节`
  if (cur) {
    prog += `；当前第 ${cur.id} 节「${cur.title}」`
    if (cur.status === 'in_progress') {
      const p = stepProgress(cur)
      if (cur.method) prog += `，教法：${METHOD_NAMES[cur.method]}（加载 skill teach-${cur.method}）`
      if (p && p.step) prog += `，第 ${p.idx}/${p.total} 步「${p.step.title}」进行中`
      if (cur.attempts) prog += `，已检验 ${cur.attempts} 次`
    } else {
      const k = (cur.steps || []).filter((x) => x.status === 'done').length
      if (cur.status === 'todo' && k && cur.method) prog += `（已暂停，做完 ${k}/${cur.steps.length} 步，教法：${METHOD_NAMES[cur.method]}（加载 skill teach-${cur.method}）；接着做：learn start ${cur.id}，不带 --steps）`
      else prog += `（${STATUS_NAMES[cur.status]}${cur.method ? '' : '，还没细化'}）`
    }
  }
  out.push(prog)
  const orphan = orphanPrereqLessons(s)
  if (orphan.length) out.push(`⚠ ${orphanText(orphan)}`)
  if (cur?.passCriteria) out.push(criteriaLine(cur))
  // 检验备注：本节检验过就给本节最近一次，否则给最近检验过的那一节（细化新一节时参考）
  const lastNote = (l) => l.notes?.length ? l.notes[l.notes.length - 1] : null
  const clip = (x, n = 150) => (x.length > n ? `${x.slice(0, n)}…` : x)
  if (cur && lastNote(cur)) out.push(`本节上次检验（${lastNote(cur).pass ? '通过' : '未通过'}）：${clip(lastNote(cur).note)}`)
  else {
    const prev = s.lessons.filter((l) => lastNote(l)).sort((a, b) => lastNote(b).at.localeCompare(lastNote(a).at))[0]
    if (prev) out.push(`最近一次检验（第 ${prev.id} 节，${lastNote(prev).pass ? '通过' : '未通过'}）：${clip(lastNote(prev).note)}`)
  }
  const curMistakes = cur ? s.mistakes.filter((m) => m.lesson === cur.id && !m.graduated) : []
  if (curMistakes.length) out.push(`本节记过的错：${curMistakes.slice(0, 3).map((m) => `${m.id}「${m.wrong}」`).join('；')}${curMistakes.length > 3 ? ` 等 ${curMistakes.length} 条` : ''}`)

  // 上次学习：取最近一次有内容的会话
  const sessions = s.sessions.filter((x) => x.lastActive)
  const last = sessions[sessions.length - 1]
  if (last) {
    const ago = daysBetween(last.lastActive)
    const when = `${ago === 0 ? '今天' : `${ago} 天前`}，${shortTime(last.start)}–${(last.end || last.lastActive).slice(11, 16)}`
    if (last.closed) {
      out.push(`上次（${when}）：${last.summary}`)
      out.push(`上次说好的下次起点：${last.nextStart}`)
    } else if (hoursSince(last.lastActive) >= SESSION_GAP_HOURS) {
      out.push(`上次（${when}）：⚠ 没有正常收尾，以下是最后的记录`)
      const recent = (cur?.steps || []).filter((x) => x.result).slice(-2)
      for (const st of recent) out.push(`  - ${st.title}：${st.result}`)
      out.push('  开场先确认：最后那一步要重做还是接着做')
    } else {
      out.push(`本次学习进行中（从 ${shortTime(last.start)} 开始）`)
    }
    if (ago >= 14) out.push(`⚠ 已经 ${ago} 天没学：先快速摸底已掌握的节，测不过的标为需复习`)
  }

  const open = s.questions.filter((q) => q.status === 'open')
  if (open.length) {
    out.push('未解决的疑问：')
    for (const q of open) out.push(`  ${q.id}「${q.text}」（${q.askedAt.slice(5, 10)} 提出${q.lesson ? `，第 ${q.lesson} 节` : ''}）`)
  }
  const due = dueMistakes(s)
  if (due.length) out.push(`今天到期复习：${due.length} 条（${due.slice(0, 5).map((m) => `${m.id}：${m.wrong}`).join('；')}）`)

  // 先修和画像：只给本课用得上的几行，不倒出整份画像
  const pend = pendingItems(s)
  const untold = s.prereq?.untold?.length
  const pnext = s.prereq ? prereqNext(s) : null
  if (untold && !s.prereq.untold) writeJson(stateFile(name), s) // 已经让模型告诉用户了：记下，免得下次再说
  if (pend.length && pnext) {
    const src = new Set(pend.map((x) => x.source))
    const why = src.size === 1 && src.has('gap') ? '（课中发现的缺口）' : src.size === 1 && src.has('append') ? '（新阶段的先修）' : ''
    out.push(`先修还有 ${pend.length} 项没定${why}：\n${pnext}`)
  } else if (pnext) out.push(pnext)
  const items = s.prereq?.items || []
  const usesOf = (nm) => s.lessons.filter((l) => !isDone(l) && (l.uses || []).includes(nm)).map((l) => l.id)
  const listBy = (d) => items.filter((x) => x.decision === d).map((x) => {
    const ls = usesOf(x.name)
    return `${x.name}${ls.length ? `（第 ${ls.join('、')} 节要用）` : ''}`
  })
  if (listBy('inline').length) out.push(`边学边补的先修：${listBy('inline').join('、')}`)
  if (listBy('skip').length) out.push(`跳过的先修：${listBy('skip').join('、')}，卡住时先回头补`)
  if (listBy('separate').length) out.push(`等待先修：${listBy('separate').join('、')}（用户选了先单独学一门，学完再回来）`)
  const prof = loadProfile()
  // 先修节不打比方；正课进行中时给出完整的类比格式（续学的会话拿不到 start 的输出）
  const anchors = cur?.kind === 'prereq' ? [] : anchorsOf(s, prof)
  if (anchors.length && cur?.status === 'in_progress') out.push(bridgeGuide(anchors.map((a) => `${a.name}（${levelText(a.lv)}）`)))
  else if (anchors.length) out.push(`可类比（用户会的技能）：${anchors.map((a) => `${a.name}：${levelText(a.lv)}`).join('；')}`)
  if (!prof.enabled) out.push('画像：已暂停，不读不写，也不给跨课程的教法建议')
  else {
    const ms = methodStats()
    if (ms.suggest) out.push(`默认教法建议：${METHOD_NAMES[ms.suggest.m]}（跨课程首次检验通过 ${ms.suggest.v.firstPass}/${ms.suggest.v.lessons}）`)
  }

  out.push(positionLine(s))
  return out.join('\n')
}

// ---------- 先修问答命令 ----------

function newPrereq() { return { setAt: isoLocal(), none: null, asked: 0, quizSeq: 0, qStart: 0, batchNo: 0, batchKind: 'intake', items: [] } }

commands.prereq = ({ pos, flags }) => {
  const sub = pos[0] || 'show'
  const name = pickCourse(flags)
  const s = loadState(name) // 分不到验证题名额的项，读的时候已经定掉了
  if (sub === 'show') {
    if (s.prereq) {
      const untold = s.prereq.untold?.length
      const out = prereqReport(s)
      if (untold && !s.prereq.untold) writeJson(stateFile(name), s) // 已经让模型告诉用户了：记下，免得下次再说
      return out
    }
    // 早期建的课（有路线、没有先修问答这一步）：不补做，以后需要时再追加
    if (s.lessons.length) return '这门课建课时还没有先修问答这一步，不用补做。展开新阶段时用 learn prereq set --append 问新用到的技能；课中发现缺本课以外的技能用 learn prereq gap。'
    return `还没做先修问答。下一步：${nextSetupStep(s)}`
  }

  if (sub === 'set') {
    if (!s.goal) fail('先立目标（learn set-goal），再列先修')
    const has = s.prereq && s.prereq.items.length
    if (has && !flags.append) fail('已经有先修清单了。阶段展开时追加用 --append；课中发现缺口用 learn prereq gap')
    if (flags.none !== undefined) {
      const why = String(need(flags.none, '--none 的理由（为什么这门课用不到别的技能）')).slice(0, 80)
      if (has) fail('清单里已经有先修项了，不能再标「不需要」')
      s.prereq = s.prereq || newPrereq()
      s.prereq.none = why
      saveState(name, s, `先修：不需要（${why}）`)
      return `已记录：这门课不需要先修（${why}）。下一步：${nextSetupStep(s)}`
    }
    const input = readJsonArg(flags)
    const list = Array.isArray(input) ? input : input.items
    if (!Array.isArray(list) || !list.length) fail('先修清单必须是非空数组：[{"name":"Java","role":"core|general|related","reason":"本课用它做什么"}]；用不到别的技能就 --none "<理由>"')
    s.prereq = s.prereq || newPrereq()
    s.prereq.none = null
    const p = loadProfile()
    // 上限按这一次列的算（阶段追加也能加必需项）
    const count = { core: 0, general: 0, related: 0 }
    const added = []
    for (const x of list) {
      const nm = checkSkillName(need(x.name, '每项的 name'))
      if (!ROLES.includes(x.role)) fail(`「${nm}」的 role 非法：${x.role}（core 必需 / general 有帮助 / related 可类比）`)
      const reason = checkText(need(x.reason, `「${nm}」的 reason（本课哪部分用它做什么，60 字内）`), `「${nm}」的 reason`)
      if (reason.length > 60) fail(`「${nm}」的 reason 超过 60 字`)
      const k = canonKey(nm)
      if ([...s.prereq.items, ...added].some((y) => [y.name, ...(y.aliases || [])].map(canonKey).includes(k))) fail(`「${nm}」已在清单里`)
      count[x.role] += 1
      if (count[x.role] > ROLE_CAPS[x.role]) fail(`${ROLE_NAMES[x.role]}类一次最多 ${ROLE_CAPS[x.role]} 项。只列本课真正要用的`)
      const it = { name: nm, role: x.role, reason, cue: x.cue ? String(x.cue).slice(0, 80) : null, aliases: [], source: flags.append ? 'append' : 'intake', state: null, answer: null, decision: null, recommend: null, note: null, addedAt: isoLocal() }
      classifyItem(it, p)
      added.push(it)
    }
    // 上一批没有项在问会不会、等出验证题了，开新的一批，重新算验证题数（只剩待定怎么补的不拦着）
    if (!s.prereq.items.some((x) => x.state === 'ask' || x.state === 'quiz')) { s.prereq.qStart = s.prereq.quizSeq || 0; s.prereq.batchNo = (s.prereq.batchNo || 0) + 1 }
    for (const it of added) it.batch = s.prereq.batchNo
    s.prereq.batchKind = flags.append ? 'append' : 'intake'
    s.prereq.items.push(...added)
    const report = prereqReport(s)
    saveState(name, s, `先修清单${flags.append ? '追加' : ''}：${added.map((x) => `${x.name}[${ROLE_NAMES[x.role]}]`).join('、')}`)
    const known = added.filter((x) => x.decision === 'known' || x.decision === 'anchor')
    const tell = known.length ? `\n先用一句话告诉用户这些不再问及依据：${known.map((x) => `${x.name}：${decisionName(x)}，画像记录 ${levelText(skillLevel(findSkill(p, x.name)))}`).join('；')}` : ''
    return report + tell
  }

  if (sub === 'answer') {
    if (!s.prereq) fail('还没有先修清单，先 learn prereq set')
    // 一次提问问了几项：--json '[{"name":"Java","choice":"B","quote":"…"}]' 一起记，画像回执合成一行
    const many = flags.json !== undefined || flags.file !== undefined
    const list = many ? readJsonArg(flags) : [{ name: pos[1], choice: pos[2], quote: flags.quote }]
    if (!Array.isArray(list) || !list.length) fail('--json 要是非空数组：[{"name":"Java","choice":"B","quote":"用户原话（可省略）"}]')
    const rows = []
    for (const x of list) {
      const it = prereqItem(s, need(x?.name, many ? '每项的 name' : '技能名'))
      const letter = String(need(x.choice, many ? `「${it.name}」的 choice（A|B|C|D）` : '选项 A|B|C|D')).toUpperCase()
      if (!['A', 'B', 'C', 'D'].includes(letter)) fail(`${many ? `「${it.name}」的` : ''}选项只能是 A（能独立做）/ B（会一点，要查资料）/ C（没接触过）/ D（不确定）`)
      if (rows.some((r) => r.it === it)) fail(`「${it.name}」写了两次`)
      if (it.state !== 'ask') fail(`「${it.name}」现在不需要问会不会：${prereqLine(it)}`)
      const quote = x.quote ? checkText(x.quote, many ? `「${it.name}」的 quote` : '--quote', { quote: true }) : null
      rows.push({ it, letter, quote })
    }
    for (const r of rows) {
      r.it.answer = r.letter
      s.prereq.asked += 1
      r.ref = `prereq-a${s.prereq.asked}`
    }
    const recs = rows.filter((r) => ANSWER_LEVEL[r.letter])
    const unsure = rows.filter((r) => !ANSWER_LEVEL[r.letter]).map((r) => `「${r.it.name}」`)
    const unsureText = unsure.length ? `${many ? unsure.join('、') : ''}选了「不确定」，不记入。` : ''
    const receipt = !recs.length ? `画像：${unsureText}` : profileWriteSafe((p) => {
      const wasEmpty = !p.skills.length
      const add = (r) => addEvidence(p, { name: r.it.name, type: 'self', level: ANSWER_LEVEL[r.letter], course: name, ref: r.ref, detail: r.quote ? `「${r.quote}」` : `先修问答选 ${r.letter}${r.it.cue ? `（看到 ${r.it.cue} 问的）` : ''}` }, { brief: many })
      if (!many) return add(recs[0])
      // 一项写不进（如画像满了）不连累别的项；addEvidence 出错时还没改画像
      const parts = [], failed = []
      for (const r of recs) { try { parts.push(add(r)) } catch (e) { failed.push(`「${r.it.name}」没记入：${e.message}`) } }
      return `${parts.length ? `画像：已记入 ${parts.join('；')}。` : '画像：'}${unsureText}${failed.length ? `⚠ ${failed.join('；')}。` : ''}${parts.length ? '哪条不对，说「删掉某某那条」就删。' : ''}`
        + (wasEmpty && parts.length ? `\n画像存在 ${PROFILE}，只记学习相关的技能；查看：learn profile` : '')
    })
    for (const { it, letter } of rows) {
      if (it.role === 'core') {
        // 必需项不凭自述定成已会：都出验证题；分不到名额的由脚本转成问怎么补
        if (letter === 'C') setDecide(it, 'learn-first')
        else it.state = 'quiz'
      } else if (it.role === 'general') {
        if (letter === 'A' || letter === 'B') setDone(it, 'known')
        else if (letter === 'C') setDecide(it, 'inline')
        else setDone(it, 'inline')
      } else if (letter === 'A' || letter === 'B') it.state = 'quiz'
      else setDone(it, 'dropped')
    }
    const report = prereqReport(s)
    saveState(name, s, `先修${rows.map((r) => `「${r.it.name}」：选 ${r.letter}`).join('，')}`)
    // 画像回执放最后：最不容易被截掉
    return `${report}\n${relay(receipt)}`
  }

  if (sub === 'quiz') {
    if (!s.prereq) fail('还没有先修清单，先 learn prereq set')
    const it = prereqItem(s, need(pos[1], '技能名'))
    const level = need(pos[2], '档位 mastered|partial|none')
    if (!LEVELS.includes(level)) fail('档位只能是 mastered（答对并说出原因）/ partial（答对但说不出原因）/ none（答错）')
    if (it.state !== 'quiz') fail(`「${it.name}」现在不需要出验证题：${prereqLine(it)}`)
    const asks = s.prereq.items.filter((x) => x.state === 'ask')
    if (asks.length) fail(`先把这一批的「会不会」记完（还差：${asks.map((x) => x.name).join('、')}，learn prereq answer …），再出验证题；验证题名额要等会不会都记完才分`)
    const detail = checkText(need(flags.detail, '--detail（题目要点和回答）'), '--detail')
    s.prereq.quizSeq = (s.prereq.quizSeq || 0) + 1
    const receipt = profileWriteSafe((p) => addEvidence(p, { name: it.name, type: 'quiz', level, course: name, ref: `prereq-q${s.prereq.quizSeq}`, detail }))
    it.quizLevel = level
    if (it.role === 'related') setDone(it, level === 'none' ? 'dropped' : 'anchor')
    else if (level === 'mastered') setDone(it, 'known')
    else if (level === 'partial') { if (it.role === 'core') setDecide(it, 'inline'); else setDone(it, 'known') }
    else setDecide(it, it.role === 'core' ? 'learn-first' : 'inline')
    const report = prereqReport(s)
    saveState(name, s, `先修「${it.name}」验证题：${level}`)
    return `${report}\n${relay(receipt)}`
  }

  if (sub === 'decide') {
    if (!s.prereq) fail('还没有先修清单，先 learn prereq set')
    const changed = []
    const decideOne = (x, many) => {
      const it = prereqItem(s, need(x?.name, many ? '每项的 name' : '技能名'))
      if (changed.includes(it)) fail(`「${it.name}」写了两次`)
      const d = need(x.decision, many ? `「${it.name}」的 decision` : '决定 learn-first|inline|separate|skip')
      // 名额用完、没验证就不拿来打比方的可类比项：用户坚持说会、验证过了，可以改回拿来打比方
      const droppedRelated = it.role === 'related' && it.state === 'done' && it.decision === 'dropped' && !it.quizLevel && /名额用完/.test(it.note || '')
      if (d === 'known') {
        // 待定怎么补、或在等「先单独学一门」的项，用户后来验证过会了：改成已会。画像里要有验证过的记录
        if (it.state !== 'decide' && it.decision !== 'separate' && !droppedRelated) fail(`只有待定怎么补、选了「先单独学一门」、或名额用完没验证的可类比项能改成已会；「${it.name}」现在是：${prereqLine(it)}`)
        const p = loadProfile()
        if (!p.enabled) fail('画像暂停中，不能凭画像改成已会。可以改选 learn-first / inline / skip（选了先单独学一门的也可以继续等）；要不要恢复画像（learn profile on）由用户决定')
        const sk = findSkill(p, it.name)
        const lv = sk && skillLevel(sk)
        // 最近一次验证要在 180 天内、不是「不会」，也不是刚降过档等复核的
        if (!lv || !lv.verified || lv.stale || lv.level === 'none' || lv.basis.level === 'none' || lv.flags.includes('上次验证降了档，需复核')) fail(`画像里「${it.name}」最近一次验证没过、或还没有验证过的记录。先出 1 道验证题，learn profile verify "${it.name}" <档> --detail "…"，答对了再改成已会`)
      } else if (!DECISIONS.includes(d)) fail(`决定只能是：learn-first 先补 / inline 边学边补 / separate 先单独学一门 / skip 跳过`)
      // 问怎么补时选定的（包括后来改成已会的）都可以改
      if (!(d === 'known' && droppedRelated) && !(it.state === 'decide' || (it.state === 'done' && (DECISIONS.includes(it.decision) || (it.decision === 'known' && it.recommend))))) fail(`「${it.name}」不需要决定怎么补：${prereqLine(it)}`)
      setDone(it, d === 'known' && droppedRelated ? 'anchor' : d)
      if (x.note) it.note = String(x.note).slice(0, 80)
      else if (d === 'known') it.note = '后来验证过会了' // 原来的「名额用完没验证」不再成立
      changed.push(it)
    }
    if (flags['all-recommended']) {
      const dec = s.prereq.items.filter((x) => x.state === 'decide')
      if (!dec.length) fail('没有待定怎么补的先修')
      for (const x of dec) { setDone(x, x.recommend); changed.push(x) }
    } else {
      // 几项选得不一样：--json '[{"name":"Java","decision":"inline"}]' 一起记；中途有一项不合法就整批不记
      const many = flags.json !== undefined || flags.file !== undefined
      const list = many ? readJsonArg(flags) : [{ name: pos[1], decision: pos[2], note: flags.note }]
      if (!Array.isArray(list) || !list.length) fail('--json 要是非空数组：[{"name":"Java","decision":"learn-first|inline|separate|skip"}]')
      for (const x of list) decideOne(x, many)
    }
    const hints = []
    for (const x of changed) {
      if (x.decision === 'learn-first' && s.lessons.length) hints.push(`「${x.name}」先补：用 learn set-plan 插入 1-2 节 {"kind":"prereq","prereqSkill":"${x.name}"} 的先修节（用没用过的新 id，已有节不改号），用到它的节在 uses 里写上它`)
    }
    const report = prereqReport(s)
    saveState(name, s, `先修怎么补：${changed.map((x) => `${x.name}=${decisionName(x)}`).join('，')}`)
    return [report, ...hints].join('\n')
  }

  if (sub === 'gap') {
    // 课中发现缺本课以外的技能
    const nm = checkSkillName(need(pos[1], '技能名'))
    const reason = checkText(need(flags.reason, '--reason（卡在哪、本节用它做什么）'), '--reason')
    if (reason.length > 60) fail('--reason 超过 60 字')
    const lid = flags.lesson ? intArg(flags.lesson, '节号') : nextLesson(s)?.id
    s.prereq = s.prereq || newPrereq()
    const k = canonKey(nm)
    let it = s.prereq.items.find((x) => [x.name, ...(x.aliases || [])].map(canonKey).includes(k))
    if (!it) { it = { name: nm, role: 'core', reason, cue: null, aliases: [], source: 'gap', answer: null, addedAt: isoLocal() }; s.prereq.items.push(it) }
    it.reason = reason
    it.source = 'gap'
    setDecide(it, 'inline')
    it.note = lid ? `第 ${lid} 节学到时发现缺` : '课中发现缺'
    if (lid) {
      const l = lesson(s, lid)
      l.uses = l.uses || []
      if (!l.uses.includes(it.name)) l.uses.push(it.name)
    }
    const report = prereqReport(s)
    saveState(name, s, `课中发现缺先修「${it.name}」：${reason}`)
    return `先用用户会的技能把「${it.name}」本节要用的最小部分讲清（不超过 3 轮），再问要不要正式补（用户已经卡在这里，不再问会不会）。${lid ? `已记到第 ${lid} 节的 uses。` : ''}\n${report}`
  }

  fail('用法：learn prereq [show] | set --json \'[…]\' [--append] | set --none "<理由>" | answer <技能> <A|B|C|D> [--quote "…"] | answer --json \'[…]\' | quiz <技能> <档> --detail "…" | decide <技能> <决定> | decide --json \'[…]\' | decide --all-recommended | gap <技能> --reason "…" [--lesson <节>]')
}

// ---------- 画像命令 ----------

function renderProfile(p) {
  const out = [`学习者画像${p.enabled ? '' : '（已暂停：不读也不写）'}，文件：${PROFILE}`]
  if (!p.skills.length) out.push('还没有记录任何技能。')
  const sorted = [...p.skills].sort((a, b) => (b.lastUsedAt || b.createdAt).localeCompare(a.lastUsedAt || a.createdAt))
  for (const sk of sorted) {
    out.push(`${sk.id} ${sk.name}${(sk.aliases || []).length ? `（别名 ${sk.aliases.join('、')}）` : ''}：${levelText(skillLevel(sk))}`)
    for (const e of sk.evidence) out.push(`   ${e.id} ${EVIDENCE_NAMES[e.type]} ${LEVEL_NAMES[e.level]} ${e.at}${e.course ? ` · ${e.course}` : ''}${e.detail ? ` · ${e.detail}` : ''}`)
  }
  // 跨课程：来自已会技能的错题
  const idx = loadIndex()
  const traps = new Map() // 按归一后的技能名分组
  for (const n of Object.keys(idx.courses || {})) {
    let s
    try { s = loadState(n) } catch { continue }
    for (const m of s.mistakes) {
      if (!m.from) continue
      const k = canonKey(m.from)
      if (!traps.has(k)) traps.set(k, { name: findSkill(p, m.from)?.name || m.from, list: [] })
      traps.get(k).list.push(`${n} ${m.id}`)
    }
  }
  for (const { name, list } of traps.values()) out.push(`带着 ${name} 的习惯犯的错：${list.length} 条（${list.slice(0, 5).join('、')}）`)
  const ms = methodStats()
  if (ms.shown.length) out.push(`教法效果（来自课程记录，跨课程首次检验通过，满 3 节才算；清空画像不会删掉）：${ms.shown.map(([m, v]) => `${METHOD_NAMES[m]} ${v.firstPass}/${v.lessons}`).join('；')}${p.enabled ? '' : '（画像暂停中，不用来给教法建议）'}`)
  out.push('删一条证据：learn profile forget e<N> --name "<技能名>"；删整个技能：learn profile forget s<N> --name "<技能名>"；暂停：learn profile off；清空：learn profile reset --confirm yes')
  out.push('画像和课程进度互不影响：清空画像不会改动课程进度。')
  return out.join('\n')
}

commands.profile = ({ pos, flags }) => {
  const sub = pos[0] || 'show'
  if (sub === 'show') return renderProfile(loadProfile())
  // 开了同步时画像在 git 里：每次改完提交（没开同步时画像不进 git，这里什么也不提交）
  const r = profileCommand(sub, pos, flags)
  if (hasRemote()) commitAll(`画像：${sub}${pos[1] ? ` ${pos[1]}` : ''}`)
  return r
}

function profileCommand(sub, pos, flags) {
  const synced = hasRemote() ? '开了同步：同步仓库的历史记录里还留着删之前的版本。' : ''

  if (sub === 'add' || sub === 'verify') {
    const nm = checkSkillName(need(pos[1], '技能名'))
    const level = need(pos[2], '档位 mastered|partial|none')
    if (!LEVELS.includes(level)) fail('档位只能是 mastered / partial / none')
    if (!loadProfile().enabled) fail('画像已暂停（learn profile on 恢复）')
    const idx = loadIndex()
    const course = idx.current && fs.existsSync(stateFile(idx.current)) ? idx.current : null
    // 先修问答进行中的技能，回答要记在先修问答里，否则那一项会卡住、画像也会重复
    if (course) {
      let cs = null
      try { cs = loadState(course) } catch {}
      const it = (cs?.prereq?.items || []).find((x) => (x.state === 'ask' || x.state === 'quiz') && [x.name, ...(x.aliases || [])].map(canonKey).includes(canonKey(nm)))
      if (it) fail(`「${it.name}」正在先修问答里，用 learn prereq ${it.state === 'ask' ? 'answer' : 'quiz'} "${it.name}" … 记录，不要用 learn profile`)
    }
    if (sub === 'add') {
      // 用户亲口说的：只记自述，每次都记（不去重）；说自己会得更多，要出题后用 verify
      const quote = checkText(need(flags.quote, '--quote（用户原话）'), '--quote', { quote: true })
      return withProfile((p) => addEvidence(p, { name: nm, type: 'self', level, course, ref: null, detail: `「${quote}」` }))
    }
    const detail = checkText(need(flags.detail, '--detail（题目要点和回答）'), '--detail')
    return withProfile((p) => {
      p.seq.v = (p.seq.v || 0) + 1
      return addEvidence(p, { name: nm, type: 'quiz', level, course, ref: `verify-q${p.seq.v}`, detail })
    })
  }

  if (sub === 'forget') {
    const id = need(pos[1], 'id（技能 s<N> 或证据 e<N>）')
    // --name：核对这个 id 确实属于这个技能才删。开了同步时必须给：另一台电脑的记录合进来时编号可能会变
    const nm = flags.name !== undefined ? String(need(flags.name, '--name 的技能名')).trim() : null
    if (!nm && hasRemote()) fail(`开了同步，两台电脑的记录合并时编号可能会变。删的时候带上技能名，脚本核对后才删：learn profile forget ${id} --name "<技能名>"`)
    // 删掉的内容也从备份里清掉
    return withProfile((p) => {
      const mismatch = (owner) => {
        const cur = findSkill(p, nm)
        const now = cur ? `「${cur.name}」现在是 ${cur.id}，证据：${cur.evidence.map((e) => `${e.id}（${EVIDENCE_NAMES[e.type]}：${LEVEL_NAMES[e.level]}，${shortDate(e.at)}）`).join('、')}` : `画像里没有「${nm}」`
        fail(`${id} ${owner ? `现在是「${owner.name}」的` : '已经不存在'}，不是「${nm}」的（两台电脑的记录合并后编号可能变了），没有删。${now}。核对后用对的 id 再删`)
      }
      const named = (sk) => !nm || skillKeys(sk).includes(canonKey(nm))
      if (/^s\d+[a-z]*$/.test(id)) {
        const i = p.skills.findIndex((x) => x.id === id)
        if (i < 0) { if (nm) mismatch(null); fail(`没有技能 ${id}`) }
        if (!named(p.skills[i])) mismatch(p.skills[i])
        const [sk] = p.skills.splice(i, 1)
        return `画像：已删除技能「${sk.name}」（${id}）和它的 ${sk.evidence.length} 条证据。${synced}`
      }
      if (/^e\d+[a-z]*$/.test(id)) {
        const sk = p.skills.find((x) => x.evidence.some((e) => e.id === id))
        if (!sk) { if (nm) mismatch(null); fail(`没有证据 ${id}`) }
        if (!named(sk)) mismatch(sk)
        sk.evidence = sk.evidence.filter((e) => e.id !== id)
        if (!sk.evidence.length) {
          p.skills = p.skills.filter((x) => x !== sk)
          return `画像：已删除 ${id}；「${sk.name}」没有证据了，整条删除。${synced}`
        }
        return `画像：已删除 ${id}；「${sk.name}」现在算${levelText(skillLevel(sk))}。${synced}`
      }
      fail('id 格式是 s<N>（整个技能）或 e<N>（一条证据），先 learn profile 看 id')
    }, { purgeBackup: true })
  }

  if (sub === 'off' || sub === 'on') {
    return withProfile((p) => {
      p.enabled = sub === 'on'
      return p.enabled ? '画像：已恢复。' : '画像：已暂停。数据保留，暂停期间不读也不写，不再拿它打比方或跳过提问（恢复：learn profile on）。'
    })
  }

  if (sub === 'reset') {
    if (flags.confirm !== 'yes') fail(`清空不可恢复。先把后果告诉用户（将永久删除画像里的全部技能和证据，课程进度不受影响${synced ? '；开了同步：同步仓库的历史记录里还留着清空前的版本' : ''}），用户明确同意后再加 --confirm yes`)
    // 加锁清空；暂停状态保留（用户先说「别用」再说「全删」，之后也不该重新记）
    return withProfileLock(() => {
      const p = loadProfile()
      const n = p.skills.length
      const paused = p.enabled === false
      for (const f of [PROFILE, PROFILE_BAK]) fs.rmSync(f, { force: true })
      if (paused) writeJson(PROFILE, { ...emptyProfile(), enabled: false })
      return `画像：已清空（删除 ${n} 个技能，包括备份）。${paused ? '画像仍是暂停状态（恢复：learn profile on）。' : ''}${synced}各门课进度里的先修问答记录（选项、档位）不受影响，还留在课程里。`
    })
  }

  fail('用法：learn profile [show] | add <技能> <档> --quote "<用户原话>" | verify <技能> <档> --detail "<题目要点和回答>" | forget <s<N>|e<N>> --name "<技能名>" | off | on | reset --confirm yes')
}

// ---------- 工作区线索 ----------
// 只读清单文件（不读源码、不写任何文件），列出项目用到的技术，只用来提问

const CUE_FILES = ['package.json', 'tsconfig.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py',
  'go.mod', 'Cargo.toml', 'Gemfile', 'composer.json', 'pubspec.yaml', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'CMakeLists.txt']
const CUE_SKIP = new Set(['node_modules', 'dist', 'build', 'target', 'out', 'venv', 'env', '__pycache__', 'vendor', 'coverage'])
// 没有原型的对象：目录里有叫 constructor、__proto__ 的文件也不会误中
const CUE_RULES = Object.assign(Object.create(null), {
  'package.json': [['JavaScript', null], ['Node.js', null], ['TypeScript', /"typescript"/], ['React', /"react"/], ['Vue', /"vue"/], ['Angular', /"@angular\/core"/], ['Next.js', /"next"/], ['Nuxt', /"nuxt"/],
    ['Express', /"express"/], ['Koa', /"koa"/], ['NestJS', /"@nestjs\/core"/], ['Electron', /"electron"/], ['Vite', /"vite"/], ['Element Plus', /"element-(plus|ui)"/], ['Ant Design', /"antd"/],
    ['Tailwind CSS', /"tailwindcss"/], ['React Native', /"react-native"/], ['Svelte', /"svelte"/], ['MongoDB', /"mongoose"|"mongodb"/], ['MySQL', /"mysql2?"/], ['PostgreSQL', /"pg"/], ['Redis', /"(io)?redis"/]],
  'tsconfig.json': [['TypeScript', null]],
  'pom.xml': [['Java', null], ['Maven', null], ['Spring Boot', /spring-boot/], ['Spring Cloud', /spring-cloud/], ['MyBatis', /mybatis/], ['MySQL', /mysql/], ['Redis', /redis/], ['Kafka', /kafka/], ['Dubbo', /dubbo/]],
  'build.gradle': [['Gradle', null], ['Java', /java|spring/], ['Kotlin', /kotlin/], ['Spring Boot', /spring-boot/], ['Android', /com\.android/]],
  'requirements.txt': [['Python', null], ['Django', /\bdjango\b/], ['Flask', /\bflask\b/], ['FastAPI', /\bfastapi\b/], ['pandas', /\bpandas\b/], ['NumPy', /\bnumpy\b/],
    ['PyTorch', /\btorch\b/], ['TensorFlow', /\btensorflow\b/], ['Scrapy', /\bscrapy\b/], ['aiohttp', /\baiohttp\b/], ['SQLAlchemy', /\bsqlalchemy\b/], ['Celery', /\bcelery\b/]],
  'go.mod': [['Go', null], ['Gin', /gin-gonic/], ['GORM', /gorm/]],
  'Cargo.toml': [['Rust', null], ['Tokio', /tokio/], ['Axum', /axum/], ['Actix', /actix/]],
  Gemfile: [['Ruby', null], ['Rails', /rails/]],
  'composer.json': [['PHP', null], ['Laravel', /laravel/]],
  'pubspec.yaml': [['Dart', null], ['Flutter', /flutter/]],
  Dockerfile: [['Docker', null]],
  'docker-compose.yml': [['Docker', null]],
  'CMakeLists.txt': [['C++', /\bcxx\b|\.(cpp|cc|cxx|hpp)\b/], ['C', /\.c\b|languages[^)]*\bc\b/], ['CMake', null]],
})
CUE_RULES['build.gradle.kts'] = CUE_RULES['build.gradle']
CUE_RULES['docker-compose.yaml'] = CUE_RULES['docker-compose.yml']
for (const f of ['pyproject.toml', 'Pipfile', 'setup.py']) CUE_RULES[f] = CUE_RULES['requirements.txt']

commands.cues = ({ flags }) => {
  const dir = path.resolve(flags.dir || process.cwd())
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`不是目录：${dir}`)
  const dirs = [dir]
  try {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory() && !d.name.startsWith('.') && !CUE_SKIP.has(d.name)) dirs.push(path.join(dir, d.name))
      if (dirs.length > 60) break
    }
  } catch {}
  const found = new Map() // 技术 → 依据
  for (const d of dirs) {
    let names
    try { names = fs.readdirSync(d) } catch { continue }
    for (const f of names) {
      const rules = CUE_RULES[f] || (/\.csproj$/.test(f) ? [['C#', null], ['.NET', null]] : /\.sln$/.test(f) ? [['.NET', null]] : null)
      if (!rules) continue
      const file = path.join(d, f)
      let raw = ''
      try { if (fs.statSync(file).size < 300000) raw = fs.readFileSync(file, 'utf8') } catch {}
      let text = raw.toLowerCase()
      // package.json / composer.json 只看依赖字段的包名；解析不了就退回全文
      let deps = false
      if (f === 'package.json' || f === 'composer.json') {
        try {
          const j = JSON.parse(raw)
          const keys = f === 'package.json'
            ? Object.keys({ ...j.dependencies, ...j.devDependencies, ...j.peerDependencies, ...j.optionalDependencies })
            : Object.keys({ ...j.require, ...j['require-dev'] })
          text = keys.map((k) => `"${k.toLowerCase()}"`).join(' ')
          deps = true
        } catch {}
      }
      const rel = path.relative(dir, file).split(path.sep).join('/')
      let lang = false
      for (const [tech, re] of rules) {
        if (found.has(tech)) { if (tech === 'C' || tech === 'C++') lang = true; continue }
        if (!re) found.set(tech, rel)
        else if (re.test(text)) { found.set(tech, `${rel}（${deps ? '依赖里有它' : '文件里提到它'}）`); if (tech === 'C' || tech === 'C++') lang = true }
      }
      // CMake 看不出是 C 还是 C++：两个都列，分开问
      if (f === 'CMakeLists.txt' && !lang) for (const t of ['C', 'C++']) if (!found.has(t)) found.set(t, `${rel}（看不出是 C 还是 C++，分开问）`)
    }
  }
  if (!found.size) return `没找到项目线索（${dir}）。照常问用户会什么。`
  const lines = [...found.entries()].slice(0, 15).map(([t, why]) => `  ${t} ← ${why}`)
  return `项目线索（${dir}，只看了清单文件）：\n${lines.join('\n')}\n只用来提问：项目用到 ≠ 用户会，没扫到 ≠ 不会。问的时候说明是看到哪个文件才问的；用户回答后才会记进画像。`
}

// 当前完整路线：调整计划时在这上面改，再整体传给 set-plan
commands.plan = ({ flags }) => {
  const s = loadState(pickCourse(flags))
  if (!s.lessons.length) return `还没有路线。下一步：${nextSetupStep(s)}`
  const maxId = Math.max(...s.lessons.map((l) => l.id))
  const rows = s.lessons.map((l) => JSON.stringify({
    id: l.id, title: l.title, summary: l.summary || undefined, kind: l.kind === 'prereq' ? 'prereq' : undefined,
    prereqSkill: l.prereqSkill || undefined, requires: l.requires, uses: l.uses || [],
  }))
  const byStatus = (st) => s.lessons.filter((l) => l.status === st).map((l) => l.id)
  const info = ['mastered', 'in_progress', 'review', 'skipped'].filter((st) => byStatus(st).length).map((st) => `${STATUS_NAMES[st]}：${byStatus(st).join('、')}`)
  return `当前路线（调整时在这上面改，整体传给 learn set-plan；已有节不改号，新节用没用过的 id，现在最大是 ${maxId}）：\n[\n${rows.join(',\n')}\n]${info.length ? `\n状态（不用写进 set-plan，脚本保留）：${info.join('；')}` : ''}`
}

commands.skill = ({ pos, flags }) => {
  if (pos[0] !== 'add') fail('用法：learn skill add <skill 目录或 .md 文件> --global|--course')
  const src = path.resolve(need(pos[1], 'skill 来源路径'))
  if (!fs.existsSync(src)) fail(`找不到 ${src}`)
  if (!!flags.global === !!flags.course) fail('必须且只能给 --global（所有课程）或 --course（只给当前课程）之一')
  const isDir = fs.statSync(src).isDirectory()
  const md = isDir ? path.join(src, 'SKILL.md') : src
  if (!fs.existsSync(md)) fail(`${src} 里没有 SKILL.md`)
  const head = fs.readFileSync(md, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!head || !/^name:\s*\S+/m.test(head[1]) || !/^description:\s*\S+/m.test(head[1])) fail('SKILL.md 开头必须有含 name 和 description 的 YAML frontmatter')
  const skillName = head[1].match(/^name:\s*['"]?([^'"\n]+)/m)[1].trim()
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skillName)) fail(`skill 名「${skillName}」不合规：DSH 要求 name 只用小写字母、数字和连字符（如 python-quiz），改好 SKILL.md 再加`)
  let destRoot
  if (flags.global) destRoot = GLOBAL_SKILLS
  else destRoot = path.join(courseDir(pickCourse(flags)), 'skills')
  fs.mkdirSync(destRoot, { recursive: true })
  const dest = isDir ? path.join(destRoot, skillName) : path.join(destRoot, `${skillName}.md`)
  if (fs.existsSync(dest)) fail(`${dest} 已存在`)
  // 不带版本库目录（.git）：课程目录在学习记录的 git 里，嵌套的 .git 会让 skill 文件同步不过去
  fs.cpSync(src, dest, { recursive: true, filter: (p) => p === src || (path.basename(p) !== '.git' && !isJunk(path.basename(p))) })
  if (!flags.global) {
    const name = pickCourse(flags)
    saveState(name, loadState(name), `添加课程 skill：${skillName}`)
  }
  return `已添加 skill「${skillName}」到 ${dest}`
}

// 多台电脑同步：连仓库、看状态、手动拉推、冲突时选边
commands.sync = ({ flags }) => {
  if (flags.remote !== undefined) return syncSetup(String(need(flags.remote, '--remote 的仓库地址')).trim())
  const url = hasRemote()
  if (!url) return '还没连同步仓库。让用户在 GitHub 上建一个私有仓库，把地址给你，再运行：learn sync --remote <仓库地址>（如 git@github.com:<用户名>/<仓库名>.git）。仓库要用户自己建、这台电脑的 git 要能登录 GitHub。'
  if (flags.keep !== undefined) return syncKeep(String(flags.keep))
  syncPull()
  const st = loadSync()
  const out = [`同步仓库：${safeUrl(url)}`, ...syncNotes.splice(0)]
  if (st.conflict) {
    if (!out.some((x) => x.startsWith('⚠ 同步冲突'))) out.push(conflictText(st.conflict))
    return out.join('\n')
  }
  const why = pushNow({ wait: 35000 })
  if (why) out.push(`推送：没推上去（${why}）`)
  else if (!st.pullError) out.push('这台电脑和同步仓库已经一致。')
  return out.join('\n')
}

// 后台推送：另一个推送正在进行就排队等它（它只推自己那个提交，不等的话连着几条命令时最后一条会漏推）
commands._push = ({ pos }) => { pushNow({ sha: pos[0] || null, wait: pos[0] ? 60000 : 0 }); return null }

commands.help = () => `learn —— 学习进度脚本（数据目录：${HOME}）

课程   init <名> [--title 标题] [--for <课程>:<先修技能>] | use <名> | list | status | now
目标   set-goal --json '{"exam":"…","summary":"…","profileSkill":"…","deadline":"YYYY-MM-DD","minutesPerSession":45}'
先修   cues [--dir <目录>]                      看项目清单文件找线索（只用来提问）
       prereq set --json '[{"name":"Java","role":"core|general|related","reason":"本课用它做什么","cue":"pom.xml"}]' [--append]
       prereq set --none "<理由>"               这门课用不到别的技能
       prereq answer <技能> <A|B|C|D> [--quote "<用户原话>"]
       prereq answer --json '[{"name":"Java","choice":"B","quote":"<用户原话，可省略>"}]'   一次问了几项，一起记
       prereq quiz <技能> <mastered|partial|none> --detail "<题目要点和回答>"
       prereq decide <技能> <learn-first|inline|separate|skip> | prereq decide --all-recommended
       prereq decide --json '[{"name":"Java","decision":"inline"}]'   几项选得不一样，一起记
       prereq decide <技能> known               待定怎么补或「先单独学一门」的项：画像里已验证会了，改成已会
       prereq gap <技能> --reason "…" [--lesson <节>]   课中发现缺本课以外的技能
       prereq                                   看清单和下一步
摸底   baseline --json '[{"ability":"…","level":"mastered|partial|none","evidence":"…"}]'
计划   set-plan --json '[{"id":1,"title":"…","summary":"…","requires":[],"uses":["先修技能"]},{"id":2,"kind":"prereq","prereqSkill":"…",…}]' [--force yes]
       plan                                     输出当前完整路线（调整计划时在它上面改）
小节   start <节> --method <教法> --criteria "<达标标准>" --check "<检验方式>" --steps '["…","…"]' [--reason "…"]
       step <节> <步> --result "<结果>"         这一步做完了（默认）；只做了一半加 --partial
       check <节> [--reason "…"]                用户说这节会了、想跳过：讲解和练习记成跳过，直接到检验
       switch <节> <教法> "<原因>" [--steps '[…]']
       done <节> --pass|--fail --note "<检验证据>" [--steps '["补…","费曼检验"]']   没过时追加补练步骤（不给就追加默认两步）
疑问   ask "<原话>" [--lesson <节>] | answer <qid> "<结论>"
错题   mistake <节> "<错误理解>" "<正确理解>" [--from <带来误解的已会技能>] | due | review <mid> --pass|--fail
       review --lesson <节> [--reason "…"]   把一节标为需复习
收尾   pause --summary "<这次学得怎样>" --next "<下次从哪开始>"
结业   finish --pass|--fail --note "<考核结果>"
画像   profile | profile add <技能> <档> --quote "<用户原话>" | profile verify <技能> <档> --detail "…"
       profile forget <s<N>|e<N>> --name "<技能名>"（开了同步必须带，核对后才删） | profile off | profile on | profile reset --confirm yes
skill  skill add <路径> --global|--course
同步   sync --remote <私有仓库地址>             连同步仓库（多台电脑接着学；画像也同步）
       sync                                     手动拉一次、推一次，看同步状态
       sync --keep local|remote                 同步冲突时，冲突的课程留哪边（另一边存进备份分支；其他课程和画像照常合并）

教法：${METHODS.join(' / ')}
JSON 也可以用 --json -（标准输入）或 --file <路径> 传入。
所有课程命令都可加 --c <课程名> 指定课程，缺省为当前课程。`

// ---------- 入口 ----------

const NO_SYNC = new Set(['help', 'sync', '_push'])
const NO_LOCK = new Set(['help', '_push']) // 后台推送只拿推送锁，只推它启动时的那个提交

function pidAlive(pid) { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }

// 数据目录锁：两个学习窗口同时跑 learn 时排队，合并记录、写进度不会撞在一起。
// 锁文件里是持有者的进程号：先写好临时文件再硬链接过去，锁从出现起就带着进程号。
// 持有者已经退出、或锁超过 10 分钟、或内容不是进程号且超过 5 秒，算失效：改名后确认改走的就是读到的那把，再删
function withDataLock(fn) {
  fs.mkdirSync(HOME, { recursive: true })
  const mine = `${process.pid}\n`
  const tmp = `${DATA_LOCK}.${process.pid}.tmp`
  const deadline = Date.now() + 60000
  fs.writeFileSync(tmp, mine)
  try {
    for (;;) {
      try { fs.linkSync(tmp, DATA_LOCK); break } catch (e) {
        if (e.code !== 'EEXIST') throw e
        let seen = null
        let age = 0
        try { seen = fs.readFileSync(DATA_LOCK, 'utf8'); age = Date.now() - fs.statSync(DATA_LOCK).mtimeMs } catch { continue }
        const stale = (text, ms) => {
          const p = /^\d+\n?$/.test(text) ? Number(text) : 0
          return ms > 600000 || (p > 0 ? !pidAlive(p) : ms > 5000)
        }
        if (stale(seen, age)) {
          // 清理失效的锁要先拿「接管锁」，一次只让一个进程清；清之前再核对一遍还是那把失效的锁，免得删掉别人刚拿到的
          const tk = `${DATA_LOCK}.takeover.tmp` // .tmp：在 .gitignore 里
          let fd = null
          try { fd = fs.openSync(tk, 'wx') } catch (e2) {
            if (e2.code !== 'EEXIST') throw e2
            try { if (Date.now() - fs.statSync(tk).mtimeMs > 5000) fs.rmSync(tk, { force: true }) } catch {}
            sleepMs(20)
            continue
          }
          try {
            let again = null
            let age2 = 0
            try { again = fs.readFileSync(DATA_LOCK, 'utf8'); age2 = Date.now() - fs.statSync(DATA_LOCK).mtimeMs } catch {}
            if (again !== null && again === seen && stale(again, age2)) fs.rmSync(DATA_LOCK, { force: true })
          } finally {
            fs.closeSync(fd)
            fs.rmSync(tk, { force: true })
          }
          continue
        }
        if (Date.now() > deadline) fail(`另一个学习窗口正在读写进度，等它做完再试（一直这样的话，删掉 ${DATA_LOCK}）`)
        sleepMs(100)
      }
    }
  } finally {
    fs.rmSync(tmp, { force: true })
  }
  try {
    return fn()
  } finally {
    try { if (fs.readFileSync(DATA_LOCK, 'utf8') === mine) fs.rmSync(DATA_LOCK, { force: true }) } catch {}
  }
}

function shouldPull(cmd) {
  if (NO_SYNC.has(cmd) || !hasRemote()) return false
  const st = loadSync()
  return cmd === 'status' || st.needPull || !st.lastTryAt || hoursSince(st.lastTryAt) * 60 >= (st.pullError ? 30 : PULL_EVERY_MIN)
}

// 命令跑完：补提交没提交的改动、推到同步仓库、把同步提示放进输出
function afterCommand(cmd, out) {
  if (NO_SYNC.has(cmd) || !hasRemote()) return out
  commitAll(`learn ${cmd}`) // 画像等不经过 saveState 的改动
  const st = loadSync()
  const tail = []
  if (st.conflict) {
    if (cmd === 'status') { if (!syncNotes.some((x) => x.startsWith('⚠ 同步冲突'))) syncNotes.push(conflictText(st.conflict)) }
    else if (committed) tail.push('⚠ 同步冲突还没解决，这次的记录只存在这台电脑上。运行 learn sync 看详情，问用户留哪边。')
  } else if (cmd === 'pause' || cmd === 'finish') {
    let why = pushNow({ wait: 35000 })
    // 仓库里有别的电脑新推的：先拉下来合上，再推一次
    if (why && loadSync().needPull) {
      syncPull()
      why = loadSync().conflict ? '和同步仓库里的记录有冲突，运行 learn sync 看详情' : pushNow({ wait: 35000 })
    }
    tail.push(why ? `同步：没推上去（${why}）。换电脑之前，先让这台联网运行一次 learn sync。` : '同步：已推到同步仓库，换台电脑也能接着学。')
  } else if (committed || (cmd === 'status' && needsPush())) {
    if (cmd === 'status' && st.pushError && !st.needPull) syncNotes.push(`同步：这台有记录还没推上去（上次：${st.pushError}），这次再试。`)
    startPush()
  }
  if (cmd === 'status') return [...syncNotes, out].filter(Boolean).join('\n')
  return [out, ...syncNotes, ...tail].filter(Boolean).join('\n')
}

function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0] || 'help'
  const fn = Object.hasOwn(commands, cmd) ? commands[cmd] : null
  if (!fn) { console.error(`未知命令：${cmd}\n\n${commands.help()}`); process.exit(2) }
  try {
    const args = parseArgs(argv.slice(1))
    const out = NO_LOCK.has(cmd) ? fn(args) : withDataLock(() => {
      clearStaleGitLocks()
      recoverRebase()
      recoverMerge()
      ensureHome()
      if (shouldPull(cmd)) syncPull()
      return afterCommand(cmd, fn(args))
    })
    if (out) console.log(out)
    for (const w of warnings) console.log(`⚠ ${w}`)
  } catch (e) {
    if (e instanceof UserError) { console.error(`错误：${e.message}`); process.exit(1) }
    throw e
  }
}

main()
