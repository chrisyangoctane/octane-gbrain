/**
 * render.ts — turns Slack messages into one Markdown page per channel per day.
 *
 * Layout: `slack/<channel-name>/<YYYY-MM-DD>.md`, one file per channel-day, so a
 * busy channel becomes many modest pages instead of one huge page. Each message
 * is one line in the form the conversation parser already recognizes:
 *
 *     **Speaker** HH:MM — message text
 *
 * Replies retain their own speaker anchors and parent timestamp. Timestamps are rendered in the workspace's
 * configured timezone (default UTC), so a day never splits across two files
 * because of the viewer's clock.
 *
 * Text is passed through unchanged except for the characters that would break
 * the line format: newlines become a continuation indent, and a leading `**`
 * or `#` at the start of a line is escaped so the message cannot forge a new
 * speaker line or a heading.
 */

export interface SlackMessage {
  /** Slack message timestamp, e.g. "1700000000.000100". Unique per channel. */
  ts: string;
  /** Set on thread replies; equals the parent's `ts`. */
  thread_ts?: string;
  /** Set on a thread parent; the parent's `ts` equals its `thread_ts`. */
  reply_count?: number;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  /** Attached file names, when Slack reports files. */
  files?: { name?: string; title?: string }[];
}

export interface RenderInput {
  channelId: string;
  channelName: string;
  /** Map of Slack user id → display name. Unknown ids render as the raw id. */
  users: Map<string, string>;
  /** Timezone for day boundaries and HH:MM. Defaults to UTC. */
  timeZone?: string;
}

export interface RenderedDay {
  /** Relative path inside the source directory, e.g. "slack/tech-team/2026-10-15.md". */
  relPath: string;
  /** Calendar day, YYYY-MM-DD. */
  day: string;
  content: string;
  messageCount: number;
}

/** Returns the local calendar day and HH:MM for a Slack ts in the given timezone. */
export function slackTsParts(ts: string, timeZone = 'UTC'): { day: string; time: string; iso: string } {
  if(!/^\d+(\.\d{1,6})?$/.test(ts)) throw new Error('invalid Slack timestamp');
  const ms = Math.floor(Number(ts) * 1000);
  if (!Number.isFinite(ms)) throw new Error(`invalid Slack timestamp: ${ts}`);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  return { day, time, iso: new Date(ms).toISOString() };
}

/** Escapes a message body so it cannot start a speaker line, heading or frontmatter block. */
export function escapeBody(text: string): string {
  return text
    .split('\n')
    .map((line, i) => {
      let out = line;
      if (/^\s*(\*\*|#|---|```)/.test(out)) out = `\\${out}`;
      return i === 0 ? out : `  ${out}`;
    })
    .join('\n');
}

/** Replaces `<@U123>` mentions with display names and strips Slack's `<url|label>` wrapping. */
export function resolveMentions(text: string, users: Map<string, string>): string {
  return text
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (_m, id: string) => `@${users.get(id) ?? id}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, (_m, name: string) => `#${name}`)
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_m, url: string, label: string) => `[${label}](${url})`)
    .replace(/<(https?:\/\/[^>]+)>/g, (_m, url: string) => url);
}

function speakerOf(msg: SlackMessage, users: Map<string, string>): string {
  if (msg.user) return users.get(msg.user) ?? msg.user;
  if (msg.bot_id) return `bot:${msg.bot_id}`;
  return msg.subtype ?? 'unknown';
}

function messageLine(msg: SlackMessage, input: RenderInput): string {
  const { time } = slackTsParts(msg.ts, input.timeZone);
  let text = resolveMentions(msg.text ?? '', input.users);
  if (msg.files?.length) {
    const names = msg.files.map((f) => f.title ?? f.name ?? 'file').join(', ');
    text = text ? `${text}\n[attached: ${names}]` : `[attached: ${names}]`;
  }
  return `**${speakerOf(msg, input.users).replace(/[\r\n*]/g,' ')}** ${time} — ${escapeBody(text || '(no text)')}${msg.thread_ts && msg.thread_ts !== msg.ts ? ` (reply to ${msg.thread_ts})` : ''}`;
}

/**
 * Groups messages into channel-days. Thread replies sit under their parent, in
 * timestamp order; a reply whose parent is outside the fetched window still
 * renders, under its own day, so nothing is lost.
 */
export function renderChannelDays(messages: SlackMessage[], input: RenderInput): RenderedDay[] {
  const tz = input.timeZone ?? 'UTC';
  if(!/^[a-zA-Z0-9_-]+$/.test(input.channelName)) throw new Error('Invalid Slack channel path');
  const sorted = [...messages].sort((a, b) => Number(a.ts) - Number(b.ts));
  const byDay = new Map<string, SlackMessage[]>();
  for (const m of sorted) {
    const { day } = slackTsParts(m.ts, tz);
    const list = byDay.get(day) ?? [];
    list.push(m);
    byDay.set(day, list);
  }
  const out: RenderedDay[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const dayMsgs = byDay.get(day)!;
    const lines: string[] = [];
    for (const m of dayMsgs) {
      const line = messageLine(m, { ...input, timeZone: tz });
      lines.push(line);
    }
    const content = [
      '---',
      `title: "#${input.channelName} — ${day}"`,
      `type: slack`,
      `date: ${day}`,
      `channel_id: ${input.channelId}`,
      `channel_name: ${input.channelName}`,
      `message_count: ${dayMsgs.length}`,
      '---',
      '',
      `# #${input.channelName} — ${day}`,
      '',
      lines.join('\n\n'),
      '',
    ].join('\n');
    out.push({
      relPath: `slack/${input.channelName}/${day}.md`,
      day,
      content,
      messageCount: dayMsgs.length,
    });
  }
  return out;
}
