// 聊天行的分组逻辑（纯函数，不依赖 React Native）。
//
// 服务端只按时间顺序推消息，页面需要三样东西：日期分隔、玩家进出的系统行、
// 以及 Telegram 式的「同一人连发并成一组」。放在这里是为了能脱离 UI 单独验证，
// 页面和设置页预览共用同一份结果。

export interface ChatLike {
  boot: number;
  seq: number;
  ts: number;
  /** 0 = 游戏内玩家，1 = 手机 App，2 = 加入，3 = 退出，4 = 服务器，5 = AllMusic，6 = 成就，7 = 点歌结果（本地） */
  kind: number;
  name: string;
  text: string;
  /** 来源服务器显示名；空/undefined 表示本服（群组服里才有值） */
  srv?: string;
  /** 结构化附件的 JSON 数组字符串；空表示没有 */
  att?: string;
  /** 玩家所在队伍名（ServerUtilities）；空表示没有队伍 */
  team?: string;
  /** 队伍颜色码字符（MC 的 `d` / `b` …）；空表示没有队伍或旧服务端 */
  teamColor?: string;
  /** 玩家所在世界的显示名；空表示不知道（服务器广播、App 消息、旧服务端都没有） */
  world?: string;
}

/** 居中系统行的来源 */
export type SystemVariant = 'join' | 'leave' | 'achievement' | 'music';

export type ChatRow =
  | { type: 'day'; key: string; ts: number; label: string }
  | { type: 'system'; key: string; msg: ChatLike; join: boolean; variant: SystemVariant }
  | {
      type: 'group';
      key: string;
      name: string;
      kind: number;
      mine: boolean;
      /** 来源服务器显示名，本服为空（设置页预览这类手工构造的行可以不填） */
      srv?: string;
      /** 队伍名，没有队伍为空 */
      team?: string;
      /** 队伍颜色码（MC 的 `d` / `b` …），名字用它上色；空表示没有队伍 */
      teamColor?: string;
      /** 玩家所在世界显示名；空表示不知道 */
      world?: string;
      msgs: ChatLike[];
    };

/** 同一发送者间隔不超过 5 分钟才并组（已批准的规则） */
export const MERGE_MS = 5 * 60 * 1000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 本地日期键：YYYY-MM-DD（不参与显示，只用来判断跨天） */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 日期分隔的文案：今天 / 昨天 / 9月1日 / 2025年12月24日 */
export function dayLabel(ts: number, now: number): string {
  const key = dayKey(ts);
  if (key === dayKey(now)) return '今天';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (key === dayKey(y.getTime())) return '昨天';
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

type GroupRow = Extract<ChatRow, { type: 'group' }> & {
  /** 分组身份：kind + 名字，App 与游戏内同名玩家不能并到一起 */
  ident: string;
  /** 组内最后一条的时间，用来判断 5 分钟窗口 */
  lastTs: number;
};

/**
 * 把按时间升序的消息整理成可渲染的行。
 *
 * @param msgs 时间升序（ChatProvider 已经保证）
 * @param opts.mine 自己的聊天昵称，用来判断哪些消息靠右
 * @param opts.now 仅测试用，固定「今天」的参照时间
 */
export function buildRows(
  msgs: ChatLike[],
  opts: { mine: string; now?: number; showJoinLeave?: boolean; showAchievements?: boolean },
): ChatRow[] {
  const now = opts.now ?? Date.now();
  const showJoinLeave = opts.showJoinLeave !== false;
  const showAchievements = opts.showAchievements !== false;
  const out: ChatRow[] = [];
  let currentDay = '';
  let group: GroupRow | null = null;

  for (const m of msgs) {
    const isJoinLeave = m.kind === 2 || m.kind === 3;
    const isAchievement = m.kind === 6;
    // 点歌结果只在这台手机上（本地插入），和进出/成就一样走居中行
    const isMusicNote = m.kind === 7;
    const isSystem = isJoinLeave || isAchievement || isMusicNote;
    // 关闭提示时直接跳过：既不留空日期头，也不打断同一人的 5 分钟合并
    if (isJoinLeave && !showJoinLeave) continue;
    if (isAchievement && !showAchievements) continue;

    const key = dayKey(m.ts);
    if (key !== currentDay) {
      currentDay = key;
      out.push({ type: 'day', key: `day:${key}`, ts: m.ts, label: dayLabel(m.ts, now) });
      group = null;
    }

    if (isSystem) {
      const variant: SystemVariant = isAchievement
        ? 'achievement'
        : isMusicNote
          ? 'music'
          : m.kind === 2
            ? 'join'
            : 'leave';
      out.push({ type: 'system', key: `sys:${m.boot}:${m.seq}`, msg: m, join: m.kind === 2, variant });
      group = null;
      continue;
    }

    // 分组身份要带上来源服务器和世界：群组服里不同子服可以有同名玩家，
    // 同一个人换了世界也要另起一组（否则世界标签会挂在整组头上，后面的消息全是错的）
    const srv = m.srv ?? '';
    const world = m.world ?? '';
    // 队伍也算分组身份：换了队伍要另起一组
    const ident = `${m.kind}:${srv}:${world}:${m.team ?? ''}:${m.name}`;
    if (group && group.ident === ident && m.ts - group.lastTs <= MERGE_MS) {
      group.msgs.push(m);
      group.lastTs = m.ts;
      continue;
    }

    group = {
      type: 'group',
      key: `grp:${m.boot}:${m.seq}`,
      name: m.name,
      kind: m.kind,
      mine: m.kind === 1 && m.name === opts.mine,
      srv,
      team: m.team ?? '',
      teamColor: m.teamColor ?? '',
      world,
      msgs: [m],
      ident,
      lastTs: m.ts,
    };
    out.push(group);
  }

  return out;
}
