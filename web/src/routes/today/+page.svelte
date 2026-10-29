<script lang="ts">
	import { ArrowDown, ArrowUp, Info, Minus, Play, Sparkles, X } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { dateTime } from '$lib/ui';
	import { wt, KG_PER_LB } from '$lib/units.svelte';
	import { MUSCLE_LABEL } from '$lib/coach/muscles';
	import type { SessionPlan } from '$lib/server/today';
	let { data } = $props();

	const ENERGY = ['Drained', 'Low', 'OK', 'Good', 'Great'];
	const MINUTES = [30, 45, 60, 75, 120];
	const LEVELS = ['Fresh', 'A bit', 'Very'];
	let energy = $state(3);
	let minutes = $state(45);
	// svelte-ignore state_referenced_locally
	let sore = $state<Record<string, number>>(Object.fromEntries(data.tiles.map((t) => [t.key, t.level])));
	let plan = $state<SessionPlan | null>(null);
	let building = $state(false);
	let starting = $state(false);
	let review = $state<'idle' | 'pending' | 'done' | 'failed'>('idle');
	let reviewCtl: AbortController | null = null;

	const tileClass = (l: number) =>
		l === 0 ? 'bg-panel text-zinc-200' : l === 1 ? 'bg-[#f5c518]/15 text-[#f5c518]' : 'bg-accent/15 text-accent';

	// Ask Claude to review the engine's plan; applied only if it lands before Start.
	async function requestReview(p: SessionPlan) {
		reviewCtl?.abort();
		reviewCtl = new AbortController();
		review = 'pending';
		try {
			const r = await fetch('/api/coach/today/review', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ plan: p }),
				signal: reviewCtl.signal
			});
			if (!r.ok) throw new Error();
			const reviewed = (await r.json()) as SessionPlan;
			if (!starting && plan === p) plan = reviewed;
			review = 'done';
		} catch {
			if (!reviewCtl?.signal.aborted) review = 'failed';
		}
	}

	const tone = { up: 'text-accent2', hold: 'text-zinc-200', down: 'text-accent', new: 'text-zinc-200' };
	const weight = (lb: number | null) => (lb == null ? 'find a weight' : lb === 0 ? 'bodyweight' : wt(lb * KG_PER_LB));
	const restLabel = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	const weekRows = $derived(
		plan ? plan.week.filter((w) => w.today > 0).sort((a, b) => b.today - a.today).slice(0, 8) : []
	);
	const restingLine = $derived(
		plan?.resting
			.filter((r) => r.why !== 'lower priority today')
			.map((r) => `${MUSCLE_LABEL[r.muscle].toLowerCase()} (${r.why})`)
			.join(', ')
	);
</script>

<div class="mx-auto max-w-md">
	{#if !plan}
		<header class="mb-5 flex items-start justify-between">
			<div>
				<p class="text-[11px] font-bold uppercase tracking-widest text-accent">Today's workout</p>
				<h1 class="text-2xl font-black tracking-tight">How are you?</h1>
			</div>
			<a href="/" aria-label="Cancel" class="text-zinc-500 hover:text-zinc-300"><X class="h-5 w-5" /></a>
		</header>

		{#each data.open as o (o.id)}
			<div class="mb-4 rounded-2xl border border-[#f5c518]/40 bg-[#f5c518]/[0.06] p-4 text-sm">
				<p class="font-semibold text-[#f5c518]">{o.name} is still open</p>
				<p class="mb-3 text-zinc-400">Started {dateTime(o.startedAt)}. Finish or discard it so its time isn't counted.</p>
				<div class="flex gap-2">
					<a href="/session/{o.id}" class="flex-1 rounded-xl border border-line py-2 text-center font-semibold">Open it</a>
					<form method="POST" action="?/discardOpen" use:enhance class="flex-1">
						<input type="hidden" name="id" value={o.id} />
						<button class="w-full rounded-xl border border-line py-2 font-semibold text-red-400">Discard it</button>
					</form>
				</div>
			</div>
		{/each}

		<form
			method="POST"
			action="?/build"
			use:enhance={() => {
				building = true;
				return async ({ result }) => {
					building = false;
					if (result.type === 'success' && result.data?.plan) {
						plan = result.data.plan as SessionPlan;
						void requestReview(plan);
					}
				};
			}}
		>
			<input type="hidden" name="energy" value={energy} />
			<input type="hidden" name="minutes" value={minutes} />
			{#each data.tiles as t (t.key)}<input type="hidden" name="sore_{t.key}" value={sore[t.key]} />{/each}

			<p class="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">Energy</p>
			<div class="mb-5 grid grid-cols-5 gap-1.5">
				{#each ENERGY as e, i (e)}
					{@const on = energy === i + 1}
					<button
						type="button"
						onclick={() => (energy = i + 1)}
						class="flex flex-col items-center gap-1.5 rounded-xl border py-2.5 text-[11px] font-semibold transition
							{on ? 'border-accent2 bg-accent2/10 text-accent2' : 'border-line text-zinc-400 hover:border-zinc-500'}"
					>
						<span class="flex h-4 items-end gap-[2px]">
							{#each { length: 5 } as _, b (b)}
								<span class="w-[3px] rounded-sm {b <= i ? (on ? 'bg-accent2' : 'bg-zinc-400') : 'bg-line'}" style="height:{4 + b * 3}px"></span>
							{/each}
						</span>
						{e}
					</button>
				{/each}
			</div>

			<p class="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">Time</p>
			<div class="mb-5 grid grid-cols-5 gap-1.5">
				{#each MINUTES as m (m)}
					<button
						type="button"
						onclick={() => (minutes = m)}
						class="rounded-xl border py-2 text-sm font-bold tabular-nums transition
							{minutes === m ? 'border-accent bg-accent/10 text-accent' : 'border-line text-zinc-400 hover:border-zinc-500'}"
						>{m === 120 ? '90+' : m}<span class="text-[10px] font-semibold"> min</span></button
					>
				{/each}
			</div>

			<div class="mb-2 flex items-baseline justify-between">
				<p class="text-xs font-bold uppercase tracking-wider text-zinc-400">Soreness</p>
				<p class="text-[10px] text-zinc-500">tap to cycle · fresh / a bit / very</p>
			</div>
			<div class="grid grid-cols-2 gap-1.5">
				{#each data.tiles as t (t.key)}
					<button
						type="button"
						onclick={() => (sore[t.key] = (sore[t.key] + 1) % 3)}
						class="rounded-xl px-3 py-2 text-left transition active:scale-[0.98] {tileClass(sore[t.key])}"
					>
						<span class="flex items-center justify-between text-sm font-semibold">
							<span>{t.label}</span><span class="text-[10px] opacity-80">{LEVELS[sore[t.key]]}</span>
						</span>
						<span class="block text-[10px] text-zinc-500">{t.note}</span>
					</button>
				{/each}
			</div>

			<button
				disabled={building}
				class="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-bold text-ink transition active:scale-[0.98] disabled:opacity-60"
			>
				<Sparkles class="h-4 w-4" />{building ? 'Building…' : "Build today's workout"}
			</button>
			<a href="/workouts" class="mt-2 block py-2 text-center text-xs text-zinc-500 hover:text-zinc-300">Or run a saved workout</a>
		</form>
	{:else}
		<header class="mb-3 flex items-start justify-between">
			<div>
				<p class="text-[11px] font-bold uppercase tracking-widest text-accent">Built for today</p>
				<h1 class="text-2xl font-black leading-tight tracking-tight">{plan.title}</h1>
				<p class="mt-0.5 text-xs text-zinc-400">
					{plan.totalSets} sets · about {plan.minutes} min{restingLine ? ` · resting: ${restingLine}` : ''}
				</p>
			</div>
			<button aria-label="Back to check-in" onclick={() => { reviewCtl?.abort(); plan = null; review = 'idle'; }} class="text-zinc-500 hover:text-zinc-300"><X class="h-5 w-5" /></button>
		</header>

		{#if plan.summary}
			<p class="mb-3 rounded-xl bg-panel px-3 py-2 text-sm text-zinc-300">{plan.summary}</p>
		{:else if review === 'pending'}
			<p class="mb-3 flex items-center gap-1.5 text-[11px] text-zinc-500"><Sparkles class="h-3 w-3 animate-pulse" />Coach is reviewing the picks…</p>
		{/if}

		{#if !plan.exercises.length}
			<p class="rounded-2xl border border-line bg-panel p-4 text-sm text-zinc-300">
				Everything is either recovering or done for the week. Take today off, or go for an easy walk.
			</p>
		{/if}

		<div class="flex flex-col gap-2">
			{#each plan.exercises as x (x.exercise)}
				<div class="rounded-2xl border bg-panel p-3 {x.supersetGroup ? 'border-accent2/40' : 'border-line'}">
					<div class="flex items-start justify-between gap-2">
						<p class="text-sm font-bold leading-tight">{x.exercise}</p>
						{#if x.supersetGroup}<span class="shrink-0 rounded bg-accent2/15 px-1.5 py-0.5 text-[10px] font-bold text-accent2">SUPERSET {String.fromCharCode(64 + x.supersetGroup)}</span>{/if}
					</div>
					<div class="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm tabular-nums">
						{#if x.kind === 'up'}<ArrowUp class="h-3.5 w-3.5 {tone.up}" />{:else if x.kind === 'down'}<ArrowDown class="h-3.5 w-3.5 {tone.down}" />{:else}<Minus class="h-3.5 w-3.5 text-zinc-500" />{/if}
						<b class={tone[x.kind]}>{x.sets} × {x.repLow}–{x.repHigh} · {weight(x.weightLb)}</b>
						<span class="text-[11px] text-zinc-500">{x.rir[0]}–{x.rir[1]} left · rest {restLabel(x.restSec)}</span>
					</div>
					{#if x.warmups.length}
						<p class="mt-1 text-[11px] text-zinc-500">Warm-up: {x.warmups.map((w) => `${wt(w.weightLb * KG_PER_LB)} × ${w.reps}`).join(', ')}</p>
					{/if}
					<p class="mt-1 text-[11px] leading-snug text-zinc-400">{x.reason}</p>
				</div>
			{/each}
		</div>

		{#if weekRows.length}
			<p class="mb-1.5 mt-5 text-xs font-bold uppercase tracking-wider text-zinc-400">Last 7 days, sets per muscle</p>
			<div class="flex flex-col gap-1.5">
				{#each weekRows as w (w.muscle)}
					{@const max = Math.max(w.target, w.done + w.today)}
					<div class="flex items-center gap-2 text-[11px]">
						<span class="w-20 shrink-0 text-zinc-300">{MUSCLE_LABEL[w.muscle]}</span>
						<div class="relative h-2.5 flex-1 overflow-hidden rounded bg-panel2">
							<div class="absolute inset-y-0 left-0 bg-zinc-500" style="width:{(w.done / max) * 100}%"></div>
							<div class="absolute inset-y-0 bg-accent2" style="left:{(w.done / max) * 100}%;width:{(w.today / max) * 100}%"></div>
						</div>
						<span class="w-12 text-right tabular-nums text-zinc-400">{Math.round(w.done + w.today)}/{w.target}</span>
					</div>
				{/each}
			</div>
			<p class="mt-1 text-[10px] text-zinc-500"><span class="text-zinc-400">grey</span> done · <span class="text-accent2">green</span> today</p>
		{/if}

		<form method="POST" action="?/start" onsubmit={() => { starting = true; reviewCtl?.abort(); }} class="mt-5">
			<input type="hidden" name="plan" value={JSON.stringify(plan)} />
			<button
				disabled={starting || !plan.exercises.length}
				class="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-bold text-ink transition active:scale-[0.98] disabled:opacity-60"
			>
				<Play class="h-4 w-4" />{starting ? 'Starting…' : 'Start'}
			</button>
		</form>
		{#if review === 'failed'}
			<p class="mt-2 flex items-center justify-center gap-1 text-[11px] text-zinc-500"><Info class="h-3 w-3" />Coach review unavailable; using the plan as built.</p>
		{/if}
	{/if}
</div>
