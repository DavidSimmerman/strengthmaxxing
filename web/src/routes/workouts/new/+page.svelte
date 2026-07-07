<script lang="ts">
	import WorkoutBuilder from '$lib/components/WorkoutBuilder.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<header class="mb-5 flex items-center gap-3">
	<a href="/workouts" class="text-zinc-500 hover:text-zinc-300" aria-label="back">←</a>
	<div>
		<p class="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">New template</p>
		<h1 class="text-2xl font-black tracking-tight">Build a workout</h1>
	</div>
</header>

<WorkoutBuilder library={data.library} action="" submitLabel="Create workout" />
