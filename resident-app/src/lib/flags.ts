/** Demo-only content (the code banner, the guided tour) is on unless a build sets EXPO_PUBLIC_DEMO=off.
    Pilot builds must turn it off — and need the real SMS backend, since 123456 is the only code that works here. */
export const DEMO = process.env.EXPO_PUBLIC_DEMO !== 'off';
