<script lang="ts">
	/**
	 * Big tap-target numeric stepper for mid-set logging. Bindable `value`.
	 * Scroll-safe: a press only counts when the finger lifts without moving, so a scroll that
	 * starts on a button changes nothing. Holding still for 0.4 s repeats.
	 * Pass `category` for a weight: +/− then walks the equipment's real settings.
	 */
	import { weightNext } from '$lib/units.svelte';

	let {
		value = $bindable(0),
		step = 2.5,
		min = 0,
		max = 9999,
		unit = '',
		label = '',
		accent = 'accent',
		category = '',
		highlight = false,
		was = null,
		compact = false
	}: {
		value: number;
		step?: number;
		min?: number;
		max?: number;
		unit?: string;
		label?: string;
		accent?: 'accent' | 'accent2';
		category?: string; // set for weights
		highlight?: boolean; // outline in orange (the coach just changed it)
		was?: number | null; // previous value, shown crossed out under a highlighted value
		compact?: boolean; // narrow (three across): slimmer buttons, smaller number
	} = $props();

	function clamp(v: number) {
		return Math.max(min, Math.min(max, Math.round(v * 100) / 100));
	}
	function bump(dir: 1 | -1) {
		value = clamp(category ? weightNext(category, Number(value) || 0, dir) : Number(value) + dir * step);
	}

	const MOVE_PX = 8;
	let press: { x: number; y: number; dir: 1 | -1; repeated: boolean } | null = null;
	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	let holdInterval: ReturnType<typeof setInterval> | null = null;
	function clearTimers() {
		if (holdTimer) clearTimeout(holdTimer);
		if (holdInterval) clearInterval(holdInterval);
		holdTimer = holdInterval = null;
	}
	function down(e: PointerEvent, dir: 1 | -1) {
		press = { x: e.clientX, y: e.clientY, dir, repeated: false };
		holdTimer = setTimeout(() => {
			if (!press) return;
			press.repeated = true;
			bump(dir);
			holdInterval = setInterval(() => bump(dir), 90);
		}, 400);
	}
	function move(e: PointerEvent) {
		if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_PX) cancel();
	}
	function up() {
		if (press && !press.repeated) bump(press.dir);
		cancel();
	}
	function cancel() {
		press = null;
		clearTimers();
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
		<span class="text-[11px] font-semibold uppercase tracking-wider {highlight ? 'text-accent' : 'text-zinc-500'}"
			>{label}{#if unit}<span class="normal-case">&nbsp;· {unit}</span>{/if}</span
		>
	{/if}
	<div
		class="flex items-stretch overflow-hidden rounded-xl border bg-ink transition-colors {ring}
			{highlight ? 'border-2 border-accent bg-accent/10' : 'border-line'}"
	>
		<button
			type="button"
			aria-label="decrease"
			class="grid {compact ? 'w-7 text-xl' : 'w-10 text-2xl'} shrink-0 place-items-center font-light text-zinc-400 transition-colors select-none touch-manipulation {btn}"
			onpointerdown={(e) => down(e, -1)}
			onpointermove={move}
			onpointerup={up}
			onpointerleave={cancel}
			onpointercancel={cancel}
			onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), bump(-1))}>−</button
		>
		<label class="flex min-w-0 flex-1 flex-col items-center justify-center px-0.5 py-2.5">
			<input
				type="number"
				inputmode="decimal"
				bind:value
				step="any"
				{min}
				{max}
				class="w-full min-w-0 bg-transparent text-center font-bold tabular-nums outline-none {compact || String(value).length >= 5 ? 'text-lg' : String(value).length >= 4 ? 'text-xl' : 'text-2xl'}"
			/>
			{#if highlight && was != null}<span class="-mt-0.5 text-[10px] text-zinc-500 line-through">{was}</span>{/if}
		</label>
		<button
			type="button"
			aria-label="increase"
			class="grid {compact ? 'w-7 text-xl' : 'w-10 text-2xl'} shrink-0 place-items-center font-light text-zinc-400 transition-colors select-none touch-manipulation {btn}"
			onpointerdown={(e) => down(e, 1)}
			onpointermove={move}
			onpointerup={up}
			onpointerleave={cancel}
			onpointercancel={cancel}
			onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), bump(1))}>+</button
		>
	</div>
</div>
