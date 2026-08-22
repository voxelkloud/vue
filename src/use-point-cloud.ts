import type {
  BrotliDecompress,
  PointCloudHierarchy,
  PointCloudSource,
} from "@voxelkloud/loader";
import { loadHierarchy, loadPointCloudSource } from "@voxelkloud/loader";
import { onScopeDispose, shallowRef, toValue, watch } from "vue";
import type { MaybeRefOrGetter, ShallowRef } from "vue";

/** What the loader is doing right now. */
export type PointCloudStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly stage: "manifest" | "hierarchy" }
  | {
      readonly kind: "ready";
      readonly source: PointCloudSource;
      readonly hierarchy: PointCloudHierarchy;
    }
  | { readonly kind: "error"; readonly error: unknown };

export interface UsePointCloudOptions {
  /**
   * Expand the WHOLE hierarchy before reporting ready.
   *
   * Default `true`, and cheap: the loader's default policy buys the entire
   * hierarchy.bin in one request, so this parses already-resident bytes rather
   * than doing more I/O — 100 KB and ~2 ms for autzen. With it off, descent
   * expands chunks as the camera reaches them.
   */
  readonly expandAll?: boolean;
  /**
   * A brotli decompressor, needed for BROTLI clouds because no browser exposes
   * one to JS. Ignored for uncompressed clouds.
   *
   * ```ts
   * const { brotliDecompress } = await import("@voxelkloud/loader/brotli");
   * ```
   */
  readonly decompress?: BrotliDecompress;
}

/**
 * Load a point cloud's manifest and hierarchy.
 *
 * Separate from the viewer component so a caller can inspect the source before
 * rendering it — attribute list, point count, bounds, `source.warnings` — or
 * drive a non-Vue renderer with the same data.
 *
 * `url` is a `MaybeRefOrGetter`, so a ref, a getter or a plain string all work
 * and the load re-runs when a reactive one changes. Cancels cleanly: a URL
 * change, an unmount, or the surrounding effect scope being disposed aborts
 * whatever is in flight, and the stale result is discarded rather than
 * committed.
 */
export function usePointCloud(
  url: MaybeRefOrGetter<string | undefined>,
  options: UsePointCloudOptions = {},
): ShallowRef<PointCloudStatus> {
  // `shallowRef`, not `ref`: `PointCloudSource` and `PointCloudHierarchy` carry
  // large typed arrays, a transport with functions on it, and a node graph with
  // parent links. Deep reactivity would walk all of it on every assignment and
  // wrap the arrays in proxies that the renderer then hands to the GPU.
  const status = shallowRef<PointCloudStatus>({ kind: "idle" });
  let controller: AbortController | undefined;
  let generation = 0;

  const stop = watch(
    () => toValue(url),
    (resolved) => {
      const mine = ++generation;
      controller?.abort();
      controller = undefined;

      if (resolved === undefined) {
        status.value = { kind: "idle" };
        return;
      }

      const ac = new AbortController();
      controller = ac;
      void (async () => {
        try {
          status.value = { kind: "loading", stage: "manifest" };
          const source = await loadPointCloudSource(resolved, {
            signal: ac.signal,
          });
          if (mine !== generation) return;

          status.value = { kind: "loading", stage: "hierarchy" };
          const hierarchy = await loadHierarchy(source, { signal: ac.signal });
          if (mine !== generation) return;

          if (options.expandAll !== false) await hierarchy.expandAll();
          if (mine !== generation) {
            hierarchy.dispose();
            return;
          }
          status.value = { kind: "ready", source, hierarchy };
        } catch (error) {
          if (mine !== generation) return;
          status.value = { kind: "error", error };
        }
      })();
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    generation++;
    controller?.abort();
    stop();
  });

  return status;
}
