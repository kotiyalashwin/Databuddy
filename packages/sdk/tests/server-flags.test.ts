/**
 * Tests for Server-Side Flag Features
 *
 * Tests for @databuddy/sdk/node flag functionality including:
 * - ServerFlagsManager
 * - ServerFlagStorage
 * - Serverless environment compatibility
 * - Next.js integration scenarios
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
	createServerFlagsManager,
	ServerFlagStorage,
	ServerFlagsManager,
	getServerFlag,
	isFlagEnabled,
	fetchAllServerFlags,
} from "@databuddy/sdk/node";

// Store original fetch
const originalFetch = global.fetch;

// Create mock fetch function with configurable latency
const createMockFetch = (
	options: { latency?: number; disabledFlag?: boolean } = {}
) => {
	const latency = options.latency ?? 0; // Default to no latency for race condition testing
	const disabledFlag = options.disabledFlag ?? false;

	return async (url: string) => {
		// Add artificial delay if specified
		if (latency > 0) {
			await new Promise((resolve) => setTimeout(resolve, latency));
		}

		if (url.includes("/flags/evaluate")) {
			if (disabledFlag && url.includes("disabled-flag")) {
				return new Response(
					JSON.stringify({
						enabled: false,
						value: false,
						payload: null,
						reason: "TARGETED_NO_MATCH",
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					}
				);
			}

			return new Response(
				JSON.stringify({
					enabled: true,
					value: true,
					payload: { variant: "test" },
					reason: "TARGETED_MATCH",
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				}
			);
		}

		if (url.includes("/flags/bulk")) {
			return new Response(
				JSON.stringify({
					flags: {
						"test-flag": {
							enabled: true,
							value: true,
							payload: { variant: "test" },
							reason: "TARGETED_MATCH",
						},
						"disabled-flag": {
							enabled: false,
							value: false,
							payload: null,
							reason: "TARGETED_NO_MATCH",
						},
					},
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				}
			);
		}

		return new Response("Not Found", { status: 404 });
	};
};

// Set up default mock fetch with no latency (tests race condition fix)
beforeEach(() => {
	global.fetch = createMockFetch();
});

afterEach(() => {
	global.fetch = originalFetch;
});

describe("ServerFlagStorage", () => {
	let storage: ServerFlagStorage;

	beforeEach(() => {
		storage = new ServerFlagStorage({
			ttl: 1000, // 1 second for fast tests
			maxSize: 10,
			keyPrefix: "test:",
		});
	});

	afterEach(() => {
		storage.clear();
	});

	it("should store and retrieve flags", () => {
		const flag = { enabled: true, value: true, payload: null, reason: "TEST" };
		storage.set("test-flag", flag);

		const retrieved = storage.get("test-flag");
		expect(retrieved).toEqual(flag);
	});

	it("should return null for non-existent flags", () => {
		const result = storage.get("non-existent");
		expect(result).toBeNull();
	});

	it("should handle TTL expiration", async () => {
		const flag = { enabled: true, value: true, payload: null, reason: "TEST" };
		storage.set("test-flag", flag);

		// Should be available immediately
		expect(storage.get("test-flag")).toEqual(flag);

		// Wait for expiration
		await new Promise((resolve) => setTimeout(resolve, 1100));

		// Should be expired
		expect(storage.get("test-flag")).toBeNull();
	});

	it("should limit cache size", () => {
		const storage = new ServerFlagStorage({ maxSize: 2 });

		storage.set("flag1", {
			enabled: true,
			value: true,
			payload: null,
			reason: "TEST",
		});
		storage.set("flag2", {
			enabled: true,
			value: true,
			payload: null,
			reason: "TEST",
		});
		storage.set("flag3", {
			enabled: true,
			value: true,
			payload: null,
			reason: "TEST",
		});

		// Should only keep the 2 most recent flags
		expect(storage.get("flag1")).toBeNull();
		expect(storage.get("flag2")).not.toBeNull();
		expect(storage.get("flag3")).not.toBeNull();
	});

	it("should get all flags", () => {
		storage.set("flag1", {
			enabled: true,
			value: true,
			payload: null,
			reason: "TEST",
		});
		storage.set("flag2", {
			enabled: false,
			value: false,
			payload: null,
			reason: "TEST",
		});

		const allFlags = storage.getAll();
		expect(allFlags).toEqual({
			flag1: { enabled: true, value: true, payload: null, reason: "TEST" },
			flag2: { enabled: false, value: false, payload: null, reason: "TEST" },
		});
	});

	it("should clear all flags", () => {
		storage.set("flag1", {
			enabled: true,
			value: true,
			payload: null,
			reason: "TEST",
		});
		storage.set("flag2", {
			enabled: false,
			value: false,
			payload: null,
			reason: "TEST",
		});

		storage.clear();

		expect(storage.get("flag1")).toBeNull();
		expect(storage.get("flag2")).toBeNull();
		expect(storage.getAll()).toEqual({});
	});
});

describe("ServerFlagsManager", () => {
	let flagsManager: ServerFlagsManager;

	beforeEach(() => {
		flagsManager = createServerFlagsManager({
			config: {
				clientId: "test-client-id",
				user: {
					userId: "test-user",
					email: "test@example.com",
					properties: { plan: "pro" },
				},
				debug: false,
				autoFetch: false, // Disable auto-fetch for controlled tests
			},
			storageConfig: {
				ttl: 5000,
				maxSize: 100,
				keyPrefix: "test:manager:",
			},
			enableMemoryCache: true,
		});
	});

	it("should create flags manager with default config", () => {
		const manager = createServerFlagsManager({
			config: { clientId: "test-id" },
		});

		expect(manager).toBeInstanceOf(ServerFlagsManager);
	});

	it("should fetch individual flag", async () => {
		const result = await flagsManager.getFlag("test-flag");

		expect(result).toEqual({
			enabled: true,
			value: true,
			payload: { variant: "test" },
			reason: "TARGETED_MATCH",
		});
	});

	it("should cache fetched flags in memory", async () => {
		// First call should fetch from API
		const result1 = await flagsManager.getFlag("test-flag");
		expect(result1.enabled).toBe(true);

		// Second call should return from memory cache
		const result2 = await flagsManager.getFlag("test-flag");
		expect(result2).toEqual(result1);
	});

	it("should fetch all flags", async () => {
		await flagsManager.fetchAllFlags();

		const memoryFlags = flagsManager.getMemoryFlags();
		expect(memoryFlags).toHaveProperty("test-flag");
		expect(memoryFlags).toHaveProperty("disabled-flag");
		expect(memoryFlags["test-flag"].enabled).toBe(true);
		expect(memoryFlags["disabled-flag"].enabled).toBe(false);
	});

	it("should update user context", async () => {
		flagsManager.updateUser({
			userId: "new-user",
			email: "new@example.com",
			properties: { plan: "free" },
		});

		const result = await flagsManager.getFlag("test-flag");
		expect(result).toBeDefined();
		// In a real scenario, this would affect flag evaluation
	});

	it("should refresh flags", async () => {
		await flagsManager.fetchAllFlags();
		const initialFlags = flagsManager.getMemoryFlags();

		flagsManager.refresh();

		// Wait a bit for refresh to complete
		await new Promise((resolve) => setTimeout(resolve, 100));

		const refreshedFlags = flagsManager.getMemoryFlags();
		expect(refreshedFlags).toBeDefined();
	});

	it("should handle session pending state", async () => {
		const pendingManager = createServerFlagsManager({
			config: {
				clientId: "test-client-id",
				isPending: true,
				autoFetch: false,
			},
		});

		const result = await pendingManager.getFlag("any-flag");
		expect(result.enabled).toBe(false);
		expect(result.reason).toBe("SESSION_PENDING");
	});

	it("should return flag state", () => {
		const state = flagsManager.isEnabled("test-flag");

		expect(state).toEqual({
			enabled: false,
			isLoading: false,
			isReady: false,
		});
	});

	it("should handle pending flags state", async () => {
		// Clear any existing state to ensure clean test
		flagsManager.refresh(true); // Clear memory and storage

		// Mock slower fetch for this test to ensure race condition can be tested
		global.fetch = createMockFetch({ latency: 100 });

		// Start a fetch but don't await it
		const fetchPromise = flagsManager.getFlag("test-flag");

		// Wait a moment to ensure pending state is properly set
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Check state while fetching
		const state = flagsManager.isEnabled("test-flag");
		expect(state.isLoading).toBe(true);
		expect(state.isReady).toBe(false);

		// Wait for fetch to complete
		const result = await fetchPromise;
		expect(result.enabled).toBe(true);

		// Check state after fetch
		const finalState = flagsManager.isEnabled("test-flag");
		expect(finalState.isLoading).toBe(false);
		expect(finalState.isReady).toBe(true);
	});

	it("should handle race condition with zero-delay fetch", async () => {
		// Create manager with custom TTL for testing
		const testManager = createServerFlagsManager({
			config: {
				clientId: "test-client-id",
				autoFetch: false,
			},
			fetchingStateTtl: 100, // Longer TTL for testing
		});

		// Mock zero-delay fetch (simulates localhost/fast network)
		global.fetch = createMockFetch({ latency: 0 });

		// Start fetch and immediately check state
		const fetchPromise = testManager.getFlag("race-flag");

		// Check state immediately (race condition scenario)
		const state = testManager.isEnabled("race-flag");
		// With zero-delay fetch, the extended tracking should still show loading
		expect(state.isLoading).toBe(true);
		expect(state.isReady).toBe(false);

		// Wait for completion
		const result = await fetchPromise;
		expect(result.enabled).toBe(true);

		// State should still be loading due to extended tracking
		const loadingState = testManager.isEnabled("race-flag");
		expect(loadingState.isLoading).toBe(true);
		expect(loadingState.isReady).toBe(false);

		// Wait for TTL to expire
		await new Promise((resolve) => setTimeout(resolve, 150));

		// State should now be ready
		const finalState = testManager.isEnabled("race-flag");
		expect(finalState.isLoading).toBe(false);
		expect(finalState.isReady).toBe(true);
	});

	it("should handle race condition with zero-delay fetch", async () => {
		// Create manager with custom TTL for testing
		const testManager = createServerFlagsManager({
			config: {
				clientId: "test-client-id",
				autoFetch: false,
			},
			fetchingStateTtl: 100, // Longer TTL for testing
		});

		// Mock zero-delay fetch (simulates localhost/fast network)
		global.fetch = createMockFetch({ latency: 0 });

		// Start fetch and immediately check state
		const fetchPromise = testManager.getFlag("race-flag");

		// Wait a moment to ensure state is set
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Check state (race condition scenario)
		const state = testManager.isEnabled("race-flag");
		// With zero-delay fetch, extended tracking should still show loading
		expect(state.isLoading).toBe(true);
		expect(state.isReady).toBe(false);

		// Wait for completion
		const result = await fetchPromise;
		expect(result.enabled).toBe(true);

		// State should still be loading due to extended tracking
		const loadingState = testManager.isEnabled("race-flag");
		expect(loadingState.isLoading).toBe(true);
		expect(loadingState.isReady).toBe(false);

		// Wait for TTL to expire
		await new Promise((resolve) => setTimeout(resolve, 150));

		// State should now be ready
		const finalState = testManager.isEnabled("race-flag");
		expect(finalState.isLoading).toBe(false);
		expect(finalState.isReady).toBe(true);
	});

	it("should handle concurrent fetch requests", async () => {
		// Mock slower fetch to test concurrency
		global.fetch = createMockFetch({ latency: 100 });

		// Start multiple concurrent fetches for same flag
		const promise1 = flagsManager.getFlag("concurrent-flag");
		const promise2 = flagsManager.getFlag("concurrent-flag");
		const promise3 = flagsManager.getFlag("concurrent-flag");

		// Small delay to ensure state is set
		await new Promise((resolve) => setTimeout(resolve, 0));

		// All should show loading state
		const state = flagsManager.isEnabled("concurrent-flag");
		expect(state.isLoading).toBe(true);
		expect(state.isReady).toBe(false);

		// Wait for all to complete
		const [result1, result2, result3] = await Promise.all([
			promise1,
			promise2,
			promise3,
		]);

		// All should return the same result
		expect(result1).toEqual(result2);
		expect(result2).toEqual(result3);
		expect(result1.enabled).toBe(true);

		// Final state should be ready
		const finalState = flagsManager.isEnabled("concurrent-flag");
		expect(finalState.isLoading).toBe(false);
		expect(finalState.isReady).toBe(true);
	});

	it("should handle rapid successive calls", async () => {
		// Clear any existing state
		flagsManager.refresh(true);

		// Mock small delay fetch for rapid calls to ensure proper testing
		global.fetch = createMockFetch({ latency: 50 });

		// Make rapid successive calls
		const results = [];
		for (let i = 0; i < 5; i++) {
			results.push(flagsManager.getFlag(`rapid-flag-${i}`));
		}

		// Small delay to ensure states are set
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Check states rapidly
		for (let i = 0; i < 5; i++) {
			const state = flagsManager.isEnabled(`rapid-flag-${i}`);
			expect(state.isLoading).toBe(true);
			expect(state.isReady).toBe(false);
		}

		// Wait for all to complete
		const completedResults = await Promise.all(results);
		completedResults.forEach((result) => {
			expect(result.enabled).toBe(true);
		});

		// All states should be ready
		for (let i = 0; i < 5; i++) {
			const state = flagsManager.isEnabled(`rapid-flag-${i}`);
			expect(state.isLoading).toBe(false);
			expect(state.isReady).toBe(true);
		}
	});
});

describe("Serverless Environment Compatibility", () => {
	it("should work without setInterval (serverless)", () => {
		// Mock serverless environment by temporarily removing setInterval
		const originalSetInterval = global.setInterval;
		delete (global as any).setInterval;

		const storage = new ServerFlagStorage({
			ttl: 1000,
			maxSize: 10,
		});

		// Should not throw error
		expect(() => {
			storage.set("test", {
				enabled: true,
				value: true,
				payload: null,
				reason: "TEST",
			});
		}).not.toThrow();

		// Restore setInterval
		global.setInterval = originalSetInterval;
	});

	it("should handle AbortSignal timeout", async () => {
		const flagsManager = createServerFlagsManager({
			config: {
				clientId: "test-client-id",
				autoFetch: false,
			},
		});

		// Mock a response that simulates a timeout error
		global.fetch = async () => {
			// Simulate a timeout by throwing an AbortError
			const error = new Error("Request timeout");
			error.name = "AbortError";
			throw error;
		};

		const result = await flagsManager.getFlag("timeout-flag");
		expect(result.enabled).toBe(false);
		expect(result.reason).toBe("ERROR");
	});
});

describe("Helper Functions", () => {
	let flagsManager: ServerFlagsManager;

	beforeEach(() => {
		flagsManager = createServerFlagsManager({
			config: {
				clientId: "test-client-id",
				autoFetch: false,
			},
		});
	});

	it("getServerFlag should return flag result", async () => {
		const result = await getServerFlag(flagsManager, "test-flag");

		expect(result).toEqual({
			enabled: true,
			value: true,
			payload: { variant: "test" },
			reason: "TARGETED_MATCH",
		});
	});

	it("isFlagEnabled should return boolean", async () => {
		const enabled = await isFlagEnabled(flagsManager, "test-flag");
		expect(enabled).toBe(true);

		// Mock a disabled flag response
		global.fetch = createMockFetch({ disabledFlag: true });

		const disabled = await isFlagEnabled(flagsManager, "disabled-flag");
		expect(disabled).toBe(false);
	});

	it("fetchAllServerFlags should fetch all flags", async () => {
		await fetchAllServerFlags(flagsManager);

		const memoryFlags = flagsManager.getMemoryFlags();
		expect(Object.keys(memoryFlags).length).toBeGreaterThan(0);
	});
});

describe("Type Safety", () => {
	it("should enforce TypeScript types", () => {
		const flagsManager = createServerFlagsManager({
			config: {
				clientId: "test-client-id",
				user: {
					userId: "user-123",
					email: "user@example.com",
					properties: {
						plan: "pro",
						region: "us-east-1",
					},
				},
			},
			storageConfig: {
				ttl: 300000,
				maxSize: 1000,
				keyPrefix: "custom:prefix:",
			},
			enableMemoryCache: true,
		});

		// TypeScript should enforce these types
		expect(flagsManager).toBeInstanceOf(ServerFlagsManager);
		expect(typeof flagsManager.getFlag).toBe("function");
		expect(typeof flagsManager.isEnabled).toBe("function");
		expect(typeof flagsManager.fetchAllFlags).toBe("function");
	});

	it("should provide type-safe flag results", async () => {
		const flagsManager = createServerFlagsManager({
			config: { clientId: "test-client-id", autoFetch: false },
		});

		const result = await flagsManager.getFlag("test-flag");

		// TypeScript should know the shape of FlagResult
		expect(result).toHaveProperty("enabled");
		expect(result).toHaveProperty("value");
		expect(result).toHaveProperty("payload");
		expect(result).toHaveProperty("reason");
		expect(typeof result.enabled).toBe("boolean");
		expect(typeof result.value).toBe("boolean");
	});
});

describe("Error Handling", () => {
	let flagsManager: ServerFlagsManager;

	beforeEach(() => {
		flagsManager = createServerFlagsManager({
			config: {
				clientId: "test-client-id",
				autoFetch: false,
			},
		});
	});

	it("should handle network errors gracefully", async () => {
		// Mock network error
		global.fetch = async () => {
			throw new Error("Network error");
		};

		const result = await flagsManager.getFlag("error-flag");
		expect(result.enabled).toBe(false);
		expect(result.reason).toBe("ERROR");
	});

	it("should handle HTTP errors gracefully", async () => {
		// Mock HTTP error
		global.fetch = async () => {
			return new Response("Server Error", { status: 500 });
		};

		const result = await flagsManager.getFlag("error-flag");
		expect(result.enabled).toBe(false);
		expect(result.reason).toBe("ERROR");
	});

	it("should handle malformed responses gracefully", async () => {
		// Mock malformed response
		global.fetch = async () => {
			return new Response("invalid json", {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		const result = await flagsManager.getFlag("error-flag");
		expect(result.enabled).toBe(false);
		expect(result.reason).toBe("ERROR");
	});
});
