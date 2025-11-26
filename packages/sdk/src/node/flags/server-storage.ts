import type { StorageInterface } from "@/core/flags/types";
import type { ServerStorageConfig } from "./types";

/**
 * Server-side storage implementation using in-memory cache
 * Optimized for serverless environments with proper TTL support
 */
export class ServerFlagStorage implements StorageInterface {
	private cache: Map<string, { value: any; expires: number }> = new Map();
	private ttl: number;
	private maxSize: number;
	private keyPrefix: string;

	constructor(config: ServerStorageConfig = {}) {
		this.ttl = config.ttl || 5 * 60 * 1000; // 5 minutes default
		this.maxSize = config.maxSize || 1000;
		this.keyPrefix = config.keyPrefix || "databuddy:flags:";

		// Clean up expired entries every minute
		if (typeof setInterval !== "undefined") {
			setInterval(() => this.cleanupExpired(), 60 * 1000);
		}
	}

	get(key: string): any {
		const fullKey = this.keyPrefix + key;
		const entry = this.cache.get(fullKey);

		if (!entry) {
			return null;
		}

		if (Date.now() > entry.expires) {
			this.cache.delete(fullKey);
			return null;
		}

		return entry.value;
	}

	set(key: string, value: unknown): void {
		const fullKey = this.keyPrefix + key;

		// Remove oldest entries if cache is full
		if (this.cache.size >= this.maxSize) {
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey) {
				this.cache.delete(oldestKey);
			}
		}

		this.cache.set(fullKey, {
			value,
			expires: Date.now() + this.ttl,
		});
	}

	getAll(): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		const now = Date.now();

		for (const [fullKey, entry] of this.cache.entries()) {
			if (now > entry.expires) {
				this.cache.delete(fullKey);
				continue;
			}

			const key = fullKey.replace(this.keyPrefix, "");
			result[key] = entry.value;
		}

		return result;
	}

	clear(): void {
		this.cache.clear();
	}

	setAll(flags: Record<string, unknown>): void {
		for (const [key, value] of Object.entries(flags)) {
			this.set(key, value);
		}
	}

	cleanupExpired(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache.entries()) {
			if (now > entry.expires) {
				this.cache.delete(key);
			}
		}
	}
}
