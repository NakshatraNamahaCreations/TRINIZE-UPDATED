import { useFocusEffect as useRouterFocusEffect } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { RefreshControl } from 'react-native';
import { C } from '@/theme';

/* Pull down to refresh, for every screen.
   A pull does two things: it asks the store to read everything again from the server (notices,
   issues, events, polls, discussions, notifications…), and it re-runs the loader of the screen
   on show, for screens that fetch their own records (dues, visitors, messages, the gallery…). */

let tick = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
/** changes each time someone pulls to refresh */
export const useRefreshTick = () => useSyncExternalStore(subscribe, () => tick, () => tick);

/** the store hands over its "read everything again" here, so screens need not know about the store */
let reloadStore: () => Promise<void> = async () => {};
export const registerStoreRefresh = (fn: () => Promise<void>) => { reloadStore = fn; return () => { if (reloadStore === fn) reloadStore = async () => {}; }; };

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export async function refreshEverything() {
  tick++;
  listeners.forEach(fn => fn());
  // the spinner stays long enough to be seen even when the server answers at once
  await Promise.all([reloadStore().catch(() => {}), wait(650)]);
}

/**
 * expo-router's useFocusEffect, which also runs again when the screen is pulled to refresh.
 * Screens that load their own records use this one, and so refresh without any code of their own.
 */
export function useFocusEffect(effect: () => void | (() => void)) {
  const t = useRefreshTick();
  // a new function whenever a refresh is asked for, which is what makes the router run it again
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => effect(), [effect, t]);
  useRouterFocusEffect(run);
}

/** The spinner to hand to a ScrollView or FlatList: `refreshControl={usePullRefresh()}`. `also` runs alongside, for a screen with one more thing to reload. */
export function usePullRefresh(also?: () => unknown) {
  const [busy, setBusy] = useState(false);
  const onRefresh = useCallback(async () => {
    setBusy(true);
    try { await Promise.all([refreshEverything(), Promise.resolve(also?.()).catch(() => {})]); } finally { setBusy(false); }
  }, [also]);
  return <RefreshControl refreshing={busy} onRefresh={onRefresh} tintColor={C.acc} colors={[C.acc]} progressBackgroundColor="#fff" />;
}
