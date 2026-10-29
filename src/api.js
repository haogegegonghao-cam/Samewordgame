import { createClient } from '@supabase/supabase-js';
import publicConfig from './public-config.json';
const url = import.meta.env.VITE_SUPABASE_URL || publicConfig.url;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || publicConfig.publishableKey;
export const configured = Boolean(url && key && !url.includes('YOUR_') && !key.includes('YOUR_'));
export const client = configured ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 4 } },
}) : null;
let signingIn;
export async function authenticate() {
  if (!client) throw new Error('NOT_CONFIGURED');
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (data.session) return data.session.user;
  if (!signingIn) signingIn = client.auth.signInAnonymously().finally(() => { signingIn = null; });
  const result = await signingIn;
  if (result.error) throw result.error;
  return result.data.user;
}
export async function rpc(action, args = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const { data, error } = await client.rpc(`game_${action}`, args).abortSignal(controller.signal);
    if (error) throw error;
    return data;
  } finally { clearTimeout(timer); }
}
export function watchRoom(id, onChange, onStatus) {
  const channel = client.channel(`room:${id}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_rooms', filter: `id=eq.${id}` }, onChange)
    .subscribe(onStatus);
  return () => client.removeChannel(channel);
}
export function readableError(error) {
  const message = error?.message || '';
  const map = {
    NOT_CONFIGURED: '联机服务尚未配置。请按 README 连接 Supabase 后再开始。',
    ROOM_UNAVAILABLE: '没有找到这个房间，或邀请已过期。请确认房间码。',
    ROOM_FULL: '这个房间已有两个人。请创建一个新房间。',
    SAME_PLAYER: '你已经在这个房间里。请让朋友用另一台设备或独立浏览器加入。',
    NOT_MEMBER: '你不在这个房间中，请使用邀请链接加入。',
    ROOM_CLOSED: '这场相遇已经结束，请创建一个新房间。',
    STALE_TURN: '轮次已经变化，正在同步最新状态。',
    ALREADY_SUBMITTED: '本轮已经提交，词语不能再修改。',
    INVALID_WORD: '请输入 1–24 个字符，不包含不可见控制字符。',
    WRONG_PHASE: '游戏状态已经变化，请稍后再试。',
    TOO_MANY_ROOMS: '创建得有些快了，请稍后再创建房间。',
    AUTH_REQUIRED: '登录已失效，请刷新页面重新连接。',
  };
  for (const [code, text] of Object.entries(map)) if (message.includes(code)) return text;
  if (/anonymous sign-ins are disabled/i.test(message)) return '请在 Supabase Authentication 中开启匿名登录。';
  if (/fetch|network|timeout|abort|load failed/i.test(message)) return '网络暂时没有连上。请检查网络后重试，房间会为你保留。';
  return '暂时无法完成操作，请重试。若持续出现，请检查联机服务配置。';
}
