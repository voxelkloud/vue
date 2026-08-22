import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PointCloudViewer } from "./PointCloudViewer.js";
import { usePointCloud } from "./use-point-cloud.js";

/**
 * There is no DOM and no GPU here, so these are contract tests, not behaviour
 * tests: that the package imports cleanly in a bare Node context, that its
 * public surface matches the React binding's, and that nothing touches
 * `document`, `navigator` or a renderer at module scope.
 *
 * The behaviour is covered where it can actually run — `@voxelkloud/view`'s
 * suite for the scheduler, material and EDL, and the browser for the rest.
 */
describe("@voxelkloud/vue module contract", () => {
  it("imports with no DOM present", () => {
    expect(typeof globalThis.document).toBe("undefined");
    expect(typeof usePointCloud).toBe("function");
    expect(typeof PointCloudViewer).toBe("object");
  });

  it("exports exactly its documented surface", async () => {
    const mod = await import("./index.js");
    expect(Object.keys(mod).sort()).toEqual([
      "PointCloudViewer",
      "VOXELKLOUD_VUE_VERSION",
      "usePointCloud",
    ]);
  });

  it("mirrors the React binding's props", async () => {
    // The two adapters exist to prove `@voxelkloud/view` is framework-free. A
    // prop present on one and missing on the other means something leaked into
    // an adapter that belonged below it.
    const props = Object.keys(
      (PointCloudViewer as unknown as { props: Record<string, unknown> }).props,
    ).sort();
    const react = readFileSync(
      new URL("../../react/src/PointCloudViewer.tsx", import.meta.url).pathname,
      "utf8",
    );
    for (const p of props) {
      expect(react, `React binding is missing "${p}"`).toContain(`readonly ${p}`);
    }
    // The callbacks Vue emits instead of taking as props.
    for (const cb of ["onStats", "onReady", "onError"]) {
      expect(react).toContain(`readonly ${cb}`);
    }
  });

  it("constructs no renderer at module scope", () => {
    // A viewer built at import time would need a canvas, which is the failure
    // that breaks SSR and every Node test in a consuming app.
    const src = readFileSync(
      new URL("./PointCloudViewer.ts", import.meta.url).pathname,
      "utf8",
    );
    expect(/^createPointCloudView\(/m.test(src)).toBe(false);
    expect(src).toContain("onBeforeUnmount");
  });

  it("keeps three/addons behind a dynamic import", () => {
    // A static import would pull examples/jsm into every bundle, including the
    // ones that pass `:controls="false"`.
    const src = readFileSync(
      new URL("./PointCloudViewer.ts", import.meta.url).pathname,
      "utf8",
    );
    expect(src).toContain("await import(");
    expect(/^import .*three\/addons/m.test(src)).toBe(false);
  });

  it("holds the source and hierarchy in a shallow ref", () => {
    // `ref` would deep-proxy megabytes of typed arrays and a node graph with
    // parent links, then hand the proxied arrays to the GPU.
    const src = readFileSync(
      new URL("./use-point-cloud.ts", import.meta.url).pathname,
      "utf8",
    );
    expect(src).toContain("shallowRef");
    expect(/[^w]\bref</.test(src.replace(/shallowRef/g, "shallowREF"))).toBe(false);
  });
});
