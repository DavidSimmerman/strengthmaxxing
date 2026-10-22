<script lang="ts">
	import { Pencil, Check } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import Stepper from './Stepper.svelte';
	import { shortDate } from '$lib/ui';
	import { wt, vol, toDisplay, fromDisplay, weightStep, units } from '$lib/units.svelte';

	type LoggedSet = {
		id: number;
		setIndex: number;
		reps: number;
		weightKg: number;
		rpe: number | null;
		isWarmup: boolean;
		volume: number;
	};
	type Exercise = {
		exerciseId: number;
		name: string;
		muscle: string;
		category: string;
		targetSets: number;
		targetReps: number;
		targetWeightKg: number;
		restSec: number;
		supersetGroup: number | null;
		sets: LoggedSet[];
		lastWeight: number;
		lastReps: number;
		lastTime?: { date: Date | string; sets: { reps: number; weightKg: number }[] } | null;
	};

	let {
		exercise,
		onLogged
	}: { exercise: Exercise; onLogged: (restSec: number, pr: number | null) => void } = $props();

	const wStep = $derived(weightStep(exercise.category));

	// Inputs are in the user's unit; converted to kg only when posted.
	// svelte-ignore state_referenced_locally
	let reps = $state(exercise.lastReps || exercise.targetReps);
	// svelte-ignore state_referenced_locally
	let weight = $state(toDisplay(exercise.lastWeight || exercise.targetWeightKg));
	let warmup = $state(false);
	let justLogged = $state(false);
	let error = $state('');

	// inline edit of a logged set
	let editingId = $state<number | null>(null);
	let editReps = $state(0);
	let editWeight = $state(0);
	function startEdit(s: LoggedSet) {
		editingId = s.id;
		editReps = s.reps;
		editWeight = toDisplay(s.weightKg);
	}

	const nextSetIndex = $derived(exercise.sets.length);
	const doneWorking = $derived(exercise.sets.filter((s) => !s.isWarmup).length);
	const totalVol = $derived(exercise.sets.reduce((t, s) => t + (s.isWarmup ? 0 : s.volume), 0));
	const lastTimeText = $derived(
		exercise.lastTime?.sets.length
			? exercise.lastTime.sets.map((s) => `${s.reps}×${toDisplay(s.weightKg)}`).join(', ')
			: ''
	);
</script>

<div class="rounded-2xl border border-line bg-panel p-4">
	<div class="mb-3 flex items-start justify-between gap-2">
		<div>
			<h3 class="text-lg font-bold leading-tight">
				<a href="/exercises/{exercise.exerciseId}" class="hover:text-accent">{exercise.name}</a>
			</h3>
			<p class="text-xs uppercase tracking-wider text-zinc-500">
				{exercise.muscle} · target {exercise.targetSets}×{exercise.targetReps}
				{#if exercise.targetWeightKg}@ {wt(exercise.targetWeightKg)}{/if}
			</p>
			{#if lastTimeText}
				<p class="mt-0.5 text-xs text-zinc-500">
					Last time ({shortDate(exercise.lastTime!.date)}): <span class="tabular-nums text-zinc-300"
						>{lastTimeText} {units()}</span
					>
				</p>
			{/if}
		</div>
		<div class="text-right">
			<div class="flex items-center gap-1">
				{#each { length: exercise.targetSets } as _, i (i)}
					<span
						class="h-2.5 w-2.5 rounded-full transition-colors"
						class:bg-accent={i < doneWorking}
						class:bg-line={i >= doneWorking}
					></span>
				{/each}
			</div>
		</div>
	</div>

	<!-- completed sets -->
	{#if exercise.sets.length}
		<div class="mb-3 flex flex-col gap-1">
			{#each exercise.sets as s (s.id)}
				{#if editingId === s.id}
					<form
						method="POST"
						action="?/editSet"
						class="rounded-lg border border-line bg-ink p-2"
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
							<Stepper bind:value={editWeight} label="Weight" step={wStep} min={0} unit={units()} />
						</div>
						<div class="mt-2 flex gap-2 text-sm">
							<button
								formaction="?/deleteSet"
								class="rounded-lg px-3 py-2 font-semibold text-red-400 hover:bg-red-500/10">Delete</button
							>
							<button type="button" onclick={() => (editingId = null)} class="ml-auto rounded-lg px-3 py-2 text-zinc-400"
								>Cancel</button
							>
							<button class="rounded-lg bg-accent2 px-4 py-2 font-bold text-ink">Save</button>
						</div>
					</form>
				{:else}
					<button
						type="button"
						onclick={() => startEdit(s)}
						title="Edit set"
						class="flex items-center gap-3 rounded-lg bg-ink px-3 py-1.5 text-left text-sm tabular-nums hover:bg-panel2"
						class:opacity-60={s.isWarmup}
					>
						<span class="w-6 text-center font-bold text-zinc-500">
							{s.isWarmup ? 'W' : s.setIndex + 1}
						</span>
						<span class="font-semibold">{s.reps} <span class="text-zinc-500">reps</span></span>
						<span class="text-zinc-600">×</span>
						<span class="font-semibold">{wt(s.weightKg)}</span>
						<span class="ml-auto text-xs text-zinc-500">{vol(s.volume)} vol <Pencil class="ml-1 inline h-3 w-3" /></span>
					</button>
				{/if}
			{/each}
		</div>
	{/if}

	<!-- log form -->
	<form
		method="POST"
		action="?/addSet"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'failure') {
					error = String(result.data?.error ?? 'Could not log set');
					return;
				}
				error = '';
				justLogged = true;
				const pr = result.type === 'success' ? ((result.data?.pr as number | null) ?? null) : null;
				onLogged(exercise.restSec, pr);
				await update({ reset: false });
				setTimeout(() => (justLogged = false), 600);
			};
		}}
	>
		<input type="hidden" name="exerciseId" value={exercise.exerciseId} />
		<input type="hidden" name="setIndex" value={nextSetIndex} />
		<input type="hidden" name="supersetGroup" value={exercise.supersetGroup ?? ''} />
		<input type="hidden" name="isWarmup" value={warmup ? 'true' : 'false'} />
		<input type="hidden" name="reps" value={reps} />
		<input type="hidden" name="weightKg" value={fromDisplay(weight)} />

		<div class="grid grid-cols-2 gap-3">
			<Stepper bind:value={reps} label="Reps" step={1} min={1} max={100} accent="accent2" />
			<Stepper bind:value={weight} label="Weight" step={wStep} min={0} unit={units()} accent="accent" />
		</div>

		<div class="mt-3 flex items-center gap-2">
			<label
				class="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-zinc-400"
			>
				<input type="checkbox" bind:checked={warmup} class="accent-zinc-500" />
				Warm-up
			</label>
			<button
				class="ml-auto flex items-center gap-2 rounded-xl px-6 py-3 font-bold text-ink transition active:scale-[0.97]"
				class:bg-accent={!justLogged}
				class:bg-accent2={justLogged}
				style="min-width:140px;justify-content:center"
			>
				{#if justLogged}<Check class="h-4 w-4" />Racked{:else}Log set{/if}
			</button>
		</div>
		{#if error}<p class="mt-2 text-right text-sm text-accent">{error}</p>{/if}
	</form>

	{#if totalVol > 0}
		<p class="mt-3 border-t border-line pt-2 text-xs text-zinc-500">
			{doneWorking} working sets · <span class="font-semibold text-zinc-300">{vol(totalVol)}</span>
			volume
		</p>
	{/if}
</div>
