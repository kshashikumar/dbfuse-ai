import { ChangeDetectorRef, SimpleChanges } from '@angular/core';
import { BackendService } from '@core/services/backend/backend.service';
import { DatabaseStats, DatabaseType, TableInfo } from '@core/utils/storage/storage.types';
import { getSafeSessionStorage } from '@core/utils/browser-adapter';

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

    protected constructor(
        protected readonly backend: BackendService,
        protected readonly cdr: ChangeDetectorRef,
    ) {}

    initExplorer(): void {
        if (this.databases && this.databases.length > 0) {
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
        if (this.databases && this.databases.length > 0) {
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
        this.loadCollectionInfo(this.selectedDatabase, name);
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
        this.availableDatabases = list;
        if (!this.selectedDatabase && list.length > 0) {
            this.selectDatabase(list[0].name);
        }
        this.cdr.markForCheck();
    }

    protected loadCollections(dbName: string): void {
        this.loadingCollections = true;
        this.backend.getTables(dbName).subscribe({
            next: (response) => {
                const list = Array.isArray(response?.tables) ? response.tables : [];
                this.collections = list;
                this.filteredCollections = [...list];
                this.loadingCollections = false;
                if (list.length > 0) {
                    this.selectCollection(list[0]);
                }
                this.actionMessage = '';
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
        this.cdr.markForCheck();
    }
}
