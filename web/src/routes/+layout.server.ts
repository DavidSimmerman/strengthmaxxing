import * as repo from '$lib/server/repo';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => ({ units: repo.getSettings().units });
