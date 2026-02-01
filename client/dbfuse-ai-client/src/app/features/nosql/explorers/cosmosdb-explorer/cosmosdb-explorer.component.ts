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
import { DatabaseStats, DatabaseType } from '@core/utils/storage/storage.types';
import { NosqlExplorerBase } from '../nosql-explorer-base';

@Component({
    selector: 'app-cosmosdb-explorer',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './cosmosdb-explorer.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CosmosdbExplorerComponent extends NosqlExplorerBase implements OnInit, OnChanges {
    @Input() override dbType: DatabaseType = 'cosmosdb';
    @Input() override databases: DatabaseStats[] | null = null;

    cosmosQuery = '';
    cosmosLimit = '';
    cosmosContinuation = '';
    cosmosDocument = '';
    cosmosId = '';
    cosmosPartitionKey = '';
    cosmosPatch = '';
    cosmosBulk = '';
    sprocId = '';
    sprocBody = '';
    sprocParams = '';
    adminDatabase = '';
    adminContainer = '';
    adminContainerDefinition = '';
    cosmosThroughput = '';

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

    get supportsStoredProcedures(): boolean {
        return this.hasCapability('stored-procedures');
    }

    get supportsAdmin(): boolean {
        return this.hasCapability('admin');
    }

    runCosmosQuery(): void {
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a container to query.';
            return;
        }
        if (!this.cosmosQuery.trim()) {
            this.errorMessage = 'SQL query is required.';
            return;
        }
        const limit = this.parseNumber(this.cosmosLimit);
        const continuationToken = this.parseScalar(this.cosmosContinuation);

        this.executeAction({
            operation: 'query',
            statement: this.cosmosQuery,
            database: this.selectedDatabase,
            collection: this.selectedCollection,
            ...(limit ? { limit } : {}),
            ...(continuationToken ? { continuationToken } : {}),
        });
    }

    runCosmosInsert(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a container to insert into.';
            return;
        }
        const document = this.parseJsonInput(this.cosmosDocument, 'Document');
        if (!document) return;

        this.executeAction({
            operation: 'create',
            database: this.selectedDatabase,
            collection: this.selectedCollection,
            document,
        });
    }

    runCosmosUpsert(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a container to upsert into.';
            return;
        }
        const document = this.parseJsonInput(this.cosmosDocument, 'Document');
        if (!document) return;

        this.executeAction({
            operation: 'upsert',
            database: this.selectedDatabase,
            collection: this.selectedCollection,
            document,
        });
    }

    runCosmosReplace(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a container to replace in.';
            return;
        }
        if (!this.cosmosId) {
            this.errorMessage = 'Document id is required.';
            return;
        }
        const document = this.parseJsonInput(this.cosmosDocument, 'Document');
        if (!document) return;
        const partitionKey = this.parseScalar(this.cosmosPartitionKey);

        this.executeAction({
            operation: 'replace',
            database: this.selectedDatabase,
            collection: this.selectedCollection,
            id: this.cosmosId,
            document,
            ...(partitionKey ? { partitionKey } : {}),
        });
    }

    runCosmosPatch(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a container to patch.';
            return;
        }
        if (!this.cosmosId) {
            this.errorMessage = 'Document id is required.';
            return;
        }
        const patch = this.parseJsonInput(this.cosmosPatch, 'Patch operations');
        if (!patch) return;
        if (!Array.isArray(patch)) {
            this.errorMessage = 'Patch operations must be a JSON array.';
            return;
        }
        const partitionKey = this.parseScalar(this.cosmosPartitionKey);

        this.executeAction({
            operation: 'patch',
            database: this.selectedDatabase,
            collection: this.selectedCollection,
            id: this.cosmosId,
            patch,
            ...(partitionKey ? { partitionKey } : {}),
        });
    }

    runCosmosRead(): void {
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a container to read from.';
            return;
        }
        if (!this.cosmosId) {
            this.errorMessage = 'Document id is required.';
            return;
        }
        const partitionKey = this.parseScalar(this.cosmosPartitionKey);

        this.executeAction({
            operation: 'read',
            database: this.selectedDatabase,
            collection: this.selectedCollection,
            id: this.cosmosId,
            ...(partitionKey ? { partitionKey } : {}),
        });
    }

    runCosmosDelete(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Deletes are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a container to delete from.';
            return;
        }
        if (!this.cosmosId) {
            this.errorMessage = 'Document id is required.';
            return;
        }
        if (!window.confirm(`Delete document ${this.cosmosId}? This cannot be undone.`)) {
            return;
        }
        const partitionKey = this.parseScalar(this.cosmosPartitionKey);

        this.executeAction({
            operation: 'delete',
            database: this.selectedDatabase,
            collection: this.selectedCollection,
            id: this.cosmosId,
            ...(partitionKey ? { partitionKey } : {}),
        });
    }

    runCosmosBulk(): void {
        if (!this.supportsBatch) {
            this.errorMessage = 'Bulk operations are not supported for this database.';
            return;
        }
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        const operations = this.parseJsonInput(this.cosmosBulk, 'Bulk operations');
        if (!operations) return;
        if (!Array.isArray(operations)) {
            this.errorMessage = 'Bulk operations must be a JSON array.';
            return;
        }
        if (!window.confirm('Run bulk operations? This may modify multiple documents.')) {
            return;
        }

        this.executeAction({
            operation: 'bulk',
            database: this.selectedDatabase,
            collection: this.selectedCollection,
            operations,
        });
    }

    runCreateDatabase(): void {
        if (!this.supportsAdmin) {
            this.errorMessage = 'Admin operations are not supported for this database.';
            return;
        }
        const database = this.adminDatabase || this.selectedDatabase;
        if (!database) {
            this.errorMessage = 'Database id is required.';
            return;
        }
        this.executeAction({
            operation: 'createdatabase',
            database,
        });
    }

    runDeleteDatabase(): void {
        if (!this.supportsAdmin) {
            this.errorMessage = 'Admin operations are not supported for this database.';
            return;
        }
        const database = this.adminDatabase || this.selectedDatabase;
        if (!database) {
            this.errorMessage = 'Database id is required.';
            return;
        }
        if (!window.confirm(`Delete database ${database}? This cannot be undone.`)) {
            return;
        }
        this.executeAction({
            operation: 'deletedatabase',
            database,
        });
    }

    runCreateContainer(): void {
        if (!this.supportsAdmin) {
            this.errorMessage = 'Admin operations are not supported for this database.';
            return;
        }
        const database = this.adminDatabase || this.selectedDatabase;
        if (!database) {
            this.errorMessage = 'Database id is required.';
            return;
        }
        const containerDefinition = this.parseJsonInput(this.adminContainerDefinition, 'Container definition');
        if (!containerDefinition) return;
        const throughput = this.parseNumber(this.cosmosThroughput);

        this.executeAction({
            operation: 'createcontainer',
            database,
            containerDefinition,
            ...(throughput ? { throughput } : {}),
        });
    }

    runReplaceContainer(): void {
        if (!this.supportsAdmin) {
            this.errorMessage = 'Admin operations are not supported for this database.';
            return;
        }
        const database = this.adminDatabase || this.selectedDatabase;
        const container = this.adminContainer || this.selectedCollection;
        if (!database || !container) {
            this.errorMessage = 'Database and container are required.';
            return;
        }
        const containerDefinition = this.parseJsonInput(this.adminContainerDefinition, 'Container definition');
        if (!containerDefinition) return;

        this.executeAction({
            operation: 'replacecontainer',
            database,
            collection: container,
            containerDefinition,
        });
    }

    runDeleteContainer(): void {
        if (!this.supportsAdmin) {
            this.errorMessage = 'Admin operations are not supported for this database.';
            return;
        }
        const database = this.adminDatabase || this.selectedDatabase;
        const container = this.adminContainer || this.selectedCollection;
        if (!database || !container) {
            this.errorMessage = 'Database and container are required.';
            return;
        }
        if (!window.confirm(`Delete container ${container}? This cannot be undone.`)) {
            return;
        }
        this.executeAction({
            operation: 'deletecontainer',
            database,
            collection: container,
        });
    }

    runCreateStoredProcedure(): void {
        if (!this.supportsStoredProcedures) {
            this.errorMessage = 'Stored procedures are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a container to create stored procedures.';
            return;
        }
        if (!this.sprocId || !this.sprocBody) {
            this.errorMessage = 'Stored procedure id and body are required.';
            return;
        }
        this.executeAction({
            operation: 'createstoredprocedure',
            database: this.selectedDatabase,
            collection: this.selectedCollection,
            storedProcedureId: this.sprocId,
            body: this.sprocBody,
        });
    }

    runReplaceStoredProcedure(): void {
        if (!this.supportsStoredProcedures) {
            this.errorMessage = 'Stored procedures are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a container to update stored procedures.';
            return;
        }
        if (!this.sprocId || !this.sprocBody) {
            this.errorMessage = 'Stored procedure id and body are required.';
            return;
        }
        this.executeAction({
            operation: 'replacestoredprocedure',
            database: this.selectedDatabase,
            collection: this.selectedCollection,
            storedProcedureId: this.sprocId,
            body: this.sprocBody,
        });
    }

    runDeleteStoredProcedure(): void {
        if (!this.supportsStoredProcedures) {
            this.errorMessage = 'Stored procedures are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a container to delete stored procedures.';
            return;
        }
        if (!this.sprocId) {
            this.errorMessage = 'Stored procedure id is required.';
            return;
        }
        if (!window.confirm(`Delete stored procedure ${this.sprocId}?`)) {
            return;
        }
        this.executeAction({
            operation: 'deletestoredprocedure',
            database: this.selectedDatabase,
            collection: this.selectedCollection,
            storedProcedureId: this.sprocId,
        });
    }

    runExecuteStoredProcedure(): void {
        if (!this.supportsStoredProcedures) {
            this.errorMessage = 'Stored procedures are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a container to execute stored procedures.';
            return;
        }
        if (!this.sprocId) {
            this.errorMessage = 'Stored procedure id is required.';
            return;
        }
        const params = this.parseOptionalJsonInput(this.sprocParams, 'Stored procedure params');
        if (this.sprocParams && params === undefined && this.errorMessage) return;
        const partitionKey = this.parseScalar(this.cosmosPartitionKey);

        this.executeAction({
            operation: 'executestoredprocedure',
            database: this.selectedDatabase,
            collection: this.selectedCollection,
            storedProcedureId: this.sprocId,
            ...(params ? { params } : {}),
            ...(partitionKey ? { partitionKey } : {}),
        });
    }

    private parseNumber(value: string): number | undefined {
        if (!value) return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    private parseScalar(value: string): any | undefined {
        if (!value || !value.trim()) return undefined;
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }
}
