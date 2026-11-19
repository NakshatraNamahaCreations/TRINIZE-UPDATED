import type { Key } from '@/i18n';

/** Morning / afternoon / evening by the phone's clock — shared by Home and the language preview. */
export function greeting(now = new Date()): Key {
  const h = now.getHours();
  return h < 12 ? 'home.morning' : h < 17 ? 'home.afternoon' : 'home.evening';
}
