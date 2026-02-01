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
    selector: 'app-memcached-explorer',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './memcached-explorer.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemcachedExplorerComponent extends NosqlExplorerBase implements OnInit, OnChanges {
    @Input() override dbType: DatabaseType = 'memcached';
    @Input() override databases: DatabaseStats[] | null = null;

    memKey = '';
    memValue = '';
    memTtl = '';
    memDeleteKey = '';
    memMultiKeys = '';

    constructor(backend: BackendService, cdr: ChangeDetectorRef) {
        super(backend, cdr);
    }

    ngOnInit(): void {
        this.initExplorer();
    }

    ngOnChanges(changes: SimpleChanges): void {
        this.handleChanges(changes);
    }

    runMemcachedGet(): void {
        if (!this.memKey) {
            this.errorMessage = 'Key is required.';
            return;
        }
        this.executeAction({
            operation: 'get',
            key: this.memKey,
        });
    }

    runMemcachedSet(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        if (!this.memKey) {
            this.errorMessage = 'Key is required.';
            return;
        }
        const ttl = this.parseNumber(this.memTtl);
        this.executeAction({
            operation: 'set',
            key: this.memKey,
            value: this.memValue ?? '',
            ...(ttl !== undefined ? { ttl } : {}),
        });
    }

    runMemcachedDelete(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Deletes are not supported for this database.';
            return;
        }
        if (!this.memDeleteKey) {
            this.errorMessage = 'Key is required.';
            return;
        }
        if (!window.confirm(`Delete key ${this.memDeleteKey}? This cannot be undone.`)) {
            return;
        }
        this.executeAction({
            operation: 'delete',
            key: this.memDeleteKey,
        });
    }

    runMemcachedMultiGet(): void {
        const keys = this.parseKeys(this.memMultiKeys);
        if (!keys.length) {
            this.errorMessage = 'Provide at least one key.';
            return;
        }
        this.executeAction({
            operation: 'mget',
            keys,
        });
    }

    runMemcachedStats(): void {
        if (!this.supportsCommands) {
            this.errorMessage = 'Stats are not supported for this database.';
            return;
        }
        this.executeAction({
            operation: 'stats',
        });
    }

    runMemcachedFlush(): void {
        if (!this.supportsCommands) {
            this.errorMessage = 'Flush is not supported for this database.';
            return;
        }
        if (!window.confirm('Flush all keys? This cannot be undone.')) {
            return;
        }
        this.executeAction({
            operation: 'flush',
        });
    }

    private parseNumber(value: string): number | undefined {
        if (!value) return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    private parseKeys(raw: string): string[] {
        if (!raw) return [];
        return raw
            .split(/[,\s]+/)
            .map((key) => key.trim())
            .filter(Boolean);
    }
}
