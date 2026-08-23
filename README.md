# @voxelkloud/vue

Vue 3 bindings for [voxelkloud](../../README.md).

```sh
npm install @voxelkloud/vue three
```

```vue
<script setup lang="ts">
import { PointCloudViewer } from "@voxelkloud/vue";
</script>

<template>
  <PointCloudViewer
    url="https://example.com/clouds/autzen/"
    :lod="{ targetScreenError: 1.0 }"
    @stats="(s) => console.log(s.frameMs)"
  />
</template>
```

The same surface as [@voxelkloud/react](../react/README.md), over the same
[@voxelkloud/view](../view/README.md). That symmetry is enforced by a test:
every prop here must exist on the React binding, because the two adapters are
the evidence that the renderer is framework-free.

`usePointCloud` takes a `MaybeRefOrGetter`, so a ref, a getter or a plain string
all work, and holds the source and hierarchy in a `shallowRef` — deep
reactivity would proxy megabytes of typed arrays and then hand the proxies to
the GPU.

MIT.
