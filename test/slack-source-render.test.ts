import { describe, expect, test } from 'bun:test';
import {
  renderChannelDays,
  resolveMentions,
  slackTsParts,
  escapeBody,
  type SlackMessage,
} from '../src/core/slack/render.ts';
import { parseConversation } from '../src/core/conversation-parser/parse.ts';

const users = new Map([
  ['U1', 'Alice Example'],
  ['U2', 'Bob Example'],
]);

function msg(ts: string, text: string, extra: Partial<SlackMessage> = {}): SlackMessage {
  return { ts, user: 'U1', text, ...extra };
}

describe('slackTsParts', () => {
  test('renders day and HH:MM in UTC by default', () => {
    // 2026-10-15T20:01:07Z
    const parts = slackTsParts('1792094467.000100');
    expect(parts.day).toBe('2026-10-15');
    expect(parts.time).toBe('20:01');
  });

  test('respects the configured timezone at a day boundary', () => {
    // 2026-10-15T23:30:00Z is 2026-10-16 08:30 in Asia/Shanghai (UTC+8)
    const ts = String(Date.UTC(2026, 9, 15, 23, 30) / 1000);
    expect(slackTsParts(ts, 'UTC').day).toBe('2026-10-15');
    expect(slackTsParts(ts, 'Asia/Shanghai')).toMatchObject({ day: '2026-10-16', time: '07:30' });
  });

  test('rejects a non-numeric timestamp', () => {
    expect(() => slackTsParts('not-a-ts')).toThrow(/invalid Slack timestamp/);
  });
});

describe('resolveMentions', () => {
  test('replaces user mentions with display names and unwraps links', () => {
    const out = resolveMentions('hi <@U1> see <https://example.com/a|the doc> and <https://example.com/b>', users);
    expect(out).toBe('hi @Alice Example see [the doc](https://example.com/a) and https://example.com/b');
  });

  test('keeps the raw id for an unknown user', () => {
    expect(resolveMentions('ping <@U9>', users)).toBe('ping @U9');
  });

  test('turns channel links into #name', () => {
    expect(resolveMentions('see <#C1|tech-team>', users)).toBe('see #tech-team');
  });
});

describe('escapeBody', () => {
  test('escapes a line that would forge a speaker or heading', () => {
    expect(escapeBody('**Mallory** 09:00 — fake')).toBe('\\**Mallory** 09:00 — fake');
    expect(escapeBody('# heading')).toBe('\\# heading');
  });

  test('indents continuation lines so a multi-line message stays one entry', () => {
    expect(escapeBody('first\nsecond')).toBe('first\n  second');
  });
});

describe('renderChannelDays', () => {
  test('one page per channel-day, sorted by day, messages in time order', () => {
    const days = renderChannelDays(
      [
        msg('1792094467.000100', 'later on the 15th'),
        msg('1791936000.000100', 'earlier on the 14th'),
        msg('1792022400.000100', 'early on the 15th'),
      ],
      { channelId: 'C1', channelName: 'tech-team', users },
    );
    expect(days.map((d) => d.relPath)).toEqual([
      'slack/tech-team/2026-10-14.md',
      'slack/tech-team/2026-10-15.md',
    ]);
    expect(days[1]!.messageCount).toBe(2);
    const body = days[1]!.content;
    expect(body.indexOf('early on the 15th')).toBeLessThan(body.indexOf('later on the 15th'));
  });

  test('writes the speaker line the conversation parser recognizes', () => {
    const [day] = renderChannelDays([msg('1792094467.000100', 'hello team')], {
      channelId: 'C1', channelName: 'tech-team', users,
    });
    expect(day!.content).toContain('**Alice Example** 20:01 — hello team');
  });

  test('marks thread replies and keeps each as its own anchor line', () => {
    const [day] = renderChannelDays(
      [
        msg('1792094467.000100', 'parent', { reply_count: 1 }),
        msg('1792094500.000100', 'reply text', { thread_ts: '1792094467.000100', user: 'U2' }),
      ],
      { channelId: 'C1', channelName: 'tech-team', users },
    );
    expect(day!.content).toContain('**Bob Example** 20:01 — reply text (reply to 1792094467.000100)');
    // The reply is not indented, so the parser sees it as a message of its own.
    expect(day!.content).not.toMatch(/^[ \t]+\*\*↳/m);
  });

  test('renders attached file names', () => {
    const [day] = renderChannelDays(
      [msg('1792094467.000100', '', { files: [{ title: 'design.pdf' }] })],
      { channelId: 'C1', channelName: 'tech-team', users },
    );
    expect(day!.content).toContain('[attached: design.pdf]');
  });

  test('frontmatter carries the channel identity and message count', () => {
    const [day] = renderChannelDays([msg('1792094467.000100', 'x')], { channelId: 'C1', channelName: 'tech-team', users });
    expect(day!.content.startsWith('---\n')).toBe(true);
    expect(day!.content).toContain('channel_id: C1');
    expect(day!.content).toContain('channel_name: tech-team');
    expect(day!.content).toContain('message_count: 1');
    expect(day!.content).toContain('type: slack');
  });

  test('bot and unknown-speaker messages get a clear speaker label', () => {
    const days = renderChannelDays(
      [
        { ts: '1792094467.000100', bot_id: 'B1', text: 'build passed' },
        { ts: '1792094468.000100', subtype: 'file_share', text: 'shared' },
      ],
      { channelId: 'C1', channelName: 'tech-team', users },
    );
    expect(days[0]!.content).toContain('**bot:B1** 20:01 — build passed');
    expect(days[0]!.content).toContain('**file_share** 20:01 — shared');
  });
});

describe('rendered output parses as a conversation', () => {
  test('the conversation parser recovers each message with its speaker', () => {
    const [day] = renderChannelDays(
      [
        msg('1792094467.000100', 'first message'),
        msg('1792094500.000100', 'second message', { user: 'U2' }),
      ],
      { channelId: 'C1', channelName: 'tech-team', users },
    );
    const body = day!.content.replace(/^---[\s\S]*?---\n/, '');
    const parsed = parseConversation(body, { fallbackDate: '2026-10-15' });
    expect(parsed.messages.map((m) => m.speaker)).toEqual(['Alice Example', 'Bob Example']);
    expect(parsed.messages[0]!.text).toContain('first message');
  });
});
