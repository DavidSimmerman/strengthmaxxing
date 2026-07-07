<script lang="ts">
	import { enhance } from '$app/forms';
	import { supersetLabel } from '$lib/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// distinct muscles per template, for the little tag row
	function muscles(ex: PageData['workouts'][number]['exercises']) {
		return [...new Set(ex.map((e) => e.muscle))];
	}
</script>

<header class="mb-6 flex items-end justify-between">
	<div>
		<p class="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Templates</p>
		<h1 class="text-3xl font-black tracking-tight">Workouts</h1>
	</div>
	<a
		href="/workouts/new"
		class="rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-ink transition active:scale-95"
		>+ New</a
	>
</header>

{#if data.workouts.length}
	<div class="grid gap-3">
		{#each data.workouts as w (w.id)}
			<div class="group rounded-2xl border border-line bg-panel p-5 transition hover:border-zinc-600">
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<h2 class="text-lg font-bold">{w.name}</h2>
						{#if w.notes}<p class="text-sm text-zinc-500">{w.notes}</p>{/if}
					</div>
					<div class="flex shrink-0 gap-1.5">
						<a
							href="/workouts/{w.id}/edit"
							class="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-accent hover:text-accent"
							>Edit</a
						>
						<form method="POST" action="?/delete" use:enhance>
							<input type="hidden" name="id" value={w.id} />
							<button
								class="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-zinc-500 hover:border-red-500 hover:text-red-400"
								>Archive</button
							>
						</form>
					</div>
				</div>

				<ol class="mt-3 flex flex-col gap-1">
					{#each w.exercises as ex, i (i)}
						<li class="flex items-center gap-2 text-sm">
							{#if ex.supersetGroup != null}
								<span
									class="grid h-4 w-4 place-items-center rounded bg-accent2/20 text-[9px] font-black text-accent2"
									>{supersetLabel(ex.supersetGroup)}</span
								>
							{:else}
								<span class="w-4 text-center text-xs text-zinc-600">{i + 1}</span>
							{/if}
							<span class="font-medium">{ex.name}</span>
							<span class="ml-auto tabular-nums text-zinc-500">{ex.targetSets}×{ex.targetReps}</span>
						</li>
					{/each}
				</ol>

				<div class="mt-3 flex flex-wrap gap-1.5">
					{#each muscles(w.exercises) as m (m)}
						<span class="rounded-full bg-panel2 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400"
							>{m}</span
						>
					{/each}
				</div>
			</div>
		{/each}
	</div>
{:else}
	<div class="rounded-2xl border border-dashed border-line px-6 py-16 text-center">
		<p class="text-lg font-semibold text-zinc-300">No templates yet</p>
		<p class="mx-auto mt-1 max-w-sm text-sm text-zinc-500">
			Build a reusable workout — pick exercises, set targets, wire up supersets — then start it in
			one tap from Today.
		</p>
		<a
			href="/workouts/new"
			class="mt-5 inline-block rounded-xl bg-accent px-6 py-3 font-bold text-ink active:scale-95"
			>Build your first workout</a
		>
	</div>
{/if}
