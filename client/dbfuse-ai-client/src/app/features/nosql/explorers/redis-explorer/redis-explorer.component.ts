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
    selector: 'app-redis-explorer',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './redis-explorer.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RedisExplorerComponent extends NosqlExplorerBase implements OnInit, OnChanges {
    @Input() override dbType: DatabaseType = 'redis';
    @Input() override databases: DatabaseStats[] | null = null;

    redisKey = '';
    redisValue = '';
    redisTtl = '';
    redisDeleteKey = '';
    redisCommand = '';
    redisCommandArgs = '';
    redisExpirePattern = '';
    redisExpireTtl = '';
    redisExpireLimit = '';

    constructor(backend: BackendService, cdr: ChangeDetectorRef) {
        super(backend, cdr);
    }

    ngOnInit(): void {
        this.initExplorer();
    }

    ngOnChanges(changes: SimpleChanges): void {
        this.handleChanges(changes);
    }

    get redisKeyTypeStats(): { type: string; count: number }[] {
        if (!this.collectionInfo?.sampleKeys) return [];
        const counts: Record<string, number> = {};
        for (const key of this.collectionInfo.sampleKeys) {
            const type = (key.type || 'unknown').toString();
            counts[type] = (counts[type] || 0) + 1;
        }
        return Object.entries(counts)
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count);
    }

    get redisKeyPrefixStats(): { prefix: string; count: number }[] {
        if (!this.collectionInfo?.sampleKeys) return [];
        const counts: Record<string, number> = {};
        for (const entry of this.collectionInfo.sampleKeys) {
            const key = String(entry.key || '');
            if (!key) continue;
            const prefix = key.includes(':') ? key.split(':')[0] : 'other';
            counts[prefix] = (counts[prefix] || 0) + 1;
        }
        return Object.entries(counts)
            .map(([prefix, count]) => ({ prefix, count }))
            .sort((a, b) => b.count - a.count);
    }

    runRedisSet(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        if (!this.redisKey) {
            this.errorMessage = 'Redis key is required.';
            return;
        }
        const ttlValue = this.redisTtl ? Number(this.redisTtl) : undefined;

        this.executeAction({
            operation: 'set',
            key: this.redisKey,
            value: this.redisValue ?? '',
            ...(Number.isFinite(ttlValue) ? { ttl: ttlValue } : {}),
        });
    }

    runRedisDelete(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Deletes are not supported for this database.';
            return;
        }
        if (!this.redisDeleteKey) {
            this.errorMessage = 'Redis key is required.';
            return;
        }
        if (!this.confirmDestructive(`Delete key "${this.redisDeleteKey}"? This cannot be undone.`)) {
            return;
        }

        this.executeAction({
            operation: 'del',
            keys: [this.redisDeleteKey],
        });
    }

    runRedisCommand(): void {
        if (!this.supportsCommands) {
            this.errorMessage = 'Commands are not supported for this database.';
            return;
        }
        if (!this.redisCommand) {
            this.errorMessage = 'Redis command is required.';
            return;
        }
        const args = this.parseArgsInput(this.redisCommandArgs);

        this.executeAction({
            operation: 'command',
            command: this.redisCommand,
            args,
        });
    }

    runRedisExpireMany(): void {
        if (!this.supportsTtl) {
            this.errorMessage = 'TTL updates are not supported for this database.';
            return;
        }
        if (!this.redisExpirePattern) {
            this.errorMessage = 'Pattern is required for TTL update.';
            return;
        }
        const ttl = Number(this.redisExpireTtl);
        if (!Number.isFinite(ttl) || ttl <= 0) {
            this.errorMessage = 'TTL must be a positive number.';
            return;
        }
        const limit = this.redisExpireLimit ? Number(this.redisExpireLimit) : undefined;

        if (!this.confirmDestructive(`Apply TTL ${ttl}s to keys matching "${this.redisExpirePattern}"?`)) {
            return;
        }

        this.executeAction({
            operation: 'expireMany',
            pattern: this.redisExpirePattern,
            ttl,
            ...(Number.isFinite(limit) ? { limit } : {}),
        });
    }

    private confirmDestructive(message: string): boolean {
        return window.confirm(message);
    }
}
