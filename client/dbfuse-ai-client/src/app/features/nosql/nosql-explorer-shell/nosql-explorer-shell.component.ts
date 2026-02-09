import { CommonModule } from '@angular/common';
import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    Input,
    OnChanges,
    OnInit,
    SimpleChanges,
    Type,
    inject,
} from '@angular/core';
import { DatabaseStats, DatabaseType } from '@core/utils/storage/storage.types';

const EXPLORER_LOADERS: Record<string, () => Promise<Type<any>>> = {
    mongodb: () =>
        import('@features/nosql/explorers/mongodb-explorer/mongodb-explorer.component').then(
            (m) => m.MongodbExplorerComponent,
        ),
    redis: () =>
        import('@features/nosql/explorers/redis-explorer/redis-explorer.component').then(
            (m) => m.RedisExplorerComponent,
        ),
    dynamodb: () =>
        import('@features/nosql/explorers/dynamodb-explorer/dynamodb-explorer.component').then(
            (m) => m.DynamodbExplorerComponent,
        ),
    cassandra: () =>
        import('@features/nosql/explorers/cassandra-explorer/cassandra-explorer.component').then(
            (m) => m.CassandraExplorerComponent,
        ),
    couchdb: () =>
        import('@features/nosql/explorers/couchdb-explorer/couchdb-explorer.component').then(
            (m) => m.CouchdbExplorerComponent,
        ),
    cosmosdb: () =>
        import('@features/nosql/explorers/cosmosdb-explorer/cosmosdb-explorer.component').then(
            (m) => m.CosmosdbExplorerComponent,
        ),
    firestore: () =>
        import('@features/nosql/explorers/firestore-explorer/firestore-explorer.component').then(
            (m) => m.FirestoreExplorerComponent,
        ),
    hbase: () =>
        import('@features/nosql/explorers/hbase-explorer/hbase-explorer.component').then(
            (m) => m.HbaseExplorerComponent,
        ),
    memcached: () =>
        import('@features/nosql/explorers/memcached-explorer/memcached-explorer.component').then(
            (m) => m.MemcachedExplorerComponent,
        ),
};

@Component({
    selector: 'app-nosql-explorer-shell',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './nosql-explorer-shell.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NosqlExplorerShellComponent implements OnChanges, OnInit {
    @Input() dbType: DatabaseType = 'mongodb';
    @Input() databases: DatabaseStats[] | null = null;

    explorerComponent: Type<any> | null = null;
    loading = false;
    loadError: string | null = null;
    private readonly cdr = inject(ChangeDetectorRef);
    private lastDbType: string | null = null;

    ngOnInit(): void {
        void this.loadExplorer(this.dbType);
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['dbType']) {
            void this.loadExplorer(this.dbType);
        }
    }

    private async loadExplorer(dbType: DatabaseType): Promise<void> {
        const normalized = String(dbType || '').toLowerCase();
        if (this.lastDbType === normalized && this.explorerComponent) {
            return;
        }
        this.lastDbType = normalized;
        const loader = EXPLORER_LOADERS[normalized];
        if (!loader) {
            this.explorerComponent = null;
            this.loading = false;
            this.loadError = `No explorer registered for "${dbType}".`;
            this.cdr.markForCheck();
            return;
        }
        this.loading = true;
        this.loadError = null;
        this.cdr.markForCheck();
        try {
            this.explorerComponent = await loader();
        } catch {
            this.explorerComponent = null;
            this.loadError = `Failed to load explorer for "${dbType}".`;
        } finally {
            this.loading = false;
            this.cdr.markForCheck();
        }
    }
}
