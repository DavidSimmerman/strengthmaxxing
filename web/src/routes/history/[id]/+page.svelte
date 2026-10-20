<script lang="ts">
	import { enhance } from '$app/forms';
	import RepTimeline from '$lib/components/RepTimeline.svelte';
	import { num, mmss, dateTime, muscleColor, readinessBand, supersetLabel } from '$lib/ui';
	import { wt, vol as fmtVol, toDisplay, fromDisplay, weightStep, units } from '$lib/units.svelte';
	import Stepper from '$lib/components/Stepper.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const muscleRows = $derived(
		Object.entries(data.volumeByMuscle).sort((a, b) => b[1] - a[1])
	);
	const muscleMax = $derived(Math.max(1, ...muscleRows.map(([, v]) => v)));
	const band = $derived(readinessBand(data.session.readinessScore));
	let confirmDelete = $state(false);

	// tap a set to fix it (e.g. the watch miscounted) — rollups recompute server-side
	let editingId = $state<number | null>(null);
	let editReps = $state(0);
	let editWeight = $state(0);
	function startEdit(s: { id: number; reps: number; weightKg: number }) {
		editingId = s.id;
		editReps = s.reps;
		editWeight = toDisplay(s.weightKg);
	}
</script>

<header class="mb-4 flex items-start justify-between gap-3">
	<div class="min-w-0">
		<a href="/history" class="text-xs text-zinc-500 hover:text-zinc-300">← History</a>
		<h1 class="truncate text-2xl font-black tracking-tight">{data.session.name}</h1>
		<p class="text-sm text-zinc-500">{dateTime(data.session.startedAt)}</p>
	</div>
	{#if data.session.readinessScore != null}
		<div class="shrink-0 text-right">
			<div class="text-xl font-black tabular-nums" style="color:{band.color}">
				{data.session.readinessScore}
			</div>
			<div class="text-[10px] uppercase tracking-wide text-zinc-500">readiness</div>
		</div>
	{/if}
</header>

<!-- summary stats -->
<div class="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
	{#each [{ v: fmtVol(data.session.totalVolumeKg), l: 'volume', c: 'text-accent' }, { v: num(data.session.estimatedKcal), l: 'kcal', c: 'text-zinc-100' }, { v: data.session.durationSec ? mmss(data.session.durationSec) : '—', l: 'duration', c: 'text-zinc-100' }, { v: wt(data.session.bodyweightKg), l: 'bodyweight', c: 'text-zinc-100' }] as stat (stat.l)}
		<div class="rounded-xl border border-line bg-panel px-3 py-3">
			<div class="text-lg font-black tabular-nums {stat.c}">{stat.v}</div>
			<div class="text-[10px] uppercase tracking-wider text-zinc-500">{stat.l}</div>
		</div>
	{/each}
</div>

<!-- volume by muscle -->
{#if muscleRows.length}
	<section class="mb-5">
		<h2 class="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">Volume by muscle</h2>
		<div class="flex flex-col gap-1.5 rounded-2xl border border-line bg-panel p-4">
			{#each muscleRows as [muscle, vol] (muscle)}
				<div class="flex items-center gap-3">
					<span class="w-20 shrink-0 text-xs capitalize text-zinc-400">{muscle}</span>
					<div class="h-3 flex-1 overflow-hidden rounded-full bg-ink">
						<div
							class="h-full rounded-full"
							style="width:{(vol / muscleMax) * 100}%;background:{muscleColor(muscle)}"
						></div>
					</div>
					<span class="w-16 shrink-0 text-right text-xs tabular-nums text-zinc-400"
						>{fmtVol(vol)}</span
					>
				</div>
			{/each}
		</div>
	</section>
{/if}

<!-- per-exercise breakdown -->
<section>
	<h2 class="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">Exercises</h2>
	<div class="flex flex-col gap-3">
		{#each data.exercises as ex (ex.name)}
			<div class="rounded-2xl border border-line bg-panel p-4">
				<div class="mb-3 flex items-baseline justify-between gap-2">
					<div class="flex items-center gap-2">
						{#if ex.supersetGroup != null}
							<span
								class="grid h-5 w-5 place-items-center rounded bg-accent2/20 text-[10px] font-black text-accent2"
								>{supersetLabel(ex.supersetGroup)}</span
							>
						{/if}
						<a href="/exercises/{ex.exerciseId}" class="font-bold hover:text-accent">{ex.name}</a>
					</div>
					{#if ex.bestE1rm > 0}
						<span class="text-sm tabular-nums text-zinc-500"
							>best e1RM <span class="font-bold text-accent">{wt(ex.bestE1rm)}</span></span
						>
					{/if}
				</div>

				<div class="flex flex-col gap-2">
					{#each ex.sets as s (s.id)}
						{#if editingId === s.id}
							<form
								method="POST"
								action="?/editSet"
								class="rounded-xl border border-line bg-ink p-3"
								use:enhance={() =>
									async ({ result, update }) => {
										if (result.type === 'success') editingId = null;
										await update({ reset: false });
									}}
							>
								<input type="hidden" name="setId" value={s.id} />
								<input type="hidden" name="reps" value={editReps} />
								<input type="hidden" name="weightKg" value={fromDisplay(editWeight)} />
								<div class="grid grid-cols-2 gap-2">
									<Stepper bind:value={editReps} label="Reps" step={1} min={1} max={100} accent="accent2" />
									<Stepper bind:value={editWeight} label="Weight" step={weightStep(ex.category)} min={0} unit={units()} />
								</div>
								<div class="mt-2 flex gap-2 text-sm">
									<button formaction="?/deleteSet" class="rounded-lg px-3 py-2 font-semibold text-red-400 hover:bg-red-500/10"
										>Delete</button
									>
									<button type="button" onclick={() => (editingId = null)} class="ml-auto rounded-lg px-3 py-2 text-zinc-400"
										>Cancel</button
									>
									<button class="rounded-lg bg-accent2 px-4 py-2 font-bold text-ink">Save</button>
								</div>
							</form>
						{:else}
						<div class="rounded-xl bg-ink p-3" class:opacity-60={s.isWarmup}>
							<button type="button" onclick={() => startEdit(s)} title="Edit set" class="flex w-full items-center gap-3 text-left text-sm tabular-nums">
								<span class="w-6 text-center font-bold text-zinc-500"
									>{s.isWarmup ? 'W' : s.setIndex + 1}</span
								>
								<span class="font-semibold">{s.reps || '—'} reps</span>
								<span class="text-zinc-600">×</span>
								<span class="font-semibold">{wt(s.weightKg)}</span>
								{#if s.rpe}<span class="text-xs text-zinc-500">RPE {s.rpe}</span>{/if}
								<span class="ml-auto text-xs text-zinc-500">e1RM {wt(s.e1rmKg)} ✎</span>
							</button>
							{#if s.repTimeline.length >= 3}
								<div class="mt-2 border-t border-line pt-2">
									<RepTimeline offsets={s.repTimeline} decayPct={s.fatigue.decayPct} />
									{#if s.fatigue.grinders > 0}
										<p class="mt-1 text-[10px] text-zinc-500">
											{s.fatigue.grinders} grinder{s.fatigue.grinders > 1 ? 's' : ''} · avg
											{(s.fatigue.avgRepMs / 1000).toFixed(2)}s / rep
										</p>
									{/if}
								</div>
							{/if}
						</div>
						{/if}
					{/each}
				</div>
			</div>
		{/each}
	</div>
</section>

<!-- danger zone -->
<div class="mt-6">
	{#if !confirmDelete}
		<button
			onclick={() => (confirmDelete = true)}
			class="text-xs text-zinc-600 hover:text-red-400">Delete this session</button
		>
	{:else}
		<form method="POST" action="?/delete" use:enhance class="flex items-center gap-2">
			<span class="text-xs text-zinc-400">Delete permanently?</span>
			<button class="rounded-lg bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-400"
				>Yes, delete</button
			>
			<button
				type="button"
				onclick={() => (confirmDelete = false)}
				class="text-xs text-zinc-500">Cancel</button
			>
		</form>
	{/if}
</div>
