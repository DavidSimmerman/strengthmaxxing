<script lang="ts">
	/**
	 * Client-side rest countdown. Starts when `runKey` changes (a new set was logged).
	 * Draws a draining ring, flashes + beeps at 0. +/- 15s and skip controls.
	 */
	import { mmss } from '$lib/ui';

	let { restSec = 120, runKey = 0 }: { restSec?: number; runKey?: number } = $props();

	let total = $state(0);
	let remaining = $state(0);
	let running = $state(false);
	let done = $state(false);
	let interval: ReturnType<typeof setInterval> | null = null;

	function stop() {
		if (interval) clearInterval(interval);
		interval = null;
		running = false;
	}

	function beep() {
		try {
			const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			const ctx = new AC();
			const o = ctx.createOscillator();
			const g = ctx.createGain();
			o.connect(g);
			g.connect(ctx.destination);
			o.frequency.value = 880;
			o.type = 'sine';
			g.gain.setValueAtTime(0.001, ctx.currentTime);
			g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
			g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
			o.start();
			o.stop(ctx.currentTime + 0.5);
			if ('vibrate' in navigator) navigator.vibrate?.([120, 60, 120]);
		} catch {
			/* audio may be blocked before user gesture; ignore */
		}
	}

	function start(sec: number) {
		stop();
		total = sec;
		remaining = sec;
		done = false;
		running = true;
		const endAt = performance.now() + sec * 1000;
		interval = setInterval(() => {
			remaining = Math.max(0, (endAt - performance.now()) / 1000);
			if (remaining <= 0) {
				remaining = 0;
				done = true;
				beep();
				stop();
			}
		}, 100);
	}

	// restart whenever a set is logged
	let lastKey = -1;
	$effect(() => {
		if (runKey !== lastKey) {
			lastKey = runKey;
			if (runKey > 0) start(restSec);
		}
	});

	$effect(() => () => stop());

	const R = 26;
	const C = 2 * Math.PI * R;
	const frac = $derived(total > 0 ? remaining / total : 0);
</script>

{#if running || done}
	<div
		class="flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors
			{done
			? 'animate-pulse border-accent2 bg-accent2/10'
			: 'border-line bg-panel2'}"
	>
		<svg width="64" height="64" viewBox="0 0 64 64" class="shrink-0">
			<circle cx="32" cy="32" r={R} fill="none" stroke="var(--color-line)" stroke-width="6" />
			<circle
				cx="32"
				cy="32"
				r={R}
				fill="none"
				stroke={done ? 'var(--color-accent2)' : 'var(--color-accent)'}
				stroke-width="6"
				stroke-linecap="round"
				stroke-dasharray={C}
				stroke-dashoffset={C * (1 - frac)}
				transform="rotate(-90 32 32)"
				style="transition:stroke-dashoffset 0.15s linear"
			/>
			<text
				x="32"
				y="37"
				text-anchor="middle"
				class="fill-zinc-100 font-bold tabular-nums"
				font-size="14">{done ? '0:00' : mmss(remaining)}</text
			>
		</svg>
		<div class="flex-1">
			<div class="text-xs font-semibold uppercase tracking-wider {done ? 'text-accent2' : 'text-zinc-400'}">
				{done ? 'Rest complete — go' : 'Resting'}
			</div>
			<div class="mt-1 flex gap-1.5">
				<button
					type="button"
					class="rounded-md bg-ink px-2 py-1 text-xs font-medium text-zinc-300 active:bg-panel"
					onclick={() => start(remaining + 15)}>+15s</button
				>
				<button
					type="button"
					class="rounded-md bg-ink px-2 py-1 text-xs font-medium text-zinc-300 active:bg-panel"
					onclick={() => start(Math.max(1, remaining - 15))}>−15s</button
				>
				<button
					type="button"
					class="rounded-md bg-ink px-2 py-1 text-xs font-medium text-zinc-300 active:bg-panel"
					onclick={() => {
						stop();
						done = false;
					}}>Skip</button
				>
			</div>
		</div>
	</div>
{/if}
