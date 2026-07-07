<script lang="ts">
	/**
	 * Hand-rolled inline-SVG line chart with an optional filled area and dot markers.
	 * Points: {x?, y, label?}. x is index if omitted. Handles a single overlay series too.
	 */
	let {
		series,
		height = 140,
		color = 'var(--color-accent)',
		fill = true,
		yMax,
		yMin = 0
	}: {
		series: { value: number; label?: string }[];
		height?: number;
		color?: string;
		fill?: boolean;
		yMax?: number;
		yMin?: number;
	} = $props();

	const W = 320;
	const padL = 6;
	const padR = 6;
	const padT = 8;
	const padB = 18;

	const max = $derived(yMax ?? Math.max(...series.map((s) => s.value), 1));
	const min = $derived(yMin);
	const span = $derived(max - min || 1);

	function px(i: number) {
		if (series.length <= 1) return padL;
		return padL + (i / (series.length - 1)) * (W - padL - padR);
	}
	function py(v: number) {
		return padT + (1 - (v - min) / span) * (height - padT - padB);
	}

	const line = $derived(series.map((s, i) => `${px(i).toFixed(1)},${py(s.value).toFixed(1)}`).join(' '));
	const area = $derived(
		series.length
			? `${padL},${height - padB} ${line} ${px(series.length - 1)},${height - padB}`
			: ''
	);
	const gid = 'lg' + Math.random().toString(36).slice(2, 8);
</script>

<svg viewBox="0 0 {W} {height}" class="w-full" style="height:{height}px" role="img">
	<defs>
		<linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
			<stop offset="0%" stop-color={color} stop-opacity="0.28" />
			<stop offset="100%" stop-color={color} stop-opacity="0" />
		</linearGradient>
	</defs>
	<!-- baseline grid -->
	<line x1={padL} x2={W - padR} y1={py(min)} y2={py(min)} stroke="var(--color-line)" stroke-width="1" />
	<line
		x1={padL}
		x2={W - padR}
		y1={py(min + span / 2)}
		y2={py(min + span / 2)}
		stroke="var(--color-line)"
		stroke-width="0.5"
		stroke-dasharray="3 4"
		opacity="0.5"
	/>
	{#if fill && series.length > 1}
		<polygon points={area} fill="url(#{gid})" />
	{/if}
	{#if series.length > 1}
		<polyline
			points={line}
			fill="none"
			stroke={color}
			stroke-width="2"
			stroke-linejoin="round"
			stroke-linecap="round"
		/>
	{/if}
	{#each series as s, i (i)}
		<circle cx={px(i)} cy={py(s.value)} r="2.5" fill="var(--color-ink)" stroke={color} stroke-width="1.5">
			<title>{s.label ? s.label + ': ' : ''}{Math.round(s.value)}</title>
		</circle>
	{/each}
	{#each series as s, i (i)}
		{#if s.label && (series.length <= 8 || i % Math.ceil(series.length / 6) === 0)}
			<text x={px(i)} y={height - 5} text-anchor="middle" class="fill-zinc-500" font-size="8"
				>{s.label}</text
			>
		{/if}
	{/each}
</svg>
