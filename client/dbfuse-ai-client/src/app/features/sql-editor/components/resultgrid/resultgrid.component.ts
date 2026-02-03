import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    Input,
    Output,
    EventEmitter,
    SimpleChanges,
    OnInit,
    inject,
    ViewChild,
    ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { CollectionViewer, DataSource } from '@angular/cdk/collections';
import { BackendService } from '@core/services/backend/backend.service';
import { TruncatePipe } from '@shared/pipes/truncate.pipe';
import { firstValueFrom, BehaviorSubject, Observable, Subscription } from 'rxjs';
import { getSafeSessionStorage } from '@core/utils/browser-adapter';
import type { DbMultiQueryResponse, DbQueryResponse } from '@core/services/db-api/db-api.types';

@Component({
    selector: 'app-resultgrid',
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, TruncatePipe, ScrollingModule],
    templateUrl: './resultgrid.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultGridComponent implements OnInit {
    private readonly _dbService = inject(BackendService);
    private readonly _cdr = inject(ChangeDetectorRef);
    private readonly _http = inject(HttpClient);

    @ViewChild('headerScroll', { read: ElementRef }) headerScroll?: ElementRef;
    @ViewChild('bodyScroll', { read: CdkVirtualScrollViewport }) bodyScroll?: CdkVirtualScrollViewport;

    @Input() triggerQuery: any = '';
    @Input() executeTriggered: boolean = false;
    @Input() externalResult: any = null;
    @Input() dbName: string = '';
    @Input() tabId: string = '';
    @Output() resultsChanged = new EventEmitter<any[]>();

    // Virtual scrolling
    dataSource: VirtualDataSource | null = null;
    displayedColumns: string[] = [];
    isVirtualScrollLoading = false;
    private isAppendingPage = false;

    get connectionId(): string {
        return getSafeSessionStorage().getItem('connectionId') || '';
    }

    // Removed heavy per-tab caching; keep minimal state only
    headers: string[] = [];
    rows: any[] = [];
    isLoading: boolean = false;
    copiedCell: string | null = null;
    errorMessage: string | null = null;
    copiedPosition = { left: 0, top: 0 };

    currentPage: number = 1;
    pageSize: number = 50; // default
    pageSizeOptions: number[] = [10, 25, 50, 100, 200, 500];
    totalRows: number = 0;
    totalPages: number = 1;
    // Per-result tab scroll offsets within the same query tab
    private resultScrollOffsets: Record<number, number> = {};
    private readonly maxStandardRows = 2000;
    private readonly standardRowHeight = 40;

    queryResults: any[] = []; // data.queries[]
    activeQueryIndex: number = 0;
    showExportModal: boolean = false;
    exportScope: 'current' | 'all' = 'current';
    exportFormat: 'csv' | 'json' = 'csv';

    // Convenience getter for template access
    get activeResult(): any | null {
        if (this.queryResults && this.queryResults.length > 0) {
            return this.queryResults[this.activeQueryIndex] || null;
        }
        return null;
    }

    // Unified getter for the virtual scroll viewport
    // Returns either the VirtualDataSource (for single queries) or the rows array (for standard queries)
    get virtualData(): any {
        return this.dataSource || this.rows;
    }

    ngOnInit(): void {
        // Initialize component
    }

    ngOnChanges(changes: SimpleChanges): void {
        // Only execute when the explicit executeTriggered flag toggles
        if (changes['executeTriggered']) {
            const prev = changes['executeTriggered'].previousValue;
            const curr = changes['executeTriggered'].currentValue;
            const hasQuery =
                (typeof this.triggerQuery === 'string' && this.triggerQuery.trim() !== '') ||
                (this.triggerQuery && typeof this.triggerQuery === 'object');
            if (prev !== curr && hasQuery) {
                this.currentPage = 1;
                this.executeQuery();
            }
        }

        // If parent provided an external result (e.g., Chat), apply it immediately
        if (changes['externalResult'] && this.externalResult) {
            this.queryResults = [this.externalResult];
            this.activeQueryIndex = 0;
            this.applyActiveQueryData();
            this._cdr.markForCheck();
        }

        // Keep pagination state reset if dbName/tabId changes, but do not auto-execute
        if (changes['dbName'] || changes['tabId']) {
            const prevTabId = changes['tabId']?.previousValue;
            const newTabId = changes['tabId']?.currentValue;

            // Save state for the previous tab if it existed
            if (prevTabId) {
                this.saveState(prevTabId);
            }

            // Restore state for the new tab if cached, otherwise reset
            if (newTabId && this.resultCache.has(newTabId)) {
                this.restoreState(newTabId);
            } else {
                // Reset local state on tab switch (new tab or no cache)
                this.resetState();
            }
            this._cdr.markForCheck();
        }
    }

    private isMultiQueryResponse(
        response: DbQueryResponse | DbMultiQueryResponse | null | undefined,
    ): response is DbMultiQueryResponse {
        return Boolean(response && Array.isArray((response as DbMultiQueryResponse).queries));
    }

    private extractQueryResults(
        response: DbQueryResponse | DbMultiQueryResponse | null | undefined,
    ): DbQueryResponse[] {
        if (!response) {
            return [];
        }

        if (this.isMultiQueryResponse(response)) {
            return (response as DbMultiQueryResponse).queries;
        }

        return [response];
    }

    // State Management Helpers
    private resultCache = new Map<
        string,
        {
            queryResults: any[];
            rows: any[];
            headers: string[];
            dataSource: VirtualDataSource | null;
            displayedColumns: string[];
            activeQueryIndex: number;
            totalRows: number;
            totalPages: number;
            currentPage: number;
            pageSize: number;
            errorMessage: string | null;
            isLoading: boolean;
            isVirtualScrollLoading: boolean;
            scrollOffset: number | null;
            resultScrollOffsets: Record<number, number>;
        }
    >();

    private saveState(tabId: string) {
        if (!tabId) return;
        this.resultCache.set(tabId, {
            queryResults: this.queryResults,
            rows: this.rows,
            headers: this.headers,
            dataSource: this.dataSource,
            displayedColumns: this.displayedColumns,
            activeQueryIndex: this.activeQueryIndex,
            totalRows: this.totalRows,
            totalPages: this.totalPages,
            currentPage: this.currentPage,
            pageSize: this.pageSize,
            errorMessage: this.errorMessage,
            isLoading: this.isLoading,
            isVirtualScrollLoading: this.isVirtualScrollLoading,
            scrollOffset: this.getScrollOffset(),
            resultScrollOffsets: { ...this.resultScrollOffsets },
        });
    }

    private restoreState(tabId: string) {
        if (!tabId) return;
        const state = this.resultCache.get(tabId);
        if (state) {
            this.queryResults = state.queryResults;
            this.rows = state.rows;
            this.headers = state.headers;
            this.dataSource = state.dataSource;
            this.displayedColumns = state.displayedColumns;
            this.activeQueryIndex = state.activeQueryIndex;
            this.totalRows = state.totalRows;
            this.totalPages = state.totalPages;
            this.currentPage = state.currentPage;
            this.pageSize = state.pageSize || this.pageSize;
            this.errorMessage = state.errorMessage;
            this.isLoading = state.isLoading;
            this.isVirtualScrollLoading = state.isVirtualScrollLoading;
            this.resultScrollOffsets = { ...(state.resultScrollOffsets || {}) };

            // Emit restored results so parent tabs update
            this.resultsChanged.emit(this.queryResults);
            this._cdr.markForCheck();
            // Restore per-result scroll if available, else fallback to cached tab scroll
            const perResultOffset = this.resultScrollOffsets[this.activeQueryIndex];
            if (perResultOffset !== undefined) {
                this.restoreScrollOffset(perResultOffset);
            } else {
                this.restoreScrollOffset(state.scrollOffset);
            }
        }
    }

    private resetState() {
        this.currentPage = 1;
        this.headers = [];
        this.rows = [];
        this.queryResults = [];
        // CRITICAL: Clear dataSource to prevent old virtual scroll results from appearing
        this.dataSource = null;
        this.displayedColumns = [];
        this.activeQueryIndex = 0;
        this.totalRows = 0;
        this.totalPages = 1;
        this.errorMessage = null;
        this.isLoading = false;
        this.isVirtualScrollLoading = false;
        this.resultScrollOffsets = {};

        // Emit empty results for new/cleared tab
        this.resultsChanged.emit([]);
    }

    // Helper to safely update a background tab's cache
    private updateCachedState(tabId: string, partialState: any) {
        if (!tabId) return;
        const existing = this.resultCache.get(tabId) || {};

        // Complex merge for Standard queries to satisfy 'rows' etc
        if (partialState.queryResults && !partialState.dataSource && partialState.queryResults.length > 0) {
            const firstRes = partialState.queryResults[0];
            // If standard, we need to extract rows/headers to be cache-compliant
            partialState.rows = firstRes.rows || [];
            partialState.headers = partialState.rows.length > 0 ? Object.keys(partialState.rows[0]) : [];
            partialState.displayedColumns = partialState.headers;
            partialState.activeQueryIndex = 0;
        }

        this.resultCache.set(tabId, { ...existing, ...partialState });
    }

    private getScrollOffset(): number | null {
        if (!this.bodyScroll) return null;
        return this.bodyScroll.measureScrollOffset('top');
    }

    private restoreScrollOffset(offset: number | null): void {
        if (offset === null || offset === undefined) return;
        // Defer until the viewport is ready with the restored data
        setTimeout(() => {
            this.bodyScroll?.scrollToOffset(offset);
        }, 0);
    }

    public clearTabCache(tabId: string): void {
        if (!tabId) return;
        this.resultCache.delete(tabId);
    }

    public clearAllCache(): void {
        this.resultCache.clear();
    }

    // TrackBy functions for performance
    trackByHeader(index: number, header: string): string {
        return header;
    }

    trackByRow(index: number, row: any): string {
        return `row-${index}-${Object.values(row).join('-')}`;
    }

    executeQuery(): void {
        const executionTabId = this.tabId; // Capture tab ID at start of execution

        this.isLoading = true;
        this.isVirtualScrollLoading = true;
        this.errorMessage = null;
        this.resultScrollOffsets = {};

        // Extract base query for virtual scrolling
        if (typeof this.triggerQuery === 'string') {
            const query = this.triggerQuery.trim();
            // Check for potential multi-statement queries (naive check for semicolon)
            // If strictly one statement, we can try virtual scrolling.
            // If multiple, we MUST use standard execution because wrapping in subquery/limit is invalid.
            const isMultiStatement = query.includes(';') && query.split(';').filter((s) => s.trim()).length > 1;

            if (isMultiStatement) {
                // Standard Execution for multi-statement
                this.dataSource = null; // Important: Clear virtual source to enable standard table view
                this.isVirtualScrollLoading = false; // standard loading only
                this._dbService.executeQuery(query, this.dbName, { page: 1, pageSize: 100 }).subscribe({
                    next: (response) => {
                        // Race Condition Check: If user switched tabs, update CACHE instead of active view
                        if (this.tabId !== executionTabId) {
                            this.updateCachedState(executionTabId, {
                                isLoading: false,
                                queryResults: this.extractQueryResults(response),
                                isVirtualScrollLoading: false,
                                resultScrollOffsets: {},
                            });
                            return;
                        }

                        this.isLoading = false;
                        if (response) {
                            this.queryResults = this.extractQueryResults(response);
                            // Emit results to parent (SqlWorkspace) to update tabs if needed
                            this.resultsChanged.emit(this.queryResults);

                            this.activeQueryIndex = 0;
                            this.applyActiveQueryData();
                        }
                        this._cdr.markForCheck();
                    },
                    error: (error) => {
                        if (this.tabId !== executionTabId) {
                            this.updateCachedState(executionTabId, {
                                isLoading: false,
                                errorMessage: error.message || 'Failed to execute query',
                                queryResults: [],
                                isVirtualScrollLoading: false,
                                resultScrollOffsets: {},
                            });
                            return;
                        }

                        this.isLoading = false;
                        this.errorMessage = error.message || 'Failed to execute query';
                        this.queryResults = [];
                        this.resultsChanged.emit([]);
                        this._cdr.markForCheck();
                    },
                });
            } else {
                // Virtual Scrolling for single statement
                this.isVirtualScrollLoading = true;
                const newDataSource = new VirtualDataSource(
                    this._http,
                    this.connectionId,
                    query,
                    100, // chunk size
                    20, // max chunks in cache
                    getSafeSessionStorage().getItem('dbType') || 'mysql2',
                );

                // Assign immediately if on same tab
                if (this.tabId === executionTabId) {
                    this.dataSource = newDataSource;
                }

                newDataSource
                    .loadInitialData()
                    .then((firstRows) => {
                        if (this.tabId !== executionTabId) {
                            // User swapped tabs. The dataSource is strictly for the background tab now.
                            const displayedColumns = firstRows && firstRows.length > 0 ? Object.keys(firstRows[0]) : [];

                            this.updateCachedState(executionTabId, {
                                dataSource: newDataSource,
                                displayedColumns: displayedColumns,
                                queryResults: [
                                    {
                                        rows: [],
                                        query: query,
                                        virtual: true,
                                        displayName: 'Result',
                                    },
                                ],
                                isVirtualScrollLoading: false,
                                isLoading: false,
                                resultScrollOffsets: {},
                            });
                            return;
                        }

                        // Still on the same tab
                        this.dataSource = newDataSource;

                        if (firstRows && firstRows.length > 0) {
                            this.displayedColumns = Object.keys(firstRows[0]);
                        } else {
                            this.displayedColumns = [];
                        }

                        // For virtual scroll, we treat it as a single result
                        this.queryResults = [
                            {
                                rows: [],
                                query: query,
                                virtual: true,
                                displayName: 'Result',
                            },
                        ];

                        this.resultsChanged.emit(this.queryResults);
                        this.isVirtualScrollLoading = false;
                        this.isLoading = false;
                        this._cdr.markForCheck();
                    })
                    .catch((error) => {
                        console.error('Virtual Scroll Error', error);
                        if (this.tabId !== executionTabId) {
                            this.updateCachedState(executionTabId, {
                                isLoading: false,
                                errorMessage: error.message || 'Failed to load data',
                                isVirtualScrollLoading: false,
                                resultScrollOffsets: {},
                            });
                            return;
                        }
                        this.isVirtualScrollLoading = false;
                        this.isLoading = false;
                        this.errorMessage = error.message || 'Failed to load data';
                        this.queryResults = [];
                        this.resultsChanged.emit([]);
                        this._cdr.markForCheck();
                    });
            }
        } else {
            this.isLoading = false;
            this.isVirtualScrollLoading = false;
        }

        this._cdr.markForCheck();
    }

    // Synchronize horizontal scroll between header and body
    onBodyScroll(event: Event): void {
        if (this.headerScroll && this.bodyScroll) {
            const scrollLeft = this.bodyScroll.measureScrollOffset('left');
            this.headerScroll.nativeElement.scrollLeft = scrollLeft;
        }
        this.updateActiveResultScroll();
        this.maybeLoadMoreRows();
    }

    // PUBLIC: switch active result from parent
    public setActiveResultIndex(index: number): void {
        if (index < 0 || index >= this.queryResults.length) return;
        this.updateActiveResultScroll();
        this.activeQueryIndex = index;
        this.applyActiveQueryData();
    }

    public getActiveResultIndex(): number {
        return this.activeQueryIndex;
    }

    // PUBLIC: close a result tab from parent
    public closeResultTab(index: number): void {
        if (index < 0 || index >= this.queryResults.length) return;

        this.queryResults.splice(index, 1);

        // Adjust active index
        if (this.activeQueryIndex >= this.queryResults.length) {
            this.activeQueryIndex = this.queryResults.length - 1;
        }
        if (this.activeQueryIndex < 0) {
            this.activeQueryIndex = 0;
        }

        // Emit to parent and re-apply view
        this.resultsChanged.emit(this.queryResults);
        if (this.queryResults.length > 0) {
            this.applyActiveQueryData();
        } else {
            // No results left: clear grid
            this.setData([]);
            this.totalRows = 0;
            this.totalPages = 1;
            this._cdr.markForCheck();
        }
    }

    // Apply current result into grid & pagination
    private applyActiveQueryData(): void {
        const active = this.queryResults[this.activeQueryIndex];
        const rows = active?.rows || [];
        // For virtual results, keep existing columns from the data source
        if (active?.virtual || this.dataSource) {
            this.rows = rows;
            if (!this.displayedColumns || this.displayedColumns.length === 0) {
                this.displayedColumns = Object.keys(rows[0] || {});
            }
            this.headers = this.displayedColumns;
            this._cdr.markForCheck();
        } else {
            this.setData(rows);
        }

        // Use per-statement pagination when present; else compute from totalRows
        if (active?.pagination) {
            this.currentPage = active.pagination.page || 1;
            this.pageSize = active.pagination.pageSize || this.pageSize;
            this.totalPages = active.pagination.totalPages || 1;
            this.totalRows = typeof active.totalRows === 'number' ? active.totalRows : rows.length;
        } else {
            this.totalRows = typeof active?.totalRows === 'number' ? active.totalRows : rows.length;
            this.totalPages = Math.ceil(this.totalRows / this.pageSize) || 1;
        }

        this.restoreActiveResultScroll();
    }

    // NEW: switch between result tabs
    selectResultTab(index: number): void {
        if (index < 0 || index >= this.queryResults.length) return;
        this.updateActiveResultScroll();
        this.activeQueryIndex = index;
        this.applyActiveQueryData();
    }

    private setData(data: any[]): void {
        if (data && data.length > 0) {
            this.headers = Object.keys(data[0]);
            this.displayedColumns = this.headers; // Sync for unified view
            this.rows = data;
        } else {
            this.headers = [];
            this.displayedColumns = [];
            this.rows = [];
        }
        this._cdr.markForCheck();
    }

    private maybeLoadMoreRows(): void {
        if (!this.bodyScroll || this.dataSource) return;
        const active = this.queryResults[this.activeQueryIndex];
        if (!active || active.virtual) return;
        if (!active.pagination || active.pagination.hasMore !== true) return;
        if (this.isAppendingPage || this.isLoading || this.isVirtualScrollLoading) return;

        const remaining = this.bodyScroll.measureScrollOffset('bottom');
        if (remaining > 200) return;

        this.loadMoreRowsForActiveResult();
    }

    private loadMoreRowsForActiveResult(): void {
        const active = this.queryResults[this.activeQueryIndex];
        if (!active?.query || typeof active.query !== 'string') return;

        const nextPage = (active.pagination?.page || 1) + 1;
        const pageSize = active.pagination?.pageSize || this.pageSize;

        this.isAppendingPage = true;
        this.isVirtualScrollLoading = true;

        this._dbService.executeQuery(active.query, this.dbName, { page: nextPage, pageSize }).subscribe({
            next: (resp: any) => {
                let payload = resp;
                if (resp && Array.isArray(resp.queries)) {
                    payload = resp.queries.find((q: any) => q.query === active.query) || resp.queries[0];
                }

                const normalized = this.normalizeSingleResult(payload);
                const newRows = normalized.rows || [];

                active.rows = [...(active.rows || []), ...newRows];
                this.applySlidingWindow(active);

                // Merge pagination info
                const hasMore =
                    payload?.pagination?.hasMore !== undefined
                        ? payload.pagination.hasMore
                        : newRows.length >= pageSize;

                active.pagination = {
                    ...(active.pagination || {}),
                    ...(payload?.pagination || {}),
                    page: nextPage,
                    pageSize,
                    hasMore,
                    totalPages:
                        payload?.pagination?.totalPages ||
                        (active.totalRows ? Math.ceil(active.totalRows / pageSize) : active.pagination?.totalPages),
                };

                active.totalRows = typeof payload?.totalRows === 'number' ? payload.totalRows : active.totalRows;

                // Update view without resetting scroll
                this.setData(active.rows || []);
                this.totalRows = active.totalRows || this.rows.length;
                this.totalPages = active.pagination?.totalPages || Math.ceil(this.totalRows / pageSize) || 1;

                this.isAppendingPage = false;
                this.isVirtualScrollLoading = false;
                setTimeout(() => this.bodyScroll?.checkViewportSize(), 0);
                this._cdr.markForCheck();
            },
            error: (error) => {
                this.isAppendingPage = false;
                this.isVirtualScrollLoading = false;
                this.errorMessage = error.message || 'Failed to load more rows';
                this._cdr.markForCheck();
            },
        });
    }

    private updateActiveResultScroll(): void {
        if (!this.bodyScroll) return;
        const offset = this.bodyScroll.measureScrollOffset('top');
        this.resultScrollOffsets[this.activeQueryIndex] = offset;
    }

    private restoreActiveResultScroll(): void {
        const offset = this.resultScrollOffsets[this.activeQueryIndex];
        if (offset === undefined) return;
        this.restoreScrollOffset(offset);
        // Ensure viewport recalculates for the new data length
        setTimeout(() => this.bodyScroll?.checkViewportSize(), 0);
    }

    private applySlidingWindow(active: any): void {
        if (!active || !Array.isArray(active.rows)) return;
        if (!this.maxStandardRows || this.maxStandardRows <= 0) return;
        if (active.rows.length <= this.maxStandardRows) return;

        const removeCount = active.rows.length - this.maxStandardRows;
        active.rows = active.rows.slice(removeCount);

        if (this.bodyScroll) {
            const currentOffset = this.bodyScroll.measureScrollOffset('top');
            const newOffset = Math.max(0, currentOffset - removeCount * this.standardRowHeight);
            this.bodyScroll.scrollToOffset(newOffset);
            this.resultScrollOffsets[this.activeQueryIndex] = newOffset;
        }
    }

    copyToClipboard(text: string, rowIndex: number, header: string, event: MouseEvent): void {
        if (text === null || text === undefined) {
            text = 'NULL';
        }

        navigator.clipboard.writeText(String(text)).then(
            () => {
                this.copiedCell = `${rowIndex}-${header}`;

                // Position tooltip relative to click
                const rect = (event.target as HTMLElement).getBoundingClientRect();
                this.copiedPosition = {
                    left: rect.left + rect.width / 2 - 25, // Center tooltip
                    top: rect.top - 35, // Position above element
                };

                this._cdr.markForCheck();

                // Clear tooltip after 2 seconds
                setTimeout(() => {
                    this.copiedCell = null;
                    this._cdr.markForCheck();
                }, 2000);

                // Copied to clipboard
            },
            (err) => {
                // Clipboard API failed; using fallback
                // Fallback for older browsers
                this.fallbackCopyTextToClipboard(String(text));
            },
        );
    }

    private fallbackCopyTextToClipboard(text: string): void {
        const textArea = document.createElement('textarea');
        textArea.value = text;

        // Avoid scrolling to bottom
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.position = 'fixed';

        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            document.execCommand('copy');
        } catch (err) {
            // ignore
        }

        document.body.removeChild(textArea);
    }

    // Method to determine cell content type for styling
    getCellType(value: any): string {
        if (value === null || value === undefined) {
            return 'null';
        }
        if (typeof value === 'number') {
            return 'number';
        }
        if (typeof value === 'boolean') {
            return 'boolean';
        }
        if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/)) {
            return 'date';
        }
        return 'string';
    }

    openExportModal(): void {
        this.exportScope = 'current';
        this.showExportModal = true;
        this._cdr.markForCheck();
    }

    closeExportModal(): void {
        this.showExportModal = false;
        this._cdr.markForCheck();
    }

    async confirmExport(format: 'json' | 'csv' | 'excel'): Promise<void> {
        // Get current data from the data source
        let data: any[] = [];

        if (this.dataSource) {
            // Get the current cached data from data source
            const currentData = await firstValueFrom(
                this.dataSource.connect({
                    viewChange: new BehaviorSubject({ start: 0, end: Number.MAX_SAFE_INTEGER }),
                }),
            );
            data = currentData.filter((row) => row && Object.keys(row).length > 0);
        }

        if (!data || data.length === 0) {
            window.alert('No rows available to export.');
            this.closeExportModal();
            return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const baseName = `result-${timestamp}`;

        if (format === 'json') {
            const blob = new Blob([this.convertToJSON(data)], { type: 'application/json;charset=utf-8' });
            this.downloadFile(`${baseName}.json`, blob);
        } else if (format === 'csv') {
            const csv = this.convertToCSV(data);
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            this.downloadFile(`${baseName}.csv`, blob);
        } else if (format === 'excel') {
            const html = this.convertToExcel(data);
            const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
            this.downloadFile(`${baseName}.xls`, blob);
        }

        this.closeExportModal();
    }

    private getDataForExport(): any[] {
        // export current grid rows for "page"
        if (this.exportScope === 'current') {
            return this.rows || [];
        }

        // export "full" - try to use any available full result payload
        const active = this.queryResults[this.activeQueryIndex];
        // If server provided full data field (custom), respect it
        if (active?.allRows && Array.isArray(active.allRows) && active.allRows.length > 0) {
            return active.allRows;
        }

        // If pagination indicates more results on server, inform user and fallback to current page
        if (active?.pagination?.hasMore) {
            // keep short / impersonal
            window.alert('Full result set is not fully loaded; exporting current page only.');
            return this.rows || [];
        }

        // fallback to whatever rows are present
        return active?.rows || this.rows || [];
    }

    private convertToJSON(data: any[]): string {
        return JSON.stringify(data, null, 2);
    }

    private convertToCSV(data: any[]): string {
        if (!data || data.length === 0) return '';

        const cols =
            this.displayedColumns && this.displayedColumns.length > 0
                ? this.displayedColumns
                : Object.keys(data[0] || {});
        const escape = (v: any) => {
            if (v === null || v === undefined) return '';
            const s = String(v);
            // escape double quotes
            if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
                return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
        };

        const lines = [];
        lines.push(cols.join(','));
        for (const row of data) {
            const vals = cols.map((c) => escape(row[c]));
            lines.push(vals.join(','));
        }
        return lines.join('\r\n');
    }

    private convertToExcel(data: any[]): string {
        // Build a minimal HTML table which Excel can open
        const cols =
            this.displayedColumns && this.displayedColumns.length > 0
                ? this.displayedColumns
                : Object.keys(data[0] || {});
        const headerRow = cols
            .map((c) => `<th style="border:1px solid #ccc;padding:4px;background:#f0f0f0;">${this.escapeHtml(c)}</th>`)
            .join('');
        const bodyRows = data
            .map((row) => {
                const cells = cols
                    .map((c) => `<td style="border:1px solid #ccc;padding:4px;">${this.escapeHtml(row[c])}</td>`)
                    .join('');
                return `<tr>${cells}</tr>`;
            })
            .join('');
        return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><table border="0" cellpadding="0" cellspacing="0">${'<thead><tr>' + headerRow + '</tr></thead>'}<tbody>${bodyRows}</tbody></table></body></html>`;
    }

    private escapeHtml(value: any): string {
        if (value === null || value === undefined) return '';
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    private downloadFile(filename: string, blob: Blob): void {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    private async fetchAllRows(): Promise<any[]> {
        const active = this.activeResult;
        // choose base SQL: prefer the active statement, else fall back to original triggerQuery
        const query = active?.query || this.triggerQuery;
        if (query && typeof query !== 'string') {
            return this.rows || [];
        }
        const pageSize = active?.pagination?.pageSize || this.pageSize;
        const totalPagesFromMeta = active?.pagination?.totalPages;
        const totalRowsFromMeta = active?.totalRows || this.totalRows;

        // compute pages to fetch
        let totalPages = 1;
        if (typeof totalPagesFromMeta === 'number' && totalPagesFromMeta > 0) {
            totalPages = totalPagesFromMeta;
        } else if (totalRowsFromMeta && pageSize) {
            totalPages = Math.ceil(totalRowsFromMeta / pageSize);
        }

        // safety cap
        const MAX_PAGES = 1000;
        totalPages = Math.min(totalPages || 1, MAX_PAGES);

        const allRows: any[] = [];

        for (let p = 1; p <= totalPages; p++) {
            try {
                const resp: any = await firstValueFrom(
                    this._dbService.executeQuery(query, this.dbName, { page: p, pageSize }),
                );

                let pageRows: any[] = [];

                if (!resp) {
                    break;
                }

                // handle multi-query response vs single-query
                if (Array.isArray(resp.queries)) {
                    // try to find matching statement by text, fallback to first
                    const found = resp.queries.find((q: any) => q.query === query) || resp.queries[0];
                    pageRows = Array.isArray(found?.rows) ? found.rows : [];
                } else {
                    pageRows = Array.isArray(resp.rows) ? resp.rows : [];
                }

                if (pageRows.length > 0) {
                    allRows.push(...pageRows);
                }

                // if server indicates no more pages, break early
                const pageMeta = Array.isArray(resp.queries)
                    ? (resp.queries.find((q: any) => q.query === query) || resp.queries[0])?.pagination
                    : resp?.pagination;
                if (pageMeta && pageMeta.hasMore === false) {
                    break;
                }

                // If server returned fewer rows than pageSize, assume last page
                if (pageRows.length < pageSize) {
                    break;
                }
            } catch (err) {
                // stop on error and return what we have
                console.error('Error fetching page', p, err);
                break;
            }
        }

        return allRows;
    }

    private normalizeSingleResult(payload: any): { rows: any[]; totalRows: number; pagination?: any } {
        if (!payload) {
            return { rows: [], totalRows: 0 };
        }

        if (Array.isArray(payload.rows)) {
            return {
                rows: payload.rows,
                totalRows: typeof payload.totalRows === 'number' ? payload.totalRows : payload.rows.length,
                pagination: payload.pagination,
            };
        }

        if (Array.isArray(payload.documents)) {
            return {
                rows: payload.documents,
                totalRows: typeof payload.totalRows === 'number' ? payload.totalRows : payload.documents.length,
                pagination: payload.pagination,
            };
        }

        if (Array.isArray(payload.keys) && Array.isArray(payload.values)) {
            const rows = payload.keys.map((key: any, idx: number) => ({
                key,
                value: payload.values[idx],
            }));
            return { rows, totalRows: rows.length };
        }

        if (Array.isArray(payload.keys)) {
            const rows = payload.keys.map((key: any) => ({ key }));
            return { rows, totalRows: rows.length };
        }

        if (payload.key !== undefined && payload.value !== undefined) {
            return { rows: [{ key: payload.key, value: payload.value }], totalRows: 1 };
        }

        if (payload.value !== undefined) {
            return { rows: [{ value: payload.value }], totalRows: 1 };
        }

        if (payload.values !== undefined) {
            const values = Array.isArray(payload.values) ? payload.values : [payload.values];
            const rows = values.map((value: any) => ({ value }));
            return { rows, totalRows: rows.length };
        }

        if (typeof payload === 'object') {
            return { rows: [payload], totalRows: 1 };
        }

        return { rows: [{ value: payload }], totalRows: 1 };
    }
}

// Virtual Data Source for efficient scrolling
class VirtualDataSource extends DataSource<any> {
    private readonly dataStream = new BehaviorSubject<any[]>([]);
    private subscription: Subscription | null = null;
    private cache = new Map<number, any[]>();
    private cacheOrder: number[] = [];
    private loadingChunks = new Set<number>();
    private totalRowCount: number | null = null;
    private hasMore = true;
    private orderByColumn: string | null = null;
    private lastKeyByChunk = new Map<number, any>();

    constructor(
        private http: HttpClient,
        private connectionId: string,
        private query: string,
        private chunkSize: number = 100,
        private maxCachedChunks: number = 20,
        private dbType: string = 'mysql2',
    ) {
        super();
    }

    private getHeaders(): HttpHeaders {
        const storage = getSafeSessionStorage();
        const token = storage.getItem('token');
        return new HttpHeaders({
            'Content-Type': 'application/json',
            'x-db-type': this.dbType,
            'x-connection-id': this.connectionId,
            Authorization: token ? token : '',
        });
    }

    connect(collectionViewer: CollectionViewer): Observable<any[]> {
        this.subscription = collectionViewer.viewChange.subscribe((range) => {
            const startChunk = Math.floor(range.start / this.chunkSize);
            const endChunk = Math.ceil(range.end / this.chunkSize);

            for (let chunkIndex = startChunk; chunkIndex <= endChunk; chunkIndex++) {
                // Don't fetch if we've reached the end
                if (this.totalRowCount !== null && chunkIndex * this.chunkSize >= this.totalRowCount) {
                    break;
                }
                if (!this.cache.has(chunkIndex) && !this.loadingChunks.has(chunkIndex) && this.hasMore) {
                    this.fetchChunk(chunkIndex);
                }
            }
        });

        return this.dataStream.asObservable();
    }

    disconnect(): void {
        this.subscription?.unsubscribe();
    }

    async loadInitialData(): Promise<any[]> {
        return this.fetchChunk(0, true);
    }

    private async fetchChunk(chunkIndex: number, forceOffset: boolean = false): Promise<any[]> {
        if (this.cache.has(chunkIndex)) {
            return this.cache.get(chunkIndex)!;
        }

        this.loadingChunks.add(chunkIndex);
        const offset = chunkIndex * this.chunkSize;
        const canUseKeyset =
            !forceOffset &&
            chunkIndex > 0 &&
            this.orderByColumn &&
            this.lastKeyByChunk.has(chunkIndex - 1) &&
            this.lastKeyByChunk.get(chunkIndex - 1) !== null &&
            this.lastKeyByChunk.get(chunkIndex - 1) !== undefined;

        try {
            const requestBody: any = {
                connectionId: this.connectionId,
                query: this.query,
                offset,
                limit: this.chunkSize,
            };

            if (canUseKeyset && this.orderByColumn) {
                requestBody.paginationMode = 'seek';
                requestBody.cursor = {
                    orderBy: this.orderByColumn,
                    lastValue: this.lastKeyByChunk.get(chunkIndex - 1),
                    direction: 'asc',
                };
            }

            const response: any = await firstValueFrom(
                this.http.post('/api/query/range', requestBody, {
                    headers: this.getHeaders(),
                }),
            );

            // Handle API response structure: { success: true, data: { rows: [...], hasMore: boolean } }
            const rows = response?.data?.rows || response?.rows || [];
            const hasMoreData = response?.data?.hasMore ?? true;

            // If we got fewer rows than requested, we've reached the end
            if (rows.length < this.chunkSize) {
                this.hasMore = false;
                this.totalRowCount = offset + rows.length;
            } else if (hasMoreData === false) {
                this.hasMore = false;
                this.totalRowCount = offset + rows.length;
            }

            this.cacheChunk(chunkIndex, rows);
            this.updateDataStream();

            if (!this.orderByColumn && rows && rows.length > 0) {
                this.orderByColumn = this.chooseOrderByColumn(rows);
            }

            if (this.orderByColumn && rows && rows.length > 0) {
                const lastRow = rows[rows.length - 1];
                const lastValue = lastRow ? lastRow[this.orderByColumn] : undefined;
                if (lastValue !== undefined && lastValue !== null) {
                    this.lastKeyByChunk.set(chunkIndex, lastValue);
                }
            }

            return rows;
        } catch (error) {
            if (canUseKeyset && !forceOffset) {
                return this.fetchChunk(chunkIndex, true);
            }
            console.error('Error fetching chunk', chunkIndex, error);
            throw error;
        } finally {
            this.loadingChunks.delete(chunkIndex);
        }
    }

    private cacheChunk(chunkIndex: number, data: any[]): void {
        if (this.cacheOrder.length >= this.maxCachedChunks) {
            const oldestChunk = this.cacheOrder.shift();
            if (oldestChunk !== undefined) {
                this.cache.delete(oldestChunk);
                this.lastKeyByChunk.delete(oldestChunk);
            }
        }

        this.cache.set(chunkIndex, data);
        this.cacheOrder.push(chunkIndex);
    }

    private updateDataStream(): void {
        const allData: any[] = [];
        const sortedChunks = Array.from(this.cache.keys()).sort((a, b) => a - b);

        // Build continuous array from cached chunks only
        for (const chunkIndex of sortedChunks) {
            const chunkData = this.cache.get(chunkIndex);
            if (chunkData && chunkData.length > 0) {
                allData.push(...chunkData);
            }
        }

        this.dataStream.next(allData);
    }

    private chooseOrderByColumn(rows: any[]): string | null {
        if (!rows || rows.length === 0) return null;
        const columns = Object.keys(rows[0] || {});
        if (columns.length === 0) return null;

        const exactId = columns.find((c) => c.toLowerCase() === 'id');
        if (exactId) return exactId;

        const idLike = columns.find((c) => /_id$/i.test(c));
        if (idLike) return idLike;

        return columns[0] || null;
    }
}
