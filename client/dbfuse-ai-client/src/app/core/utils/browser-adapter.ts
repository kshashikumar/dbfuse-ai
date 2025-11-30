// A tiny SSR-safe browser adapter for window and Web Storage
// Provides safe fallbacks when running in non-browser environments

type StorageLike = Storage;

class MemoryStorage implements StorageLike {
    private store = new Map<string, string>();
    get length(): number {
        return this.store.size;
    }
    clear(): void {
        this.store.clear();
    }
    getItem(key: string): string | null {
        return this.store.has(key) ? (this.store.get(key) as string) : null;
    }
    key(index: number): string | null {
        const keys = Array.from(this.store.keys());
        return keys[index] ?? null;
    }
    removeItem(key: string): void {
        this.store.delete(key);
    }
    setItem(key: string, value: string): void {
        this.store.set(key, value);
    }
}

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

const memorySession = new MemoryStorage();
const memoryLocal = new MemoryStorage();

export function getSafeWindow(): (Window & typeof globalThis) | undefined {
    return isBrowser ? window : undefined;
}

export function getSafeDocument(): Document | undefined {
    return isBrowser ? document : undefined;
}

export function getSafeSessionStorage(): StorageLike {
    try {
        if (isBrowser && typeof window.sessionStorage !== 'undefined') {
            return window.sessionStorage;
        }
    } catch {
        // ignore and fall through to memory storage
    }
    return memorySession;
}

export function getSafeLocalStorage(): StorageLike {
    try {
        if (isBrowser && typeof window.localStorage !== 'undefined') {
            return window.localStorage;
        }
    } catch {
        // ignore and fall through to memory storage
    }
    return memoryLocal;
}
