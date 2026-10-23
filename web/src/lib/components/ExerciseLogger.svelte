<script module lang="ts">
	/** A lowered next-set weight, shown loudly until confirmed or the next set is logged. */
	export type DropNotice = { exerciseId: number; name: string; from: number; to: number; unit: string };
</script>

<script lang="ts">
	import { Pencil, Check, Trash2, ChevronDown, ChevronUp, ArrowUp, ArrowDown, Minus } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import Stepper from './Stepper.svelte';
	import { shortDate } from '$lib/ui';
	import { isApp, native } from '$lib/native';
	import { belowLb } from '$lib/equipment';
	import { wt, vol, toDisplay, fromDisplay, weightStep, units } from '$lib/units.svelte';

	type LoggedSet = {
		id: number;
		setIndex: number;
		reps: number;
		weightKg: number;
		rpe: number | null;
		isWarmup: boolean;
		side: string | null;
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
		perSide: boolean;
		sets: LoggedSet[];
		lastWeight: number;
		lastReps: number;
		lastTime?: { date: Date | string; sets: { reps: number; weightKg: number; side?: string | null }[] } | null;
		suggestion?: { weightKg: number; reps: number; kind: 'up' | 'hold' | 'down'; reason: string } | null;
	};

	let {
		exercise,
		onLogged,
		onNotice = () => {},
		suggesting = false
	}: {
		exercise: Exercise;
		onLogged: (restSec: number, pr: number | null) => void;
		/** The drop to show on the rest timer: set while this card is off screen, null otherwise. */
		onNotice?: (exerciseId: number, n: DropNotice | null) => void;
		suggesting?: boolean; // coach still working out today's weights
	} = $props();

	// Inputs are in the user's unit; converted to kg only when posted.
	// svelte-ignore state_referenced_locally
	let reps = $state(
		exercise.sets.length ? exercise.lastReps : exercise.suggestion?.reps || exercise.lastReps || exercise.targetReps
	);
	// svelte-ignore state_referenced_locally
	let repsR = $state(reps); // right side, one-side-at-a-time exercises
	// svelte-ignore state_referenced_locally
	let weight = $state(
		toDisplay(
			exercise.sets.length
				? exercise.lastWeight
				: exercise.suggestion?.weightKg ?? (exercise.lastWeight || exercise.targetWeightKg)
		)
	);
	// When the coach's suggestion arrives after the page opened, use it — unless a set is
	// already logged or the inputs were changed by hand.
	// svelte-ignore state_referenced_locally
	const seeded = { reps, weight, applied: !!exercise.suggestion };
	$effect(() => {
		const s = exercise.suggestion;
		if (!s || seeded.applied || exercise.sets.length) return;
		seeded.applied = true;
		if (reps !== seeded.reps || weight !== seeded.weight) return;
		reps = repsR = s.reps;
		weight = toDisplay(s.weightKg);
	});

	/** Settable weights below `w` (display units), nearest first. */
	function lighter(w: number): number[] {
		if (units() === 'lb') return belowLb(exercise.category, w);
		const s = weightStep(exercise.category);
		const out = [];
		for (let x = Math.ceil(w / s - 1e-6) - 1; x > 0 && out.length < 20; x--) out.push(Math.round(x * s * 100) / 100);
		return out;
	}
	/**
	 * Mid-workout load drop. A few reps short is normal fatigue across sets: keep the weight and
	 * take fewer reps. Only a big miss (3+ reps or over a quarter of the target) lowers the next
	 * set, by about 3% per missed rep (5-10%), to a weight the equipment can be set to. Never when
	 * the nearest lighter setting is more than 20% off (light cable / dumbbell work), and never
	 * after the last set.
	 */
	function nextSetDrop(target: number, got: number, w: number) {
		const short = target - got;
		if (w <= 0 || (short < 3 && short <= target * 0.25)) return null;
		const opts = lighter(w);
		if (!opts.length || w - opts[0] > w * 0.2) return null;
		const want = w * Math.min(0.1, Math.max(0.05, 0.03 * short));
		return opts.filter((x) => w - x <= want + 1e-6).at(-1) ?? opts[0];
	}

	const targetReps = $derived(exercise.suggestion?.reps ?? exercise.targetReps);
	let warmup = $state(false);
	let justLogged = $state(false);
	let error = $state('');

	// ---- weight-drop alert: card in the exercise (B) + rest-timer banner when off screen (A) ----
	let drop = $state<{ from: number; to: number; short: number } | null>(null);
	let root: HTMLElement | undefined = $state();
	let inView = $state(true);
	$effect(() => {
		if (!root) return;
		const io = new IntersectionObserver(([e]) => (inView = e.isIntersecting), { threshold: 0.15 });
		io.observe(root);
		return () => io.disconnect();
	});
	$effect(() => {
		onNotice(
			exercise.exerciseId,
			drop && !inView ? { exerciseId: exercise.exerciseId, name: exercise.name, from: drop.from, to: drop.to, unit: units() } : null
		);
	});
	function buzz() {
		if (isApp()) void native('haptic', { kind: 'warning' });
		else if ('vibrate' in navigator) navigator.vibrate?.([150, 80, 150]);
	}

	// ---- logged sets, paired by setIndex for one-side-at-a-time exercises ----
	type Row = { key: string; setIndex: number; isWarmup: boolean; sets: LoggedSet[] };
	const rows = $derived.by(() => {
		if (!exercise.perSide) return exercise.sets.map((s) => ({ key: String(s.id), setIndex: s.setIndex, isWarmup: s.isWarmup, sets: [s] }));
		const by = new Map<string, Row>();
		for (const s of exercise.sets) {
			const k = `${s.isWarmup ? 'w' : 's'}${s.setIndex}`;
			const r = by.get(k) ?? { key: k, setIndex: s.setIndex, isWarmup: s.isWarmup, sets: [] };
			r.sets.push(s);
			by.set(k, r);
		}
		for (const r of by.values()) r.sets.sort((a, b) => (a.side ?? '').localeCompare(b.side ?? ''));
		return [...by.values()];
	});
	const sideOf = (r: Row, side: 'L' | 'R') => r.sets.find((s) => s.side === side) ?? (side === 'L' ? r.sets[0] : r.sets[1]);
	const repsText = (r: Row) =>
		exercise.perSide ? r.sets.map((s) => `${s.side ?? ''} ${s.reps}`.trim()).join(' · ') : String(r.sets[0].reps);

	// inline edit of a logged set (both sides together)
	let editingKey = $state<string | null>(null);
	let editReps = $state(0);
	let editRepsR = $state(0);
	let editWeight = $state(0);
	function startEdit(r: Row) {
		editingKey = r.key;
		editReps = sideOf(r, 'L')?.reps ?? 0;
		editRepsR = sideOf(r, 'R')?.reps ?? 0;
		editWeight = toDisplay(r.sets[0].weightKg);
	}

	const working = $derived(rows.filter((r) => !r.isWarmup));
	const doneWorking = $derived(working.length);
	const nextSetIndex = $derived(rows.length ? Math.max(...rows.map((r) => r.setIndex)) + 1 : 0);
	const totalVol = $derived(exercise.sets.reduce((t, s) => t + (s.isWarmup ? 0 : s.volume), 0));
	const complete = $derived(exercise.targetSets > 0 && doneWorking >= exercise.targetSets);
	let expanded = $state(false); // reopened after finishing
	let addingExtra = $state(false); // "+ Add another set" after finishing
	const showForm = $derived(!complete || addingExtra);
	const doneSummary = $derived.by(() => {
		const ws = new Set(working.map((r) => r.sets[0].weightKg));
		const one = ws.size === 1 ? wt(working[0]?.sets[0].weightKg) : '';
		return working.map((r) => (one ? repsText(r) : `${repsText(r)}×${toDisplay(r.sets[0].weightKg)}`)).join(', ') + (one ? ` × ${one}` : '');
	});
	const lastTimeText = $derived(
		exercise.lastTime?.sets.length
			? exercise.lastTime.sets.map((s) => `${s.side ?? ''}${s.reps}×${toDisplay(s.weightKg)}`).join(', ')
			: ''
	);
	const chips = $derived(Array.from({ length: 5 }, (_, i) => targetReps - 2 + i).filter((n) => n >= 1));
</script>

<div bind:this={root}>
{#if complete && !expanded}
	<!-- finished: one dimmed line, tap to reopen -->
	<button
		type="button"
		onclick={() => (expanded = true)}
		class="flex w-full items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3 text-left opacity-60 transition hover:opacity-90"
	>
		<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent2 text-ink"><Check class="h-4 w-4" /></span>
		<span class="min-w-0 flex-1">
			<span class="block truncate font-bold">{exercise.name}</span>
			<span class="block truncate text-xs tabular-nums text-zinc-400">{doneSummary}</span>
		</span>
		<ChevronDown class="h-4 w-4 shrink-0 text-zinc-500" />
	</button>
{:else}
<div class="rounded-2xl border bg-panel p-4 {complete ? 'border-accent2/40' : 'border-line'}">
	<div class="mb-3 flex items-start justify-between gap-2">
		<div>
			<h3 class="text-lg font-bold leading-tight">
				<a href="/exercises/{exercise.exerciseId}" class="hover:text-accent">{exercise.name}</a>
			</h3>
			<p class="text-xs uppercase tracking-wider text-zinc-500">
				{exercise.muscle} · target {exercise.targetSets}×{exercise.targetReps}{exercise.perSide ? ' each side' : ''}
				{#if exercise.targetWeightKg}@ {wt(exercise.targetWeightKg)}{/if}
			</p>
			{#if lastTimeText && !complete}
				<p class="mt-0.5 text-xs text-zinc-500">
					Last time ({shortDate(exercise.lastTime!.date)}): <span class="tabular-nums text-zinc-300"
						>{lastTimeText} {units()}</span
					>
				</p>
			{/if}
			{#if exercise.suggestion && !complete}
				{@const sg = exercise.suggestion}
				<div class="mt-2 flex items-center gap-2 rounded-xl bg-ink px-3 py-2">
					{#if sg.kind === 'up'}<ArrowUp class="h-4 w-4 text-accent2" />{:else if sg.kind === 'down'}<ArrowDown
							class="h-4 w-4 text-accent"
						/>{:else}<Minus class="h-4 w-4 text-zinc-300" />{/if}
					<span
						class="text-lg font-black tabular-nums {sg.kind === 'up'
							? 'text-accent2'
							: sg.kind === 'down'
								? 'text-accent'
								: 'text-zinc-200'}">{wt(sg.weightKg)} × {sg.reps}</span
					>
					<span class="ml-auto text-[11px] text-zinc-500">today</span>
				</div>
				{#if sg.reason}<p class="mt-1 text-xs text-zinc-400">{sg.reason}</p>{/if}
			{:else if suggesting && !complete}
				<p class="mt-2 flex items-center gap-2 text-xs text-zinc-500">
					<span class="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent"></span>
					Coach is working out today's weight…
				</p>
			{/if}
		</div>
		<div class="flex flex-col items-end gap-2">
			{#if complete}
				<button
					type="button"
					onclick={() => ((expanded = false), (addingExtra = false))}
					aria-label="Collapse"
					class="flex items-center gap-1 rounded-full bg-accent2 px-2 py-0.5 text-[10px] font-black uppercase text-ink"
					>Done<ChevronUp class="h-3 w-3" /></button
				>
			{:else}
				<div class="flex items-center gap-1">
					{#each { length: exercise.targetSets } as _, i (i)}
						<span
							class="h-2.5 w-2.5 rounded-full transition-colors"
							class:bg-accent={i < doneWorking}
							class:bg-line={i >= doneWorking}
						></span>
					{/each}
				</div>
			{/if}
			<form method="POST" action="?/removeExercise" use:enhance>
				<input type="hidden" name="exerciseId" value={exercise.exerciseId} />
				<button
					title="Remove from this workout"
					aria-label="Remove {exercise.name} from this workout"
					class="-mr-1 rounded-lg p-1.5 text-zinc-600 hover:bg-red-500/10 hover:text-red-400"
					onclick={(e) => {
						const n = rows.length;
						const msg = `Remove ${exercise.name} from today's workout?${n ? ` Its ${n} logged set${n > 1 ? 's are' : ' is'} deleted.` : ''} Your saved workout doesn't change.`;
						if (!confirm(msg)) e.preventDefault();
					}}><Trash2 class="h-4 w-4" /></button
				>
			</form>
		</div>
	</div>

	<!-- completed sets -->
	{#if rows.length}
		<div class="mb-3 flex flex-col gap-1">
			{#each rows as r (r.key)}
				{#if editingKey === r.key}
					<form
						method="POST"
						action="?/editSet"
						class="rounded-lg border border-line bg-ink p-2"
						use:enhance={() =>
							async ({ result, update }) => {
								if (result.type === 'success') editingKey = null;
								await update({ reset: false });
							}}
					>
						<input type="hidden" name="setId" value={sideOf(r, 'L')?.id} />
						<input type="hidden" name="reps" value={editReps} />
						{#if exercise.perSide && sideOf(r, 'R')}
							<input type="hidden" name="setIdR" value={sideOf(r, 'R')?.id} />
							<input type="hidden" name="repsR" value={editRepsR} />
						{/if}
						<input type="hidden" name="weightKg" value={fromDisplay(editWeight)} />
						<div class="grid gap-2 {exercise.perSide ? 'grid-cols-3' : 'grid-cols-2'}">
							<Stepper bind:value={editReps} label={exercise.perSide ? 'Left' : 'Reps'} step={1} min={1} max={100} accent="accent2" compact={exercise.perSide} />
							{#if exercise.perSide}<Stepper bind:value={editRepsR} label="Right" step={1} min={1} max={100} accent="accent2" compact />{/if}
							<Stepper bind:value={editWeight} label={exercise.perSide ? units() : 'Weight'} category={exercise.category} min={0} unit={exercise.perSide ? '' : units()} compact={exercise.perSide} />
						</div>
						<div class="mt-2 flex gap-2 text-sm">
							<button
								formaction="?/deleteSet"
								class="rounded-lg px-3 py-2 font-semibold text-red-400 hover:bg-red-500/10">Delete</button
							>
							<button type="button" onclick={() => (editingKey = null)} class="ml-auto rounded-lg px-3 py-2 text-zinc-400"
								>Cancel</button
							>
							<button class="rounded-lg bg-accent2 px-4 py-2 font-bold text-ink">Save</button>
						</div>
					</form>
				{:else}
					<button
						type="button"
						onclick={() => startEdit(r)}
						title="Edit set"
						class="flex items-center gap-3 rounded-lg bg-ink px-3 py-1.5 text-left text-sm tabular-nums hover:bg-panel2"
						class:opacity-60={r.isWarmup}
					>
						<span class="w-6 text-center font-bold text-zinc-500">
							{r.isWarmup ? 'W' : working.indexOf(r) + 1}
						</span>
						<span class="font-semibold">{repsText(r)} <span class="text-zinc-500">reps</span></span>
						<span class="text-zinc-600">×</span>
						<span class="font-semibold">{wt(r.sets[0].weightKg)}</span>
						<span class="ml-auto text-xs text-zinc-500"
							>{vol(r.sets.reduce((t, s) => t + s.volume, 0))} vol <Pencil class="ml-1 inline h-3 w-3" /></span
						>
					</button>
				{/if}
			{/each}
		</div>
	{/if}

	{#if showForm}
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
				drop = null;
				const got = exercise.perSide ? Math.min(reps, repsR) : reps;
				const lastSet = !warmup && doneWorking + 1 >= exercise.targetSets;
				const to = warmup || lastSet ? null : nextSetDrop(targetReps, got, weight);
				if (to != null) {
					drop = { from: weight, to, short: targetReps - got };
					weight = to;
					buzz();
				}
				const pr = result.type === 'success' ? ((result.data?.pr as number | null) ?? null) : null;
				onLogged(exercise.restSec, pr);
				await update({ reset: false });
				if (lastSet) addingExtra = false;
				setTimeout(() => (justLogged = false), 600);
			};
		}}
	>
		<input type="hidden" name="exerciseId" value={exercise.exerciseId} />
		<input type="hidden" name="setIndex" value={nextSetIndex} />
		<input type="hidden" name="supersetGroup" value={exercise.supersetGroup ?? ''} />
		<input type="hidden" name="isWarmup" value={warmup ? 'true' : 'false'} />
		<input type="hidden" name="reps" value={reps} />
		{#if exercise.perSide}<input type="hidden" name="repsR" value={repsR} />{/if}
		<input type="hidden" name="weightKg" value={fromDisplay(weight)} />

		{#if drop}
			<div class="mb-3 rounded-xl bg-accent p-3 text-ink">
				<div class="flex items-center gap-2 text-lg font-black"><ArrowDown class="h-5 w-5" />Drop to {drop.to} {units()}</div>
				<p class="text-xs font-semibold">
					{drop.short} reps short of {targetReps}. Keep {drop.from} if that set was a fluke.
				</p>
				<div class="mt-2 flex gap-2 text-sm font-bold">
					<button type="button" onclick={() => (drop = null)} class="flex-1 rounded-lg bg-ink px-3 py-2 text-zinc-100"
						>Use {drop.to}</button
					>
					<button
						type="button"
						onclick={() => {
							weight = drop!.from;
							drop = null;
						}}
						class="flex-1 rounded-lg border border-ink px-3 py-2">Keep {drop.from}</button
					>
				</div>
			</div>
		{/if}
		<div class="grid gap-3 {exercise.perSide ? 'grid-cols-3 gap-2' : 'grid-cols-2'}">
			<Stepper bind:value={reps} label={exercise.perSide ? 'Left' : 'Reps'} step={1} min={1} max={100} accent="accent2" compact={exercise.perSide} />
			{#if exercise.perSide}<Stepper bind:value={repsR} label="Right" step={1} min={1} max={100} accent="accent2" compact />{/if}
			<Stepper
				bind:value={weight}
				label={exercise.perSide ? units() : 'Weight'}
				category={exercise.category}
				min={0}
				unit={exercise.perSide ? '' : units()}
				compact={exercise.perSide}
				accent="accent"
				highlight={!!drop}
				was={drop?.from ?? null}
			/>
		</div>
		<!-- one tap for the reps you actually did, around the target -->
		<div class="mt-2 flex items-center gap-1.5">
			<span class="w-12 shrink-0 text-[10px] font-semibold uppercase leading-tight tracking-wider text-zinc-500">Reps done</span>
			{#each chips as n (n)}
				<button
					type="button"
					onclick={() => (reps = repsR = n)}
					class="flex-1 rounded-lg border py-1.5 text-sm font-bold tabular-nums transition
						{reps === n && (!exercise.perSide || repsR === n)
						? 'border-accent2 bg-accent2 text-ink'
						: 'border-line bg-ink text-zinc-300'}">{n}</button
				>
			{/each}
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
	{:else}
		<button type="button" onclick={() => (addingExtra = true)} class="text-xs text-zinc-500 hover:text-zinc-300"
			>+ Add another set</button
		>
	{/if}

	{#if totalVol > 0}
		<p class="mt-3 border-t border-line pt-2 text-xs text-zinc-500">
			{doneWorking} working sets · <span class="font-semibold text-zinc-300">{vol(totalVol)}</span>
			volume
		</p>
	{/if}
</div>
{/if}
</div>
