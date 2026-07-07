<script lang="ts">
	/** Hand-rolled inline-SVG vertical bar chart. Each datum: {label, value, color?}. */
	let {
		data,
		height = 120,
		color = 'var(--color-accent)',
		unit = '',
		barLabels = false
	}: {
		data: { label: string; value: number; color?: string }[];
		height?: number;
		color?: string;
		unit?: string;
		barLabels?: boolean;
	} = $props();

	const max = $derived(Math.max(...data.map((d) => d.value), 1));
	const gap = 6;
	const bw = $derived(data.length ? (100 - gap * (data.length - 1)) / data.length : 0);
</script>

<div>
	<svg viewBox="0 0 100 {height}" preserveAspectRatio="none" class="w-full" style="height:{height}px">
		{#each data as d, i (d.label + i)}
			{@const h = (d.value / max) * (height - 22)}
			{@const x = i * (bw + gap)}
			<rect
				{x}
				y={height - 18 - h}
				width={bw}
				height={Math.max(1, h)}
				rx="1.5"
				fill={d.color ?? color}
				opacity="0.9"
			>
				<title>{d.label}: {Math.round(d.value)}{unit}</title>
			</rect>
			{#if barLabels}
				<text
					x={x + bw / 2}
					y={height - 20 - h}
					text-anchor="middle"
					class="fill-zinc-300 tabular-nums"
					font-size="6">{Math.round(d.value)}</text
				>
			{/if}
		{/each}
	</svg>
	<div class="mt-1 flex" style="gap:{gap}%">
		{#each data as d, i (d.label + i)}
			<span
				class="truncate text-center text-[9px] text-zinc-500"
				style="width:{bw}%"
				title={d.label}>{d.label}</span
			>
		{/each}
	</div>
</div>
