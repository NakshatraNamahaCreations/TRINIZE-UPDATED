import type { CommunityEvent, NotifPrefs } from '@/store/data';
import { Notifications } from './native';

/**
 * Local notifications. Remote push (announcements sent by the admin office) additionally needs a
 * server plus FCM/APNs credentials; everything here works on-device with no backend.
 * Lock-screen copy is deliberately generic — message content never leaves the app (see notif.note).
 */
export type PushCopy = { title: string; body: string };
export type PermState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

let ready = false;
export function setupNotifications() {
  if (!Notifications || ready) return;
  ready = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
    Notifications.setNotificationChannelAsync('default', { name: 'Community updates', importance: Notifications.AndroidImportance.DEFAULT }).catch(() => {});
  } catch {
    ready = false;
  }
}

export async function permissionState(): Promise<PermState> {
  if (!Notifications) return 'unavailable';
  try {
    const p = await Notifications.getPermissionsAsync();
    return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function askPermission(): Promise<PermState> {
  if (!Notifications) return 'unavailable';
  try {
    const cur = await permissionState();
    if (cur !== 'undetermined') return cur;
    const p = await Notifications.requestPermissionsAsync();
    return p.granted ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function sendNow(copy: PushCopy): Promise<boolean> {
  if (!Notifications || (await askPermission()) !== 'granted') return false;
  try {
    await Notifications.scheduleNotificationAsync({ content: copy, trigger: null });
    return true;
  } catch {
    return false;
  }
}

const quietAt = (d: Date) => d.getHours() >= 22 || d.getHours() < 7;
const reminderId = (eventId: string) => 'event-reminder-' + eventId;

/** One hour before an event the resident is going to — skipped if that's past, muted, or in quiet hours. */
export async function scheduleEventReminder(e: CommunityEvent, prefs: NotifPrefs, copy: PushCopy) {
  if (!Notifications || !prefs.events) return;
  const at = new Date(new Date(e.at).getTime() - 60 * 60_000);
  if (at.getTime() <= Date.now() || (prefs.quiet && quietAt(at))) return;
  if ((await permissionState()) !== 'granted') return;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: reminderId(e.id),
      content: copy,
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  } catch {
    // scheduling is best-effort; the RSVP itself already succeeded
  }
}

export function cancelEventReminder(eventId: string) {
  Notifications?.cancelScheduledNotificationAsync(reminderId(eventId)).catch(() => {});
}
