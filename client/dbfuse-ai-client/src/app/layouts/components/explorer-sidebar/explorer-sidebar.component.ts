import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    EventEmitter,
    inject,
    OnInit,
    Output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { BackendService } from '@core/services/backend/backend.service';
import { DatabaseType, newTabData, TableInfo } from '@core/utils/storage/storage.types';
import { getSafeSessionStorage } from '@core/utils/browser-adapter';

@Component({
    selector: 'app-sidebar',
    standalone: true,
    imports: [CommonModule, RouterModule, HttpClientModule, FormsModule],
    templateUrl: './sidebar.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideBarComponent implements OnInit {
    private readonly _router = inject(Router);
    private readonly _cdr = inject(ChangeDetectorRef);

    @Output() newTabEmitter = new EventEmitter<newTabData>();
    @Output() initDBInfoEmitter = new EventEmitter<any>();
    @Output() databaseSelected = new EventEmitter<string>(); // New output for database selection

    databases: any = {};
    filteredDatabases: any = [];
    filterText: string = '';
    isLoading: boolean = false;
    isRefreshing: boolean = false;
    openSections: { [key: string]: boolean } = {};
    selectedDatabase: string | null = null; // Track selected database
    readonly sqlDbTypes = new Set<DatabaseType>(['mysql2', 'pg', 'sqlite3', 'mssql', 'oracledb']);
    readonly documentDbTypes = new Set<DatabaseType>(['mongodb', 'couchdb', 'cosmosdb', 'firestore']);
    readonly keyValueDbTypes = new Set<DatabaseType>(['redis', 'memcached']);

    constructor(private dbService: BackendService) {}

    ngOnInit(): void {
        this.getDatabases();
    }

    // TrackBy functions for performance
    trackByDatabaseName(index: number, database: any): string {
        return database?.name || index;
    }

    trackByTableName(index: number, table: any): string {
        return table?.name || index;
    }

    refresh() {
        this.isRefreshing = true;
        this.openSections = {};
        this.selectedDatabase = null; // Reset selection on refresh
        try {
            const storage = getSafeSessionStorage();
            storage.removeItem('selectedDB');
            storage.removeItem('selectedDBType');
        } catch {}
        this.getDatabases();
        this._cdr.markForCheck();
    }

    get currentDbType(): DatabaseType {
        return (getSafeSessionStorage().getItem('dbType') as DatabaseType) || 'mysql2';
    }

    get isSqlBased(): boolean {
        return this.sqlDbTypes.has(this.currentDbType);
    }

    get tablesLabel(): string {
        if (this.keyValueDbTypes.has(this.currentDbType)) return 'Key groups';
        if (this.documentDbTypes.has(this.currentDbType)) return 'Collections';
        return 'Tables';
    }

    get columnsLabel(): string {
        if (this.keyValueDbTypes.has(this.currentDbType)) return 'Keys';
        if (this.documentDbTypes.has(this.currentDbType)) return 'Fields';
        if (this.currentDbType === 'dynamodb') return 'Attributes';
        return 'Columns';
    }

    getDatabases() {
        this.isLoading = true;
        this._cdr.markForCheck();

        this.dbService.getDatabases().subscribe({
            next: (data) => {
                this.databases = data;
                this.filteredDatabases = data['databases'] || [];
                // Databases loaded
                this.initDBInfoEmitter.emit(this.filteredDatabases);
                this._cdr.markForCheck();
            },
            error: (error) => {
                console.error('Error fetching databases', error);
                this.filteredDatabases = [];
                this._cdr.markForCheck();
            },
            complete: () => {
                this.isLoading = false;
                this.isRefreshing = false;
                this._cdr.markForCheck();
            },
        });
    }

    filterDatabases() {
        const filter = this.filterText.toLowerCase().trim();

        if (!filter) {
            this.filteredDatabases = [...(this.databases['databases'] || [])];
            this.openSections = {};
            this._cdr.markForCheck();
            return;
        }

        this.filteredDatabases = (this.databases.databases || [])
            .map((db: any) => {
                const filteredTables = (db.tables || []).filter((table: any) =>
                    table.name.toLowerCase().includes(filter),
                );

                const filteredViews = (db.views || []).filter((view: any) => view.name.toLowerCase().includes(filter));

                if (db.name.toLowerCase().includes(filter) || filteredTables.length || filteredViews.length) {
                    return {
                        ...db,
                        tables: filteredTables,
                        views: filteredViews,
                    };
                }
                return null;
            })
            .filter((db: any) => db !== null);

        this._cdr.markForCheck();
    }

    // New method to handle database selection
    selectDatabase(databaseName: string): void {
        // Toggle selection if clicking the same database
        if (this.selectedDatabase === databaseName) {
            this.toggleSection(databaseName);
        } else {
            this.selectedDatabase = databaseName;
            this.toggleSection(databaseName);
            this.databaseSelected.emit(databaseName);
            // Persist selected database and its type; inform backend
            try {
                const storage = getSafeSessionStorage();
                if (this.selectedDatabase) {
                    storage.setItem('selectedDB', this.selectedDatabase);
                    const dbType = storage.getItem('dbType') || '';
                    if (dbType) storage.setItem('selectedDBType', dbType);
                }
            } catch {}
            if (this.selectedDatabase && this.isSqlBased) {
                this.dbService.switchDatabase(this.selectedDatabase).subscribe({
                    next: () => {},
                    error: () => {},
                });
            }
        }
        this._cdr.markForCheck();
    }

    // Method to get CSS classes for database items
    getDatabaseClasses(databaseName: string): string {
        const baseClasses = 'px-3 py-1 rounded-md transition-colors duration-150 hover:bg-muted';
        if (this.selectedDatabase === databaseName) {
            return `${baseClasses} bg-muted border border-border`;
        }
        return baseClasses;
    }

    toggleSection(section: string): void {
        this.openSections[section] = !this.openSections[section];
        this._cdr.markForCheck();
    }

    getTableInfo(section: string): void {
        const [dbName, tableName] = section.split('_table_');

        const database = this.filteredDatabases?.find((db: any) => db.name === dbName);

        if (database) {
            const tableIndex = database.tables?.findIndex((t: any) => t.name === tableName);

            if (tableIndex > -1) {
                // Check if table info is already loaded
                const table = database.tables[tableIndex];
                if (!table.columns || table.columns.length === 0) {
                    this.dbService.getTableInfo(dbName, tableName).subscribe({
                        next: (data: TableInfo) => {
                            database.tables = [...database.tables];
                            database.tables[tableIndex] = {
                                ...database.tables[tableIndex],
                                columns: data.columns || [],
                                indexes: data.indexes || [],
                                foreign_keys: data.foreign_keys || [],
                                triggers: data.triggers || [],
                            };
                            this._cdr.markForCheck();
                        },
                        error: (error) => {
                            console.error('Error fetching table information:', error);
                        },
                    });
                }
            } else {
                console.warn(`Table ${tableName} not found in database ${dbName}`);
            }
        } else {
            console.warn(`Database ${dbName} not found`);
        }

        this.toggleSection(section);
    }

    isOpen(section: string): boolean {
        return !!this.openSections[section];
    }

    openNewTab(dbName: string, tableName: string) {
        if (!this.isSqlBased) return;
        // Ensure we have a valid database context
        let effectiveDb = dbName || this.selectedDatabase || '';
        if (!effectiveDb) {
            try {
                effectiveDb = getSafeSessionStorage().getItem('selectedDB') || '';
            } catch {}
        }

        // Persist selection for other components and future actions
        try {
            const storage = getSafeSessionStorage();
            if (effectiveDb) {
                storage.setItem('selectedDB', effectiveDb);
                const dbType = storage.getItem('dbType') || '';
                if (dbType) storage.setItem('selectedDBType', dbType);
            }
        } catch {}

        // Optionally switch backend context if the user opened directly from a table without hitting the DB header first
        if (effectiveDb && this.selectedDatabase !== effectiveDb && this.isSqlBased) {
            this.dbService.switchDatabase(effectiveDb).subscribe({
                next: () => {},
                error: () => {},
            });
        }

        this.newTabEmitter.emit({ dbName: effectiveDb, tableName: tableName });
    }

    // Helper method to check if a database is selected
    isDatabaseSelected(databaseName: string): boolean {
        return this.selectedDatabase === databaseName;
    }

    // Method to programmatically select a database (useful for external control)
    setSelectedDatabase(databaseName: string | null): void {
        this.selectedDatabase = databaseName;
        if (databaseName) {
            this.databaseSelected.emit(databaseName);
        }
        this._cdr.markForCheck();
    }

    // Get the currently selected database
    getSelectedDatabase(): string | null {
        return this.selectedDatabase;
    }
}
