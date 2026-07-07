<script lang="ts">
	/** Strength-vs-readiness scatter. Points: {x, y, label?, hot?}. Axes labelled by props. */
	let {
		points,
		height = 200,
		xLabel = '',
		yLabel = '',
		color = 'var(--color-accent2)'
	}: {
		points: { x: number; y: number; label?: string; hot?: boolean }[];
		height?: number;
		xLabel?: string;
		yLabel?: string;
		color?: string;
	} = $props();

	const W = 320;
	const padL = 28;
	const padR = 8;
	const padT = 8;
	const padB = 22;

	const xs = $derived(points.map((p) => p.x));
	const ys = $derived(points.map((p) => p.y));
	const xMin = $derived(points.length ? Math.min(...xs) : 0);
	const xMax = $derived(points.length ? Math.max(...xs, xMin + 1) : 1);
	const yMin = $derived(points.length ? Math.min(...ys) : 0);
	const yMax = $derived(points.length ? Math.max(...ys, yMin + 1) : 1);

	const cx = (x: number) => padL + ((x - xMin) / (xMax - xMin || 1)) * (W - padL - padR);
	const cy = (y: number) => padT + (1 - (y - yMin) / (yMax - yMin || 1)) * (height - padT - padB);
</script>

<svg viewBox="0 0 {W} {height}" class="w-full" style="height:{height}px" role="img">
	<!-- axes -->
	<line x1={padL} x2={padL} y1={padT} y2={height - padB} stroke="var(--color-line)" />
	<line x1={padL} x2={W - padR} y1={height - padB} y2={height - padB} stroke="var(--color-line)" />
	<!-- grid halves -->
	<line
		x1={padL}
		x2={W - padR}
		y1={(padT + height - padB) / 2}
		y2={(padT + height - padB) / 2}
		stroke="var(--color-line)"
		stroke-dasharray="3 4"
		opacity="0.4"
	/>
	{#each points as p, i (i)}
		<circle
			cx={cx(p.x)}
			cy={cy(p.y)}
			r={p.hot ? 5 : 4}
			fill={p.hot ? 'var(--color-accent)' : color}
			opacity="0.85"
			stroke="var(--color-ink)"
			stroke-width="1"
		>
			<title>{p.label ?? ''} ({Math.round(p.x)}, {Math.round(p.y)})</title>
		</circle>
	{/each}
	{#if xLabel}
		<text x={(padL + W - padR) / 2} y={height - 4} text-anchor="middle" class="fill-zinc-500" font-size="9"
			>{xLabel}</text
		>
	{/if}
	{#if yLabel}
		<text
			x={9}
			y={(padT + height - padB) / 2}
			text-anchor="middle"
			class="fill-zinc-500"
			font-size="9"
			transform="rotate(-90 9 {(padT + height - padB) / 2})">{yLabel}</text
		>
	{/if}
</svg>
