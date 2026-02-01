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
    selector: 'app-firestore-explorer',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './firestore-explorer.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FirestoreExplorerComponent extends NosqlExplorerBase implements OnInit, OnChanges {
    @Input() override dbType: DatabaseType = 'firestore';
    @Input() override databases: DatabaseStats[] | null = null;

    docPath = '';
    docId = '';
    docPayload = '';
    mergeSet = false;

    queryFilters = '';
    queryOrderBy = '';
    queryLimit = '';
    queryCollectionGroup = false;
    transactionActions = '';
    batchActions = '';

    constructor(backend: BackendService, cdr: ChangeDetectorRef) {
        super(backend, cdr);
    }

    ngOnInit(): void {
        this.initExplorer();
    }

    ngOnChanges(changes: SimpleChanges): void {
        this.handleChanges(changes);
    }

    runFirestoreQuery(): void {
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection to query.';
            return;
        }
        const filters = this.queryFilters?.trim() ? this.parseJsonInput(this.queryFilters, 'Filters') : [];
        if (this.queryFilters?.trim() && !filters) return;
        const orderBy = this.queryOrderBy?.trim() ? this.parseJsonInput(this.queryOrderBy, 'Order by') : [];
        if (this.queryOrderBy?.trim() && !orderBy) return;
        const limit = this.parseNumber(this.queryLimit);

        this.executeAction({
            operation: 'query',
            collection: this.selectedCollection,
            filters,
            orderBy,
            ...(limit ? { limit } : {}),
            collectionGroup: this.queryCollectionGroup,
        });
    }

    runFirestoreGet(): void {
        const target = this.resolveDocTarget(true);
        if (!target) return;
        this.executeAction({
            operation: 'get',
            ...target,
        });
    }

    runFirestoreSet(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        const target = this.resolveDocTarget(true);
        if (!target) return;
        const document = this.parseJsonInput(this.docPayload, 'Document');
        if (!document) return;

        this.executeAction({
            operation: 'set',
            ...target,
            document,
            merge: this.mergeSet,
        });
    }

    runFirestoreCreate(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        const target = this.resolveDocTarget(true);
        if (!target) return;
        const document = this.parseJsonInput(this.docPayload, 'Document');
        if (!document) return;

        this.executeAction({
            operation: 'create',
            ...target,
            document,
        });
    }

    runFirestoreAdd(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection to add to.';
            return;
        }
        const document = this.parseJsonInput(this.docPayload, 'Document');
        if (!document) return;

        this.executeAction({
            operation: 'add',
            collection: this.selectedCollection,
            document,
        });
    }

    runFirestoreUpdate(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        const target = this.resolveDocTarget(true);
        if (!target) return;
        const document = this.parseJsonInput(this.docPayload, 'Update document');
        if (!document) return;

        this.executeAction({
            operation: 'update',
            ...target,
            document,
        });
    }

    runFirestoreDelete(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Deletes are not supported for this database.';
            return;
        }
        const target = this.resolveDocTarget(true);
        if (!target) return;
        if (!window.confirm('Delete this document? This cannot be undone.')) {
            return;
        }
        this.executeAction({
            operation: 'delete',
            ...target,
        });
    }

    get supportsTransactions(): boolean {
        return this.hasCapability('transactions');
    }

    get supportsBatch(): boolean {
        return this.hasCapability('batch');
    }

    runFirestoreTransaction(): void {
        if (!this.supportsTransactions) {
            this.errorMessage = 'Transactions are not supported for this database.';
            return;
        }
        const actions = this.parseJsonInput(this.transactionActions, 'Transaction actions');
        if (!actions) return;
        if (!Array.isArray(actions)) {
            this.errorMessage = 'Transaction actions must be a JSON array.';
            return;
        }

        this.executeAction({
            operation: 'transaction',
            actions,
        });
    }

    runFirestoreBatch(): void {
        if (!this.supportsBatch) {
            this.errorMessage = 'Batch writes are not supported for this database.';
            return;
        }
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        const actions = this.parseJsonInput(this.batchActions, 'Batch actions');
        if (!actions) return;
        if (!Array.isArray(actions)) {
            this.errorMessage = 'Batch actions must be a JSON array.';
            return;
        }
        if (!window.confirm('Run batch write? This may modify multiple documents.')) {
            return;
        }

        this.executeAction({
            operation: 'batch',
            actions,
        });
    }

    private resolveDocTarget(requireId: boolean): { documentPath?: string; collection?: string; id?: string } | null {
        if (this.docPath?.trim()) {
            return { documentPath: this.docPath.trim() };
        }
        if (!this.selectedCollection) {
            this.errorMessage = 'Select a collection or provide a document path.';
            return null;
        }
        if (requireId && !this.docId) {
            this.errorMessage = 'Document id is required.';
            return null;
        }
        return { collection: this.selectedCollection, id: this.docId };
    }

    private parseNumber(value: string): number | undefined {
        if (!value) return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
}
