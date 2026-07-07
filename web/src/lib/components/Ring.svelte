<script lang="ts">
	/** A readiness gauge: a 270° arc that fills to `value`/`max`, with the score in the middle. */
	import { readinessBand } from '$lib/ui';

	let {
		value,
		max = 100,
		size = 148,
		stroke = 12,
		label = ''
	}: { value: number | null; max?: number; size?: number; stroke?: number; label?: string } =
		$props();

	const band = $derived(readinessBand(value));
	const r = $derived((size - stroke) / 2);
	const cx = $derived(size / 2);
	// 270° arc (gap at the bottom), starting at 135deg.
	const START = 135;
	const SWEEP = 270;
	const circ = $derived(2 * Math.PI * r);
	const arcLen = $derived((SWEEP / 360) * circ);
	const pct = $derived(value == null ? 0 : Math.max(0, Math.min(1, value / max)));

	// animated fill
	let shown = $state(0);
	$effect(() => {
		const target = pct;
		let raf: number;
		const start = performance.now();
		const from = shown;
		const step = (t: number) => {
			const k = Math.min(1, (t - start) / 700);
			const eased = 1 - Math.pow(1 - k, 4);
			shown = from + (target - from) * eased;
			if (k < 1) raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	});
</script>

<div class="relative inline-grid place-items-center" style="width:{size}px;height:{size}px">
	<svg width={size} height={size} viewBox="0 0 {size} {size}" class="-rotate-90 rotate-0">
		<circle
			{cx}
			cy={cx}
			{r}
			fill="none"
			stroke="var(--color-line)"
			stroke-width={stroke}
			stroke-linecap="round"
			stroke-dasharray="{arcLen} {circ}"
			transform="rotate({START} {cx} {cx})"
		/>
		<circle
			{cx}
			cy={cx}
			{r}
			fill="none"
			stroke={band.color}
			stroke-width={stroke}
			stroke-linecap="round"
			stroke-dasharray="{arcLen * shown} {circ}"
			transform="rotate({START} {cx} {cx})"
			style="filter:drop-shadow(0 0 6px {band.color}66)"
		/>
	</svg>
	<div class="absolute flex flex-col items-center">
		<span
			class="font-black leading-none tabular-nums"
			style="font-size:{size * 0.3}px;color:{band.color}"
		>
			{value ?? '—'}
		</span>
		<span class="mt-1 text-xs font-semibold uppercase tracking-wider text-zinc-400"
			>{label || band.label}</span
		>
	</div>
</div>
