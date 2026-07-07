<script lang="ts">
	/**
	 * Per-rep fatigue viz for a single set. Draws one bar per inter-rep gap; the bar's
	 * height/color scales with how much slower that rep was than the set's fastest gap.
	 * Rising bars = the lifter grinding = fatigue. Pure from the `offsets` (ms) array.
	 */
	let {
		offsets,
		height = 40,
		decayPct = 0
	}: { offsets: number[]; height?: number; decayPct?: number } = $props();

	const gaps = $derived(
		offsets.length < 2 ? [] : offsets.slice(1).map((o, i) => o - offsets[i])
	);
	const min = $derived(gaps.length ? Math.min(...gaps) : 0);
	const max = $derived(gaps.length ? Math.max(...gaps, min + 1) : 1);
	const bw = $derived(gaps.length ? 100 / gaps.length : 0);

	// bar color: fast=green, slow=orange, ramps through the two accents
	function barColor(g: number): string {
		const t = (g - min) / (max - min || 1); // 0 fast .. 1 slow
		if (t < 0.5) return 'color-mix(in oklch, var(--color-accent2), #f5c518 ' + t * 200 + '%)';
		return 'color-mix(in oklch, #f5c518, var(--color-accent) ' + (t - 0.5) * 200 + '%)';
	}
</script>

{#if gaps.length}
	<div class="flex items-end gap-3">
		<svg
			viewBox="0 0 100 {height}"
			preserveAspectRatio="none"
			class="h-10 w-full"
			style="height:{height}px"
		>
			{#each gaps as g, i (i)}
				{@const t = (g - min) / (max - min || 1)}
				{@const h = 4 + t * (height - 6)}
				<rect
					x={i * bw + 0.6}
					y={height - h}
					width={bw - 1.2}
					height={h}
					rx="0.8"
					fill={barColor(g)}
				>
					<title>rep {i + 2}: {(g / 1000).toFixed(2)}s gap</title>
				</rect>
			{/each}
		</svg>
		<div class="shrink-0 text-right leading-tight">
			<div
				class="text-sm font-bold tabular-nums"
				style="color:{decayPct > 25 ? 'var(--color-accent)' : decayPct > 8 ? '#f5c518' : 'var(--color-accent2)'}"
			>
				{decayPct}%
			</div>
			<div class="text-[9px] uppercase tracking-wide text-zinc-500">decay</div>
		</div>
	</div>
{:else}
	<span class="text-xs text-zinc-600">no rep timing</span>
{/if}
