<script lang="ts">
	import { enhance } from '$app/forms';
	import Stepper from './Stepper.svelte';
	import { kg, num } from '$lib/ui';

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
	};

	let {
		exercise,
		onLogged
	}: { exercise: Exercise; onLogged: (restSec: number) => void } = $props();

	// step size: barbell/machine = 2.5kg, dumbbell = 2kg, bodyweight = 1kg
	const wStep = $derived(
		exercise.category === 'dumbbell' ? 2 : exercise.category === 'bodyweight' ? 1 : 2.5
	);

	// seed the log inputs from the exercise's last/target values (capture at mount is intended)
	// svelte-ignore state_referenced_locally
	let reps = $state(exercise.lastReps || exercise.targetReps);
	// svelte-ignore state_referenced_locally
	let weight = $state(exercise.lastWeight || exercise.targetWeightKg);
	let warmup = $state(false);
	let justLogged = $state(false);

	const nextSetIndex = $derived(exercise.sets.length);
	const doneWorking = $derived(exercise.sets.filter((s) => !s.isWarmup).length);
	const totalVol = $derived(exercise.sets.reduce((t, s) => t + (s.isWarmup ? 0 : s.volume), 0));
</script>

<div class="rounded-2xl border border-line bg-panel p-4">
	<div class="mb-3 flex items-start justify-between gap-2">
		<div>
			<h3 class="text-lg font-bold leading-tight">{exercise.name}</h3>
			<p class="text-xs uppercase tracking-wider text-zinc-500">
				{exercise.muscle} · target {exercise.targetSets}×{exercise.targetReps}
				{#if exercise.targetWeightKg}@ {kg(exercise.targetWeightKg)}{/if}
			</p>
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
				<div
					class="flex items-center gap-3 rounded-lg bg-ink px-3 py-1.5 text-sm tabular-nums"
					class:opacity-60={s.isWarmup}
				>
					<span class="w-6 text-center font-bold text-zinc-500">
						{s.isWarmup ? 'W' : s.setIndex + 1}
					</span>
					<span class="font-semibold">{s.reps} <span class="text-zinc-500">reps</span></span>
					<span class="text-zinc-600">×</span>
					<span class="font-semibold">{kg(s.weightKg)}</span>
					<span class="ml-auto text-xs text-zinc-500">{num(s.volume)} kg vol</span>
				</div>
			{/each}
		</div>
	{/if}

	<!-- log form -->
	<form
		method="POST"
		action="?/addSet"
		use:enhance={() => {
			return async ({ update }) => {
				justLogged = true;
				onLogged(exercise.restSec);
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
		<input type="hidden" name="weightKg" value={weight} />

		<div class="grid grid-cols-2 gap-3">
			<Stepper bind:value={reps} label="Reps" step={1} min={0} max={100} accent="accent2" />
			<Stepper bind:value={weight} label="Weight" step={wStep} min={0} unit="kg" accent="accent" />
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
				{#if justLogged}✓ Racked{:else}Log set{/if}
			</button>
		</div>
	</form>

	{#if totalVol > 0}
		<p class="mt-3 border-t border-line pt-2 text-xs text-zinc-500">
			{doneWorking} working sets · <span class="font-semibold text-zinc-300">{num(totalVol)} kg</span>
			volume
		</p>
	{/if}
</div>
