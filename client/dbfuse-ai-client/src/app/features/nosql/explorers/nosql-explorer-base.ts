import { ChangeDetectorRef, SimpleChanges, inject } from '@angular/core';
import { BackendService } from '@core/services/backend/backend.service';
import { DatabaseStats, DatabaseType, TableInfo } from '@core/utils/storage/storage.types';
import { getSafeSessionStorage } from '@core/utils/browser-adapter';
import { ConfirmationOptions, ConfirmationService } from '@shared/services/confirmation.service';

export abstract class NosqlExplorerBase {
    dbType: DatabaseType = 'mongodb';
    databases: DatabaseStats[] | null = null;

    availableDatabases: DatabaseStats[] = [];
    selectedDatabase = '';
    collections: string[] = [];
    filteredCollections: string[] = [];
    selectedCollection = '';
    collectionInfo: TableInfo | null = null;
    filterText = '';
    loadingDatabases = false;
    loadingCollections = false;
    loadingDetails = false;
    actionLoading = false;
    errorMessage = '';
    actionMessage = '';
    strategyMetadata: any | null = null;
    actionResult: any | null = null;
    showAllSampleDocuments = false;
    protected readonly sampleDocumentsLimit = 5;
    readonly virtualItemSize = 40;
    readonly trackByDatabase = (_index: number, db: { name?: string } | null): string | number => db?.name ?? _index;
    readonly trackByCollection = (_index: number, name: string | null): string | number => name ?? _index;
    protected readonly confirmation = inject(ConfirmationService);

    protected constructor(
        protected readonly backend: BackendService,
        protected readonly cdr: ChangeDetectorRef,
    ) {}

    initExplorer(): void {
        if (Array.isArray(this.databases) && this.databases.length > 0) {
            this.applyDatabases(this.databases);
        } else {
            this.refreshDatabases();
        }
        this.loadStrategyMetadata();
    }

    handleChanges(changes: SimpleChanges): void {
        if (changes['dbType'] && !changes['dbType'].firstChange) {
            this.resetState();
            this.loadStrategyMetadata();
        }
        if (Array.isArray(this.databases) && this.databases.length > 0) {
            this.applyDatabases(this.databases);
        } else if (changes['databases'] && !changes['databases'].firstChange) {
            this.refreshDatabases();
        }
    }

    get supportsCrud(): boolean {
        const caps = this.strategyMetadata?.capabilities;
        if (!Array.isArray(caps) || caps.length === 0) return true;
        return caps.includes('crud');
    }

    get supportsIndexes(): boolean {
        const features = this.strategyMetadata?.supportedFeatures;
        if (!Array.isArray(features) || features.length === 0) return true;
        return features.includes('indexes');
    }

    get supportsAggregation(): boolean {
        const caps = this.strategyMetadata?.capabilities;
        if (!Array.isArray(caps) || caps.length === 0) return true;
        return caps.includes('aggregation');
    }

    get supportsExplain(): boolean {
        const caps = this.strategyMetadata?.capabilities;
        if (!Array.isArray(caps) || caps.length === 0) return true;
        return caps.includes('explain');
    }

    get supportsCommands(): boolean {
        const caps = this.strategyMetadata?.capabilities;
        if (!Array.isArray(caps) || caps.length === 0) return true;
        return caps.includes('commands');
    }

    get supportsTtl(): boolean {
        const caps = this.strategyMetadata?.capabilities;
        if (!Array.isArray(caps) || caps.length === 0) return true;
        return caps.includes('ttl');
    }

    protected hasCapability(name: string): boolean {
        const caps = this.strategyMetadata?.capabilities;
        if (!Array.isArray(caps) || caps.length === 0) return true;
        return caps.map((cap) => String(cap).toLowerCase()).includes(name.toLowerCase());
    }

    protected hasFeature(name: string): boolean {
        const features = this.strategyMetadata?.supportedFeatures;
        if (!Array.isArray(features) || features.length === 0) return true;
        return features.map((feature) => String(feature).toLowerCase()).includes(name.toLowerCase());
    }

    refreshDatabases(): void {
        this.loadingDatabases = true;
        this.errorMessage = '';
        this.backend.getDatabases().subscribe({
            next: (response) => {
                const list = Array.isArray(response?.databases) ? response.databases : [];
                this.applyDatabases(list);
                this.loadingDatabases = false;
                this.cdr.markForCheck();
            },
            error: (error) => {
                this.loadingDatabases = false;
                this.errorMessage = error?.error || error?.message || 'Failed to load databases.';
                this.cdr.markForCheck();
            },
        });
    }

    selectDatabase(dbName: string): void {
        if (!dbName || this.selectedDatabase === dbName) return;
        this.selectedDatabase = dbName;
        this.persistSelectedDatabase(dbName);
        this.selectedCollection = '';
        this.collectionInfo = null;
        this.showAllSampleDocuments = false;
        this.collections = [];
        this.filteredCollections = [];
        this.loadCollections(dbName);
    }

    filterCollectionsList(): void {
        const text = this.filterText.toLowerCase();
        if (!text) {
            this.filteredCollections = [...this.collections];
            return;
        }
        this.filteredCollections = this.collections.filter((name) => name.toLowerCase().includes(text));
    }

    selectCollection(name: string): void {
        if (!name || this.selectedCollection === name) return;
        this.selectedCollection = name;
        this.collectionInfo = null;
        this.actionMessage = '';
        this.actionResult = null;
        this.showAllSampleDocuments = false;
        this.loadCollectionInfo(this.selectedDatabase, name);
    }

    get sampleDocuments(): any[] {
        const docs = this.collectionInfo?.sampleDocuments;
        return Array.isArray(docs) ? docs : [];
    }

    get limitedSampleDocuments(): any[] {
        if (this.showAllSampleDocuments) {
            return this.sampleDocuments;
        }
        return this.sampleDocuments.slice(0, this.sampleDocumentsLimit);
    }

    get hasMoreSampleDocuments(): boolean {
        return this.sampleDocuments.length > this.sampleDocumentsLimit;
    }

    toggleSampleDocuments(): void {
        this.showAllSampleDocuments = !this.showAllSampleDocuments;
        this.cdr.markForCheck();
    }

    protected parseJsonInput(value: string, label: string): any | null {
        if (!value || !value.trim()) {
            this.errorMessage = `${label} is required.`;
            return null;
        }
        try {
            return JSON.parse(value);
        } catch (error) {
            console.error('JSON parse error:', error);
            this.errorMessage = `${label} must be valid JSON.`;
            return null;
        }
    }

    protected parseOptionalJsonInput(value: string, label: string): any | undefined {
        if (!value || !value.trim()) return undefined;
        const parsed = this.parseJsonInput(value, label);
        return parsed === null ? undefined : parsed;
    }

    protected parseArgsInput(value: string): string[] {
        const raw = value ? value.trim() : '';
        if (!raw) return [];
        if (raw.startsWith('[')) {
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [String(parsed)];
            } catch {
                return raw.split(/\s+/).filter(Boolean);
            }
        }
        return raw.split(/\s+/).filter(Boolean);
    }

    protected async confirmDestructive(message: string, options: Partial<ConfirmationOptions> = {}): Promise<boolean> {
        return this.confirmation.confirm({
            message,
            title: options.title ?? 'Confirm action',
            confirmLabel: options.confirmLabel ?? 'Confirm',
            cancelLabel: options.cancelLabel ?? 'Cancel',
            confirmVariant: options.confirmVariant ?? 'danger',
        });
    }

    protected executeAction(payload: any): void {
        this.actionLoading = true;
        this.errorMessage = '';
        this.actionMessage = '';
        this.actionResult = null;
        this.backend.executeQuery(payload, this.selectedDatabase).subscribe({
            next: (result) => {
                this.actionLoading = false;
                this.actionResult = result;
                this.actionMessage = 'Action completed successfully.';
                if (this.selectedDatabase && this.selectedCollection) {
                    this.loadCollectionInfo(this.selectedDatabase, this.selectedCollection);
                }
                if (this.dbType === 'redis' && this.selectedDatabase) {
                    this.loadCollections(this.selectedDatabase, {
                        preserveSelection: true,
                        preserveMessage: true,
                    });
                }
                this.cdr.markForCheck();
            },
            error: (error) => {
                this.actionLoading = false;
                this.errorMessage = error?.error || error?.message || 'Action failed.';
                this.actionResult = null;
                this.cdr.markForCheck();
            },
        });
    }

    protected applyDatabases(list: DatabaseStats[]): void {
        this.availableDatabases = list.map((db) => {
            const extractedName = this.extractName((db as any)?.name ?? db);
            return {
                ...db,
                name: extractedName || String((db as any)?.name ?? ''),
            } as DatabaseStats;
        });
        const names = this.availableDatabases.map((db) => db.name);
        if (this.selectedDatabase && !names.includes(this.selectedDatabase)) {
            this.selectedDatabase = '';
        }
        if (!this.selectedDatabase && names.length > 0) {
            this.selectDatabase(names[0]);
        }
        this.cdr.markForCheck();
    }

    protected loadCollections(
        dbName: string,
        options: { preserveSelection?: boolean; preserveMessage?: boolean } = {},
    ): void {
        this.loadingCollections = true;
        this.backend.getCollections(dbName).subscribe({
            next: (response) => {
                const list = Array.isArray(response?.collections) ? response.collections : [];
                const normalized = list
                    .map((item) => {
                        const extracted = this.extractName(item);
                        if (extracted) return extracted;
                        try {
                            return JSON.stringify(item);
                        } catch {
                            return '';
                        }
                    })
                    .map((name) => String(name))
                    .filter((name) => name && name !== 'null' && name !== 'undefined' && name !== '[object Object]');
                this.collections = normalized;
                this.filteredCollections = [...normalized];
                this.loadingCollections = false;
                const shouldPreserve =
                    options.preserveSelection !== false &&
                    this.selectedCollection &&
                    normalized.includes(this.selectedCollection);

                if (shouldPreserve) {
                    this.loadCollectionInfo(this.selectedDatabase, this.selectedCollection);
                } else {
                    const safeFirst = normalized.find((name) => !name.startsWith('system.'));
                    const isSystemDb = ['admin', 'local', 'config'].includes(String(dbName || '').toLowerCase());
                    const defaultCollection = safeFirst || (isSystemDb ? '' : normalized[0]);
                    if (defaultCollection) {
                        this.selectCollection(defaultCollection);
                    }
                }

                if (!options.preserveMessage) {
                    this.actionMessage = '';
                }
                this.cdr.markForCheck();
            },
            error: (error) => {
                this.loadingCollections = false;
                this.errorMessage = error?.error || error?.message || 'Failed to load collections.';
                this.cdr.markForCheck();
            },
        });
    }

    protected loadCollectionInfo(dbName: string, collection: string): void {
        this.loadingDetails = true;
        this.backend.getTableInfo(dbName, collection).subscribe({
            next: (info) => {
                this.collectionInfo = info;
                this.loadingDetails = false;
                this.actionMessage = '';
                this.cdr.markForCheck();
            },
            error: (error) => {
                this.loadingDetails = false;
                this.errorMessage = error?.error || error?.message || 'Failed to load details.';
                this.cdr.markForCheck();
            },
        });
    }

    protected loadStrategyMetadata(): void {
        this.backend.getStrategyMetadata().subscribe({
            next: (resp) => {
                this.strategyMetadata = resp?.metadata || null;
                this.cdr.markForCheck();
            },
            error: () => {
                this.strategyMetadata = null;
                this.cdr.markForCheck();
            },
        });
    }

    protected extractName(value: any, depth = 0): string {
        if (!value && value !== 0) return '';
        if (typeof value === 'string') return value;
        if (typeof value === 'number') return String(value);
        if (typeof value !== 'object' || depth > 2) return '';
        const preferredKeys = [
            'name',
            'collection',
            'collectionName',
            'table',
            'table_name',
            'tableName',
            'db',
            'database',
            'databaseName',
            'id',
        ];
        for (const key of preferredKeys) {
            if (key in value) {
                const result = this.extractName((value as any)[key], depth + 1);
                if (result) return result;
            }
        }
        for (const key of Object.keys(value)) {
            const candidate = (value as any)[key];
            if (typeof candidate === 'string' && candidate.trim()) {
                return candidate;
            }
        }
        return '';
    }

    protected persistSelectedDatabase(dbName: string): void {
        try {
            const storage = getSafeSessionStorage();
            if (dbName) {
                storage.setItem('selectedDB', dbName);
                storage.setItem('selectedDBType', this.dbType);
            } else {
                storage.removeItem('selectedDB');
                storage.removeItem('selectedDBType');
            }
        } catch {}
    }

    protected resetState(): void {
        this.availableDatabases = [];
        this.selectedDatabase = '';
        this.collections = [];
        this.filteredCollections = [];
        this.selectedCollection = '';
        this.collectionInfo = null;
        this.filterText = '';
        this.errorMessage = '';
        this.actionMessage = '';
        this.actionResult = null;
        this.strategyMetadata = null;
        this.showAllSampleDocuments = false;
        this.cdr.markForCheck();
    }
}
