<script lang="ts">
	import { T } from '@threlte/core';
	import { BackSide, type Texture } from 'three';

	let { texture, opacity = 1 }: { texture: Texture; opacity?: number } = $props();
</script>

<T.Mesh rotation.y={Math.PI}>
	<T.SphereGeometry args={[500, 60, 40]} />
	<T.MeshBasicMaterial
		map={texture}
		side={BackSide}
		transparent={opacity < 1}
		{opacity}
		depthWrite={false}
	/>
</T.Mesh>
