<script lang="ts">
	import { Zap, Dumbbell, ChartLine, Bot, Activity, Settings, BicepsFlexed } from '@lucide/svelte';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { setUnits } from '$lib/units.svelte';

	let { children, data } = $props();
	// before children render (SSR too), and again whenever settings change
	$effect.pre(() => {
		setUnits(data.units);
	});
	// svelte-ignore state_referenced_locally
	setUnits(data.units);
	const bare = $derived(page.url.pathname === '/login');

	const nav = [
		{ href: '/', label: 'Today', icon: Zap },
		{ href: '/workouts', label: 'Workouts', icon: Dumbbell },
		{ href: '/history', label: 'History', icon: ChartLine },
		{ href: '/coach', label: 'Coach', icon: Bot },
		{ href: '/reports', label: 'Reports', icon: Activity },
		{ href: '/settings', label: 'Settings', icon: Settings }
	];
	const active = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link
		rel="stylesheet"
		href="https://rsms.me/inter/inter.css"
	/>
	<title>strengthmaxxing</title>
</svelte:head>

{#if bare}
	<main class="safe-top mx-auto max-w-3xl px-4 py-6">{@render children()}</main>
{:else}
<div class="safe-bottom-nav min-h-screen md:pl-56">
	<!-- desktop sidebar -->
	<aside
		class="fixed left-0 top-0 hidden h-full w-56 flex-col border-r border-line bg-panel px-4 py-6 md:flex"
	>
		<a href="/" class="mb-8 flex items-center gap-2 px-2">
			<BicepsFlexed class="h-6 w-6 text-accent" strokeWidth={2.25} />
			<span class="text-lg font-black tracking-tight"
				>strength<span class="text-accent">maxxing</span></span
			>
		</a>
		<nav class="flex flex-col gap-1">
			{#each nav as item (item.href)}
				<a
					href={item.href}
					class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition
						{active(item.href)
						? 'bg-accent/15 text-accent'
						: 'text-zinc-400 hover:bg-panel2 hover:text-zinc-100'}"
				>
					<item.icon class="h-4 w-4 shrink-0" />{item.label}
				</a>
			{/each}
		</nav>
	</aside>

	<main class="safe-top mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
		{@render children()}
	</main>

	<!-- mobile bottom bar -->
	<nav
		class="safe-bottom fixed bottom-0 left-0 z-20 flex w-full justify-around border-t border-line bg-panel/95 backdrop-blur md:hidden"
	>
		{#each nav as item (item.href)}
			<a
				href={item.href}
				class="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium
					{active(item.href) ? 'text-accent' : 'text-zinc-500'}"
			>
				<item.icon class="h-5 w-5" />{item.label}
			</a>
		{/each}
	</nav>
</div>
{/if}
