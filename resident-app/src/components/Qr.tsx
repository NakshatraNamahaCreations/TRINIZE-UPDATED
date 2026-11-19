import encode from 'qrcode-generator';
import { useMemo } from 'react';
import { View } from 'react-native';

/** A QR code drawn with plain views (no native module): each row is a strip of dark runs. */
export function Qr({ value, size = 168 }: { value: string; size?: number }) {
  const rows = useMemo(() => {
    const q = encode(0, 'M');
    q.addData(value);
    q.make();
    const n = q.getModuleCount();
    // per row: [start, length] of every dark run
    return Array.from({ length: n }, (_, r) => {
      const runs: [number, number][] = [];
      for (let c = 0; c < n; c++) {
        if (!q.isDark(r, c)) continue;
        const last = runs[runs.length - 1];
        if (last && last[0] + last[1] === c) last[1]++;
        else runs.push([c, 1]);
      }
      return runs;
    });
  }, [value]);
  const cell = Math.floor(size / rows.length), side = cell * rows.length;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="QR code" style={{ width: side + 16, height: side + 16, padding: 8, backgroundColor: '#fff', borderRadius: 10 }}>
      {rows.map((runs, r) => (
        <View key={r} style={{ height: cell, width: side }}>
          {runs.map(([c, len]) => <View key={c} style={{ position: 'absolute', left: c * cell, width: len * cell, height: cell, backgroundColor: '#111' }} />)}
        </View>
      ))}
    </View>
  );
}
