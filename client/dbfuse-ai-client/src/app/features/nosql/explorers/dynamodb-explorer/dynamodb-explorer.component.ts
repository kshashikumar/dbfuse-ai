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
import { VirtualListComponent } from '@shared/components/virtual-list/virtual-list.component';
import { BackendService } from '@core/services/backend/backend.service';
import { DatabaseStats, DatabaseType } from '@core/utils/storage/storage.types';
import { NosqlExplorerBase } from '../nosql-explorer-base';

@Component({
    selector: 'app-dynamodb-explorer',
    standalone: true,
    imports: [CommonModule, FormsModule, VirtualListComponent],
    templateUrl: './dynamodb-explorer.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DynamodbExplorerComponent extends NosqlExplorerBase implements OnInit, OnChanges {
    @Input() override dbType: DatabaseType = 'dynamodb';
    @Input() override databases: DatabaseStats[] | null = null;

    queryMode: 'query' | 'scan' = 'scan';
    dynamoKey = '';
    dynamoItem = '';
    dynamoUpdateKey = '';
    dynamoUpdateOptions = '';
    dynamoDeleteKey = '';
    dynamoQueryOptions = '';
    dynamoLimit = '';
    dynamoStartKey = '';
    dynamoBatchGet = '';
    dynamoBatchWrite = '';
    dynamoTransactGet = '';
    dynamoTransactWrite = '';
    dynamoCreateTable = '';
    dynamoUpdateTable = '';
    dynamoDeleteTableName = '';

    constructor(backend: BackendService, cdr: ChangeDetectorRef) {
        super(backend, cdr);
    }

    ngOnInit(): void {
        this.initExplorer();
    }

    ngOnChanges(changes: SimpleChanges): void {
        this.handleChanges(changes);
    }

    get supportsBatch(): boolean {
        return this.hasCapability('batch');
    }

    get supportsTransactions(): boolean {
        return this.hasCapability('transactions');
    }

    get supportsAdmin(): boolean {
        return this.hasCapability('admin');
    }

    get gsiIndexes(): any[] {
        return (this.collectionInfo?.indexes || []).filter((idx: any) =>
            String(idx.type || '')
                .toUpperCase()
                .includes('GSI'),
        );
    }

    get lsiIndexes(): any[] {
        return (this.collectionInfo?.indexes || []).filter((idx: any) =>
            String(idx.type || '')
                .toUpperCase()
                .includes('LSI'),
        );
    }

    runDynamoQuery(): void {
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a table to query.';
            return;
        }
        const options = this.parseOptionalJsonInput(this.dynamoQueryOptions, 'Query options');
        if (this.dynamoQueryOptions && options === undefined && this.errorMessage) return;
        const startKey = this.parseOptionalJsonInput(this.dynamoStartKey, 'Exclusive start key');
        if (this.dynamoStartKey && startKey === undefined && this.errorMessage) return;
        const limit = this.parseNumber(this.dynamoLimit);

        this.executeAction({
            operation: this.queryMode,
            table: this.selectedCollection,
            ...(options ? { options } : {}),
            ...(startKey ? { exclusiveStartKey: startKey } : {}),
            ...(limit ? { limit } : {}),
        });
    }

    runDynamoGet(): void {
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a table to get an item.';
            return;
        }
        const key = this.parseJsonInput(this.dynamoKey, 'Key');
        if (!key) return;

        this.executeAction({
            operation: 'get',
            table: this.selectedCollection,
            key,
        });
    }

    runDynamoPut(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a table to insert into.';
            return;
        }
        const item = this.parseJsonInput(this.dynamoItem, 'Item');
        if (!item) return;

        this.executeAction({
            operation: 'put',
            table: this.selectedCollection,
            item,
        });
    }

    runDynamoUpdate(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Updates are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a table to update.';
            return;
        }
        const key = this.parseJsonInput(this.dynamoUpdateKey, 'Key');
        if (!key) return;
        const options = this.parseOptionalJsonInput(this.dynamoUpdateOptions, 'Update options');
        if (this.dynamoUpdateOptions && options === undefined && this.errorMessage) return;

        this.executeAction({
            operation: 'update',
            table: this.selectedCollection,
            key,
            ...(options ? { options } : {}),
        });
    }

    async runDynamoDelete(): Promise<void> {
        if (!this.supportsCrud) {
            this.errorMessage = 'Deletes are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a table to delete from.';
            return;
        }
        const key = this.parseJsonInput(this.dynamoDeleteKey, 'Key');
        if (!key) return;
        const confirmed = await this.confirmDestructive('Delete the matching item? This cannot be undone.', {
            title: 'Confirm delete',
            confirmLabel: 'Delete',
        });
        if (!confirmed) {
            return;
        }

        this.executeAction({
            operation: 'delete',
            table: this.selectedCollection,
            key,
        });
    }

    runDynamoBatchGet(): void {
        if (!this.supportsBatch) {
            this.errorMessage = 'Batch operations are not supported for this database.';
            return;
        }
        const requestItems = this.parseJsonInput(this.dynamoBatchGet, 'Batch get request');
        if (!requestItems) return;

        this.executeAction({
            operation: 'batchget',
            requestItems,
        });
    }

    async runDynamoBatchWrite(): Promise<void> {
        if (!this.supportsBatch) {
            this.errorMessage = 'Batch operations are not supported for this database.';
            return;
        }
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        const requestItems = this.parseJsonInput(this.dynamoBatchWrite, 'Batch write request');
        if (!requestItems) return;
        const confirmed = await this.confirmDestructive('Run batch write? This may insert or delete multiple items.', {
            title: 'Confirm batch write',
            confirmLabel: 'Run',
        });
        if (!confirmed) {
            return;
        }

        this.executeAction({
            operation: 'batchwrite',
            requestItems,
        });
    }

    runDynamoTransactGet(): void {
        if (!this.supportsTransactions) {
            this.errorMessage = 'Transactions are not supported for this database.';
            return;
        }
        const transactItems = this.parseJsonInput(this.dynamoTransactGet, 'Transact get items');
        if (!transactItems) return;
        if (!Array.isArray(transactItems)) {
            this.errorMessage = 'Transact get items must be a JSON array.';
            return;
        }

        this.executeAction({
            operation: 'transactget',
            transactItems,
        });
    }

    async runDynamoTransactWrite(): Promise<void> {
        if (!this.supportsTransactions) {
            this.errorMessage = 'Transactions are not supported for this database.';
            return;
        }
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        const transactItems = this.parseJsonInput(this.dynamoTransactWrite, 'Transact write items');
        if (!transactItems) return;
        if (!Array.isArray(transactItems)) {
            this.errorMessage = 'Transact write items must be a JSON array.';
            return;
        }
        const confirmed = await this.confirmDestructive('Run transactional write? This may modify multiple items.', {
            title: 'Confirm transaction',
            confirmLabel: 'Run',
        });
        if (!confirmed) {
            return;
        }

        this.executeAction({
            operation: 'transactwrite',
            transactItems,
        });
    }

    runDynamoCreateTable(): void {
        if (!this.supportsAdmin) {
            this.errorMessage = 'Admin operations are not supported for this database.';
            return;
        }
        const tableDefinition = this.parseJsonInput(this.dynamoCreateTable, 'Table definition');
        if (!tableDefinition) return;

        this.executeAction({
            operation: 'createtable',
            tableDefinition,
        });
    }

    runDynamoUpdateTable(): void {
        if (!this.supportsAdmin) {
            this.errorMessage = 'Admin operations are not supported for this database.';
            return;
        }
        const tableDefinition = this.parseJsonInput(this.dynamoUpdateTable, 'Table update');
        if (!tableDefinition) return;

        this.executeAction({
            operation: 'updatetable',
            tableDefinition,
        });
    }

    async runDynamoDeleteTable(): Promise<void> {
        if (!this.supportsAdmin) {
            this.errorMessage = 'Admin operations are not supported for this database.';
            return;
        }
        const tableName = this.dynamoDeleteTableName || this.selectedCollection;
        if (!tableName) {
            this.errorMessage = 'Table name is required.';
            return;
        }
        const confirmed = await this.confirmDestructive(`Delete table ${tableName}? This cannot be undone.`, {
            title: 'Confirm delete',
            confirmLabel: 'Delete',
        });
        if (!confirmed) {
            return;
        }

        this.executeAction({
            operation: 'deletetable',
            table: tableName,
        });
    }

    private parseNumber(value: string): number | undefined {
        if (!value) return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
}
