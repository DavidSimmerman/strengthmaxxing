<script lang="ts">
	import { wt } from '$lib/units.svelte';
	import { muscleColor } from '$lib/ui';
	let { data } = $props();
	let q = $state('');
	const shown = $derived(
		data.exercises
			.filter((e) => e.name.toLowerCase().includes(q.toLowerCase()) || e.muscle.includes(q.toLowerCase()))
			.sort((a, b) => (b.bestE1rm ?? -1) - (a.bestE1rm ?? -1) || a.name.localeCompare(b.name))
	);
</script>

<header class="mb-4">
	<p class="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Library</p>
	<h1 class="text-3xl font-black tracking-tight">Exercises</h1>
</header>
<input
	bind:value={q}
	placeholder="Search…"
	class="mb-4 w-full rounded-xl border border-line bg-panel px-4 py-3 text-sm outline-none focus:border-accent"
/>
<ul class="flex flex-col gap-1.5">
	{#each shown as e (e.id)}
		<li>
			<a href="/exercises/{e.id}" class="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 hover:border-accent">
				<span class="h-2.5 w-2.5 rounded-full" style="background:{muscleColor(e.muscle)}"></span>
				<span class="flex-1 font-semibold">{e.name}</span>
				<span class="text-xs text-zinc-500">{e.muscle}</span>
				{#if e.bestE1rm}<span class="w-24 text-right text-sm font-bold tabular-nums text-accent">{wt(e.bestE1rm)}</span>{/if}
			</a>
		</li>
	{/each}
</ul>
