import { STATUS, type Status } from '../../shared/types';

export interface DiscordTarget {
  webhookUrl: string;
  username: string;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  timestamp?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface DiscordPayload {
  username?: string;
  content?: string;
  embeds: DiscordEmbed[];
}

const WEBHOOK_PATTERN = /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const MAX_RETRY_WAIT_MS = 5000;

const COLOR_DOWN = 0xe5484d;
const COLOR_UP = 0x30a46c;
const COLOR_INFO = 0x3e63dd;

export function isDiscordWebhookUrl(url: string): boolean {
  return WEBHOOK_PATTERN.test(url);
}

export async function sendDiscord(
  target: DiscordTarget,
  payload: DiscordPayload,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!isDiscordWebhookUrl(target.webhookUrl)) throw new Error('Invalid Discord webhook URL');
  const body = JSON.stringify(target.username ? { ...payload, username: target.username } : payload);
  const send = () =>
    fetcher(target.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10_000),
    });

  let res = await send();
  if (res.status === 429) {
    // Discord 的 retry_after 單位是秒；等太久就放棄，不要卡住監測
    const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
    const waitMs = Math.min((data.retry_after ?? 1) * 1000, MAX_RETRY_WAIT_MS);
    await new Promise((r) => setTimeout(r, waitMs));
    res = await send();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord responded ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  await res.body?.cancel();
}

export interface StatusMessageInfo {
  monitorName: string;
  target: string;
  status: Status;
  msg: string;
  latencyMs: number | null;
  ts: number;
  timezone: string;
  resend: boolean;
}

export function statusMessage(info: StatusMessageInfo): DiscordPayload {
  const down = info.status === STATUS.DOWN;
  const time = new Intl.DateTimeFormat('zh-TW', {
    timeZone: info.timezone,
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(info.ts);
  const fields: DiscordEmbed['fields'] = [{ name: '時間', value: time, inline: true }];
  if (info.latencyMs != null) fields.push({ name: '延遲', value: `${info.latencyMs} ms`, inline: true });
  // Discord 的 field value 上限 1024 字、title 256 字，超過整則訊息會被拒
  if (info.target) fields.push({ name: '目標', value: info.target.slice(0, 1024) });
  return {
    embeds: [
      {
        title: (down
          ? `🔴 ${info.monitorName} 異常${info.resend ? '（仍未恢復）' : ''}`
          : `🟢 ${info.monitorName} 已恢復`
        ).slice(0, 256),
        description: info.msg.slice(0, 2000) || undefined,
        color: down ? COLOR_DOWN : COLOR_UP,
        timestamp: new Date(info.ts).toISOString(),
        fields,
      },
    ],
  };
}

export function testMessage(): DiscordPayload {
  return {
    embeds: [
      {
        title: '測試通知',
        description: 'uptime-flare-plus 可以送訊息到這個頻道。',
        color: COLOR_INFO,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
