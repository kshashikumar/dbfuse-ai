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
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { VirtualListComponent } from '@shared/components/virtual-list/virtual-list.component';
import { BackendService } from '@core/services/backend/backend.service';
import { DatabaseStats, DatabaseType } from '@core/utils/storage/storage.types';
import { NosqlExplorerBase } from '../nosql-explorer-base';

@Component({
    selector: 'app-mongodb-explorer',
    standalone: true,
    imports: [CommonModule, FormsModule, VirtualListComponent],
    templateUrl: './mongodb-explorer.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MongodbExplorerComponent extends NosqlExplorerBase implements OnInit, OnChanges {
    @Input() override dbType: DatabaseType = 'mongodb';
    @Input() override databases: DatabaseStats[] | null = null;

    readonly mongoTabs: { id: MongoTabId; label: string }[] = [
        { id: 'documents', label: 'Documents' },
        { id: 'aggregations', label: 'Aggregations' },
        { id: 'schema', label: 'Schema' },
        { id: 'indexes', label: 'Indexes' },
        { id: 'validation', label: 'Validation' },
    ];
    activeTab: MongoTabId = 'documents';
    readonly pageSizeOptions = [10, 25, 50, 100];
    readonly mongoDocItemSize = 220;
    viewMode: 'list' | 'json' | 'table' = 'list';
    showQueryOptions = false;
    showInsertPanel = false;
    showUpdatePanel = false;
    showDeletePanel = false;
    showExportMenu = false;
    showAdvancedActions = false;
    expandedDatabaseName = '';
    showAddDatabase = false;
    showAddCollection = false;
    newDatabaseName = '';
    newDatabaseCollectionName = '';
    newCollectionName = '';
    mongoFindPage = 1;
    mongoFindPageSize = 25;

    mongoInsertPayload = '';
    mongoFindFilter = '';
    mongoFindProjection = '';
    mongoFindSort = '';
    mongoFindCollation = '';
    mongoFindLimit = '25';
    mongoFindSkip = '0';
    mongoFindResults: any[] | null = null;
    mongoFindTotal: number | null = null;
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
    mongoFindOneFilter = '';
    mongoFindOneUpdate = '';
    mongoFindOneOptions = '';
    mongoFindOneDeleteFilter = '';
    mongoBulkWrite = '';
    mongoCreateCollectionName = '';
    mongoRenameTo = '';
    readonly trackByTreeItem = (_index: number, item: MongoTreeItem): string => `${item.type}:${item.name}`;

    constructor(
        backend: BackendService,
        cdr: ChangeDetectorRef,
        private readonly sanitizer: DomSanitizer,
    ) {
        super(backend, cdr);
    }

    ngOnInit(): void {
        this.initExplorer();
        this.syncFindPaging();
    }

    ngOnChanges(changes: SimpleChanges): void {
        this.handleChanges(changes);
    }

    get mongoResultDocs(): any[] {
        if (this.mongoFindResults !== null) {
            return this.mongoFindResults;
        }
        return this.limitedSampleDocuments;
    }

    get mongoTableColumns(): string[] {
        const docs = this.mongoResultDocs;
        if (!docs.length) return [];
        const columns = new Set<string>();
        docs.forEach((doc) => {
            if (doc && typeof doc === 'object') {
                Object.keys(doc).forEach((key) => columns.add(key));
            }
        });
        return Array.from(columns);
    }

    get mongoTreeItems(): MongoTreeItem[] {
        const items: MongoTreeItem[] = [];
        for (const db of this.availableDatabases) {
            const count =
                db?.tables?.length || (this.expandedDatabaseName === db.name ? this.filteredCollections.length : 0);
            const expanded = this.expandedDatabaseName === db.name;
            items.push({ type: 'db', name: db.name, count, expanded });
            if (expanded) {
                if (this.loadingCollections) {
                    items.push({ type: 'loading', name: 'Loading collections...' });
                } else if (!this.filteredCollections.length) {
                    items.push({ type: 'empty', name: 'No collections found.' });
                } else {
                    for (const name of this.filteredCollections) {
                        items.push({ type: 'collection', name });
                    }
                }
            }
        }
        return items;
    }

    formatJson(value: any): SafeHtml {
        const json = JSON.stringify(value, null, 2) ?? '';
        const escaped = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const highlighted = escaped.replace(
            /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g,
            (match) => {
                let cls = 'text-sky-600';
                if (/^\"/.test(match)) {
                    cls = /:$/.test(match) ? 'text-amber-700' : 'text-emerald-700';
                } else if (/true|false/.test(match)) {
                    cls = 'text-fuchsia-600';
                } else if (/null/.test(match)) {
                    cls = 'text-gray-500';
                }
                return `<span class="${cls}">${match}</span>`;
            },
        );
        return this.sanitizer.bypassSecurityTrustHtml(highlighted);
    }

    get mongoCanPrev(): boolean {
        return this.mongoFindPage > 1;
    }

    get mongoTotalPages(): number | null {
        if (typeof this.mongoFindTotal !== 'number' || this.mongoFindPageSize <= 0) return null;
        return Math.max(1, Math.ceil(this.mongoFindTotal / this.mongoFindPageSize));
    }

    get mongoCanNext(): boolean {
        if (this.mongoTotalPages !== null) {
            return this.mongoFindPage < this.mongoTotalPages;
        }
        return (this.mongoFindResults?.length || 0) >= this.mongoFindPageSize;
    }

    get mongoRangeLabel(): string {
        if (this.mongoFindResults === null) return 'Showing sample documents';
        const total = this.mongoFindTotal ?? this.mongoFindResults.length;
        const start = (this.mongoFindPage - 1) * this.mongoFindPageSize + 1;
        const end = start + this.mongoFindResults.length - 1;
        return `${start}-${Math.max(start, end)} of ${total}`;
    }

    get mongoIndexes(): { name: string; type?: string; unique?: boolean }[] {
        if (!this.collectionInfo?.indexes) return [];
        return this.collectionInfo.indexes.map((idx: any) => ({
            name: idx.index_name || idx.name || 'index',
            type: idx.type || idx.index_type,
            unique: idx.is_unique ?? idx.unique,
        }));
    }

    setActiveTab(tab: MongoTabId): void {
        this.activeTab = tab;
    }

    override selectCollection(name: string): void {
        this.mongoFindResults = null;
        this.mongoFindTotal = null;
        this.mongoFindPage = 1;
        super.selectCollection(name);
        if (this.selectedCollection) {
            this.runMongoFind();
        }
    }

    override selectDatabase(dbName: string): void {
        this.expandedDatabaseName = dbName;
        super.selectDatabase(dbName);
    }

    toggleDatabaseNode(dbName: string): void {
        if (this.expandedDatabaseName === dbName) {
            this.expandedDatabaseName = '';
            return;
        }
        this.selectDatabase(dbName);
    }

    toggleAddDatabase(): void {
        this.showAddDatabase = !this.showAddDatabase;
        if (this.showAddDatabase) {
            this.showAddCollection = false;
        }
    }

    toggleAddCollection(): void {
        this.showAddCollection = !this.showAddCollection;
        if (this.showAddCollection) {
            this.showAddDatabase = false;
        }
    }

    createDatabase(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Database creation is not supported for this connection.';
            return;
        }
        if (!this.newDatabaseName) {
            this.errorMessage = 'Database name is required.';
            return;
        }
        if (!this.newDatabaseCollectionName) {
            this.errorMessage = 'Provide an initial collection name.';
            return;
        }
        this.actionLoading = true;
        this.errorMessage = '';
        const payload = {
            operation: 'createCollection',
            collection: this.newDatabaseCollectionName,
        };
        this.backend.executeQuery(payload, this.newDatabaseName).subscribe({
            next: () => {
                this.actionLoading = false;
                this.showAddDatabase = false;
                const dbName = this.newDatabaseName;
                this.newDatabaseName = '';
                this.newDatabaseCollectionName = '';
                this.refreshDatabases();
                this.selectDatabase(dbName);
                this.cdr.markForCheck();
            },
            error: (error) => {
                this.actionLoading = false;
                this.errorMessage = error?.error || error?.message || 'Failed to create database.';
                this.cdr.markForCheck();
            },
        });
    }

    createCollectionFromSidebar(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Collection creation is not supported for this connection.';
            return;
        }
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a database to add a collection.';
            return;
        }
        if (!this.newCollectionName) {
            this.errorMessage = 'Collection name is required.';
            return;
        }
        this.actionLoading = true;
        this.errorMessage = '';
        const payload = {
            operation: 'createCollection',
            collection: this.newCollectionName,
        };
        this.backend.executeQuery(payload, this.selectedDatabase).subscribe({
            next: () => {
                this.actionLoading = false;
                this.showAddCollection = false;
                this.newCollectionName = '';
                this.loadCollections(this.selectedDatabase);
                this.cdr.markForCheck();
            },
            error: (error) => {
                this.actionLoading = false;
                this.errorMessage = error?.error || error?.message || 'Failed to create collection.';
                this.cdr.markForCheck();
            },
        });
    }

    toggleQueryOptions(): void {
        this.showQueryOptions = !this.showQueryOptions;
    }

    toggleInsertPanel(): void {
        this.showInsertPanel = !this.showInsertPanel;
    }

    toggleUpdatePanel(): void {
        this.showUpdatePanel = !this.showUpdatePanel;
        if (this.showUpdatePanel) {
            this.showDeletePanel = false;
        }
    }

    toggleDeletePanel(): void {
        this.showDeletePanel = !this.showDeletePanel;
        if (this.showDeletePanel) {
            this.showUpdatePanel = false;
        }
    }

    toggleExportMenu(): void {
        this.showExportMenu = !this.showExportMenu;
    }

    setViewMode(mode: 'list' | 'json' | 'table'): void {
        this.viewMode = mode;
    }

    setPageSize(size: number): void {
        this.mongoFindPageSize = size;
        this.mongoFindPage = 1;
        this.syncFindPaging();
        if (this.mongoFindResults !== null) {
            this.runMongoFind();
        }
    }

    goToPrevPage(): void {
        if (!this.mongoCanPrev) return;
        this.mongoFindPage -= 1;
        this.syncFindPaging();
        this.runMongoFind();
    }

    goToNextPage(): void {
        if (!this.mongoCanNext) return;
        this.mongoFindPage += 1;
        this.syncFindPaging();
        this.runMongoFind();
    }

    syncFindPaging(): void {
        this.mongoFindLimit = String(this.mongoFindPageSize);
        this.mongoFindSkip = String((this.mongoFindPage - 1) * this.mongoFindPageSize);
    }

    private buildFindPayload(): { filter: any; projection?: any; sort?: any; options?: any } | null {
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection to run a query.';
            return null;
        }
        const filter = this.mongoFindFilter.trim() ? this.parseJsonInput(this.mongoFindFilter, 'Filter') : {};
        if (this.mongoFindFilter.trim() && !filter) return null;

        const projection = this.mongoFindProjection.trim()
            ? this.parseJsonInput(this.mongoFindProjection, 'Projection')
            : undefined;
        if (this.mongoFindProjection.trim() && !projection) return null;

        const sort = this.mongoFindSort.trim() ? this.parseJsonInput(this.mongoFindSort, 'Sort') : undefined;
        if (this.mongoFindSort.trim() && !sort) return null;

        const collation = this.mongoFindCollation.trim()
            ? this.parseJsonInput(this.mongoFindCollation, 'Collation')
            : undefined;
        if (this.mongoFindCollation.trim() && !collation) return null;

        const options: Record<string, number> = {};
        const limitValue = Number(this.mongoFindLimit);
        if (Number.isFinite(limitValue) && limitValue > 0) {
            options.limit = limitValue;
            this.mongoFindPageSize = limitValue;
        }
        const skipValue = Number(this.mongoFindSkip);
        if (Number.isFinite(skipValue) && skipValue >= 0) {
            options.skip = skipValue;
            if (limitValue > 0) {
                this.mongoFindPage = Math.floor(skipValue / limitValue) + 1;
            }
        }
        if (collation) {
            (options as any).collation = collation;
        }

        return { filter, projection, sort, options: Object.keys(options).length ? options : undefined };
    }

    runMongoFind(): void {
        const parsed = this.buildFindPayload();
        if (!parsed) return;

        this.actionLoading = true;
        this.errorMessage = '';
        this.actionMessage = '';
        this.actionResult = null;

        const payload: any = {
            operation: 'find',
            collection: this.selectedCollection,
            filter: parsed.filter,
        };
        if (parsed.projection) payload.projection = parsed.projection;
        if (parsed.sort) payload.sort = parsed.sort;
        if (parsed.options) payload.options = parsed.options;

        const pageSize = parsed.options?.limit || this.mongoFindPageSize || 20;

        this.backend.executeQuery(payload, this.selectedDatabase, { page: 1, pageSize }).subscribe({
            next: (result: any) => {
                this.actionLoading = false;
                this.actionResult = result;
                const docs = Array.isArray(result?.documents)
                    ? result.documents
                    : Array.isArray(result?.rows)
                      ? result.rows
                      : [];
                this.mongoFindResults = docs;
                this.mongoFindTotal = typeof result?.totalRows === 'number' ? result.totalRows : docs.length;
                this.actionMessage = 'Query completed successfully.';
                this.cdr.markForCheck();
            },
            error: (error) => {
                this.actionLoading = false;
                this.errorMessage = error?.error || error?.message || 'Query failed.';
                this.mongoFindResults = null;
                this.mongoFindTotal = null;
                this.cdr.markForCheck();
            },
        });
    }

    runMongoFindExplain(): void {
        const parsed = this.buildFindPayload();
        if (!parsed) return;

        this.executeAction({
            operation: 'explain',
            collection: this.selectedCollection,
            explain: {
                operation: 'find',
                filter: parsed.filter,
                projection: parsed.projection,
                sort: parsed.sort,
                options: parsed.options,
            },
        });
    }

    clearMongoFind(): void {
        this.mongoFindFilter = '';
        this.mongoFindProjection = '';
        this.mongoFindSort = '';
        this.mongoFindCollation = '';
        this.mongoFindLimit = String(this.mongoFindPageSize);
        this.mongoFindSkip = '0';
        this.mongoFindPage = 1;
        this.mongoFindResults = null;
        this.mongoFindTotal = null;
        this.actionResult = null;
        this.actionMessage = '';
        this.cdr.markForCheck();
    }

    runMongoInsert(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Insert is not supported for this database.';
            return;
        }
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

    exportMongoResults(format: 'json' | 'csv'): void {
        const docs = this.mongoFindResults ?? this.sampleDocuments;
        if (!docs || docs.length === 0) {
            this.errorMessage = 'No documents to export.';
            return;
        }
        if (format === 'json') {
            const data = JSON.stringify(docs, null, 2);
            this.downloadBlob(data, 'application/json', 'json');
            this.showExportMenu = false;
            return;
        }
        const columns = this.mongoTableColumns;
        const rows = docs.map((doc) =>
            columns
                .map((key) => {
                    const value = doc?.[key];
                    const serialized =
                        value === null || value === undefined
                            ? ''
                            : typeof value === 'object'
                              ? JSON.stringify(value)
                              : String(value);
                    const escaped = serialized.replace(/\"/g, '\"\"');
                    return `"${escaped}"`;
                })
                .join(','),
        );
        const csv = [columns.join(','), ...rows].join('\n');
        this.downloadBlob(csv, 'text/csv', 'csv');
        this.showExportMenu = false;
    }

    private downloadBlob(data: string, mime: string, ext: string): void {
        const blob = new Blob([data], { type: mime });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const name = this.selectedCollection || 'mongo-data';
        anchor.href = url;
        anchor.download = `${name}.${ext}`;
        anchor.click();
        URL.revokeObjectURL(url);
    }

    runMongoUpdate(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Update is not supported for this database.';
            return;
        }
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

    runMongoFindOneAndUpdate(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Update is not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection to update.';
            return;
        }
        const filter = this.parseJsonInput(this.mongoFindOneFilter, 'Find filter');
        const update = this.parseJsonInput(this.mongoFindOneUpdate, 'Update document');
        if (!filter || !update) return;
        const options = this.parseOptionalJsonInput(this.mongoFindOneOptions, 'Options');
        if (this.mongoFindOneOptions && options === undefined && this.errorMessage) return;

        this.executeAction({
            operation: 'findOneAndUpdate',
            collection: this.selectedCollection,
            filter,
            update,
            ...(options ? { options } : {}),
        });
    }

    async runMongoFindOneAndDelete(): Promise<void> {
        if (!this.supportsCrud) {
            this.errorMessage = 'Delete is not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection to delete from.';
            return;
        }
        const filter = this.parseJsonInput(this.mongoFindOneDeleteFilter, 'Find filter');
        if (!filter) return;
        const confirmed = await this.confirmDestructive(`Delete one document from ${this.selectedCollection}?`, {
            title: 'Confirm delete',
            confirmLabel: 'Delete',
        });
        if (!confirmed) {
            return;
        }

        this.executeAction({
            operation: 'findOneAndDelete',
            collection: this.selectedCollection,
            filter,
        });
    }

    async runMongoDelete(): Promise<void> {
        if (!this.supportsCrud) {
            this.errorMessage = 'Delete is not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection to delete from.';
            return;
        }
        const filter = this.parseJsonInput(this.mongoDeleteFilter, 'Delete filter');
        if (!filter) return;

        const confirmed = await this.confirmDestructive(
            `Delete matching documents in ${this.selectedCollection}? This cannot be undone.`,
            {
                title: 'Confirm delete',
                confirmLabel: 'Delete',
            },
        );
        if (!confirmed) {
            return;
        }

        this.executeAction({
            operation: this.mongoDeleteMode,
            collection: this.selectedCollection,
            filter,
        });
    }

    async runMongoBulkWrite(): Promise<void> {
        if (!this.supportsCrud) {
            this.errorMessage = 'Bulk write is not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection to bulk write.';
            return;
        }
        const operations = this.parseJsonInput(this.mongoBulkWrite, 'Bulk operations');
        if (!operations) return;
        if (!Array.isArray(operations)) {
            this.errorMessage = 'Bulk operations must be a JSON array.';
            return;
        }
        const confirmed = await this.confirmDestructive('Run bulk write? This may modify multiple documents.', {
            title: 'Confirm bulk write',
            confirmLabel: 'Run',
        });
        if (!confirmed) {
            return;
        }

        this.executeAction({
            operation: 'bulkWrite',
            collection: this.selectedCollection,
            operations,
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
        if (!this.supportsCrud) {
            this.errorMessage = 'Index write operations are not supported for this database.';
            return;
        }
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

    async runMongoDropIndex(): Promise<void> {
        if (!this.supportsCrud) {
            this.errorMessage = 'Index write operations are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection to manage indexes.';
            return;
        }
        if (!this.mongoDropIndexName) {
            this.errorMessage = 'Index name is required.';
            return;
        }
        const confirmed = await this.confirmDestructive(`Drop index "${this.mongoDropIndexName}"?`, {
            title: 'Confirm delete',
            confirmLabel: 'Delete',
        });
        if (!confirmed) {
            return;
        }

        this.executeAction({
            operation: 'dropIndex',
            collection: this.selectedCollection,
            indexName: this.mongoDropIndexName,
        });
    }

    runMongoCreateCollection(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Collection creation is not supported for this database.';
            return;
        }
        if (!this.mongoCreateCollectionName) {
            this.errorMessage = 'Collection name is required.';
            return;
        }
        this.executeAction({
            operation: 'createCollection',
            collection: this.mongoCreateCollectionName,
        });
    }

    async runMongoDropCollection(): Promise<void> {
        if (!this.supportsCrud) {
            this.errorMessage = 'Collection deletion is not supported for this database.';
            return;
        }
        const collection = this.selectedCollection;
        if (!collection) {
            this.errorMessage = 'Select a collection to delete.';
            return;
        }
        const confirmed = await this.confirmDestructive(`Drop collection "${collection}"?`, {
            title: 'Confirm delete',
            confirmLabel: 'Delete',
        });
        if (!confirmed) {
            return;
        }
        this.executeAction({
            operation: 'dropCollection',
            collection,
        });
    }

    runMongoRenameCollection(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Collection rename is not supported for this database.';
            return;
        }
        const collection = this.selectedCollection;
        if (!collection || !this.mongoRenameTo) {
            this.errorMessage = 'Select a collection and provide a new name.';
            return;
        }
        this.executeAction({
            operation: 'renameCollection',
            collection,
            newName: this.mongoRenameTo,
            dropTarget: false,
        });
    }
}

type MongoTabId = 'documents' | 'aggregations' | 'schema' | 'indexes' | 'validation';

type MongoTreeItem = {
    type: 'db' | 'collection' | 'loading' | 'empty';
    name: string;
    count?: number;
    expanded?: boolean;
};
