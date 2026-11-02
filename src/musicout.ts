// AllMusic 输出的解析（纯函数，音乐面板和聊天页的命令面板共用）。
//
// 桥接插件把 AllMusic 的 `sendMessage` 原文收回来，行长得像：
//   `1->歌名 | 歌手 | 专辑[点我选择]`
//   `[肥猫电台]正在播放：xxx`
//   `/music list 查看歌曲队列[点我选择]`
// 这里只做两件事：把「可点的搜索结果行」解析成结构化条目，把错误码翻译成人话。

export interface MusicEntry {
  /** 搜索结果里的序号（`1->` 的 1），`select` 时用 */
  index: number;
  title: string;
  artist: string;
  album: string;
  /** 去掉 `[点我…]` 提示后的原文，找不到结构时作为后备显示 */
  raw: string;
}

/** 去掉 AllMusic 附在行尾的 `[点我选择]` / `[点我查看]` 之类提示 */
export function stripHints(text: string): string {
  return text.replace(/\[点我[^\]]*\]/g, '').trim();
}

/** 解析 `1->歌名 | 歌手 | 专辑` 这类行；解析不出来的行直接跳过 */
export function parseEntries(lines: string[]): MusicEntry[] {
  const out: MusicEntry[] = [];
  for (const raw of lines) {
    const text = stripHints(raw);
    const m = text.match(/^\s*(\d+)\s*(?:->|[-:])\s*(.+)$/);
    if (!m) continue;
    const parts = m[2].split('|').map((s) => s.trim());
    out.push({
      index: Number(m[1]),
      title: parts[0] || '',
      artist: parts[1] || '',
      album: parts[2] || '',
      raw: text,
    });
  }
  return out;
}

/** 这组输出像不像搜索结果（有 `n->` 行就是） */
export function looksLikeSearch(lines: string[]): boolean {
  return parseEntries(lines).length > 0;
}

/** 错误码 → 人话。`code` 为空时退到最后一行的原文 */
export function friendly(code: string, lines: string[] = []): string {
  if (!code) return lines.length ? lines[lines.length - 1] : '音乐操作失败';
  if (code.startsWith('RATE_LIMITED')) return code.replace(/^RATE_LIMITED:?/, '') || '操作太频繁，请稍后再试';
  switch (code) {
    case 'MUSIC_NO_PLAYER':
      return '这个绑定码还没有记录玩家名。请先在游戏里上线一次，或重新放置监控器。';
    case 'MUSIC_DISABLED':
      return '服务器没有开启音乐功能（config 的 [music] enabled=false）。';
    case 'MUSIC_UNAVAILABLE':
    case 'BRIDGE_UNAVAILABLE':
      return '连不上代理上的 AEMobileBridge（检查插件是否启用、host/port/密钥是否一致）。';
    case 'BRIDGE_DISABLED':
      return '服务器没有开启通用命令桥（config 的 [bridge] enabled=false）。';
    case 'BAD_SECRET':
      return '命令桥密钥不一致：后端 [bridge] secret 和 BC 插件 config.yml 的 secret 要相同。';
    case 'BAD_PLAYER':
      return '玩家名不合法，无法以该身份执行命令。';
    case 'COMMAND_NOT_ALLOWED:music':
      return '桥接插件没有允许 music 命令（config.yml 的 allow-commands 加上 music）。';
    case 'UNKNOWN_COMMAND':
      return '服务器没有这个命令：确认 AllMusic 已安装在 BC 代理上。';
    case 'MUSIC_NO_RESPONSE':
    case 'MUSIC_BAD_RESPONSE':
      return '音乐桥没有返回有效结果，请稍后再试。';
    case 'NO_MUSIC_SESSION':
      return '服务器当前没有音乐会话（需要至少一名装了 AllMusic 的玩家在线）。搜歌和队列仍然可用。';
    case 'TOO_MANY_ARGS':
      return '参数太多了。';
    default:
      return code;
  }
}

// ---------------------------------------------------------------- 可点条目
//
// AllMusic 的返回不只是文本：搜索结果、队列、help 列表里都带 `[点我选择]` /
// `[点我查看]`，游戏里点那个提示就能执行。App 要把同一套交互还原出来，
// 所以这里把每行分成「可点动作」和「纯文本」。

export type MusicActionKind = 'select' | 'command';

export interface MusicAction {
  kind: MusicActionKind;
  /** 主文本：歌名，或 `/music stop` */
  label: string;
  /** 副文本：歌手 · 专辑，或命令说明 */
  sub: string;
  /** select 用：搜索结果序号 */
  index?: number;
  /** command 用：子命令与参数 */
  cmd?: string;
  args?: string[];
  /** 命令里还带占位符（`[音乐ID]`、`(序号)`），点了要先填参数 */
  needsArg?: boolean;
  raw: string;
}

export interface ParsedOutput {
  actions: MusicAction[];
  texts: string[];
}

/** 行尾的 `[点我选择]` / `[点我查看]` */
const CLICKABLE = /\[点我[^\]]*\]\s*$/;
/** 行里的 `/music` 之后那段（后面再按词切） */
const MUSIC_CMD = /\/music\s+(.*)$/;

/** 是不是占位符：`[音乐ID]`、`(序号)`、`（序号）` */
function isPlaceholder(token: string): boolean {
  return /^[\[(（]/.test(token);
}

/**
 * 把 `/music` 后面那段切成「子命令 + 参数」。
 *
 * 规则：英文/数字词是命令和参数，遇到占位符就停下并标记 `needsArg`
 * （`/music [音乐ID] 来点歌` 这种占位符在第一位的，`cmd` 为空、占位符进 args）。
 * 中文说明文字直接截断。
 */
function splitCommand(body: string): {
  cmd: string;
  args: string[];
  needsArg: boolean;
  label: string;
  desc: string;
} {
  const tokens = body.split(/\s+/).filter(Boolean);
  let cmd = '';
  const args: string[] = [];
  let needsArg = false;
  let desc = '';

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isPlaceholder(t)) {
      args.push(t);
      needsArg = true;
      continue;
    }
    if (/^[A-Za-z0-9_-]+$/.test(t)) {
      if (!cmd) cmd = t;
      else args.push(t);
      continue;
    }
    // 第一个非命令词就是中文说明，剩下的全是说明
    desc = tokens.slice(i).join(' ');
    break;
  }

  return {
    cmd,
    args,
    needsArg,
    label: `/music ${[cmd, ...args].filter(Boolean).join(' ')}`.trim(),
    desc,
  };
}

/**
 * 把 AllMusic 的输出拆成「可点动作」和「纯文本」。
 *
 * 认两种行：
 *   - `1->歌名 | 歌手 | 专辑` —— 搜索结果，点了 `select 1`；
 *   - `[肥猫电台]/music stop 停止播放歌曲[点我选择]` —— help/队列里的可点提示，
 *     点了执行那条命令（带 `[ID]`/`(序号)` 占位符的先进参数模式）。
 */
export function parseOutput(lines: string[]): ParsedOutput {
  const actions: MusicAction[] = [];
  const texts: string[] = [];

  for (const raw of lines) {
    const stripped = stripHints(raw);
    if (!stripped) continue;

    // 1) 搜索结果 / 队列条目
    const m = stripped.match(/^\s*(\d+)\s*(?:->|[-:])\s*(.+)$/);
    if (m) {
      const parts = m[2].split('|').map((s) => s.trim());
      actions.push({
        kind: 'select',
        label: parts[0] || '',
        sub: [parts[1], parts[2]].filter(Boolean).join(' · '),
        index: Number(m[1]),
        raw: stripped,
      });
      continue;
    }

    // 2) 带 `[点我…]` 的命令提示
    if (CLICKABLE.test(raw)) {
      const body = stripped.replace(/^\[[^\]]*\]\s*/, ''); // 去掉 [肥猫电台] 这类前缀
      const cmdMatch = body.match(MUSIC_CMD);
      if (cmdMatch) {
        const parsed = splitCommand(cmdMatch[1]);
        if (parsed.cmd || parsed.args.length) {
          actions.push({
            kind: 'command',
            label: parsed.label,
            sub: parsed.desc,
            cmd: parsed.cmd,
            args: parsed.args,
            needsArg: parsed.needsArg,
            raw: stripped,
          });
          continue;
        }
      }
    }

    texts.push(stripped);
  }

  return { actions, texts };
}
