import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DatabaseStats, DatabaseType } from '@core/utils/storage/storage.types';
import { NosqlExplorerComponent } from '@features/nosql/nosql-explorer/nosql-explorer.component';
import { MongodbExplorerComponent } from '@features/nosql/explorers/mongodb-explorer/mongodb-explorer.component';
import { RedisExplorerComponent } from '@features/nosql/explorers/redis-explorer/redis-explorer.component';
import { DynamodbExplorerComponent } from '@features/nosql/explorers/dynamodb-explorer/dynamodb-explorer.component';
import { CassandraExplorerComponent } from '@features/nosql/explorers/cassandra-explorer/cassandra-explorer.component';
import { CouchdbExplorerComponent } from '@features/nosql/explorers/couchdb-explorer/couchdb-explorer.component';
import { CosmosdbExplorerComponent } from '@features/nosql/explorers/cosmosdb-explorer/cosmosdb-explorer.component';
import { FirestoreExplorerComponent } from '@features/nosql/explorers/firestore-explorer/firestore-explorer.component';
import { HbaseExplorerComponent } from '@features/nosql/explorers/hbase-explorer/hbase-explorer.component';
import { MemcachedExplorerComponent } from '@features/nosql/explorers/memcached-explorer/memcached-explorer.component';

@Component({
    selector: 'app-nosql-explorer-shell',
    standalone: true,
    imports: [
        CommonModule,
        MongodbExplorerComponent,
        RedisExplorerComponent,
        DynamodbExplorerComponent,
        CassandraExplorerComponent,
        CouchdbExplorerComponent,
        CosmosdbExplorerComponent,
        FirestoreExplorerComponent,
        HbaseExplorerComponent,
        MemcachedExplorerComponent,
        NosqlExplorerComponent,
    ],
    templateUrl: './nosql-explorer-shell.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NosqlExplorerShellComponent {
    @Input() dbType: DatabaseType = 'mongodb';
    @Input() databases: DatabaseStats[] | null = null;
}
