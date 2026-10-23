<script lang="ts">
	/**
	 * Rest countdown. Starts when `runKey` changes (a new set was logged). At 0 it rings until
	 * dismissed: inside the iPhone app the phone's own alarm (AlarmKit) rings, even locked or
	 * silenced; in a browser the page beeps and vibrates on a loop while it is open.
	 * +/- 15s and skip controls; logging the next set also stops it.
	 */
	import { mmss } from '$lib/ui';
	import { isApp, native } from '$lib/native';

	let { restSec = 120, runKey = 0 }: { restSec?: number; runKey?: number } = $props();

	let total = $state(0);
	let remaining = $state(0);
	let running = $state(false);
	let done = $state(false);
	let interval: ReturnType<typeof setInterval> | null = null;
	let ringer: ReturnType<typeof setInterval> | null = null;
	let nativeAlarm = false; // the phone's alarm will ring, so the page stays quiet

	function stop() {
		if (interval) clearInterval(interval);
		interval = null;
		running = false;
	}

	function silence() {
		if (ringer) clearInterval(ringer);
		ringer = null;
	}

	// One audio context, unlocked by the first tap (Log set), reused for every beep.
	let ctx: AudioContext | null = null;
	function audio() {
		if (!ctx) {
			const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			ctx = new AC();
		}
		if (ctx.state === 'suspended') void ctx.resume();
		return ctx;
	}
	$effect(() => {
		const unlock = () => audio();
		window.addEventListener('pointerdown', unlock, { once: true });
		return () => window.removeEventListener('pointerdown', unlock);
	});

	function beep() {
		try {
			const c = audio();
			for (const [at, f] of [[0, 880], [0.18, 1175], [0.36, 880]] as const) {
				const o = c.createOscillator();
				const g = c.createGain();
				o.connect(g);
				g.connect(c.destination);
				o.frequency.value = f;
				o.type = 'square';
				const t = c.currentTime + at;
				g.gain.setValueAtTime(0.001, t);
				g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
				g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
				o.start(t);
				o.stop(t + 0.16);
			}
			if ('vibrate' in navigator) navigator.vibrate?.([200, 100, 200]);
		} catch {
			/* audio may be blocked before a user gesture */
		}
	}

	function ring() {
		silence();
		if (nativeAlarm) return;
		beep();
		ringer = setInterval(beep, 1500);
	}

	/** Schedule (or move) the phone's alarm to the current end time. */
	async function armNative(sec: number) {
		if (!isApp()) return;
		const r = await native<{ scheduled: boolean }>('restAlarm', { endsAt: Date.now() + sec * 1000 });
		nativeAlarm = !!r?.scheduled;
	}
	function disarmNative() {
		if (isApp()) void native('restAlarmCancel');
	}

	function start(sec: number) {
		stop();
		silence();
		total = sec;
		remaining = sec;
		done = false;
		running = true;
		void armNative(sec);
		const endAt = performance.now() + sec * 1000;
		interval = setInterval(() => {
			remaining = Math.max(0, (endAt - performance.now()) / 1000);
			if (remaining <= 0) {
				remaining = 0;
				done = true;
				stop();
				ring();
			}
		}, 100);
	}

	function dismiss() {
		stop();
		silence();
		disarmNative();
		done = false;
	}

	// restart whenever a set is logged
	let lastKey = -1;
	$effect(() => {
		if (runKey !== lastKey) {
			lastKey = runKey;
			if (runKey > 0) start(restSec);
		}
	});

	$effect(() => () => {
		stop();
		silence();
		disarmNative();
	});

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
				{#if done}
					<button
						type="button"
						class="rounded-lg bg-accent2 px-5 py-2 text-sm font-bold text-ink active:scale-[0.97]"
						onclick={dismiss}>Dismiss</button
					>
				{:else}
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
						onclick={dismiss}>Skip</button
					>
				{/if}
			</div>
		</div>
	</div>
{/if}
