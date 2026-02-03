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
    selector: 'app-cassandra-explorer',
    standalone: true,
    imports: [CommonModule, FormsModule, VirtualListComponent],
    templateUrl: './cassandra-explorer.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CassandraExplorerComponent extends NosqlExplorerBase implements OnInit, OnChanges {
    @Input() override dbType: DatabaseType = 'cassandra';
    @Input() override databases: DatabaseStats[] | null = null;

    cqlStatement = '';
    selectWhere = '';
    selectLimit = '';
    insertValues = '';
    updateValues = '';
    updateWhere = '';
    deleteWhere = '';
    lwtConditions = '';
    lwtIfNotExists = false;
    batchStatements = '';
    batchLogged = true;

    constructor(backend: BackendService, cdr: ChangeDetectorRef) {
        super(backend, cdr);
    }

    ngOnInit(): void {
        this.initExplorer();
    }

    ngOnChanges(changes: SimpleChanges): void {
        this.handleChanges(changes);
    }

    get partitionKeys(): string[] {
        return this.getKeysByKind('partition_key');
    }

    get clusteringKeys(): string[] {
        return this.getKeysByKind('clustering');
    }

    get supportsBatch(): boolean {
        return this.hasCapability('batch');
    }

    runCqlQuery(): void {
        if (!this.cqlStatement.trim()) {
            this.errorMessage = 'CQL statement is required.';
            return;
        }
        this.executeAction({
            operation: 'query',
            statement: this.cqlStatement,
        });
    }

    runSelect(): void {
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a table to query.';
            return;
        }
        const where = this.parseOptionalJsonInput(this.selectWhere, 'Where clause');
        if (this.selectWhere && where === undefined && this.errorMessage) return;
        const limit = this.parseNumber(this.selectLimit);

        this.executeAction({
            operation: 'select',
            keyspace: this.selectedDatabase,
            table: this.selectedCollection,
            ...(where ? { where } : {}),
            ...(limit ? { limit } : {}),
        });
    }

    runInsert(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a table to insert into.';
            return;
        }
        const values = this.parseJsonInput(this.insertValues, 'Values');
        if (!values) return;
        const lwtPayload = this.buildLwtPayload();
        if (this.lwtConditions && !lwtPayload) return;

        this.executeAction({
            operation: 'insert',
            keyspace: this.selectedDatabase,
            table: this.selectedCollection,
            values,
            ...(lwtPayload ? lwtPayload : {}),
        });
    }

    async runUpdate(): Promise<void> {
        if (!this.supportsCrud) {
            this.errorMessage = 'Updates are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a table to update.';
            return;
        }
        const values = this.parseJsonInput(this.updateValues, 'Update values');
        const where = this.parseJsonInput(this.updateWhere, 'Where clause');
        if (!values || !where) return;
        const lwtPayload = this.buildLwtPayload();
        if (this.lwtConditions && !lwtPayload) return;

        if (!this.hasPartitionKey(where)) {
            const confirmed = await this.confirmDestructive(
                'Update without full partition key? This can cause wide scans.',
                {
                    title: 'Confirm update',
                    confirmLabel: 'Continue',
                    confirmVariant: 'primary',
                },
            );
            if (!confirmed) {
                return;
            }
        }

        this.executeAction({
            operation: 'update',
            keyspace: this.selectedDatabase,
            table: this.selectedCollection,
            values,
            where,
            ...(lwtPayload ? lwtPayload : {}),
        });
    }

    async runDelete(): Promise<void> {
        if (!this.supportsCrud) {
            this.errorMessage = 'Deletes are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a table to delete from.';
            return;
        }
        const where = this.parseJsonInput(this.deleteWhere, 'Where clause');
        if (!where) return;
        const lwtPayload = this.buildLwtPayload();
        if (this.lwtConditions && !lwtPayload) return;

        const confirmMessage = this.hasPartitionKey(where)
            ? 'Delete matching rows? This cannot be undone.'
            : 'Delete without full partition key? This can cause wide scans.';
        const confirmed = await this.confirmDestructive(confirmMessage, {
            title: 'Confirm delete',
            confirmLabel: 'Delete',
        });
        if (!confirmed) {
            return;
        }

        this.executeAction({
            operation: 'delete',
            keyspace: this.selectedDatabase,
            table: this.selectedCollection,
            where,
            ...(lwtPayload ? lwtPayload : {}),
        });
    }

    async runBatch(): Promise<void> {
        if (!this.hasCapability('batch')) {
            this.errorMessage = 'Batch operations are not supported for this database.';
            return;
        }
        const statements = this.parseJsonInput(this.batchStatements, 'Batch statements');
        if (!statements) return;
        if (!Array.isArray(statements)) {
            this.errorMessage = 'Batch statements must be a JSON array.';
            return;
        }
        const confirmed = await this.confirmDestructive('Run batch statements? This may modify multiple rows.', {
            title: 'Confirm batch write',
            confirmLabel: 'Run',
        });
        if (!confirmed) {
            return;
        }

        this.executeAction({
            operation: 'batch',
            keyspace: this.selectedDatabase,
            statements,
            logged: this.batchLogged,
        });
    }

    private parseNumber(value: string): number | undefined {
        if (!value) return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    private getKeysByKind(kind: string): string[] {
        const columns = this.collectionInfo?.columns || [];
        return columns
            .filter((col) =>
                String(col.extra || '')
                    .toLowerCase()
                    .includes(kind),
            )
            .map((col) => col.column_name)
            .filter(Boolean);
    }

    private hasPartitionKey(where: any): boolean {
        const keys = this.partitionKeys;
        if (keys.length === 0) return true;
        if (!where) return false;
        if (Array.isArray(where)) {
            const fields = new Set(
                where.map((entry) => entry?.field || entry?.column).filter((value) => typeof value === 'string'),
            );
            return keys.every((key) => fields.has(key));
        }
        if (typeof where === 'object') {
            return keys.every((key) => Object.prototype.hasOwnProperty.call(where, key));
        }
        return false;
    }

    private buildLwtPayload(): { if?: any; ifNotExists?: boolean } | null {
        if (this.lwtIfNotExists) {
            return { ifNotExists: true };
        }
        if (!this.lwtConditions?.trim()) {
            return null;
        }
        const conditions = this.parseJsonInput(this.lwtConditions, 'IF conditions');
        if (!conditions) return null;
        return { if: conditions };
    }
}
