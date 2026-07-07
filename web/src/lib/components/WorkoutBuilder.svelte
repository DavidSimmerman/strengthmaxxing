<script lang="ts">
	import { enhance } from '$app/forms';
	import Stepper from './Stepper.svelte';
	import { supersetLabel } from '$lib/ui';

	type LibExercise = { id: number; name: string; muscle: string; category: string; defaultRestSec: number };
	type Slot = {
		exerciseId: number;
		name: string;
		muscle: string;
		targetSets: number;
		targetReps: number;
		targetWeightKg: number;
		restSec: number;
		supersetGroup: number | null;
	};

	let {
		library,
		initial,
		action,
		submitLabel = 'Save workout'
	}: {
		library: LibExercise[];
		initial?: { name: string; notes: string; exercises: Slot[] };
		action: string;
		submitLabel?: string;
	} = $props();

	// seed the form once from the (static) initial prop
	// svelte-ignore state_referenced_locally
	let name = $state(initial?.name ?? '');
	// svelte-ignore state_referenced_locally
	let notes = $state(initial?.notes ?? '');
	// svelte-ignore state_referenced_locally
	let slots = $state<Slot[]>(
		initial ? (structuredClone($state.snapshot(initial.exercises)) as Slot[]) : []
	);
	let picker = $state('');

	function addExercise() {
		const id = Number(picker);
		const lib = library.find((l) => l.id === id);
		if (!lib) return;
		slots = [
			...slots,
			{
				exerciseId: lib.id,
				name: lib.name,
				muscle: lib.muscle,
				targetSets: 3,
				targetReps: 8,
				targetWeightKg: 0,
				restSec: lib.defaultRestSec,
				supersetGroup: null
			}
		];
		picker = '';
	}
	function remove(i: number) {
		slots = slots.filter((_, j) => j !== i);
	}
	function move(i: number, dir: -1 | 1) {
		const j = i + dir;
		if (j < 0 || j >= slots.length) return;
		const copy = [...slots];
		[copy[i], copy[j]] = [copy[j], copy[i]];
		slots = copy;
	}

	// superset options: none, A(0), B(1), C(2), D(3)
	const ssOptions = [null, 0, 1, 2, 3];

	// serialize slots for the form action
	const payload = $derived(
		JSON.stringify(
			slots.map((s, i) => ({
				exerciseId: s.exerciseId,
				orderIndex: i,
				supersetGroup: s.supersetGroup,
				targetSets: s.targetSets,
				targetReps: s.targetReps,
				targetWeightKg: s.targetWeightKg,
				restSec: s.restSec
			}))
		)
	);
	const valid = $derived(name.trim().length > 0 && slots.length > 0);
</script>

<form method="POST" {action} use:enhance>
	<input type="hidden" name="exercises" value={payload} />

	<div class="mb-4">
		<input
			name="name"
			bind:value={name}
			placeholder="Workout name — e.g. Push A"
			class="w-full border-b-2 border-line bg-transparent pb-2 text-2xl font-black tracking-tight outline-none placeholder:text-zinc-600 focus:border-accent"
		/>
		<input
			name="notes"
			bind:value={notes}
			placeholder="Notes (optional)"
			class="mt-2 w-full bg-transparent text-sm text-zinc-400 outline-none placeholder:text-zinc-600"
		/>
	</div>

	<!-- slots -->
	<div class="flex flex-col gap-2">
		{#each slots as slot, i (i)}
			<div class="rounded-2xl border border-line bg-panel p-4">
				<div class="mb-3 flex items-center gap-2">
					<span class="text-xs tabular-nums text-zinc-600">{i + 1}</span>
					{#if slot.supersetGroup != null}
						<span
							class="grid h-5 w-5 place-items-center rounded bg-accent2/20 text-[10px] font-black text-accent2"
							>{supersetLabel(slot.supersetGroup)}</span
						>
					{/if}
					<span class="font-bold">{slot.name}</span>
					<span class="text-xs uppercase tracking-wide text-zinc-500">{slot.muscle}</span>
					<div class="ml-auto flex items-center gap-1">
						<button
							type="button"
							onclick={() => move(i, -1)}
							class="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-panel2"
							aria-label="move up">↑</button
						>
						<button
							type="button"
							onclick={() => move(i, 1)}
							class="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-panel2"
							aria-label="move down">↓</button
						>
						<button
							type="button"
							onclick={() => remove(i)}
							class="grid h-7 w-7 place-items-center rounded text-zinc-500 hover:bg-red-500/20 hover:text-red-400"
							aria-label="remove">✕</button
						>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
					<Stepper bind:value={slot.targetSets} label="Sets" step={1} min={1} max={20} />
					<Stepper bind:value={slot.targetReps} label="Reps" step={1} min={1} max={100} />
					<Stepper bind:value={slot.targetWeightKg} label="Weight" step={2.5} min={0} unit="kg" />
					<div class="flex flex-col gap-1">
						<span class="text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
							>Rest</span
						>
						<div class="flex items-center rounded-xl border border-line bg-ink px-3 py-2.5">
							<input
								type="number"
								bind:value={slot.restSec}
								step="15"
								min="0"
								class="w-full bg-transparent text-center text-lg font-bold tabular-nums outline-none"
							/>
							<span class="text-xs text-zinc-500">s</span>
						</div>
					</div>
				</div>

				<div class="mt-3 flex items-center gap-2">
					<span class="text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
						>Superset</span
					>
					<div class="flex gap-1">
						{#each ssOptions as opt (opt)}
							<button
								type="button"
								onclick={() => (slot.supersetGroup = opt)}
								class="rounded-lg border px-3 py-1 text-xs font-semibold transition
									{slot.supersetGroup === opt
									? 'border-accent2 bg-accent2/15 text-accent2'
									: 'border-line text-zinc-500 hover:text-zinc-300'}"
							>
								{opt == null ? 'None' : supersetLabel(opt)}
							</button>
						{/each}
					</div>
				</div>
			</div>
		{/each}
	</div>

	<!-- add exercise -->
	<div class="mt-3 flex gap-2">
		<select
			bind:value={picker}
			class="flex-1 rounded-xl border border-line bg-panel px-3 py-3 text-sm text-zinc-200 outline-none focus:border-accent"
		>
			<option value="">+ Add exercise from library…</option>
			{#each library as l (l.id)}
				<option value={l.id}>{l.name} · {l.muscle}</option>
			{/each}
		</select>
		<button
			type="button"
			onclick={addExercise}
			disabled={!picker}
			class="rounded-xl border border-line bg-panel px-5 py-3 font-semibold text-zinc-200 disabled:opacity-40"
			>Add</button
		>
	</div>

	<!-- save -->
	<div class="mt-6 flex gap-2">
		<a
			href="/workouts"
			class="rounded-xl border border-line px-5 py-3 text-center font-semibold text-zinc-400"
			>Cancel</a
		>
		<button
			disabled={!valid}
			class="flex-1 rounded-xl bg-accent py-3 font-bold text-ink transition active:scale-[0.98] disabled:opacity-40"
			>{submitLabel}</button
		>
	</div>
</form>
