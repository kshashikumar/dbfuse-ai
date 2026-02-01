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
    selector: 'app-couchdb-explorer',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './couchdb-explorer.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CouchdbExplorerComponent extends NosqlExplorerBase implements OnInit, OnChanges {
    @Input() override dbType: DatabaseType = 'couchdb';
    @Input() override databases: DatabaseStats[] | null = null;

    mangoSelector = '';
    docId = '';
    docRev = '';
    docPayload = '';
    bulkPayload = '';
    viewDesignDoc = '';
    viewName = '';
    viewParams = '';
    changesParams = '';
    attachmentName = '';
    attachmentContentType = '';
    attachmentEncoding: 'raw' | 'base64' = 'raw';
    attachmentData = '';
    indexDefinition = '';
    indexDesignDoc = '';
    indexName = '';

    constructor(backend: BackendService, cdr: ChangeDetectorRef) {
        super(backend, cdr);
    }

    ngOnInit(): void {
        this.initExplorer();
    }

    ngOnChanges(changes: SimpleChanges): void {
        this.handleChanges(changes);
    }

    override selectDatabase(dbName: string): void {
        if (!dbName || this.selectedDatabase === dbName) return;
        this.selectedDatabase = dbName;
        this.persistSelectedDatabase(dbName);
        this.selectedCollection = dbName;
        this.collectionInfo = null;
        this.actionMessage = '';
        this.actionResult = null;
        this.loadCollectionInfo(dbName, dbName);
    }

    get supportsViews(): boolean {
        return this.hasFeature('views');
    }

    get supportsChanges(): boolean {
        return this.hasCapability('changes');
    }

    get supportsAttachments(): boolean {
        return this.hasCapability('attachments');
    }

    runMangoQuery(): void {
        const selector = this.mangoSelector?.trim() ? this.parseJsonInput(this.mangoSelector, 'Mango selector') : {};
        if (this.mangoSelector?.trim() && !selector) return;
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a database to query.';
            return;
        }

        this.executeAction({
            operation: 'find',
            database: this.selectedDatabase,
            filter: selector,
        });
    }

    runViewQuery(): void {
        if (!this.supportsViews) {
            this.errorMessage = 'View queries are not supported for this database.';
            return;
        }
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a database to query.';
            return;
        }
        if (!this.viewDesignDoc || !this.viewName) {
            this.errorMessage = 'Design doc and view name are required.';
            return;
        }
        const params = this.parseOptionalJsonInput(this.viewParams, 'View params');
        if (this.viewParams && params === undefined && this.errorMessage) return;

        this.executeAction({
            operation: 'view',
            database: this.selectedDatabase,
            designDoc: this.viewDesignDoc,
            view: this.viewName,
            ...(params ? { params } : {}),
        });
    }

    runChangesFeed(): void {
        if (!this.supportsChanges) {
            this.errorMessage = 'Changes feed is not supported for this database.';
            return;
        }
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a database to query.';
            return;
        }
        const params = this.parseOptionalJsonInput(this.changesParams, 'Changes params');
        if (this.changesParams && params === undefined && this.errorMessage) return;

        this.executeAction({
            operation: 'changes',
            database: this.selectedDatabase,
            ...(params ? { params } : {}),
        });
    }

    runDocGet(): void {
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a database to query.';
            return;
        }
        if (!this.docId) {
            this.errorMessage = 'Document id is required.';
            return;
        }

        this.executeAction({
            operation: 'get',
            database: this.selectedDatabase,
            id: this.docId,
        });
    }

    runAttachmentGet(): void {
        if (!this.supportsAttachments) {
            this.errorMessage = 'Attachments are not supported for this database.';
            return;
        }
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a database to query.';
            return;
        }
        if (!this.docId || !this.attachmentName) {
            this.errorMessage = 'Document id and attachment name are required.';
            return;
        }

        this.executeAction({
            operation: 'attachmentGet',
            database: this.selectedDatabase,
            id: this.docId,
            attachmentName: this.attachmentName,
        });
    }

    runAttachmentInsert(): void {
        if (!this.supportsAttachments) {
            this.errorMessage = 'Attachments are not supported for this database.';
            return;
        }
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a database to insert into.';
            return;
        }
        if (!this.docId || !this.attachmentName) {
            this.errorMessage = 'Document id and attachment name are required.';
            return;
        }
        if (!this.attachmentData) {
            this.errorMessage = 'Attachment data is required.';
            return;
        }

        const params = this.docRev ? { rev: this.docRev } : undefined;
        this.executeAction({
            operation: 'attachmentInsert',
            database: this.selectedDatabase,
            id: this.docId,
            attachmentName: this.attachmentName,
            data: this.attachmentData,
            ...(this.attachmentContentType ? { contentType: this.attachmentContentType } : {}),
            encoding: this.attachmentEncoding === 'base64' ? 'base64' : 'raw',
            ...(params ? { params } : {}),
        });
    }

    runAttachmentDelete(): void {
        if (!this.supportsAttachments) {
            this.errorMessage = 'Attachments are not supported for this database.';
            return;
        }
        if (!this.supportsCrud) {
            this.errorMessage = 'Deletes are not supported for this database.';
            return;
        }
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a database to delete from.';
            return;
        }
        if (!this.docId || !this.attachmentName || !this.docRev) {
            this.errorMessage = 'Document id, rev, and attachment name are required.';
            return;
        }
        if (!window.confirm(`Delete attachment ${this.attachmentName}? This cannot be undone.`)) {
            return;
        }

        this.executeAction({
            operation: 'attachmentDelete',
            database: this.selectedDatabase,
            id: this.docId,
            attachmentName: this.attachmentName,
            rev: this.docRev,
        });
    }

    runDocInsert(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a database to insert into.';
            return;
        }
        const document = this.parseJsonInput(this.docPayload, 'Document');
        if (!document) return;

        this.executeAction({
            operation: 'insert',
            database: this.selectedDatabase,
            document,
        });
    }

    runDocUpdate(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Updates are not supported for this database.';
            return;
        }
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a database to update.';
            return;
        }
        const document = this.parseJsonInput(this.docPayload, 'Document');
        if (!document) return;

        this.executeAction({
            operation: 'update',
            database: this.selectedDatabase,
            document,
        });
    }

    runDocDelete(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Deletes are not supported for this database.';
            return;
        }
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a database to delete from.';
            return;
        }
        let id = this.docId;
        let rev = this.docRev;
        if ((!id || !rev) && this.docPayload?.trim()) {
            const document = this.parseJsonInput(this.docPayload, 'Document');
            if (!document) return;
            id = id || document._id;
            rev = rev || document._rev;
        }
        if (!id || !rev) {
            this.errorMessage = 'Document id and rev are required for delete.';
            return;
        }
        if (!window.confirm(`Delete document ${id}? This cannot be undone.`)) {
            return;
        }

        this.executeAction({
            operation: 'delete',
            database: this.selectedDatabase,
            id,
            rev,
        });
    }

    runBulk(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Bulk writes are not supported for this database.';
            return;
        }
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a database to bulk write.';
            return;
        }
        const documents = this.parseJsonInput(this.bulkPayload, 'Bulk documents');
        if (!documents) return;
        if (!Array.isArray(documents)) {
            this.errorMessage = 'Bulk documents must be a JSON array.';
            return;
        }
        if (!window.confirm('Run bulk document write? This may insert or delete multiple documents.')) {
            return;
        }

        this.executeAction({
            operation: 'bulk',
            database: this.selectedDatabase,
            documents,
        });
    }

    runCreateIndex(): void {
        if (!this.supportsIndexes) {
            this.errorMessage = 'Index operations are not supported for this database.';
            return;
        }
        if (!this.supportsCrud) {
            this.errorMessage = 'Index writes are not supported for this database.';
            return;
        }
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a database to create indexes in.';
            return;
        }
        const index = this.parseJsonInput(this.indexDefinition, 'Index definition');
        if (!index) return;

        this.executeAction({
            operation: 'createIndex',
            database: this.selectedDatabase,
            index,
        });
    }

    runDeleteIndex(): void {
        if (!this.supportsIndexes) {
            this.errorMessage = 'Index operations are not supported for this database.';
            return;
        }
        if (!this.supportsCrud) {
            this.errorMessage = 'Index writes are not supported for this database.';
            return;
        }
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a database to delete indexes from.';
            return;
        }
        if (!this.indexDesignDoc || !this.indexName) {
            this.errorMessage = 'Design doc and index name are required.';
            return;
        }
        if (!window.confirm(`Delete index ${this.indexName}?`)) {
            return;
        }

        this.executeAction({
            operation: 'deleteIndex',
            database: this.selectedDatabase,
            designDoc: this.indexDesignDoc,
            indexName: this.indexName,
        });
    }

    runListIndexes(): void {
        if (!this.supportsIndexes) {
            this.errorMessage = 'Index operations are not supported for this database.';
            return;
        }
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a database to list indexes.';
            return;
        }

        this.executeAction({
            operation: 'listIndexes',
            database: this.selectedDatabase,
        });
    }
}
