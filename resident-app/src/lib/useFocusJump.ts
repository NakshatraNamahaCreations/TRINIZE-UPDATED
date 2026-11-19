import { useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, ScrollViewInstance } from 'react-native';

/**
 * Scroll a list screen to the item a notification pointed at (`?focus=<id>`) once that item has been
 * laid out. Wrap each item in a View with `onLayout={place(id)}` (a direct child of the scroll content),
 * and pass `scrollRef` to the screen's ScrollView.
 */
export function useFocusJump(focus: string | undefined) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [ys, setYs] = useState<Record<string, number>>({});
  const jumpedTo = useRef<string | undefined>(undefined);
  const target = focus ? ys[focus] : undefined;

  useEffect(() => {
    // once per focus value, so a second notification for another item still jumps
    if (!focus || target === undefined || jumpedTo.current === focus) return;
    jumpedTo.current = focus;
    const h = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, target - 10), animated: true }), 250);
    return () => clearTimeout(h);
  }, [focus, target]);

  const place = (id: string) => (e: LayoutChangeEvent) => {
    const y = e.nativeEvent.layout.y;
    setYs(prev => (prev[id] === y ? prev : { ...prev, [id]: y }));
  };
  return { scrollRef, place };
}
