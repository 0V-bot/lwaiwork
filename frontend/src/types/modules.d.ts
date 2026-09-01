/**
 * Ambient module declarations for runtime-loaded packages.
 *
 * `echarts` is consumed via a dynamic import (see `@/lib/echarts`) so
 * the build keeps going even when the package isn't installed yet
 * (e.g. mid-`npm install` on Windows where the cache occasionally
 * EPERMs on `_cacache/index-v5/...`). The runtime helper degrades to
 * a placeholder in that case; nothing on the page crashes.
 */
declare module 'echarts';
