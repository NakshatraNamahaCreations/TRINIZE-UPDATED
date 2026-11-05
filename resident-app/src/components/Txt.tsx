import { StyleSheet, Text, type TextProps } from 'react-native';
import { C, font, type Weight } from '@/theme';

export function Txt({ w = 400, style, ...rest }: TextProps & { w?: Weight }) {
  return <Text {...rest} style={[s.txt, font(w), style]} />;
}

export const Meta = ({ style, ...rest }: TextProps) => <Txt {...rest} style={[s.meta, style]} />;

const s = StyleSheet.create({
  txt: { color: C.ink, fontSize: 13.5 },
  meta: { fontSize: 11, color: C.ink3, lineHeight: 16 },
});
