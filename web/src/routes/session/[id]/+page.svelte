<script lang="ts">
	import { enhance } from '$app/forms';
	import ExerciseLogger from '$lib/components/ExerciseLogger.svelte';
	import RestTimer from '$lib/components/RestTimer.svelte';
	import { num, dur, supersetLabel } from '$lib/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// rest timer trigger — bump the key + set restSec whenever a set is logged
	let restKey = $state(0);
	let restSec = $state(120);
	function onLogged(sec: number) {
		restSec = sec;
		restKey += 1;
	}

	// ad-hoc: extra exercises added client-side (before their first set exists server-side)
	let extraIds = $state<number[]>([]);
	let picker = $state('');

	// build the display list = server exercises + client-added ones not already present
	const displayExercises = $derived.by(() => {
		const present = new Set(data.exercises.map((e) => e.exerciseId));
		const extras = extraIds
			.filter((id) => !present.has(id))
			.map((id) => {
				const lib = data.library.find((l) => l.id === id)!;
				return {
					exerciseId: lib.id,
					name: lib.name,
					muscle: lib.muscle,
					category: lib.category,
					targetSets: 3,
					targetReps: 8,
					targetWeightKg: 0,
					restSec: lib.defaultRestSec,
					supersetGroup: null as number | null,
					sets: [] as never[],
					lastWeight: 0,
					lastReps: 8
				};
			});
		return [...data.exercises, ...extras];
	});

	// group by superset: null groups render standalone, shared numbers cluster
	type Ex = (typeof displayExercises)[number];
	const groups = $derived.by(() => {
		const out: { key: string; superset: number | null; items: Ex[] }[] = [];
		const byGroup = new Map<number, Ex[]>();
		for (const ex of displayExercises) {
			if (ex.supersetGroup == null) {
				out.push({ key: 'solo-' + ex.exerciseId, superset: null, items: [ex] });
			} else {
				const arr = byGroup.get(ex.supersetGroup) ?? [];
				arr.push(ex);
				byGroup.set(ex.supersetGroup, arr);
			}
		}
		for (const [g, items] of byGroup) out.push({ key: 'ss-' + g, superset: g, items });
		// keep source order roughly by first item's position
		const pos = (e: Ex) => displayExercises.indexOf(e);
		out.sort((a, b) => pos(a.items[0]) - pos(b.items[0]));
		return out;
	});

	function addPicked() {
		const id = Number(picker);
		if (id && !extraIds.includes(id)) extraIds = [...extraIds, id];
		picker = '';
	}

	let confirmFinish = $state(false);
</script>

<header class="mb-4 flex items-center justify-between gap-3">
	<div class="min-w-0">
		<p class="text-[11px] font-bold uppercase tracking-widest text-accent">Live session</p>
		<h1 class="truncate text-2xl font-black tracking-tight">{data.session.name}</h1>
	</div>
	<a href="/history" class="text-sm text-zinc-500 hover:text-zinc-300" aria-label="close">✕</a>
</header>

<!-- live stats bar -->
<div class="mb-4 grid grid-cols-3 divide-x divide-line rounded-2xl border border-line bg-panel">
	<div class="px-4 py-3 text-center">
		<div class="text-lg font-black tabular-nums">{data.totalSets}</div>
		<div class="text-[10px] uppercase tracking-wider text-zinc-500">sets</div>
	</div>
	<div class="px-4 py-3 text-center">
		<div class="text-lg font-black tabular-nums text-accent">{num(data.totalVolume)}</div>
		<div class="text-[10px] uppercase tracking-wider text-zinc-500">kg volume</div>
	</div>
	<div class="px-4 py-3 text-center">
		<div class="text-lg font-black tabular-nums">
			{dur(Date.now() - new Date(data.session.startedAt).getTime())}
		</div>
		<div class="text-[10px] uppercase tracking-wider text-zinc-500">elapsed</div>
	</div>
</div>

<!-- sticky rest timer -->
<div class="sticky top-2 z-10 mb-4">
	<RestTimer {restSec} runKey={restKey} />
</div>

<!-- exercises -->
<div class="flex flex-col gap-4">
	{#each groups as grp (grp.key)}
		{#if grp.superset != null}
			<div class="rounded-2xl border border-accent2/30 bg-accent2/[0.04] p-2">
				<div class="mb-1 flex items-center gap-2 px-2 pt-1">
					<span
						class="grid h-6 w-6 place-items-center rounded-full bg-accent2 text-xs font-black text-ink"
						>{supersetLabel(grp.superset)}</span
					>
					<span class="text-xs font-bold uppercase tracking-wider text-accent2">Superset</span>
					<span class="text-xs text-zinc-500">no rest between</span>
				</div>
				<div class="flex flex-col gap-2">
					{#each grp.items as ex (ex.exerciseId)}
						<ExerciseLogger exercise={ex} {onLogged} />
					{/each}
				</div>
			</div>
		{:else}
			{#each grp.items as ex (ex.exerciseId)}
				<ExerciseLogger exercise={ex} {onLogged} />
			{/each}
		{/if}
	{/each}
</div>

<!-- add exercise (ad-hoc) -->
<div class="mt-4 flex gap-2">
	<select
		bind:value={picker}
		class="flex-1 rounded-xl border border-line bg-panel px-3 py-3 text-sm text-zinc-200 outline-none focus:border-accent"
	>
		<option value="">+ Add an exercise…</option>
		{#each data.library as l (l.id)}
			<option value={l.id}>{l.name} · {l.muscle}</option>
		{/each}
	</select>
	<button
		onclick={addPicked}
		disabled={!picker}
		class="rounded-xl border border-line bg-panel px-5 py-3 font-semibold text-zinc-200 disabled:opacity-40"
		>Add</button
	>
</div>

<!-- finish -->
<div class="mt-6 mb-2">
	{#if !confirmFinish}
		<button
			onclick={() => (confirmFinish = true)}
			class="w-full rounded-2xl border border-line bg-panel py-4 text-center font-bold text-zinc-200 transition hover:border-accent"
			disabled={data.totalSets === 0}
			class:opacity-50={data.totalSets === 0}
		>
			Finish workout
		</button>
		{#if data.totalSets === 0}
			<p class="mt-2 text-center text-xs text-zinc-600">Log at least one set to finish.</p>
		{/if}
	{:else}
		<form method="POST" action="?/finish" use:enhance class="rounded-2xl border border-accent bg-panel p-4">
			<p class="mb-3 text-sm font-semibold">Wrap it up? Volume & kcal will be computed.</p>
			<div class="flex gap-2">
				<button
					type="button"
					onclick={() => (confirmFinish = false)}
					class="flex-1 rounded-xl border border-line py-3 font-semibold text-zinc-300"
					>Keep going</button
				>
				<button class="flex-1 rounded-xl bg-accent py-3 font-bold text-ink active:scale-[0.98]"
					>Finish & save</button
				>
			</div>
		</form>
	{/if}
</div>
