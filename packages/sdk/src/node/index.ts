import { createLogger, createNoopLogger, type Logger } from "./logger";
import { EventQueue } from "./queue";
import type {
	BatchEventInput,
	BatchEventResponse,
	CustomEventInput,
	DatabuddyConfig,
	EventResponse,
	GlobalProperties,
	Middleware,
} from "./types";

export type {
	BatchEventInput,
	BatchEventResponse,
	CustomEventInput,
	DatabuddyConfig,
	EventResponse,
	GlobalProperties,
	Logger,
	Middleware,
} from "./types";

const DEFAULT_API_URL = "https://basket.databuddy.cc";
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_BATCH_TIMEOUT = 2000;
const DEFAULT_MAX_QUEUE_SIZE = 1000;
const DEFAULT_MAX_DEDUPLICATION_CACHE_SIZE = 10_000;

export class Databuddy {
	private readonly clientId: string;
	private apiUrl: string;
	private logger: Logger;
	private enableBatching: boolean;
	private batchSize: number;
	private batchTimeout: number;
	private queue: EventQueue;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private globalProperties: GlobalProperties = {};
	private middleware: Middleware[] = [];
	private enableDeduplication: boolean;
	private deduplicationCache: Set<string> = new Set();
	private maxDeduplicationCacheSize: number;

	constructor(config: DatabuddyConfig) {
		if (!config.clientId || typeof config.clientId !== "string") {
			throw new Error("clientId is required and must be a string");
		}

		this.clientId = config.clientId.trim();
		this.apiUrl = config.apiUrl?.trim() || DEFAULT_API_URL;
		this.enableBatching = config.enableBatching !== false;
		this.batchSize = Math.min(config.batchSize || DEFAULT_BATCH_SIZE, 100);
		this.batchTimeout = config.batchTimeout || DEFAULT_BATCH_TIMEOUT;
		this.queue = new EventQueue(config.maxQueueSize || DEFAULT_MAX_QUEUE_SIZE);
		this.middleware = config.middleware || [];
		this.enableDeduplication = config.enableDeduplication !== false;
		this.maxDeduplicationCacheSize =
			config.maxDeduplicationCacheSize || DEFAULT_MAX_DEDUPLICATION_CACHE_SIZE;

		if (config.logger) {
			this.logger = config.logger;
		} else if (config.debug) {
			this.logger = createLogger(true);
		} else {
			this.logger = createNoopLogger();
		}

		this.logger.info("Initialized", {
			clientId: this.clientId,
			apiUrl: this.apiUrl,
			enableBatching: this.enableBatching,
			batchSize: this.batchSize,
			batchTimeout: this.batchTimeout,
			middlewareCount: this.middleware.length,
			enableDeduplication: this.enableDeduplication,
		});
	}

	async track(event: CustomEventInput): Promise<EventResponse> {
		if (!event.name || typeof event.name !== "string") {
			return {
				success: false,
				error: "Event name is required and must be a string",
			};
		}

		const batchEvent: BatchEventInput = {
			type: "custom",
			name: event.name,
			eventId: event.eventId,
			anonymousId: event.anonymousId,
			sessionId: event.sessionId,
			timestamp: event.timestamp,
			properties: {
				...this.globalProperties,
				...(event.properties || {}),
			},
		};

		const processedEvent = await this.applyMiddleware(batchEvent);
		if (!processedEvent) {
			this.logger.debug("Event dropped by middleware", { name: event.name });
			return { success: true };
		}

		if (this.enableDeduplication && processedEvent.eventId) {
			if (this.deduplicationCache.has(processedEvent.eventId)) {
				this.logger.debug("Event deduplicated", {
					eventId: processedEvent.eventId,
				});
				return { success: true };
			}
			this.addToDeduplicationCache(processedEvent.eventId);
		}

		if (!this.enableBatching) {
			return this.send(processedEvent);
		}

		const shouldFlush = this.queue.add(processedEvent);
		this.logger.debug("Event queued", { queueSize: this.queue.size() });

		this.scheduleFlush();

		if (shouldFlush || this.queue.size() >= this.batchSize) {
			await this.flush();
		}

		return { success: true };
	}

	private async send(event: BatchEventInput): Promise<EventResponse> {
		try {
			const url = `${this.apiUrl}/?client_id=${encodeURIComponent(this.clientId)}`;

			this.logger.info("📤 SENDING SINGLE EVENT:", {
				name: event.name,
				properties: JSON.stringify(event.properties, null, 2),
				propertiesCount: Object.keys(event.properties || {}).length,
			});

			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(event),
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => "Unknown error");
				this.logger.error("Request failed", {
					status: response.status,
					statusText: response.statusText,
					body: errorText,
				});
				return {
					success: false,
					error: `HTTP ${response.status}: ${response.statusText}`,
				};
			}

			const data = await response.json();

			this.logger.info("Response received", data);

			if (data.status === "success") {
				return {
					success: true,
					eventId: data.eventId,
				};
			}

			return {
				success: false,
				error: data.message || "Unknown error from server",
			};
		} catch (error) {
			this.logger.error("Request error", {
				error: error instanceof Error ? error.message : String(error),
			});
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Network request failed",
			};
		}
	}

	private scheduleFlush(): void {
		if (this.flushTimer) {
			return;
		}

		this.flushTimer = setTimeout(() => {
			this.flush().catch((error) => {
				this.logger.error("Auto-flush error", {
					error: error instanceof Error ? error.message : String(error),
				});
			});
		}, this.batchTimeout);
	}

	async flush(): Promise<BatchEventResponse> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}

		if (this.queue.isEmpty()) {
			return {
				success: true,
				processed: 0,
				results: [],
			};
		}

		const events = this.queue.getAll();
		this.queue.clear();

		this.logger.info("Flushing events", { count: events.length });

		return this.batch(events);
	}

	async batch(events: BatchEventInput[]): Promise<BatchEventResponse> {
		if (!Array.isArray(events)) {
			return {
				success: false,
				error: "Events must be an array",
			};
		}

		if (events.length === 0) {
			return {
				success: false,
				error: "Events array cannot be empty",
			};
		}

		if (events.length > 100) {
			return {
				success: false,
				error: "Batch size cannot exceed 100 events",
			};
		}

		for (const event of events) {
			if (!event.name || typeof event.name !== "string") {
				return {
					success: false,
					error: "All events must have a valid name",
				};
			}
		}

		const enrichedEvents = events.map((event) => ({
			...event,
			properties: {
				...this.globalProperties,
				...(event.properties || {}),
			},
		}));

		const processedEvents: BatchEventInput[] = [];
		for (const event of enrichedEvents) {
			const processedEvent = await this.applyMiddleware(event);
			if (!processedEvent) {
				continue;
			}

			if (this.enableDeduplication && processedEvent.eventId) {
				if (this.deduplicationCache.has(processedEvent.eventId)) {
					this.logger.debug("Event deduplicated in batch", {
						eventId: processedEvent.eventId,
					});
					continue;
				}
				this.addToDeduplicationCache(processedEvent.eventId);
			}

			processedEvents.push(processedEvent);
		}

		if (processedEvents.length === 0) {
			return {
				success: true,
				processed: 0,
				results: [],
			};
		}

		try {
			const url = `${this.apiUrl}/batch?client_id=${encodeURIComponent(this.clientId)}`;

			this.logger.info("📦 SENDING BATCH EVENTS:", {
				count: processedEvents.length,
				firstEventName: processedEvents[0]?.name,
				firstEventProperties: JSON.stringify(
					processedEvents[0]?.properties,
					null,
					2
				),
				firstEventPropertiesCount: Object.keys(
					processedEvents[0]?.properties || {}
				).length,
			});

			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(processedEvents),
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => "Unknown error");
				this.logger.error("Batch request failed", {
					status: response.status,
					statusText: response.statusText,
					body: errorText,
				});
				return {
					success: false,
					error: `HTTP ${response.status}: ${response.statusText}`,
				};
			}

			const data = await response.json();

			this.logger.info("Batch response received", data);

			if (data.status === "success") {
				return {
					success: true,
					processed: data.processed || processedEvents.length,
					results: data.results,
				};
			}

			return {
				success: false,
				error: data.message || "Unknown error from server",
			};
		} catch (error) {
			this.logger.error("Batch request error", {
				error: error instanceof Error ? error.message : String(error),
			});
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Network request failed",
			};
		}
	}

	setGlobalProperties(properties: GlobalProperties): void {
		this.globalProperties = { ...this.globalProperties, ...properties };
		this.logger.debug("Global properties updated", { properties });
	}

	getGlobalProperties(): GlobalProperties {
		return { ...this.globalProperties };
	}

	clearGlobalProperties(): void {
		this.globalProperties = {};
		this.logger.debug("Global properties cleared");
	}

	addMiddleware(middleware: Middleware): void {
		this.middleware.push(middleware);
		this.logger.debug("Middleware added", {
			totalMiddleware: this.middleware.length,
		});
	}

	clearMiddleware(): void {
		this.middleware = [];
		this.logger.debug("Middleware cleared");
	}

	getDeduplicationCacheSize(): number {
		return this.deduplicationCache.size;
	}

	clearDeduplicationCache(): void {
		this.deduplicationCache.clear();
		this.logger.debug("Deduplication cache cleared");
	}

	private async applyMiddleware(
		event: BatchEventInput
	): Promise<BatchEventInput | null> {
		let processedEvent: BatchEventInput | null = event;

		for (const middleware of this.middleware) {
			if (!processedEvent) {
				break;
			}
			try {
				processedEvent = await middleware(processedEvent);
			} catch (error) {
				this.logger.error("Middleware error", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return processedEvent;
	}

	private addToDeduplicationCache(eventId: string): void {
		if (this.deduplicationCache.size >= this.maxDeduplicationCacheSize) {
			const oldest = this.deduplicationCache.values().next().value;
			if (oldest) {
				this.deduplicationCache.delete(oldest);
			}
		}
		this.deduplicationCache.add(eventId);
	}
}

export { Databuddy as db };

// Export server-side flag functionality
export * from "./flags";
