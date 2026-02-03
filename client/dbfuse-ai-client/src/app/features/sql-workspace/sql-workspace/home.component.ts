import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    SimpleChanges,
    ViewChild,
    inject,
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
    DatabaseType,
    MultipleTablesInfo,
    RAGHistoryEntry,
    RAGPromptResponse,
    newTabData,
    openAIEvent,
} from '@core/utils/storage/storage.types';
import { ResultGridComponent } from '@features/sql-editor/components/resultgrid/resultgrid.component';
import { BackendService } from '@core/services/backend/backend.service';
import { DragDropTabDirective } from '@shared/directives/drag-drop.directive';
import { MonacoEditorComponent } from '@app/editor/components/monaco-editor/monaco-editor.component';
import { MonacoThemeService } from '@app/editor/services/monaco-theme.service';
import { getSafeSessionStorage } from '@core/utils/browser-adapter';
import { getDbTypeEntry } from '@core/registry/db-type.registry';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

type AIMeta = {
    queryId?: string;
    strategy?: string;
    explanation?: string | null;
    suggestions?: string[] | null;
} | null;

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        FormsModule,
        ResultGridComponent,
        DragDropTabDirective,
        MonacoEditorComponent,
    ],
    templateUrl: './home.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements OnInit, OnChanges, OnDestroy {
    @Input() tabData!: newTabData;
    @Input() openAIEnabled!: openAIEvent;
    @Input() InitDBInfo!: any;
    @Input() pendingQuery?: { sql: string; dbName?: string; id?: number } | null;
    @ViewChild(ResultGridComponent) resultGrid!: ResultGridComponent;

    tabs: { id: string; dbName: string; tableName: string; displayName: string }[] = [];
    selectedTab = -1;
    tabContent: string[] = [];
    triggerQuery: any = '';
    executeTriggered: boolean = false;
    selectedDB: string = '';
    currentTabId: string = '';
    editingTabIndex: number | null = null;
    maxTabs: number = 20;

    currentPage: number = 1;
    pageSize: number = 6;
    totalRows: number = 0;
    paginatedData: any[] = [];

    currentResultTabs: any[] = [];
    activeResultIndex: number = 0;
    aiMeta: AIMeta = null;
    private aiMetaByTab: Record<string, AIMeta> = {};
    ragHistory: RAGHistoryEntry[] = [];
    ragHistoryLoading = false;
    ragFeedbackStatus = '';

    private darkModeObserver: MutationObserver | null = null;
    Math = Math;
    private databaseType: DatabaseType = sessionStorage.getItem('dbType') as DatabaseType;
    private document = inject(DOCUMENT);
    private draggingIndex: number | null = null;
    // Sequential counter for generic tab names (ytab 1, ytab 2, ...)
    private nextTabNumber: number = 1;

    constructor(
        private readonly cdr: ChangeDetectorRef,
        private readonly dbService: BackendService,
        private readonly monacoTheme: MonacoThemeService,
    ) {}

    ngOnInit() {
        if (this.InitDBInfo) {
            this.initializeData(this.InitDBInfo);
        }
        // Pick up a globally selected database (from Sidebar) if it matches current connection type
        try {
            const persisted = sessionStorage.getItem('selectedDB');
            const persistedType = sessionStorage.getItem('selectedDBType');
            const currentType = sessionStorage.getItem('dbType');
            if (persisted && (!persistedType || !currentType || persistedType === currentType)) {
                this.selectedDB = persisted;
            } else {
                this.selectedDB = '';
            }
        } catch {}
        this.setupDarkModeObserver();
    }

    ngOnDestroy() {
        if (this.darkModeObserver) {
            this.darkModeObserver.disconnect();
        }
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['tabData'] && this.tabData?.dbName && this.tabData?.tableName) {
            this.addTab(this.tabData.dbName, this.tabData.tableName);
        } else if (changes['InitDBInfo'] && changes['InitDBInfo'].currentValue) {
            this.initializeData(changes['InitDBInfo'].currentValue);
        }
        if (changes['openAIEnabled'] && changes['openAIEnabled'].currentValue && this.selectedDB) {
            this.updateDatabaseInfo();
        }
        if (changes['pendingQuery'] && changes['pendingQuery'].currentValue) {
            this.applyPendingQuery(changes['pendingQuery'].currentValue);
        }
    }

    private setupDarkModeObserver() {
        if (typeof window === 'undefined') return;

        const target = this.document.body || this.document.documentElement;
        if (!target) return;

        this.darkModeObserver = new MutationObserver(() => {
            this.syncEditorTheme();
        });

        this.darkModeObserver.observe(target, {
            attributes: true,
            attributeFilter: ['class'],
        });

        this.syncEditorTheme();
    }

    private syncEditorTheme(): void {
        void this.monacoTheme.syncWithDocument();
    }

    get currentDbType(): DatabaseType {
        const stored = getSafeSessionStorage().getItem('dbType') as DatabaseType | null;
        return stored || this.databaseType;
    }

    get isSqlBased(): boolean {
        return getDbTypeEntry(this.currentDbType)?.category === 'sql';
    }

    getTableLabel(): string {
        const entry = getDbTypeEntry(this.currentDbType);
        if (entry?.explorer?.collectionLabel) return entry.explorer.collectionLabel;
        if (entry?.category === 'cache') return 'Key groups';
        if (entry?.category === 'nosql') return 'Collections';
        return 'Tables';
    }

    shouldShowViews(): boolean {
        return this.isSqlBased;
    }

    private getDefaultEditorText(): string {
        if (this.isSqlBased) {
            return '-- Write your SQL here\n';
        }
        const entry = getDbTypeEntry(this.currentDbType);
        if (entry?.explorer?.defaultEditorText) return entry.explorer.defaultEditorText;
        return '-- Write your query here\n';
    }

    trackByResultIndex(index: number, _item: any): number {
        return index;
    }

    onResultsChanged(results: any[]) {
        const safe = Array.isArray(results) ? results : [];
        this.currentResultTabs = safe.map((r, idx) => ({
            ...r,
            displayName: this.getResultTabLabel(r, idx),
        }));

        this.activeResultIndex = Math.min(this.activeResultIndex, this.currentResultTabs.length - 1);
        if (this.activeResultIndex < 0) this.activeResultIndex = 0;

        this.cdr.markForCheck();
    }

    onSelectResultTab(index: number) {
        this.activeResultIndex = index;
        if (this.resultGrid) {
            this.resultGrid.setActiveResultIndex(index);
        }
    }

    onCloseResultTab(index: number) {
        if (this.resultGrid) {
            this.resultGrid.closeResultTab(index);
        }
    }

    trackByTabId(index: number, tab: any): string {
        return tab?.id || index;
    }

    trackByDatabaseName(index: number, database: any): string {
        return database?.name || index;
    }

    updateDatabaseInfo() {
        const selectedDatabase = this.InitDBInfo?.find((db: any) => db.name === this.selectedDB);
        if (selectedDatabase && selectedDatabase.tables?.length) {
            const tableNames = selectedDatabase.tables.map((table: any) => table.name);
            this.dbService.getMultipleTablesInfo(this.selectedDB, tableNames).subscribe({
                next: (tableInfoArray: MultipleTablesInfo) => {
                    tableInfoArray.tables.forEach((tableInfo: any) => {
                        const tableIndex = selectedDatabase.tables.findIndex(
                            (t: any) => t.name === tableInfo.table_name,
                        );
                        if (tableIndex > -1) {
                            selectedDatabase.tables[tableIndex] = {
                                ...selectedDatabase.tables[tableIndex],
                                columns: tableInfo.columns || [],
                                indexes: tableInfo.indexes || [],
                                foreign_keys: tableInfo.foreign_keys || [],
                                triggers: tableInfo.triggers || [],
                            };
                        }
                    });
                    this.cdr.markForCheck();
                },
                error: (error) => {
                    console.error('Error fetching table information for selected database:', error);
                },
            });
        } else {
            console.warn(`No tables found for selected database: ${this.selectedDB}`);
        }
    }

    initializeData(data: any) {
        if (data && Array.isArray(data)) {
            this.totalRows = data.length || 0;
            this.updatePaginatedData();
        } else {
            this.totalRows = 0;
            this.paginatedData = [];
        }
    }

    updatePaginatedData() {
        const start = (this.currentPage - 1) * this.pageSize;
        const end = start + this.pageSize;
        this.paginatedData = (this.InitDBInfo || []).slice(start, end);
    }

    changePage(newPage: number) {
        if (newPage > 0 && newPage <= this.getTotalPages()) {
            this.currentPage = newPage;
            this.updatePaginatedData();
            this.cdr.markForCheck();
        }
    }

    getTotalPages(): number {
        return this.totalRows > 0 && this.pageSize > 0 ? Math.ceil(this.totalRows / this.pageSize) : 1;
    }

    convertToReadableSize(sizeInBytes: any): string {
        sizeInBytes = Number(sizeInBytes);
        if (isNaN(sizeInBytes)) {
            return 'Invalid size';
        }
        const units = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
        let unitIndex = 0;
        while (sizeInBytes >= 1024 && unitIndex < units.length - 1) {
            sizeInBytes /= 1024;
            unitIndex++;
        }
        return `${sizeInBytes.toFixed(2)} ${units[unitIndex]}`;
    }

    // Monaco editor is handled via standalone component

    private generateSelectQuery(dbName: string, tableName: string, dbType: DatabaseType): string {
        switch (dbType) {
            case 'mysql2':
                // MySQL: database.table or just table if database is selected
                return `SELECT * FROM ${dbName}.${tableName};`;

            case 'pg':
                // PostgreSQL: schema.table or just table if schema is selected
                return `SELECT * FROM ${tableName};`;

            case 'sqlite3':
                // SQLite: just table name (no database prefix)
                return `SELECT * FROM ${tableName};`;

            case 'mssql':
                // SQL Server: [database].[schema].[table] or simplified
                return `SELECT * FROM ${dbName}.dbo.${tableName};`;

            case 'oracledb':
                // Oracle: schema.table or just table if schema is selected
                return `SELECT * FROM ${tableName};`;

            case 'mongodb':
                return `-- MongoDB collection: ${tableName}`;

            case 'redis':
                return `-- Redis key group: ${tableName}`;

            default:
                // Fallback to generic SQL
                return `SELECT * FROM ${tableName};`;
        }
    }

    // Helper method to generate database-specific table identifier
    private generateTableIdentifier(dbName: string, tableName: string, dbType: DatabaseType): string {
        switch (dbType) {
            case 'mysql2':
                return `${dbName}.${tableName}`;

            case 'pg':
                return `${dbName}.${tableName}`;

            case 'sqlite3':
                return `${dbName}/${tableName}`; // Use / separator for SQLite file-based DBs

            case 'mssql':
                return `${dbName}.${tableName}`;

            case 'oracledb':
                return `${dbName}.${tableName}`;

            case 'mongodb':
                return `${dbName}.${tableName}`;

            case 'redis':
                return `${dbName}.${tableName}`;

            default:
                return `${dbName}.${tableName}`;
        }
    }

    // Updated addTab method
    addTab(dbName: string, tableName: string) {
        if (this.tabs.length >= this.maxTabs) {
            alert(`Maximum number of tabs (${this.maxTabs}) reached. Please close some tabs.`);
            return;
        }

        // Generate a unique identifier per tab (avoid reusing same tab for same table)
        const baseId = this.generateTableIdentifier(dbName, tableName, this.currentDbType);
        const id = `${baseId}#${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        // Generate generic display name (remove table/db from title)
        const displayName = `Query ${this.nextTabNumber++}`;
        // Prefer the database selected in Sidebar (sessionStorage), then fall back to provided or current,
        // ensuring it matches the current connection type
        let boundDb = dbName || this.selectedDB || '';
        try {
            const persisted = sessionStorage.getItem('selectedDB');
            const persistedType = sessionStorage.getItem('selectedDBType');
            const currentType = sessionStorage.getItem('dbType');
            if (!boundDb && persisted && (!persistedType || !currentType || persistedType === currentType)) {
                boundDb = persisted;
            }
        } catch {}

        // Create and push the new tab entry
        this.tabs.push({ id, dbName: boundDb || dbName, tableName, displayName });

        // Pre-fill editor with a database-specific SELECT query (do not auto-execute)
        const selectQuery = this.generateSelectQuery(boundDb || dbName, tableName, this.currentDbType);
        this.tabContent.push(selectQuery);

        // Select the newly added tab
        this.selectTab(this.tabs.length - 1);

        if (this.openAIEnabled?.openAIEnabled) {
            this.updateDatabaseInfoIfNeeded(boundDb || dbName);
        }

        this.cdr.markForCheck();
    }

    // Create a new blank query tab; if dbName provided, bind to that database
    addNewQueryTab(dbName: string = '') {
        if (this.tabs.length >= this.maxTabs) {
            alert(`Maximum number of tabs (${this.maxTabs}) reached. Please close some tabs.`);
            return;
        }

        const id = `new-query#${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const displayName = `Query ${this.nextTabNumber++}`;
        const initialSql = this.getDefaultEditorText();

        // If no dbName is provided but we have an active selectedDB, use that
        let boundDb = dbName || this.selectedDB || '';
        // If still empty, try sessionStorage (e.g., invoked from overview without tabs)
        if (!boundDb) {
            try {
                boundDb = sessionStorage.getItem('selectedDB') || '';
            } catch {}
        }

        this.tabs.push({ id, dbName: boundDb, tableName: '', displayName });
        this.tabContent.push(initialSql);
        this.selectTab(this.tabs.length - 1);

        // Update component + persist selection for other components
        this.setSelectedDB(boundDb);

        this.cdr.markForCheck();
    }

    // Centralize how we track/persist selected DB
    private setSelectedDB(dbName: string) {
        this.selectedDB = dbName || '';
        try {
            if (this.selectedDB) {
                sessionStorage.setItem('selectedDB', this.selectedDB);
                const currentType = sessionStorage.getItem('dbType') || '';
                if (currentType) sessionStorage.setItem('selectedDBType', currentType);
            } else {
                sessionStorage.removeItem('selectedDB');
                sessionStorage.removeItem('selectedDBType');
            }
        } catch {}
        // Do not call backend here; Sidebar handles server-side switching to avoid duplicates and cross-engine issues
    }

    private updateDatabaseInfoIfNeeded(dbName: string) {
        const selectedDatabase = this.InitDBInfo?.find((db: any) => db.name === dbName);
        if (selectedDatabase) {
            const allTablesPopulated = selectedDatabase.tables.every(
                (table: any) => table.columns && table.columns.length > 0,
            );
            if (!allTablesPopulated) {
                // Refreshing table info as not all columns are populated
                this.updateDatabaseInfo();
            }
        }
    }

    selectTab(tabIndex: number) {
        if (tabIndex < 0 || tabIndex >= this.tabs.length) return;
        if (!this.tabContent[tabIndex]) {
            this.tabContent[tabIndex] = '';
        }
        this.selectedTab = tabIndex;
        this.setSelectedDB(this.tabs[tabIndex].dbName);
        // Do not set triggerQuery on tab switch to avoid auto-execution
        this.triggerQuery = '';
        this.currentTabId = this.tabs[tabIndex].id;
        this.executeTriggered = false;
        this.editingTabIndex = null;
        this.activeResultIndex = 0;
        this.currentResultTabs = [];
        this.aiMeta = this.aiMetaByTab[this.currentTabId] || null;
        if (this.aiMeta) {
            this.refreshRagHistory();
        } else {
            this.ragHistory = [];
        }
        this.cdr.markForCheck();
    }

    onEditorValueChange(value: string) {
        if (this.selectedTab >= 0) {
            this.tabContent[this.selectedTab] = value;
        }
    }

    closeTab(tabIndex: number) {
        if (tabIndex < 0 || tabIndex >= this.tabs.length) return;
        const removedId = this.tabs[tabIndex]?.id;
        this.tabs.splice(tabIndex, 1);
        this.tabContent.splice(tabIndex, 1);
        this.selectedTab = this.tabs.length ? Math.max(0, tabIndex - 1) : -1;
        // If all tabs are closed, reset the tab numbering
        if (this.tabs.length === 0) {
            this.nextTabNumber = 1;
        }
        if (this.selectedTab >= 0) {
            this.setSelectedDB(this.tabs[this.selectedTab]?.dbName || '');
            this.currentTabId = this.tabs[this.selectedTab]?.id || '';
            this.aiMeta = this.aiMetaByTab[this.currentTabId] || null;
        } else {
            this.setSelectedDB('');
            this.currentTabId = '';
            this.aiMeta = null;
        }
        this.triggerQuery = '';
        this.executeTriggered = false;
        this.editingTabIndex = null;
        this.activeResultIndex = 0;
        this.currentResultTabs = [];
        if (removedId) {
            delete this.aiMetaByTab[removedId];
        }
        this.cdr.markForCheck();
    }

    closeAllTabs() {
        this.tabs = [];
        this.tabContent = [];
        this.selectedTab = -1;
        this.setSelectedDB('');
        this.currentTabId = '';
        this.triggerQuery = '';
        this.executeTriggered = false;
        // Reset tab numbering when all tabs are closed
        this.nextTabNumber = 1;
        this.editingTabIndex = null;
        this.activeResultIndex = 0;
        this.currentResultTabs = [];
        this.aiMeta = null;
        this.aiMetaByTab = {};
        this.cdr.markForCheck();
    }

    startEditingTab(tabIndex: number) {
        this.editingTabIndex = tabIndex;
        this.cdr.markForCheck();
    }

    renameTab(tabIndex: number, newName: string) {
        if (tabIndex < 0 || tabIndex >= this.tabs.length || !newName.trim()) return;
        this.tabs[tabIndex].displayName = newName.trim();
        this.editingTabIndex = null;
        this.cdr.markForCheck();
    }

    handleDragStart(index: number) {
        this.draggingIndex = index;
    }

    handleDragOver(event: Event) {
        event.preventDefault();
        (event as DragEvent).dataTransfer!.dropEffect = 'move';
    }

    handleDrop(targetIndex: number, event?: DragEvent) {
        let sourceIndex: number | null = null;
        if (event?.dataTransfer) {
            const data = event.dataTransfer.getData('text/plain');
            if (data) sourceIndex = parseInt(data, 10);
        }
        if (sourceIndex === null && this.draggingIndex !== null) {
            sourceIndex = this.draggingIndex;
        }
        if (sourceIndex === null || isNaN(sourceIndex)) return;
        if (sourceIndex === targetIndex) return;
        const [movedTab] = this.tabs.splice(sourceIndex, 1);
        this.tabs.splice(targetIndex, 0, movedTab);
        const [movedContent] = this.tabContent.splice(sourceIndex, 1);
        this.tabContent.splice(targetIndex, 0, movedContent);
        if (this.selectedTab === sourceIndex) {
            this.selectedTab = targetIndex;
        } else if (sourceIndex < this.selectedTab && targetIndex >= this.selectedTab) {
            this.selectedTab--;
        } else if (sourceIndex > this.selectedTab && targetIndex <= this.selectedTab) {
            this.selectedTab++;
        }
        this.cdr.markForCheck();
    }

    handleDragEnd() {
        this.draggingIndex = null;
    }

    handleExecQueryClick() {
        // Ensure execution targets the most recently selected DB and matching engine
        try {
            const persisted = sessionStorage.getItem('selectedDB');
            const persistedType = sessionStorage.getItem('selectedDBType');
            const currentType = sessionStorage.getItem('dbType');
            if (persisted && (!persistedType || !currentType || persistedType === currentType)) {
                this.selectedDB = persisted;
            } else if (persisted && persistedType && currentType && persistedType !== currentType) {
                this.selectedDB = '';
            }
        } catch {}

        if (!this.isSqlBased) {
            const raw = this.tabContent[this.selectedTab] || '';
            const parsed = this.parseNoSqlQuery(raw);
            if (!parsed) return;
            this.triggerQuery = parsed;
        } else {
            this.triggerQuery = this.tabContent[this.selectedTab] || '';
        }

        // flip the boolean so ngOnChanges in child sees a change every click
        this.executeTriggered = !this.executeTriggered;
        this.cdr.markForCheck();
    }

    private parseNoSqlQuery(raw: string): any | null {
        if (!raw || !raw.trim()) {
            alert('Please provide a JSON query payload before executing.');
            return null;
        }

        const cleaned = raw
            .split('\n')
            .filter((line) => {
                const trimmed = line.trim();
                return !trimmed.startsWith('//') && !trimmed.startsWith('--') && !trimmed.startsWith('#');
            })
            .join('\n')
            .trim();

        try {
            return JSON.parse(cleaned);
        } catch (error) {
            console.error('Failed to parse NoSQL query JSON:', error);
            alert('Invalid JSON. NoSQL queries must be valid JSON payloads.');
            return null;
        }
    }

    // Build a display name for a result (dbname.table or sensible fallback)
    getResultTabLabel(r: any, index: number): string {
        if (r?.displayName && typeof r.displayName === 'string') return r.displayName;

        const db = (r?.dbName || this.selectedDB || '').toString();
        const table = (r?.tableName || this.extractFirstIdentifier(r?.query || '') || '').toString();

        if (db && table) return `${db}.${table}`;
        if (table) return table;
        if (db) return `${db}_Q${index + 1}`;
        return `Query ${index + 1}`;
    }

    // Try to infer the first table-like identifier from a SQL statement
    private extractFirstIdentifier(sql: string): string | null {
        if (!sql) return null;
        // Look after FROM / JOIN / INTO / UPDATE (first hit wins)
        const m = sql.match(/\b(FROM|JOIN|INTO|UPDATE)\s+([`"'[\]]?[\w.]+[`"'[\]]?)/i);
        if (!m || !m[2]) return null;

        // Clean quotes/brackets
        return m[2].replace(/^[`"'[\]]+|[`"'[\]]+$/g, '');
    }

    handleOpenAIPrompt() {
        const entry = getDbTypeEntry(this.currentDbType);
        if (!entry?.supports?.aiQueryGeneration) {
            alert('AI query generation is currently supported for SQL databases only.');
            return;
        }
        // Check if there's an active database connection
        const connectionId = getSafeSessionStorage().getItem('connectionId');
        if (!connectionId) {
            alert('Please connect to a database first before using AI features.');
            return;
        }

        // Verify dbType is set in sessionStorage
        const dbType = getSafeSessionStorage().getItem('dbType');
        if (!dbType) {
            alert('Database type is not set. Please reconnect to your database.');
            return;
        }

        // Ensure we use the most recent DB selected in Sidebar and matching current engine
        try {
            const persisted = sessionStorage.getItem('selectedDB');
            const persistedType = sessionStorage.getItem('selectedDBType');
            const currentType = sessionStorage.getItem('dbType');
            if (persisted && (!persistedType || !currentType || persistedType === currentType)) {
                this.selectedDB = persisted;
            }
        } catch {}

        if (!this.selectedDB) {
            alert('Please select a database before using AI features.');
            return;
        }

        const promptText = this.tabContent[this.selectedTab];
        const request$ = this.dbService.executeRAGPrompt(this.selectedDB, promptText, {
            includeExplanation: true,
            includeSuggestions: true,
        });

        request$
            .pipe(
                catchError((error) => {
                    return this.handlePromptError(error);
                }),
            )
            .subscribe((data) => {
                if (!data || this.selectedTab < 0) return;
                this.applyRagResponse(data);
            });
    }

    private getAIErrorMessage(error: any): string {
        const fallback = 'Failed to generate SQL query. Please try again.';
        if (!error) return fallback;
        if (typeof error === 'string') return error;
        const body = error.error;
        if (typeof body === 'string') return body;
        if (body && typeof body.error === 'string') return body.error;
        if (body && typeof body.message === 'string') return body.message;
        if (typeof error.message === 'string') return error.message;
        return fallback;
    }

    private applyRagResponse(data: RAGPromptResponse) {
        this.tabContent[this.selectedTab] = data.query;
        const tabId = this.tabs[this.selectedTab]?.id || '';
        const meta = {
            queryId: data.queryId,
            strategy: data.strategy,
            explanation: data.explanation ?? null,
            suggestions: data.suggestions ?? null,
        };
        if (tabId) {
            this.aiMetaByTab[tabId] = meta;
            this.aiMeta = meta;
        } else {
            this.aiMeta = meta;
        }
        this.cdr.markForCheck();
        this.refreshRagHistory();
    }

    private handlePromptError(error: any) {
        console.error('AI prompt error:', error);
        alert(this.getAIErrorMessage(error));
        return of({ query: this.tabContent[this.selectedTab] || '' });
    }

    applySuggestion(suggestion: string) {
        if (this.selectedTab < 0) return;
        this.tabContent[this.selectedTab] = suggestion;
        this.cdr.markForCheck();
    }

    private applyPendingQuery(pending: { sql: string; dbName?: string } | null) {
        if (!pending?.sql) return;
        const targetDb = pending.dbName || this.selectedDB || '';
        this.addNewQueryTab(targetDb);
        if (this.selectedTab >= 0) {
            this.tabContent[this.selectedTab] = pending.sql;
        }
        this.cdr.markForCheck();
    }

    refreshRagHistory(limit: number = 5) {
        this.ragHistoryLoading = true;
        this.dbService.getRAGHistory(limit).subscribe({
            next: (resp) => {
                this.ragHistory = Array.isArray(resp?.history) ? resp.history : [];
                this.ragFeedbackStatus = '';
                this.ragHistoryLoading = false;
                this.cdr.markForCheck();
            },
            error: () => {
                this.ragHistoryLoading = false;
                this.cdr.markForCheck();
            },
        });
    }

    sendRagFeedback(feedback: 'positive' | 'negative', comments: string = '') {
        if (!this.aiMeta?.queryId) {
            alert('No AI query to provide feedback for.');
            return;
        }
        this.ragFeedbackStatus = 'Sending feedback...';
        this.dbService
            .submitRAGFeedback({
                queryId: this.aiMeta.queryId,
                feedback,
                comments,
            })
            .subscribe({
                next: () => {
                    this.ragFeedbackStatus = 'Feedback recorded. Thank you!';
                    this.refreshRagHistory();
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.ragFeedbackStatus = 'Failed to send feedback.';
                    this.cdr.markForCheck();
                },
            });
    }

    onDiscQueryClick() {
        if (this.selectedTab >= 0) {
            this.tabContent[this.selectedTab] = '';
        }
        this.triggerQuery = '';
        this.executeTriggered = false;
        this.cdr.markForCheck();
    }
}
