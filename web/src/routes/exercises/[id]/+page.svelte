<script lang="ts">
	import LineChart from '$lib/components/LineChart.svelte';
	import { shortDate } from '$lib/ui';
	import { wt, toDisplay } from '$lib/units.svelte';
	let { data } = $props();
	const series = $derived(data.sessions.map((s) => ({ value: toDisplay(s.e1rm), label: shortDate(s.date) })));
	const repMax = $derived(Object.entries(data.prs.repMax).sort((a, b) => +a[0] - +b[0]));
</script>

<header class="mb-6">
	<a href="/exercises" class="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300">← Exercises</a>
	<h1 class="text-3xl font-black tracking-tight">{data.exercise.name}</h1>
	<p class="text-sm text-zinc-500">{data.exercise.muscle} · {data.exercise.category}</p>
</header>

{#if !data.sets.length}
	<p class="rounded-2xl border border-line bg-panel p-6 text-center text-sm text-zinc-500">No sets logged yet.</p>
{:else}
	<section class="mb-4 rounded-2xl border border-line bg-panel p-5">
		<div class="mb-2 flex items-baseline justify-between">
			<h2 class="text-sm font-bold uppercase tracking-wider text-zinc-400">Estimated 1-rep max</h2>
			{#if data.prs.bestE1rm}
				<span class="text-sm text-zinc-400">best <b class="text-accent">{wt(data.prs.bestE1rm.e1rm)}</b> · {shortDate(data.prs.bestE1rm.date)}</span>
			{/if}
		</div>
		{#if series.length > 1}
			<LineChart {series} yMin={Math.min(...series.map((s) => s.value)) * 0.9} />
		{:else}
			<p class="py-6 text-center text-xs text-zinc-600">Log this in two sessions to see a trend.</p>
		{/if}
	</section>

	<section class="mb-4 rounded-2xl border border-line bg-panel p-5">
		<h2 class="mb-1 text-sm font-bold uppercase tracking-wider text-zinc-400">Personal records</h2>
		<p class="mb-3 text-xs text-zinc-500">Heaviest weight you've lifted for at least this many reps.</p>
		<div class="grid grid-cols-5 gap-2 text-center">
			{#each repMax as [n, w] (n)}
				<div class="rounded-xl bg-ink py-3">
					<div class="text-lg font-black tabular-nums">{toDisplay(w)}</div>
					<div class="text-[10px] uppercase tracking-wider text-zinc-500">{n}+ reps</div>
				</div>
			{/each}
		</div>
	</section>

	<section class="rounded-2xl border border-line bg-panel p-5">
		<h2 class="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-400">Sessions</h2>
		<ul class="flex flex-col gap-1 text-sm">
			{#each [...data.sessions].reverse() as s (s.sessionId)}
				<li>
					<a href="/history/{s.sessionId}" class="flex justify-between rounded-lg bg-ink px-3 py-2 tabular-nums hover:bg-panel2">
						<span class="text-zinc-400">{shortDate(s.date)}</span>
						<span>top {s.top.reps}×{wt(s.top.weightKg)} · <b class="text-accent">{wt(s.e1rm)}</b></span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}
