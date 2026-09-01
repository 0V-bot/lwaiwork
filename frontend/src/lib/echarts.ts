/**
 * Thin dynamic-import wrapper around echarts.
 *
 * Why dynamic:
 *   * The chart code touches `window`/`document` at module load time, so
 *     a top-level `import 'echarts'` blows up on Next.js SSR / build.
 *   * Splitting the chart bundle also keeps the rest of the page
 *     cheap - the chart only loads when at least one chart component
 *     actually mounts.
 *
 * Falls back gracefully if echarts isn't installed (returns null). The
 * chart components render a placeholder strip in that case so the user
 * never sees a runtime error - they just don't get the chart.
 */

export type EChartsInstance = unknown;

/**
 * One-shot chart bootstrap. Mounts `option` into `dom` and returns the
 * echarts instance. The caller is responsible for `dispose()` when the
 * node unmounts (every chart component in `components/analytics/*` does
 * so in its cleanup effect).
 *
 * Returns null when echarts is missing or fails to load; the caller is
 * expected to handle null without throwing.
 */
export async function initChart(
  dom: HTMLElement,
  option: unknown,
): Promise<EChartsInstance | null> {
  // The ambient module declaration makes this a runtime-only check;
  // tsc needs it as `any` to compile when the package is missing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let echarts: any;
  try {
    echarts = await import('echarts');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[analytics] echarts not available; chart skipped. Run `npm install` inside the frontend workspace.',
      err,
    );
    return null;
  }

  if (!echarts || typeof echarts.init !== 'function') {
    return null;
  }
  const instance = echarts.init(dom, undefined, { renderer: 'canvas' });
  if (!instance) return null;
  instance.setOption(option);
  return instance;
}

/** Standard resize handler; safe to call with `null`. */
export function resizeChart(instance: EChartsInstance | null): void {
  if (!instance) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (instance as any).resize?.();
}

/** Dispose-on-unmount helper; safe to call with `null`. */
export function disposeChart(instance: EChartsInstance | null): void {
  if (!instance) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (instance as any).dispose?.();
}
