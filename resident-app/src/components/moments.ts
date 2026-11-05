import type { Key } from '@/i18n';
import type { IconName } from './Icon';

/** Event albums shown on Home and in the gallery. Photos are illustrated placeholders in this demo. */
export const MOMENTS: { id: string; ic: IconName; l: Key; g: readonly [string, string]; fg: string; count: number }[] = [
  { id: 'plant', ic: 'leaf-outline', l: 'home.m.plant', g: ['#BBF7D0', '#DCFCE7'], fg: '#067647', count: 9 },
  { id: 'onam', ic: 'sparkles-outline', l: 'home.m.onam', g: ['#FDE68A', '#FEF3C7'], fg: '#B54708', count: 12 },
  { id: 'badminton', ic: 'tennisball-outline', l: 'home.m.badminton', g: ['#BAE6FD', '#E0F2FE'], fg: '#0369A1', count: 6 },
  { id: 'art', ic: 'color-palette-outline', l: 'home.m.art', g: ['#DDD6FE', '#EDE9FE'], fg: '#6D28D9', count: 8 },
];
