// Server-only entry: Vercel's file tracer does not resolve browser cache query
// suffixes. A static path includes the unchanged shared engine in the function.
import './classic-engine.js';
export const {CLASSIC_VERSION,CLASSIC_TIER_LIMITS,CLASSIC_RULES,evaluateClassic,evaluateFrames,qualifyClassicRow,compareClassic,compactClassic,rankClassicTiers}=globalThis.OXClassic;
