<script lang="ts">
	/**
	 * Big tap-target numeric stepper for mid-set logging. Bindable `value`.
	 * Hold-to-repeat on press. `unit` shown after the number.
	 */
	let {
		value = $bindable(0),
		step = 2.5,
		min = 0,
		max = 9999,
		unit = '',
		label = '',
		accent = 'accent'
	}: {
		value: number;
		step?: number;
		min?: number;
		max?: number;
		unit?: string;
		label?: string;
		accent?: 'accent' | 'accent2';
	} = $props();

	function clamp(v: number) {
		return Math.max(min, Math.min(max, Math.round(v * 100) / 100));
	}
	function bump(dir: number) {
		value = clamp(value + dir * step);
	}

	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	let holdInterval: ReturnType<typeof setInterval> | null = null;
	function startHold(dir: number) {
		bump(dir);
		holdTimer = setTimeout(() => {
			holdInterval = setInterval(() => bump(dir), 80);
		}, 400);
	}
	function endHold() {
		if (holdTimer) clearTimeout(holdTimer);
		if (holdInterval) clearInterval(holdInterval);
		holdTimer = holdInterval = null;
	}

	const ring = $derived(accent === 'accent2' ? 'focus-within:border-accent2' : 'focus-within:border-accent');
	const btn = $derived(
		accent === 'accent2'
			? 'active:bg-accent2/20 active:text-accent2'
			: 'active:bg-accent/20 active:text-accent'
	);
</script>

<div class="flex flex-col gap-1">
	{#if label}
		<span class="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
	{/if}
	<div
		class="flex items-stretch overflow-hidden rounded-xl border border-line bg-ink transition-colors {ring}"
	>
		<button
			type="button"
			aria-label="decrease"
			class="grid w-12 shrink-0 place-items-center text-2xl font-light text-zinc-400 transition-colors select-none touch-manipulation {btn}"
			onpointerdown={() => startHold(-1)}
			onpointerup={endHold}
			onpointerleave={endHold}
			onpointercancel={endHold}>−</button
		>
		<label class="flex flex-1 items-baseline justify-center gap-1 px-1 py-2.5">
			<input
				type="number"
				inputmode="decimal"
				bind:value
				{step}
				{min}
				{max}
				class="w-full min-w-0 bg-transparent text-center text-2xl font-bold tabular-nums outline-none"
			/>
			{#if unit}<span class="text-sm text-zinc-500">{unit}</span>{/if}
		</label>
		<button
			type="button"
			aria-label="increase"
			class="grid w-12 shrink-0 place-items-center text-2xl font-light text-zinc-400 transition-colors select-none touch-manipulation {btn}"
			onpointerdown={() => startHold(1)}
			onpointerup={endHold}
			onpointerleave={endHold}
			onpointercancel={endHold}>+</button
		>
	</div>
</div>
