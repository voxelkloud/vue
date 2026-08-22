// @voxelkloud/vue — Vue 3 bindings over @voxelkloud/view.
//
// Deliberately thin, and deliberately the same surface as @voxelkloud/react.
// Everything below these two exports knows about neither framework, so the two
// adapters cannot drift apart in capability, and a vanilla host reuses the same
// viewer rather than a third implementation of it.

export { PointCloudViewer } from "./PointCloudViewer.js";

export { usePointCloud } from "./use-point-cloud.js";
export type {
  PointCloudStatus,
  UsePointCloudOptions,
} from "./use-point-cloud.js";

export const VOXELKLOUD_VUE_VERSION = "0.0.0";
