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
    selector: 'app-hbase-explorer',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './hbase-explorer.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HbaseExplorerComponent extends NosqlExplorerBase implements OnInit, OnChanges {
    @Input() override dbType: DatabaseType = 'hbase';
    @Input() override databases: DatabaseStats[] | null = null;

    rowKey = '';
    rowValues = '';
    scanStart = '';
    scanEnd = '';
    scanLimit = '';
    getColumns = '';
    getMaxVersions = '';
    scanColumns = '';
    scanFilter = '';
    scanMaxVersions = '';
    incrementValues = '';
    appendValues = '';

    constructor(backend: BackendService, cdr: ChangeDetectorRef) {
        super(backend, cdr);
    }

    ngOnInit(): void {
        this.initExplorer();
    }

    ngOnChanges(changes: SimpleChanges): void {
        this.handleChanges(changes);
    }

    get columnFamilies(): string[] {
        const families = new Set<string>();
        for (const col of this.collectionInfo?.columns || []) {
            const name = col.column_name || '';
            if (name.includes(':')) {
                families.add(name.split(':')[0]);
            }
        }
        return Array.from(families);
    }

    runHBaseGet(): void {
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a table to get from.';
            return;
        }
        if (!this.rowKey) {
            this.errorMessage = 'Row key is required.';
            return;
        }
        const columns = this.parseOptionalJsonInput(this.getColumns, 'Columns');
        if (this.getColumns && columns === undefined && this.errorMessage) return;
        const maxVersions = this.parseNumber(this.getMaxVersions);

        this.executeAction({
            operation: 'get',
            database: this.selectedDatabase,
            table: this.selectedCollection,
            rowKey: this.rowKey,
            ...(columns ? { columns } : {}),
            ...(maxVersions ? { maxVersions } : {}),
        });
    }

    runHBaseScan(): void {
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a table to scan.';
            return;
        }
        const limit = this.parseNumber(this.scanLimit);
        const columns = this.parseOptionalJsonInput(this.scanColumns, 'Scan columns');
        if (this.scanColumns && columns === undefined && this.errorMessage) return;
        const filter = this.parseOptionalJsonInput(this.scanFilter, 'Scan filter');
        if (this.scanFilter && filter === undefined && this.errorMessage) return;
        const maxVersions = this.parseNumber(this.scanMaxVersions);

        this.executeAction({
            operation: 'scan',
            database: this.selectedDatabase,
            table: this.selectedCollection,
            ...(this.scanStart ? { startRow: this.scanStart } : {}),
            ...(this.scanEnd ? { endRow: this.scanEnd } : {}),
            ...(limit ? { limit } : {}),
            ...(columns ? { columns } : {}),
            ...(filter ? { filter } : {}),
            ...(maxVersions ? { maxVersions } : {}),
        });
    }

    runHBasePut(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a table to write to.';
            return;
        }
        if (!this.rowKey) {
            this.errorMessage = 'Row key is required.';
            return;
        }
        const values = this.parseJsonInput(this.rowValues, 'Values');
        if (!values) return;

        this.executeAction({
            operation: 'put',
            database: this.selectedDatabase,
            table: this.selectedCollection,
            rowKey: this.rowKey,
            values,
        });
    }

    runHBaseIncrement(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a table to write to.';
            return;
        }
        if (!this.rowKey) {
            this.errorMessage = 'Row key is required.';
            return;
        }
        const values = this.parseJsonInput(this.incrementValues, 'Increment values');
        if (!values) return;

        this.executeAction({
            operation: 'increment',
            database: this.selectedDatabase,
            table: this.selectedCollection,
            rowKey: this.rowKey,
            values,
        });
    }

    runHBaseAppend(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a table to write to.';
            return;
        }
        if (!this.rowKey) {
            this.errorMessage = 'Row key is required.';
            return;
        }
        const values = this.parseJsonInput(this.appendValues, 'Append values');
        if (!values) return;

        this.executeAction({
            operation: 'append',
            database: this.selectedDatabase,
            table: this.selectedCollection,
            rowKey: this.rowKey,
            values,
        });
    }

    runHBaseDelete(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Deletes are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a table to delete from.';
            return;
        }
        if (!this.rowKey) {
            this.errorMessage = 'Row key is required.';
            return;
        }
        if (!window.confirm(`Delete row ${this.rowKey}? This cannot be undone.`)) {
            return;
        }

        this.executeAction({
            operation: 'delete',
            database: this.selectedDatabase,
            table: this.selectedCollection,
            rowKey: this.rowKey,
        });
    }

    private parseNumber(value: string): number | undefined {
        if (!value) return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
}
