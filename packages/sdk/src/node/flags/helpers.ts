import type { FlagResult } from "@/core/flags/types";
import type { ServerFlagsManagerOptions } from "./types";
import { ServerFlagsManager } from "./server-manager";

/**
 * Create a server-side flags manager for Next.js server components,
 * API routes, and serverless environments.
 */
export function createServerFlagsManager(
	options: ServerFlagsManagerOptions
): ServerFlagsManager {
	return new ServerFlagsManager(options);
}

/**
 * Hook-like function for server components to check flag status
 */
export async function getServerFlag(
	flagsManager: ServerFlagsManager,
	key: string
): Promise<FlagResult> {
	return await flagsManager.getFlag(key);
}

/**
 * Check if a flag is enabled (boolean helper)
 */
export async function isFlagEnabled(
	flagsManager: ServerFlagsManager,
	key: string
): Promise<boolean> {
	const result = await flagsManager.getFlag(key);
	return result.enabled;
}

/**
 * Fetch all flags at once (useful for initialization)
 */
export async function fetchAllServerFlags(
	flagsManager: ServerFlagsManager
): Promise<void> {
	return await flagsManager.fetchAllFlags();
}
