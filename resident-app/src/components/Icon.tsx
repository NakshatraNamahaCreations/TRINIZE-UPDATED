import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { C } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 18, color = C.ink2, style }: { name: IconName; size?: number; color?: string; style?: ComponentProps<typeof Ionicons>['style'] }) {
  return <Ionicons name={name} size={size} color={color} style={style} />;
}

/** Tinted rounded square holding an icon — quick links, list rows, notifications. */
export function IconTile({ name, bg = C.accBg, fg = C.acc, size = 38, radius = 10, style }: {
  name: IconName; bg?: string; fg?: string; size?: number; radius?: number; style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ width: size, height: size, borderRadius: radius, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Ionicons name={name} size={Math.round(size * 0.5)} color={fg} />
    </View>
  );
}

/** Material Community glyphs, for the few shapes Ionicons lacks (the Home tab's house-with-heart). */
export type MciName = ComponentProps<typeof MaterialCommunityIcons>['name'];
export { MaterialCommunityIcons };

export const iconFont = { ...Ionicons.font, ...MaterialCommunityIcons.font };
