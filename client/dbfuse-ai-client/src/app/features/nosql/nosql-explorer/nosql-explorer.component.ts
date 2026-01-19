import { CommonModule } from '@angular/common';
import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    Input,
    OnChanges,
    OnInit,
    SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackendService } from '@core/services/backend/backend.service';
import { DatabaseStats, DatabaseType, TableInfo } from '@core/utils/storage/storage.types';
import { getSafeSessionStorage } from '@core/utils/browser-adapter';

@Component({
    selector: 'app-nosql-explorer',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './nosql-explorer.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NosqlExplorerComponent implements OnInit, OnChanges {
    @Input() dbType: DatabaseType = 'mongodb';
    @Input() databases: DatabaseStats[] | null = null;

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
    readOnlyMode = false;
    strategyMetadata: any | null = null;
    actionResult: any | null = null;

    mongoInsertPayload = '';
    mongoUpdateFilter = '';
    mongoUpdatePayload = '';
    mongoUpdateMode: 'updateOne' | 'updateMany' = 'updateOne';
    mongoDeleteFilter = '';
    mongoDeleteMode: 'deleteOne' | 'deleteMany' = 'deleteOne';
    mongoIndexKeys = '';
    mongoIndexOptions = '';
    mongoDropIndexName = '';
    mongoAggregatePipeline = '';
    mongoExplainPayload = '';

    redisKey = '';
    redisValue = '';
    redisTtl = '';
    redisDeleteKey = '';
    redisCommand = '';
    redisCommandArgs = '';
    redisExpirePattern = '';
    redisExpireTtl = '';
    redisExpireLimit = '';

    private readonly documentDbTypes = new Set<DatabaseType>(['mongodb', 'couchdb', 'cosmosdb', 'firestore']);
    private readonly keyValueDbTypes = new Set<DatabaseType>(['redis', 'memcached']);
    private readonly tableDbTypes = new Set<DatabaseType>(['dynamodb', 'cassandra', 'hbase']);

    constructor(
        private readonly backend: BackendService,
        private readonly cdr: ChangeDetectorRef,
    ) {}

    ngOnInit(): void {
        if (this.databases && this.databases.length > 0) {
            this.applyDatabases(this.databases);
        } else {
            this.refreshDatabases();
        }
        this.loadStrategyMetadata();
    }

    ngOnChanges(changes: SimpleChanges): void {
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

    get explorerTitle(): string {
        const labels: Record<string, string> = {
            mongodb: 'MongoDB',
            redis: 'Redis',
            couchdb: 'CouchDB',
            cosmosdb: 'Azure Cosmos DB',
            firestore: 'Firestore',
            dynamodb: 'DynamoDB',
            cassandra: 'Cassandra',
            hbase: 'HBase',
            memcached: 'Memcached',
        };
        const base = labels[this.dbType] || 'NoSQL';
        return `${base} Explorer`;
    }

    get databaseLabel(): string {
        if (this.dbType === 'firestore') return 'Projects';
        if (this.dbType === 'dynamodb') return 'Regions';
        if (this.dbType === 'hbase') return 'Namespaces';
        if (this.dbType === 'cassandra' || this.keyValueDbTypes.has(this.dbType)) return 'Keyspaces';
        return 'Databases';
    }

    get collectionLabel(): string {
        if (this.keyValueDbTypes.has(this.dbType)) return 'Key groups';
        if (this.tableDbTypes.has(this.dbType)) return 'Tables';
        if (this.documentDbTypes.has(this.dbType)) return 'Collections';
        return 'Collections';
    }

    get detailLabel(): string {
        if (this.keyValueDbTypes.has(this.dbType)) return 'Keys';
        if (this.tableDbTypes.has(this.dbType)) {
            return this.dbType === 'dynamodb' ? 'Items' : 'Rows';
        }
        if (this.documentDbTypes.has(this.dbType)) return 'Documents';
        return 'Documents';
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

    get mongoIndexes(): { name: string; type?: string; unique?: boolean }[] {
        if (this.dbType !== 'mongodb' || !this.collectionInfo?.indexes) return [];
        return this.collectionInfo.indexes.map((idx: any) => ({
            name: idx.index_name || idx.name || 'index',
            type: idx.type || idx.index_type,
            unique: idx.is_unique ?? idx.unique,
        }));
    }

    get redisKeyTypeStats(): { type: string; count: number }[] {
        if (this.dbType !== 'redis' || !this.collectionInfo?.sampleKeys) return [];
        const counts: Record<string, number> = {};
        for (const key of this.collectionInfo.sampleKeys) {
            const type = (key.type || 'unknown').toString();
            counts[type] = (counts[type] || 0) + 1;
        }
        return Object.entries(counts)
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count);
    }

    get redisKeyPrefixStats(): { prefix: string; count: number }[] {
        if (this.dbType !== 'redis' || !this.collectionInfo?.sampleKeys) return [];
        const counts: Record<string, number> = {};
        for (const entry of this.collectionInfo.sampleKeys) {
            const key = String(entry.key || '');
            if (!key) continue;
            const prefix = key.includes(':') ? key.split(':')[0] : 'other';
            counts[prefix] = (counts[prefix] || 0) + 1;
        }
        return Object.entries(counts)
            .map(([prefix, count]) => ({ prefix, count }))
            .sort((a, b) => b.count - a.count);
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

    private applyDatabases(list: DatabaseStats[]): void {
        this.availableDatabases = list;
        if (!this.selectedDatabase && list.length > 0) {
            this.selectDatabase(list[0].name);
        }
        this.cdr.markForCheck();
    }

    private loadCollections(dbName: string): void {
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

    private loadCollectionInfo(dbName: string, collection: string): void {
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

    private persistSelectedDatabase(dbName: string): void {
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

    private loadStrategyMetadata(): void {
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

    runMongoInsert(): void {
        if (!this.ensureWritable()) return;
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection to insert into.';
            return;
        }
        const payload = this.parseJsonInput(this.mongoInsertPayload, 'Insert payload');
        if (!payload) return;

        const operation = Array.isArray(payload) ? 'insertMany' : 'insertOne';
        this.executeAction({
            operation,
            collection: this.selectedCollection,
            ...(Array.isArray(payload) ? { documents: payload } : { document: payload }),
        });
    }

    runMongoUpdate(): void {
        if (!this.ensureWritable()) return;
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection to update.';
            return;
        }
        const filter = this.parseJsonInput(this.mongoUpdateFilter, 'Update filter');
        const update = this.parseJsonInput(this.mongoUpdatePayload, 'Update document');
        if (!filter || !update) return;

        this.executeAction({
            operation: this.mongoUpdateMode,
            collection: this.selectedCollection,
            filter,
            update,
        });
    }

    runMongoDelete(): void {
        if (!this.ensureWritable()) return;
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection to delete from.';
            return;
        }
        const filter = this.parseJsonInput(this.mongoDeleteFilter, 'Delete filter');
        if (!filter) return;

        if (!window.confirm('Delete matching documents? This cannot be undone.')) {
            return;
        }

        this.executeAction({
            operation: this.mongoDeleteMode,
            collection: this.selectedCollection,
            filter,
        });
    }

    runMongoAggregate(): void {
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection to run aggregation.';
            return;
        }
        const pipeline = this.parseJsonInput(this.mongoAggregatePipeline, 'Aggregation pipeline');
        if (!pipeline) return;
        if (!Array.isArray(pipeline)) {
            this.errorMessage = 'Aggregation pipeline must be a JSON array.';
            return;
        }
        this.executeAction({
            operation: 'aggregate',
            collection: this.selectedCollection,
            pipeline,
        });
    }

    runMongoExplain(): void {
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection to run explain.';
            return;
        }
        const explain = this.parseJsonInput(this.mongoExplainPayload, 'Explain payload');
        if (!explain) return;

        this.executeAction({
            operation: 'explain',
            collection: this.selectedCollection,
            explain,
        });
    }

    runMongoCreateIndex(): void {
        if (!this.ensureWritable()) return;
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection to manage indexes.';
            return;
        }
        const keys = this.parseJsonInput(this.mongoIndexKeys, 'Index keys');
        if (!keys) return;
        const options = this.mongoIndexOptions?.trim()
            ? this.parseJsonInput(this.mongoIndexOptions, 'Index options')
            : null;
        if (this.mongoIndexOptions?.trim() && !options) return;

        this.executeAction({
            operation: 'createIndex',
            collection: this.selectedCollection,
            indexKeys: keys,
            ...(options ? { indexOptions: options } : {}),
        });
    }

    runMongoDropIndex(): void {
        if (!this.ensureWritable()) return;
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection to manage indexes.';
            return;
        }
        if (!this.mongoDropIndexName) {
            this.errorMessage = 'Index name is required.';
            return;
        }
        if (!window.confirm(`Drop index ${this.mongoDropIndexName}?`)) {
            return;
        }

        this.executeAction({
            operation: 'dropIndex',
            collection: this.selectedCollection,
            indexName: this.mongoDropIndexName,
        });
    }

    runRedisSet(): void {
        if (!this.ensureWritable()) return;
        if (!this.redisKey) {
            this.errorMessage = 'Redis key is required.';
            return;
        }
        const ttlValue = this.redisTtl ? Number(this.redisTtl) : undefined;

        this.executeAction({
            operation: 'set',
            key: this.redisKey,
            value: this.redisValue ?? '',
            ...(Number.isFinite(ttlValue) ? { ttl: ttlValue } : {}),
        });
    }

    runRedisDelete(): void {
        if (!this.ensureWritable()) return;
        if (!this.redisDeleteKey) {
            this.errorMessage = 'Redis key is required.';
            return;
        }

        if (!window.confirm(`Delete key ${this.redisDeleteKey}?`)) {
            return;
        }

        this.executeAction({
            operation: 'del',
            keys: [this.redisDeleteKey],
        });
    }

    runRedisCommand(): void {
        if (!this.ensureWritable()) return;
        if (!this.redisCommand) {
            this.errorMessage = 'Redis command is required.';
            return;
        }
        const args = this.parseArgsInput(this.redisCommandArgs);

        this.executeAction({
            operation: 'command',
            command: this.redisCommand,
            args,
        });
    }

    runRedisExpireMany(): void {
        if (!this.ensureWritable()) return;
        if (!this.redisExpirePattern) {
            this.errorMessage = 'Pattern is required for TTL update.';
            return;
        }
        const ttl = Number(this.redisExpireTtl);
        if (!Number.isFinite(ttl) || ttl <= 0) {
            this.errorMessage = 'TTL must be a positive number.';
            return;
        }
        const limit = this.redisExpireLimit ? Number(this.redisExpireLimit) : undefined;

        this.executeAction({
            operation: 'expireMany',
            pattern: this.redisExpirePattern,
            ttl,
            ...(Number.isFinite(limit) ? { limit } : {}),
        });
    }

    private ensureWritable(): boolean {
        if (this.readOnlyMode) {
            this.errorMessage = 'Read-only mode is enabled. Disable it to perform writes.';
            return false;
        }
        return true;
    }

    private parseJsonInput(value: string, label: string): any | null {
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

    private parseArgsInput(value: string): string[] {
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

    private executeAction(payload: any): void {
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

    private resetState(): void {
        this.availableDatabases = [];
        this.selectedDatabase = '';
        this.collections = [];
        this.filteredCollections = [];
        this.selectedCollection = '';
        this.collectionInfo = null;
        this.filterText = '';
        this.errorMessage = '';
        this.actionMessage = '';
        this.mongoIndexKeys = '';
        this.mongoIndexOptions = '';
        this.mongoDropIndexName = '';
        this.mongoAggregatePipeline = '';
        this.mongoExplainPayload = '';
        this.actionResult = null;
        this.strategyMetadata = null;
        this.redisCommand = '';
        this.redisCommandArgs = '';
        this.redisExpirePattern = '';
        this.redisExpireTtl = '';
        this.redisExpireLimit = '';
        this.cdr.markForCheck();
    }
}
