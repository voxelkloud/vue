import type { BrotliDecompress } from "@voxelkloud/loader";
import { createPointCloudView } from "@voxelkloud/view";
import type {
  ColorMode,
  EdlOptions,
  LodOptions,
  PointCloudView,
  PointMaterialOptions,
  ViewStats,
} from "@voxelkloud/view";
import {
  defineComponent,
  h,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from "vue";
import type { PropType, VNode } from "vue";
import { usePointCloud } from "./use-point-cloud.js";
import type { PointCloudStatus } from "./use-point-cloud.js";

/**
 * A point cloud in a canvas.
 *
 * Deliberately thin, and deliberately the same shape as the React binding:
 * everything below it is `@voxelkloud/view`, which knows about neither
 * framework, so the two adapters cannot drift apart in capability. This owns
 * exactly what Vue should own — the canvas element, the lifecycle, and turning
 * props into idempotent setter calls.
 *
 * Written with `h()` rather than as an SFC so the package builds with plain
 * tsup: a `.vue` file would drag the SFC compiler into the build of a component
 * whose entire template is one canvas.
 */
export const PointCloudViewer = defineComponent({
  name: "PointCloudViewer",
  props: {
    /** Directory URL or `metadata.json` URL. Both are accepted. */
    url: { type: String, required: true },
    /** LOD policy. `targetPixelSpacing` is the primary quality control. */
    lod: { type: Object as PropType<LodOptions>, default: undefined },
    /**
     * Colour mode. Defaults to the cloud's own RGB when it has any, and to an
     * elevation ramp when it does not — LAS point format 1 carries intensity
     * and classification and no colour, which is most 3DEP lidar.
     */
    colorMode: { type: Object as PropType<ColorMode>, default: undefined },
    material: {
      type: Object as PropType<PointMaterialOptions>,
      default: undefined,
    },
    /**
     * Eye-dome lighting. Omitted means off. Whether the pass EXISTS is fixed
     * when the view is built, so toggling it rebuilds the renderer; changing
     * the numbers inside it does not.
     */
    edl: { type: Object as PropType<EdlOptions>, default: undefined },
    /** Needed for BROTLI clouds; no browser exposes a brotli decoder to JS. */
    decompress: {
      type: Function as PropType<BrotliDecompress>,
      default: undefined,
    },
    /** `"arena"` (default) batches nodes into slabs; `"per-node"` is the fallback. */
    sinkMode: {
      type: String as PropType<"arena" | "per-node">,
      default: undefined,
    },
    /** Attach `three/addons` OrbitControls. Default `true`. */
    controls: { type: Boolean, default: true },
  },
  emits: {
    /** Once per rendered frame, with the LIVE stats object. */
    stats: (_stats: ViewStats) => true,
    /** Once the view exists, for imperative escape hatches. */
    ready: (_view: PointCloudView) => true,
    error: (_error: unknown) => true,
  },
  setup(props, { emit, slots, expose }) {
    const canvasRef = ref<HTMLCanvasElement | null>(null);
    const viewRef = shallowRef<PointCloudView | undefined>(undefined);
    const failure = shallowRef<unknown>(undefined);
    const cloud = usePointCloud(
      () => props.url,
      props.decompress === undefined ? {} : { decompress: props.decompress },
    );

    let teardown: (() => void) | undefined;

    const build = async () => {
      teardown?.();
      teardown = undefined;
      const canvas = canvasRef.value;
      const status = cloud.value;
      if (canvas === null || status.kind !== "ready") return;

      let cancelled = false;
      let raf = 0;
      let view: PointCloudView | undefined;
      let tickControls: (() => void) | undefined;
      let disposeExtras: (() => void) | undefined;
      teardown = () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        disposeExtras?.();
        view?.dispose();
        viewRef.value = undefined;
      };

      try {
        const hasColor = status.source.attributes.some(
          (a) => a.role === "color",
        );
        view = createPointCloudView({
          canvas,
          ...(props.lod !== undefined ? { lod: props.lod } : {}),
          ...(props.decompress !== undefined
            ? { decompress: props.decompress }
            : {}),
          ...(props.sinkMode !== undefined ? { sinkMode: props.sinkMode } : {}),
          ...(props.edl !== undefined ? { edl: props.edl } : {}),
          material: {
            ...(hasColor ? {} : { colorMode: { kind: "elevation" as const } }),
            ...(props.colorMode !== undefined
              ? { colorMode: props.colorMode }
              : {}),
            ...props.material,
          },
        });
        await view.init();
        if (cancelled) {
          view.dispose();
          return;
        }
        viewRef.value = view;
        view.addCloud(status.source, status.hierarchy);
        view.frameCloud(0);

        const resize = () => {
          const r = canvas.getBoundingClientRect();
          view?.setSize(
            Math.max(r.width, 1),
            Math.max(r.height, 1),
            Math.min(globalThis.devicePixelRatio ?? 1, 2),
          );
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        disposeExtras = () => observer.disconnect();

        if (props.controls) {
          // Lazily imported so the core module graph never pulls examples/jsm.
          const { OrbitControls } = await import(
            "three/addons/controls/OrbitControls.js"
          );
          if (!cancelled) {
            const c = new OrbitControls(view.camera, canvas);
            c.enableDamping = true;
            c.dampingFactor = 0.08;
            c.zoomToCursor = true;
            c.target.copy(view.targetFor(0));
            c.update();
            const prev = disposeExtras;
            disposeExtras = () => {
              prev?.();
              c.dispose();
            };
            tickControls = () => c.update();
          }
        }

        emit("ready", view);

        const tick = () => {
          raf = requestAnimationFrame(tick);
          tickControls?.();
          view?.renderFrame();
          if (view !== undefined) emit("stats", view.stats);
        };
        raf = requestAnimationFrame(tick);
      } catch (error) {
        if (cancelled) return;
        failure.value = error;
        emit("error", error);
      }
    };

    // Only the props that change the SHAPE of the pipeline rebuild it. The
    // quality knobs below are setters, so dragging a slider must not tear down
    // a GPU device and re-upload every resident node.
    watch(
      [cloud, canvasRef, () => props.controls, () => props.sinkMode, () => props.edl === undefined],
      () => void build(),
      { immediate: true, flush: "post" },
    );

    watch(
      () => props.lod?.targetPixelSpacing,
      (v) => {
        if (v !== undefined) viewRef.value?.setTargetPixelSpacing(v);
      },
    );
    watch(
      () => props.lod?.pointBudget,
      (v) => {
        if (v !== undefined) viewRef.value?.setPointBudget(v);
      },
    );
    watch(
      () => [props.edl?.strength, props.edl?.radius, props.edl?.opacity],
      () => {
        if (props.edl !== undefined) viewRef.value?.setEdl(props.edl);
      },
    );

    onBeforeUnmount(() => teardown?.());

    // An imperative escape hatch that matches the React binding's `onReady`,
    // for the things a declarative surface should not try to own: camera
    // animation, picking, measurement.
    expose({ view: viewRef });

    return (): VNode => {
      const status: PointCloudStatus =
        failure.value !== undefined
          ? { kind: "error", error: failure.value }
          : cloud.value;
      return h("div", { style: { position: "relative" } }, [
        h("canvas", {
          ref: canvasRef,
          style: { width: "100%", height: "100%", display: "block" },
        }),
        status.kind !== "ready" ? slots["overlay"]?.({ status }) : undefined,
      ]);
    };
  },
});
