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
    selector: 'app-redis-explorer',
    standalone: true,
    imports: [CommonModule, FormsModule, VirtualListComponent],
    templateUrl: './redis-explorer.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RedisExplorerComponent extends NosqlExplorerBase implements OnInit, OnChanges {
    @Input() override dbType: DatabaseType = 'redis';
    @Input() override databases: DatabaseStats[] | null = null;

    keyFilterText = '';
    selectedKey: any | null = null;
    redisKey = '';
    redisValue = '';
    redisTtl = '';
    redisDeleteKey = '';
    redisCommand = '';
    redisCommandArgs = '';
    redisExpirePattern = '';
    redisExpireTtl = '';
    redisExpireLimit = '';
    expandedKeyspace = '';
    showAddKeyspace = false;
    showAddGroup = false;
    showSetPanel = false;
    showDeletePanel = false;
    showTtlPanel = false;
    newKeyspaceName = '';
    newKeyGroupName = '';
    newKeyGroupValue = '';
    showEditModal = false;
    editKeyName = '';
    editKeyType = '';
    editValue = '';
    editTtl = '';
    editLoading = false;
    editError = '';
    readonly redisKeyItemSize = 132;
    readonly trackByRedisKey = (_index: number, entry: { key?: string } | null): string | number =>
        entry?.key ?? _index;
    readonly trackByTreeItem = (_index: number, item: { type?: string; name?: string } | null): string | number =>
        `${item?.type || 'item'}:${item?.name ?? _index}`;

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

    getKeyCount(db: any): number {
        if (!db) return 0;
        const keyCount = (db as any)?.keyCount;
        if (Number.isFinite(Number(keyCount))) {
            return Number(keyCount);
        }
        const tables = Array.isArray(db?.tables) ? db.tables : [];
        return tables.length;
    }

    get redisTreeItems(): { type: string; name: string; count?: number; expanded?: boolean }[] {
        const items: { type: string; name: string; count?: number; expanded?: boolean }[] = [];
        const databases = Array.isArray(this.availableDatabases) ? this.availableDatabases : [];

        for (const db of databases) {
            const name = db?.name ? String(db.name) : '';
            if (!name) continue;
            const expanded = this.expandedKeyspace === name;
            items.push({
                type: 'db',
                name,
                count: this.getKeyCount(db),
                expanded,
            });

            if (expanded) {
                if (this.loadingCollections && this.selectedDatabase === name) {
                    items.push({ type: 'loading', name: 'Loading key groups...' });
                } else if (this.selectedDatabase === name) {
                    const groups = Array.isArray(this.filteredCollections) ? this.filteredCollections : [];
                    if (groups.length === 0) {
                        items.push({ type: 'empty', name: 'No key groups found.' });
                    } else {
                        groups.forEach((group) => {
                            items.push({ type: 'group', name: group });
                        });
                    }
                }
            }
        }

        if (items.length === 0) {
            return [{ type: 'empty', name: 'No keyspaces found.' }];
        }

        return items;
    }

    get filteredSampleKeys(): any[] {
        const keys = Array.isArray(this.collectionInfo?.sampleKeys) ? this.collectionInfo?.sampleKeys : [];
        const search = this.keyFilterText.trim().toLowerCase();
        if (!search) return keys;
        return keys.filter((entry: any) =>
            String(entry?.key || '')
                .toLowerCase()
                .includes(search),
        );
    }

    get activeRedisKey(): any | null {
        const keys = this.filteredSampleKeys;
        if (keys.length === 0) return null;
        if (this.selectedKey && keys.some((entry: any) => entry?.key === this.selectedKey?.key)) {
            return this.selectedKey;
        }
        return keys[0];
    }

    selectKey(key: any): void {
        this.selectedKey = key;
    }

    openEditModal(key: any): void {
        if (!key) return;
        this.selectKey(key);
        this.showEditModal = true;
        this.editError = '';
        this.editKeyName = String(key?.key ?? '');
        this.editKeyType = String(key?.type || 'unknown');
        this.editValue = key?.valuePreview ?? '';
        this.editTtl = key?.ttl !== null && key?.ttl !== undefined ? String(key.ttl) : '';

        if (this.editKeyType === 'string' && this.editKeyName) {
            this.editLoading = true;
            this.backend
                .executeQuery(
                    {
                        operation: 'get',
                        key: this.editKeyName,
                    },
                    this.selectedDatabase,
                )
                .subscribe({
                    next: (result: any) => {
                        this.editLoading = false;
                        if (result && 'value' in result) {
                            this.editValue = result.value ?? '';
                        }
                        this.cdr.markForCheck();
                    },
                    error: () => {
                        this.editLoading = false;
                        this.cdr.markForCheck();
                    },
                });
        }
    }

    closeEditModal(): void {
        this.showEditModal = false;
        this.editError = '';
        this.editKeyName = '';
        this.editKeyType = '';
        this.editValue = '';
        this.editTtl = '';
        this.editLoading = false;
    }

    saveEditModal(): void {
        if (!this.supportsCrud) {
            this.editError = 'Writes are not supported for this database.';
            return;
        }
        if (!this.editKeyName) {
            this.editError = 'Key is required.';
            return;
        }
        if (this.editKeyType !== 'string' && this.editKeyType !== 'unknown') {
            this.editError = 'Editing is supported only for string keys. Use the command bar for other types.';
            return;
        }
        const ttlValue = this.editTtl ? Number(this.editTtl) : undefined;
        this.editLoading = true;
        this.editError = '';
        this.backend
            .executeQuery(
                {
                    operation: 'set',
                    key: this.editKeyName,
                    value: this.editValue ?? '',
                    ...(Number.isFinite(ttlValue) ? { ttl: ttlValue } : {}),
                },
                this.selectedDatabase,
            )
            .subscribe({
                next: () => {
                    this.editLoading = false;
                    this.showEditModal = false;
                    this.loadCollections(this.selectedDatabase, {
                        preserveSelection: true,
                        preserveMessage: true,
                    });
                    this.cdr.markForCheck();
                },
                error: (error) => {
                    this.editLoading = false;
                    this.editError = error?.error || error?.message || 'Failed to update key.';
                    this.cdr.markForCheck();
                },
            });
    }

    override selectDatabase(dbName: string): void {
        this.selectedKey = null;
        this.keyFilterText = '';
        this.expandedKeyspace = dbName;
        super.selectDatabase(dbName);
    }

    override selectCollection(name: string): void {
        this.selectedKey = null;
        super.selectCollection(name);
    }

    toggleKeyspaceNode(name: string): void {
        if (!name) return;
        if (this.selectedDatabase !== name) {
            this.selectDatabase(name);
            this.expandedKeyspace = name;
            return;
        }
        this.expandedKeyspace = this.expandedKeyspace === name ? '' : name;
    }

    toggleAddKeyspace(): void {
        this.showAddKeyspace = !this.showAddKeyspace;
        if (this.showAddKeyspace) {
            this.showAddGroup = false;
        }
    }

    toggleAddGroup(): void {
        this.showAddGroup = !this.showAddGroup;
        if (this.showAddGroup) {
            this.showAddKeyspace = false;
        }
    }

    createKeyspace(): void {
        const raw = this.newKeyspaceName.trim();
        if (!raw) {
            this.errorMessage = 'Keyspace name is required.';
            return;
        }
        const numericRaw = raw.startsWith('db') ? raw.slice(2) : raw;
        const numeric = Number.isFinite(Number(numericRaw)) ? Number(numericRaw) : NaN;
        if (!Number.isFinite(numeric) || numeric < 0) {
            this.errorMessage = 'Use a numeric keyspace index (e.g. 0 or db0).';
            return;
        }
        const normalized = `db${numeric}`;
        this.newKeyspaceName = '';
        this.showAddKeyspace = false;
        this.expandedKeyspace = normalized;
        this.selectDatabase(normalized);

        if (!this.supportsCrud) {
            return;
        }

        this.actionLoading = true;
        this.errorMessage = '';
        this.actionMessage = '';
        this.actionResult = null;
        this.backend
            .executeQuery(
                {
                    operation: 'set',
                    key: '__db_seed__',
                    value: '1',
                },
                normalized,
            )
            .subscribe({
                next: (result) => {
                    this.actionLoading = false;
                    this.actionResult = result;
                    this.actionMessage = 'Keyspace initialized.';
                    this.refreshDatabases();
                    this.loadCollections(normalized, {
                        preserveSelection: true,
                        preserveMessage: true,
                    });
                    this.cdr.markForCheck();
                },
                error: (error) => {
                    this.actionLoading = false;
                    this.errorMessage = error?.error || error?.message || 'Failed to initialize keyspace.';
                    this.cdr.markForCheck();
                },
            });
    }

    createKeyGroup(): void {
        if (!this.supportsCrud) {
            this.errorMessage = 'Writes are not supported for this database.';
            return;
        }
        if (!this.selectedDatabase) {
            this.errorMessage = 'Select a keyspace first.';
            return;
        }
        const group = this.newKeyGroupName.trim();
        if (!group) {
            this.errorMessage = 'Key group name is required.';
            return;
        }
        const seedKey = `${group}:__seed`;
        const seedValue = this.newKeyGroupValue || '';
        this.actionLoading = true;
        this.errorMessage = '';
        this.actionMessage = '';
        this.actionResult = null;
        this.backend
            .executeQuery(
                {
                    operation: 'set',
                    key: seedKey,
                    value: seedValue,
                },
                this.selectedDatabase,
            )
            .subscribe({
                next: (result) => {
                    this.actionLoading = false;
                    this.actionResult = result;
                    this.actionMessage = 'Key group created.';
                    this.loadCollections(this.selectedDatabase, {
                        preserveSelection: true,
                        preserveMessage: true,
                    });
                    this.cdr.markForCheck();
                },
                error: (error) => {
                    this.actionLoading = false;
                    this.errorMessage = error?.error || error?.message || 'Failed to create key group.';
                    this.cdr.markForCheck();
                },
            });
        this.newKeyGroupName = '';
        this.newKeyGroupValue = '';
        this.showAddGroup = false;
    }

    toggleSetPanel(): void {
        this.showSetPanel = !this.showSetPanel;
    }

    toggleDeletePanel(): void {
        this.showDeletePanel = !this.showDeletePanel;
    }

    toggleTtlPanel(): void {
        this.showTtlPanel = !this.showTtlPanel;
    }

    clearRedisCommand(): void {
        this.redisCommand = '';
        this.redisCommandArgs = '';
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

    async runRedisDelete(): Promise<void> {
        if (!this.supportsCrud) {
            this.errorMessage = 'Deletes are not supported for this database.';
            return;
        }
        if (!this.redisDeleteKey) {
            this.errorMessage = 'Redis key is required.';
            return;
        }
        const confirmed = await this.confirmDestructive(`Delete key "${this.redisDeleteKey}"? This cannot be undone.`, {
            title: 'Confirm delete',
            confirmLabel: 'Delete',
        });
        if (!confirmed) {
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

    async runRedisExpireMany(): Promise<void> {
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

        const confirmed = await this.confirmDestructive(
            `Apply TTL ${ttl}s to keys matching "${this.redisExpirePattern}"?`,
            {
                title: 'Confirm TTL update',
                confirmLabel: 'Apply',
            },
        );
        if (!confirmed) {
            return;
        }

        this.executeAction({
            operation: 'expireMany',
            pattern: this.redisExpirePattern,
            ttl,
            ...(Number.isFinite(limit) ? { limit } : {}),
        });
    }
}
