import type { Lang } from '@/i18n';
import { initialState, type State } from '@/store/data';
import { AsyncStorage, Localization } from './native';

/** Bump when State changes shape incompatibly — older snapshots are then ignored, not half-loaded. */
const V = 'trinize.v1.';
const K = { auth: V + 'auth', lang: V + 'lang', store: V + 'store' };

export type SavedAuth = { signedIn: boolean; phone: string };
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

export async function loadBoot(): Promise<Boot> {
  const [auth, lang, store] = await Promise.all([read<SavedAuth>(K.auth), read<Lang>(K.lang), read<State>(K.store)]);
  return {
    auth: auth ?? { signedIn: false, phone: '' },
    lang: lang && LANG_CODES.includes(lang) ? lang : deviceLang(),
    // shallow merge so keys added in a newer build pick up their defaults
    store: store ? { ...initialState, ...store, chat: { ...store.chat, busy: false, creating: false } } : initialState,
  };
}

const write = (key: string, value: unknown) => {
  AsyncStorage?.setItem(key, JSON.stringify(value)).catch(() => {});
};

export const saveAuth = (a: SavedAuth) => write(K.auth, a);
export const saveLang = (l: Lang) => write(K.lang, l);
export const saveStore = (s: State) => write(K.store, s);
