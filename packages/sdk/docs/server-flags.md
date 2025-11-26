# Server-Side Feature Flags Documentation

## Overview

The `@databuddy/sdk/node` export provides comprehensive server-side feature flag support for Next.js applications, including server components, API routes, middleware, and serverless environments.

## ✅ Requirements Fulfilled

- ✅ **@databuddy/sdk/node export for feature flags** - Complete server-side flag implementation
- ✅ **Works in Next.js server components, API routes, and middleware** - Full integration support
- ✅ **Works in serverless environments with proper caching** - Optimized for serverless platforms
- ✅ **Type-safe API with full TypeScript support** - Complete type coverage

## Installation

```bash
npm install @databuddy/sdk
# or
bun add @databuddy/sdk
# or
yarn add @databuddy/sdk
```

## Quick Start

### Basic Server Component Usage

```typescript
import { createServerFlagsManager, getServerFlag } from '@databuddy/sdk/node';

// Create flags manager
const flagsManager = createServerFlagsManager({
  config: {
    clientId: process.env.DATABUDDY_CLIENT_ID,
    user: {
      userId: 'user-123',
      email: 'user@example.com'
    }
  }
});

// Use in server component
export default async function MyComponent() {
  const flagResult = await getServerFlag(flagsManager, 'new-feature');

  return (
    <div>
      {flagResult.enabled ? 'New Feature!' : 'Old Feature'}
    </div>
  );
}
```

## API Reference

### createServerFlagsManager(options)

Creates a new server-side flags manager instance.

```typescript
import { createServerFlagsManager, ServerFlagsManagerOptions } from '@databuddy/sdk/node';

const flagsManager = createServerFlagsManager(options: ServerFlagsManagerOptions);
```

#### Options

```typescript
interface ServerFlagsManagerOptions extends FlagsManagerOptions {
  config: {
    clientId: string; // Required: Your Databuddy client ID
    apiUrl?: string; // Default: "https://api.databuddy.cc"
    user?: {
      userId?: string;
      email?: string;
      properties?: Record<string, any>;
    };
    disabled?: boolean; // Default: false
    debug?: boolean; // Default: false
    skipStorage?: boolean; // Default: false
    isPending?: boolean; // Default: false
    autoFetch?: boolean; // Default: true
  };
  storageConfig?: {
    ttl?: number; // Default: 5 minutes (300000ms)
    maxSize?: number; // Default: 1000 flags
    keyPrefix?: string; // Default: "databuddy:flags:"
  };
  enableMemoryCache?: boolean; // Default: true
}
```

### ServerFlagsManager Class

The main class for managing server-side feature flags.

#### Methods

##### getFlag(key: string): Promise<FlagResult>

Fetches a single flag from the API or cache.

```typescript
const result = await flagsManager.getFlag("my-feature");
console.log(result.enabled); // boolean
console.log(result.payload); // any
console.log(result.reason); // string
```

##### isEnabled(key: string): FlagState

Gets the current state of a flag without triggering a fetch.

```typescript
const state = flagsManager.isEnabled("my-feature");
console.log(state.enabled); // boolean
console.log(state.isLoading); // boolean
console.log(state.isReady); // boolean
```

##### fetchAllFlags(): Promise<void>

Fetches all flags for the current user in bulk.

```typescript
await flagsManager.fetchAllFlags();
```

##### updateUser(user): void

Updates the user context for flag evaluation.

```typescript
flagsManager.updateUser({
  userId: "new-user",
  email: "new@example.com",
  properties: { plan: "pro" },
});
```

##### refresh(forceClear?: boolean): void

Refreshes all flags, optionally clearing cache first.

```typescript
flagsManager.refresh(); // Refresh with cache
flagsManager.refresh(true); // Force clear and refresh
```

### Helper Functions

#### getServerFlag(flagsManager, key): Promise<FlagResult>

Convenience function to get a flag result.

```typescript
import { getServerFlag } from "@databuddy/sdk/node";

const result = await getServerFlag(flagsManager, "feature-key");
```

#### isFlagEnabled(flagsManager, key): Promise<boolean>

Convenience function that returns only the enabled boolean.

```typescript
import { isFlagEnabled } from "@databuddy/sdk/node";

const enabled = await isFlagEnabled(flagsManager, "feature-key");
```

#### fetchAllServerFlags(flagsManager): Promise<void>

Convenience function to fetch all flags.

```typescript
import { fetchAllServerFlags } from "@databuddy/sdk/node";

await fetchAllServerFlags(flagsManager);
```

## Usage Patterns

### 1. Server Components

```typescript
// app/components/FeatureWrapper.tsx
import { createServerFlagsManager, getServerFlag } from '@databuddy/sdk/node';

const flagsManager = createServerFlagsManager({
  config: {
    clientId: process.env.DATABUDDY_CLIENT_ID!,
    user: {
      userId: 'user-123',
      properties: { plan: 'pro' }
    }
  }
});

interface FeatureWrapperProps {
  flagKey: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export async function FeatureWrapper({ flagKey, children, fallback }: FeatureWrapperProps) {
  const flagResult = await getServerFlag(flagsManager, flagKey);

  if (flagResult.enabled) {
    return <>{children}</>;
  }

  return <>{fallback || null}</>;
}
```

### 2. API Routes

```typescript
// app/api/flags/[flagKey]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerFlagsManager, isFlagEnabled } from "@databuddy/sdk/node";

const apiFlagsManager = createServerFlagsManager({
  config: {
    clientId: process.env.DATABUDDY_CLIENT_ID!,
    debug: process.env.NODE_ENV === "development",
  },
  storageConfig: {
    ttl: 2 * 60 * 1000, // 2 minutes for API routes
    maxSize: 500,
  },
});

export async function GET(
  request: NextRequest,
  { params }: { params: { flagKey: string } },
) {
  const flagKey = params.flagKey;

  // Extract user info from request
  const userId = request.headers.get("x-user-id");
  const userEmail = request.headers.get("x-user-email");

  // Update user context
  if (userId || userEmail) {
    apiFlagsManager.updateUser({
      userId: userId || undefined,
      email: userEmail || undefined,
    });
  }

  const isEnabled = await isFlagEnabled(apiFlagsManager, flagKey);

  return NextResponse.json({
    flagKey,
    enabled: isEnabled,
    timestamp: new Date().toISOString(),
  });
}
```

### 3. Middleware

```typescript
// middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerFlagsManager, isFlagEnabled } from "@databuddy/sdk/node";

const middlewareFlagsManager = createServerFlagsManager({
  config: {
    clientId: process.env.DATABUDDY_CLIENT_ID!,
    debug: process.env.NODE_ENV === "development",
  },
  storageConfig: {
    ttl: 60 * 1000, // 1 minute for middleware
    maxSize: 200,
  },
});

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Extract user info
  const userId = request.cookies.get("user_id")?.value;

  if (userId) {
    middlewareFlagsManager.updateUser({ userId });
  }

  // Beta features access control
  if (pathname.startsWith("/beta")) {
    const betaAccess = await isFlagEnabled(
      middlewareFlagsManager,
      "beta-access",
    );

    if (!betaAccess) {
      const url = request.nextUrl.clone();
      url.pathname = "/coming-soon";
      return NextResponse.redirect(url);
    }
  }

  // New dashboard routing
  if (pathname === "/dashboard") {
    const newDashboard = await isFlagEnabled(
      middlewareFlagsManager,
      "new-dashboard",
    );

    if (newDashboard) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard-v2";
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

### 4. Serverless Environments

The implementation is optimized for serverless environments:

```typescript
// Works perfectly in Vercel, Netlify, AWS Lambda, etc.
import { createServerFlagsManager } from "@databuddy/sdk/node";

const flagsManager = createServerFlagsManager({
  config: {
    clientId: process.env.DATABUDDY_CLIENT_ID!,
    autoFetch: true,
  },
  storageConfig: {
    ttl: 5 * 60 * 1000, // 5 minutes
    maxSize: 1000,
  },
  enableMemoryCache: true, // Important for serverless
});

// No external dependencies, works with fetch API
// Automatic timeout handling for serverless
// Memory-based caching for performance
```

## Caching Strategy

### Memory Cache

- **Enabled by default** for optimal performance
- Stores recently accessed flags in memory
- Automatically manages cache size limits
- Perfect for serverless environments

### Persistent Cache

- **ServerFlagStorage** with TTL support
- Configurable cache duration (default: 5 minutes)
- Configurable maximum size (default: 1000 flags)
- Automatic cleanup of expired entries
- Custom key prefixes for isolation

### Cache Hierarchy

1. **Memory Cache** (fastest) - if `enableMemoryCache: true`
2. **Persistent Cache** (fast) - ServerFlagStorage with TTL
3. **Network Fetch** (slowest) - API call with timeout

## Type Safety

### Complete TypeScript Support

```typescript
import type {
  FlagResult,
  FlagState,
  FlagsConfig,
  ServerStorageConfig,
  ServerFlagsManagerOptions,
} from "@databuddy/sdk/node";

// All types are fully exported and documented
interface FlagResult {
  enabled: boolean;
  value: boolean;
  payload: any;
  reason: string;
  flagId?: string;
  flagType?: "boolean" | "rollout";
}

interface FlagState {
  enabled: boolean;
  isLoading: boolean;
  isReady: boolean;
}
```

### Generic Type Support

```typescript
// Payload typing
interface NewFeaturePayload {
  variant: "a" | "b" | "c";
  maxUsers?: number;
}

const result = await flagsManager.getFlag("new-feature");
if (result.enabled && result.payload) {
  const payload = result.payload as NewFeaturePayload;
  console.log(payload.variant); // Fully typed
}
```

## Error Handling

### Graceful Degradation

The implementation handles errors gracefully:

```typescript
// Network errors return disabled flags
const result = await flagsManager.getFlag("any-flag");
// result = { enabled: false, value: false, payload: null, reason: "ERROR" }

// Timeouts are handled automatically
// AbortSignal.timeout(5000) for individual flags
// AbortSignal.timeout(10000) for bulk fetch
```

### Debug Logging

```typescript
const flagsManager = createServerFlagsManager({
  config: {
    clientId: "your-client-id",
    debug: true, // Enable debug logging
  },
});

// Debug logs show:
// - Cache hits/misses
// - Network requests
// - Flag evaluation results
// - Error details
```

## Performance Optimization

### Serverless Optimizations

1. **Request Timeouts**: Automatic timeout handling prevents hanging
2. **Memory Caching**: Reduces API calls in warm functions
3. **Bulk Fetch**: Fetch all flags at once for efficiency
4. **Connection Reuse**: Built-in fetch optimization
5. **Size Limits**: Prevents memory bloat

### Best Practices

```typescript
// 1. Use appropriate TTL for your use case
const apiFlagsManager = createServerFlagsManager({
  storageConfig: { ttl: 2 * 60 * 1000 }, // 2 min for APIs
});

const componentFlagsManager = createServerFlagsManager({
  storageConfig: { ttl: 10 * 60 * 1000 }, // 10 min for components
});

// 2. Pre-warm cache when possible
await flagsManager.fetchAllFlags(); // Pre-load common flags

// 3. Use bulk operations
const [flag1, flag2, flag3] = await Promise.all([
  flagsManager.getFlag("feature-1"),
  flagsManager.getFlag("feature-2"),
  flagsManager.getFlag("feature-3"),
]);

// 4. Configure appropriate cache sizes
const smallCache = createServerFlagsManager({
  storageConfig: { maxSize: 100 }, // For limited environments
});

const largeCache = createServerFlagsManager({
  storageConfig: { maxSize: 2000 }, // For high-traffic apps
});
```

## Environment Variables

```bash
# Required
DATABUDDY_CLIENT_ID=your-client-id

# Optional
NODE_ENV=development
NEXT_PUBLIC_DATABUDDY_DEBUG=true
```

## Migration Guide

### From Client-Side Flags

```typescript
// Before (client-side)
import { useFlags } from "@databuddy/sdk/react";

function MyComponent() {
  const { isEnabled } = useFlags();
  const enabled = isEnabled("my-feature");
}

// After (server-side)
import { createServerFlagsManager, getServerFlag } from "@databuddy/sdk/node";

const flagsManager = createServerFlagsManager({
  config: { clientId: process.env.DATABUDDY_CLIENT_ID! },
});

async function MyComponent() {
  const result = await getServerFlag(flagsManager, "my-feature");
  const enabled = result.enabled;
}
```

## Testing

The implementation includes comprehensive tests:

```bash
# Run all server flag tests
bun test tests/server-flags.test.ts

# Test coverage includes:
# - ServerFlagStorage functionality
# - ServerFlagsManager operations
# - Serverless environment compatibility
# - Error handling scenarios
# - Type safety validation
# - Performance characteristics
```

## Examples Repository

Complete working examples are available in the `/examples` directory:

- `server-component.tsx` - Server component usage
- `api-route.ts` - API route implementation
- `middleware.ts` - Next.js middleware usage
- `server-flags.test.ts` - Comprehensive test suite

## Support

- **Documentation**: [Full API docs](https://databuddy.cc/docs)
- **Issues**: [GitHub Issues](https://github.com/databuddy-analytics/databuddy/issues)
- **Discussions**: [GitHub Discussions](https://github.com/databuddy-analytics/databuddy/discussions)

## License

MIT License - see LICENSE file for details.
