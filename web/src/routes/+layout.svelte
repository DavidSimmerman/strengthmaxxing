<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';

	let { children } = $props();

	const nav = [
		{ href: '/', label: 'Today', icon: '⚡' },
		{ href: '/workouts', label: 'Workouts', icon: '🏋️' },
		{ href: '/history', label: 'History', icon: '📈' },
		{ href: '/coach', label: 'Coach', icon: '🤖' },
		{ href: '/reports', label: 'Reports', icon: '🧬' }
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

<div class="min-h-screen pb-24 md:pb-0 md:pl-56">
	<!-- desktop sidebar -->
	<aside
		class="fixed left-0 top-0 hidden h-full w-56 flex-col border-r border-line bg-panel px-4 py-6 md:flex"
	>
		<a href="/" class="mb-8 flex items-center gap-2 px-2">
			<span class="text-2xl">💪</span>
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
					<span>{item.icon}</span>{item.label}
				</a>
			{/each}
		</nav>
	</aside>

	<main class="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
		{@render children()}
	</main>

	<!-- mobile bottom bar -->
	<nav
		class="fixed bottom-0 left-0 z-20 flex w-full justify-around border-t border-line bg-panel/95 backdrop-blur md:hidden"
	>
		{#each nav as item (item.href)}
			<a
				href={item.href}
				class="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium
					{active(item.href) ? 'text-accent' : 'text-zinc-500'}"
			>
				<span class="text-lg">{item.icon}</span>{item.label}
			</a>
		{/each}
	</nav>
</div>
