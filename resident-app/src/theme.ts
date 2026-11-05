import type { TextStyle } from 'react-native';

/** Phone palette — mirrors the CFM purple tokens from the web simulation (--p-*). */
export const C = {
  bg: '#F6F4FB',
  card: '#FFFFFF',
  line: '#E7E3F2',
  ink: '#171331',
  ink2: '#5E5980',
  ink3: '#918CAB',
  acc: '#7C55F7',
  accBg: '#F1ECFE',
  accBorder: '#D9CEFC',
  ai: '#6D46F0',
  aiBg: '#EFEAFE',
  good: '#067647',
  goodBg: '#E4F7EE',
  warn: '#B54708',
  warnBg: '#FEF0DC',
  bad: '#B42318',
  badBg: '#FDE9E7',
  dimBg: '#EEF1F6',
  red: '#EF4444',
  toast: '#101828',
};

export const GRAD = {
  hero: ['#7C55F7', '#4C2BC4'] as const,
  brand: ['#8B5CF6', '#6D28D9'] as const,
  button: ['#7C55F7', '#5B34D6'] as const,
  gratitude: ['#FBF9FF', '#F3EEFF'] as const,
};

export type Weight = 400 | 500 | 600 | 700 | 800;

const FAMILY: Record<Weight, string> = {
  400: 'PlusJakartaSans_400Regular',
  500: 'PlusJakartaSans_500Medium',
  600: 'PlusJakartaSans_600SemiBold',
  700: 'PlusJakartaSans_700Bold',
  800: 'PlusJakartaSans_800ExtraBold',
};

/** Custom fonts ship one file per weight, so weight is chosen by family, not fontWeight. */
export const font = (w: Weight = 400): TextStyle => ({ fontFamily: FAMILY[w] });
