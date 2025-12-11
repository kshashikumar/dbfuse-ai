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
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BackendService } from '@lib/services';
import { TruncatePipe } from '@lib/providers/truncate.pipe';
import { firstValueFrom } from 'rxjs';

@Component({
    selector: 'app-resultgrid',
    standalone: true,
    imports: [CommonModule, RouterModule, FormsModule, TruncatePipe],
    templateUrl: './resultgrid.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultGridComponent implements OnInit {
    private readonly _dbService = inject(BackendService);
    private readonly _cdr = inject(ChangeDetectorRef);

    @Input() triggerQuery: string = '';
    @Input() executeTriggered: boolean = false;
    @Input() dbName: string = '';
    @Input() tabId: string = '';
    @Output() resultsChanged = new EventEmitter<any[]>();

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
            const hasQuery = typeof this.triggerQuery === 'string' && this.triggerQuery.trim() !== '';
            if (prev !== curr && hasQuery) {
                this.currentPage = 1;
                this.executeQuery();
            }
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
        this.errorMessage = null;
        this._cdr.markForCheck();

        this._dbService
            .executeQuery(this.triggerQuery, this.dbName, { page: this.currentPage, pageSize: this.pageSize })
            .subscribe({
                next: (data) => {
                    if (data) {
                        if (Array.isArray(data.queries)) {
                            // Multi-query
                            this.queryResults = data.queries;
                            // Keep index in range (e.g., after re-exec)
                            this.activeQueryIndex = Math.min(this.activeQueryIndex, this.queryResults.length - 1);
                            if (this.activeQueryIndex < 0) this.activeQueryIndex = 0;

                            // Let parent render tabs
                            this.resultsChanged.emit(
                                (data.queries || []).map((q: any, idx: number) => {
                                    // Try to infer table name from query or fallback to index
                                    let tableName = '';
                                    const match = q.query?.match(/FROM\s+([^\s;]+)/i);
                                    if (match && match[1]) {
                                        tableName = match[1].replace(/[`"'[\]]/g, ''); // strip quotes/brackets
                                    }
                                    const displayName =
                                        this.dbName && tableName
                                            ? `${this.dbName}.${tableName}`
                                            : `${this.dbName || 'Query'}_${idx + 1}`;

                                    return { ...q, displayName };
                                }),
                            );

                            // Apply selected result to grid
                            this.applyActiveQueryData();

                            // No per-tab caching retained; state lives in-memory per component
                        } else {
                            // Single-query fallback
                            const single = data as any;
                            const rows = Array.isArray(single.rows) ? single.rows : [];
                            const totalRows = typeof single.totalRows === 'number' ? single.totalRows : rows.length;

                            this.queryResults = [];
                            this.activeQueryIndex = 0;
                            this.resultsChanged.emit([]); // parent hides tabs

                            this.setData(rows);
                            this.totalRows = totalRows || 0;
                            this.totalPages = Math.ceil(this.totalRows / this.pageSize) || 1;
                            // No per-tab caching retained
                        }
                    } else {
                        this.setData([]);
                        this.queryResults = [];
                        this.resultsChanged.emit([]);
                        this.totalRows = 0;
                        this.totalPages = 1;
                    }
                    this.isLoading = false;
                    this._cdr.markForCheck();
                },
                error: (error) => {
                    this.errorMessage =
                        error?.error?.error ||
                        'An error occurred while executing the query. Please check your syntax and try again.';
                    this.isLoading = false;
                    this.rows = [];
                    this.headers = [];
                    this.queryResults = [];
                    this.resultsChanged.emit([]);
                    this.totalRows = 0;
                    this.totalPages = 1;
                    this._cdr.markForCheck();
                },
            });
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

    changePage(newPage: number): void {
        if (newPage > 0 && newPage <= this.totalPages && newPage !== this.currentPage) {
            this.currentPage = newPage;
            this.executeQuery(); // backend paginates current SELECT; we keep active index
        }
    }

    // Change page size via dropdown and re-run the query
    changePageSize(event: Event): void {
        const value = Number((event.target as HTMLSelectElement).value);
        if (!isNaN(value) && value > 0 && value !== this.pageSize) {
            this.pageSize = value;
            this.currentPage = 1;
            this.executeQuery();
        }
    }

    goToPage(event: Event): void {
        const target = event.target as HTMLInputElement;
        const pageNumber = parseInt(target.value, 10);

        if (!isNaN(pageNumber) && pageNumber >= 1 && pageNumber <= this.totalPages) {
            this.changePage(pageNumber);
        } else {
            target.value = this.currentPage.toString();
        }
    }

    // Utility method to get cell display value
    getCellDisplayValue(value: any): string {
        if (value === null || value === undefined) {
            return 'NULL';
        }
        if (typeof value === 'boolean') {
            return value ? 'TRUE' : 'FALSE';
        }
        if (typeof value === 'object') {
            return JSON.stringify(value);
        }
        return String(value);
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
        let data: any[] = [];

        if (this.exportScope === 'all') {
            // prefer already-available full payload
            const active = this.activeResult;
            if (active?.allRows && Array.isArray(active.allRows) && active.allRows.length) {
                data = active.allRows;
            } else {
                // try to fetch all pages from backend
                data = await this.fetchAllRows();
            }
        } else {
            data = this.rows || [];
        }

        if (!data || data.length === 0) {
            window.alert('No rows available to export.');
            this.closeExportModal();
            return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const scope = this.exportScope === 'all' ? 'all' : 'current';
        const baseName = `result-${scope}-${timestamp}`;

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

        const cols = this.headers && this.headers.length > 0 ? this.headers : Object.keys(data[0] || {});
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
        const cols = this.headers && this.headers.length > 0 ? this.headers : Object.keys(data[0] || {});
        const headerRow = cols.map((c) => `<th style="border:1px solid #ccc;padding:4px;background:#f0f0f0;">${this.escapeHtml(c)}</th>`).join('');
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
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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
                const pageMeta =
                    Array.isArray(resp.queries)
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


}
