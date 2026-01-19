import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DatabaseStats, DatabaseType } from '@core/utils/storage/storage.types';
import { NosqlExplorerComponent } from '@features/nosql/nosql-explorer/nosql-explorer.component';
import { MongodbExplorerComponent } from '@features/nosql/explorers/mongodb-explorer/mongodb-explorer.component';
import { RedisExplorerComponent } from '@features/nosql/explorers/redis-explorer/redis-explorer.component';

@Component({
    selector: 'app-nosql-explorer-shell',
    standalone: true,
    imports: [CommonModule, MongodbExplorerComponent, RedisExplorerComponent, NosqlExplorerComponent],
    templateUrl: './nosql-explorer-shell.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NosqlExplorerShellComponent {
    @Input() dbType: DatabaseType = 'mongodb';
    @Input() databases: DatabaseStats[] | null = null;
}
