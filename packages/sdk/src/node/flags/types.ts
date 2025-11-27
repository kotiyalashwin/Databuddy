import type { FlagsConfig, FlagsManagerOptions } from "@/core/flags/types";

export interface ServerStorageConfig {
	/** Cache TTL in milliseconds (default: 5 minutes) */
	ttl?: number;
	/** Maximum cache size (default: 1000 flags) */
	maxSize?: number;
	/** Custom cache key prefix (default: 'databuddy:flags:') */
	keyPrefix?: string;
}

export interface ServerFlagsManagerOptions extends FlagsManagerOptions {
	/** Server-side storage configuration */
	storageConfig?: ServerStorageConfig;
	/** Enable memory caching for serverless environments */
	enableMemoryCache?: boolean;
	/** Time to keep fetching state after completion (ms, default: 50) */
	fetchingStateTtl?: number;
}
