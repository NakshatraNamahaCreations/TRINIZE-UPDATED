import { createContext, useContext } from 'react';
import type { State } from './data';
import type { Actions } from './store';

export type Store = { state: State; actions: Actions };
export const StoreCtx = createContext<Store | null>(null);

export function useStore() {
  const s = useContext(StoreCtx);
  if (!s) throw new Error('useStore must be used inside <StoreProvider>');
  return s;
}
