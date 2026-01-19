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
    selector: 'app-mongodb-explorer',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './mongodb-explorer.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MongodbExplorerComponent extends NosqlExplorerBase implements OnInit, OnChanges {
    @Input() override dbType: DatabaseType = 'mongodb';
    @Input() override databases: DatabaseStats[] | null = null;

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

    constructor(backend: BackendService, cdr: ChangeDetectorRef) {
        super(backend, cdr);
    }

    ngOnInit(): void {
        this.initExplorer();
    }

    ngOnChanges(changes: SimpleChanges): void {
        this.handleChanges(changes);
    }

    get mongoIndexes(): { name: string; type?: string; unique?: boolean }[] {
        if (!this.collectionInfo?.indexes) return [];
        return this.collectionInfo.indexes.map((idx: any) => ({
            name: idx.index_name || idx.name || 'index',
            type: idx.type || idx.index_type,
            unique: idx.is_unique ?? idx.unique,
        }));
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

    runMongoDelete(): void {
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

        if (
            !this.confirmDestructive(`Delete matching documents in ${this.selectedCollection}? This cannot be undone.`)
        ) {
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

    runMongoDropIndex(): void {
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
        if (!this.confirmDestructive(`Drop index "${this.mongoDropIndexName}"?`)) {
            return;
        }

        this.executeAction({
            operation: 'dropIndex',
            collection: this.selectedCollection,
            indexName: this.mongoDropIndexName,
        });
    }

    private confirmDestructive(message: string): boolean {
        return window.confirm(message);
    }
}
