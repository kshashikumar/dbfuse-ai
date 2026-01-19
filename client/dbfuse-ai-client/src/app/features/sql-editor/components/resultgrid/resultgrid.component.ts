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
            // Reset local state on tab switch
            this.currentPage = 1;
            this.headers = [];
            this.rows = [];
            this.queryResults = [];
            this.activeQueryIndex = 0;
            this.totalRows = 0;
            this.totalPages = 1;
            this.errorMessage = null;
            this.isLoading = false;
            this._cdr.markForCheck();
        }
    }

    // TrackBy functions for performance
    trackByHeader(index: number, header: string): string {
        return header;
    }

    trackByRow(index: number, row: any): string {
        return `row-${index}-${Object.values(row).join('-')}`;
    }

    executeQuery(): void {
        this.isLoading = true;
        this.isVirtualScrollLoading = true;
        this.errorMessage = null;

        // Extract base query for virtual scrolling
        if (typeof this.triggerQuery === 'string') {
            const query = this.triggerQuery.trim();

            // Initialize virtual scroll data source
            this.dataSource = new VirtualDataSource(
                this._http,
                this.connectionId,
                query,
                100, // chunk size
                20, // max chunks in cache
            );

            // Load first chunk to get columns
            this.dataSource
                .loadInitialData()
                .then((firstRows) => {
                    if (firstRows && firstRows.length > 0) {
                        this.displayedColumns = Object.keys(firstRows[0]);
                    }
                    this.isVirtualScrollLoading = false;
                    this.isLoading = false;
                    this._cdr.markForCheck();
                })
                .catch((error) => {
                    this.errorMessage = error.message || 'Failed to load data';
                    this.isVirtualScrollLoading = false;
                    this.isLoading = false;
                    this._cdr.markForCheck();
                });
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
    }

    // PUBLIC: switch active result from parent
    public setActiveResultIndex(index: number): void {
        if (index < 0 || index >= this.queryResults.length) return;
        this.activeQueryIndex = index;
        this.applyActiveQueryData();
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
        this.setData(rows);

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
    }

    // NEW: switch between result tabs
    selectResultTab(index: number): void {
        if (index < 0 || index >= this.queryResults.length) return;
        this.activeQueryIndex = index;
        this.applyActiveQueryData();
    }

    private setData(data: any[]): void {
        if (data && data.length > 0) {
            this.headers = Object.keys(data[0]);
            this.rows = data;
        } else {
            this.headers = [];
            this.rows = [];
        }
        this._cdr.markForCheck();
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

    constructor(
        private http: HttpClient,
        private connectionId: string,
        private query: string,
        private chunkSize: number = 100,
        private maxCachedChunks: number = 20,
    ) {
        super();
    }

    private getHeaders(): HttpHeaders {
        const storage = getSafeSessionStorage();
        const token = storage.getItem('token');
        const dbType = storage.getItem('dbType') || 'mysql2';
        const connectionId = storage.getItem('connectionId') || '';
        return new HttpHeaders({
            'Content-Type': 'application/json',
            'x-db-type': dbType,
            'x-connection-id': connectionId,
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
        this.dataStream.complete();
    }

    async loadInitialData(): Promise<any[]> {
        return this.fetchChunk(0);
    }

    private async fetchChunk(chunkIndex: number): Promise<any[]> {
        if (this.cache.has(chunkIndex)) {
            return this.cache.get(chunkIndex)!;
        }

        this.loadingChunks.add(chunkIndex);
        const offset = chunkIndex * this.chunkSize;

        try {
            const response: any = await firstValueFrom(
                this.http.post(
                    '/api/query/range',
                    {
                        connectionId: this.connectionId,
                        query: this.query,
                        offset,
                        limit: this.chunkSize,
                    },
                    {
                        headers: this.getHeaders(),
                    },
                ),
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

            return rows;
        } catch (error) {
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
}
