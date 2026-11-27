import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { saveLang } from '@/lib/persist';
import { en, type Key } from './en';
import { hi } from './hi';
import { kn } from './kn';

export type { Key } from './en';
export type Lang = 'en' | 'kn' | 'hi';

export const LANGS: { code: Lang; native: string; english: string }[] = [
  { code: 'en', native: 'English', english: 'English' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi' },
];

const DICTS: Record<Lang, Record<Key, string>> = { en, kn, hi };
type Vars = Record<string, string | number>;

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

type I18n = {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** plain string with {placeholders} filled */
  t: (key: Key, vars?: Vars) => string;
  /** like t(), but placeholders can be React nodes — for links or bold runs inside a sentence */
  tr: (key: Key, parts: Record<string, ReactNode>) => ReactNode;
  /** translates a stored English value (status, category…) under `prefix`, falling back to the value itself */
  tx: (prefix: string, value: string) => string;
};

const I18nCtx = createContext<I18n | null>(null);

export function LangProvider({ initial = 'en', children }: { initial?: Lang; children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initial);
  useEffect(() => { saveLang(lang); }, [lang]);
  const dict = DICTS[lang];

  // a count of 1 uses the string's singular form when it has one ("1 parcel", not "1 parcel(s)")
  const t = useCallback((key: Key, vars?: Vars) => {
    const one = (key + '.one') as Key;
    const k = vars?.n === 1 && one in en ? one : key;
    return fill(dict[k] ?? en[k], vars);
  }, [dict]);
  const tr = useCallback((key: Key, parts: Record<string, ReactNode>) =>
    (dict[key] ?? en[key]).split(/\{(\w+)\}/).map((seg, i) => <Fragment key={i}>{i % 2 ? parts[seg] : seg}</Fragment>), [dict]);
  const tx = useCallback((prefix: string, value: string) => {
    const k = `${prefix}.${value}` as Key;
    return k in dict ? dict[k] : value;
  }, [dict]);

  const value = useMemo(() => ({ lang, setLang, t, tr, tx }), [lang, t, tr, tx]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useT() {
  const v = useContext(I18nCtx);
  if (!v) throw new Error('useT must be used inside <LangProvider>');
  return v;
}
