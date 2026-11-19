import type { Lang } from '@/i18n';
import { firstState, ME, SOCIETY, type State } from '@/store/data';
import { AsyncStorage, Localization, SecureStore } from './native';

/** Bump when State changes shape incompatibly — older snapshots are then ignored, not half-loaded. */
// v2: seed dates became relative to the install day — v1 snapshots are stuck in August 2026
const V = 'trinize.v2.';
const K = { auth: V + 'auth', lang: V + 'lang' };
/** each mobile number keeps its own copy, so signing out and back in brings it all back */
const storeKey = (phone: string) => V + 'store.' + phone;

/** tokens are only present when the app talks to the API (kept in the secure store with the rest) */
export type SavedAuth = { signedIn: boolean; phone: string; tokens?: { access: string; refresh: string } | null; role?: 'resident' | 'vpm' | 'guard' };
export type Boot = { auth: SavedAuth; lang: Lang; store: State };

const LANG_CODES: Lang[] = ['en', 'kn', 'hi'];

/** First launch follows the phone's language when it's one we ship; otherwise English. */
function deviceLang(): Lang {
  try {
    const code = Localization?.getLocales()[0]?.languageCode as Lang | undefined;
    return code && LANG_CODES.includes(code) ? code : 'en';
  } catch {
    return 'en';
  }
}

async function read<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Sign-in state goes to the Keystore-backed secure store; web (no secure store) falls back to AsyncStorage. */
async function readAuth(): Promise<SavedAuth | null> {
  try {
    const raw = await SecureStore?.getItemAsync(K.auth);
    if (raw) return JSON.parse(raw) as SavedAuth;
  } catch { /* not available here */ }
  return read<SavedAuth>(K.auth);
}

// shallow merge so keys added in a newer build pick up their defaults
const hydrate = (store: State | null): State =>
  store ? { ...firstState, ...store, me: { ...firstState.me, ...store.me }, chat: { ...store.chat, startedAt: store.chat.startedAt ?? new Date().toISOString(), busy: false, creating: false } } : firstState;

/** The saved data for a number, or a fresh seed the first time it signs in on this phone. */
export async function loadStore(phone: string): Promise<State> {
  const s = hydrate(await read<State>(storeKey(phone)));
  // the name and flat this number had last time, until the server confirms them
  if (s.who) { Object.assign(ME, s.who.me); Object.assign(SOCIETY, s.who.society); }
  return s;
}

export async function loadBoot(): Promise<Boot> {
  const [auth, lang] = await Promise.all([readAuth(), read<Lang>(K.lang)]);
  const a = auth ?? { signedIn: false, phone: '' };
  return {
    auth: a,
    lang: lang && LANG_CODES.includes(lang) ? lang : deviceLang(),
    store: a.signedIn && a.phone ? await loadStore(a.phone) : firstState,
  };
}

const write = (key: string, value: unknown) => {
  AsyncStorage?.setItem(key, JSON.stringify(value)).catch(() => {});
};

export const saveAuth = (a: SavedAuth) => {
  const raw = JSON.stringify(a);
  SecureStore?.setItemAsync(K.auth, raw)
    .then(() => AsyncStorage?.removeItem(K.auth)) // nothing left in plain storage once it's in the secure store
    .catch(() => write(K.auth, a));
  if (!SecureStore) write(K.auth, a);
};
export const saveLang = (l: Lang) => write(K.lang, l);
export const saveStore = (phone: string, s: State) => write(storeKey(phone), s);
export const deleteStore = (phone: string) => { AsyncStorage?.removeItem(storeKey(phone)).catch(() => {}); };
