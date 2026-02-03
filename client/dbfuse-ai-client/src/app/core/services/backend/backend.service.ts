import { Injectable } from '@angular/core';
import { environment } from '@env/environment';
import { Observable, forkJoin, of, throwError } from 'rxjs';
import { map, switchMap, catchError, finalize } from 'rxjs/operators';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { DbApiService } from '@core/services/db-api/db-api.service';
import type {
    DbBatchQueryResponse,
    DbMultiQueryResponse,
    DbQueryResponse,
    DbMetadataMultipleTablesResponse,
    DbMetadataProceduresResponse,
    DbMetadataStrategyResponse,
    DbMetadataTableInfoResponse,
    DbMetadataViewsResponse,
    DbMetadataTablesResponse,
    DbMetadataCollectionsResponse,
    DbHealthResponse,
    DbConnectResponse,
    DbSwitchResponse,
    DbQueryAnalysisResponse,
} from '@core/services/db-api/db-api.types';
import {
    RAGHistoryResponse,
    RAGPromptResponse,
    DatabaseStats,
    ConnectionConfig,
    Connection,
    ConfigData,
    SaveResponse,
    AIModelCatalogResponse,
} from '@core/utils/storage/storage.types';
import { getSafeSessionStorage } from '@core/utils/browser-adapter';

@Injectable({
    providedIn: 'root',
})
export class BackendService {
    BASE_URL = environment.apiUrl;
    // Simple in-memory cache for table columns per database to speed up repeated AI prompts
    private tableInfoCache: Map<
        string,
        {
            columnsByTable: Map<
                string,
                {
                    column_name: string;
                    data_type?: string;
                    is_nullable?: boolean;
                    default_value?: any;
                    extra?: string;
                    is_primary_key?: boolean;
                    length?: number | null;
                    precision?: number | null;
                    scale?: number | null;
                }[]
            >;
            timestamp: number;
        }
    > = new Map();
    private reconnectInFlight: Observable<boolean> | null = null;

    private getHeaders(): HttpHeaders {
        const storage = getSafeSessionStorage();
        const token = storage.getItem('token');
        const dbType = storage.getItem('dbType') || 'mysql2'; // Default to 'mysql2' if not set
        const connectionId = storage.getItem('connectionId') || '';
        return new HttpHeaders({
            'Content-Type': 'application/json',
            'x-db-type': dbType,
            'x-connection-id': connectionId,
            Authorization: token ? token : '',
        });
    }

    constructor(
        private _http: HttpClient,
        private readonly dbApi: DbApiService,
    ) {}

    private getStoredConnectionConfig(): ConnectionConfig | null {
        const raw = getSafeSessionStorage().getItem('connection');
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw) as Connection;
            const { id, status, createdAt, lastUsed, databaseDisplay, databaseShort, ...config } = parsed;
            return config as ConnectionConfig;
        } catch {
            return null;
        }
    }

    private shouldReconnect(error: any): boolean {
        const status = error?.status;
        const payload = error?.error;
        const message =
            typeof payload === 'string' ? payload : payload?.error || payload?.message || error?.message || '';
        return (
            status === 503 ||
            message.includes('No active database connection') ||
            message.includes('Database connection error')
        );
    }

    private tryReconnect(): Observable<boolean> {
        if (this.reconnectInFlight) {
            return this.reconnectInFlight;
        }
        const config = this.getStoredConnectionConfig();
        if (!config) {
            return of(false);
        }
        this.reconnectInFlight = this.connect(config).pipe(
            map(() => true),
            catchError(() => of(false)),
            finalize(() => {
                this.reconnectInFlight = null;
            }),
        );
        return this.reconnectInFlight;
    }

    private withReconnect<T>(factory: () => Observable<T>): Observable<T> {
        return factory().pipe(
            catchError((error) => {
                if (!this.shouldReconnect(error)) {
                    return throwError(() => error);
                }
                return this.tryReconnect().pipe(
                    switchMap((reconnected) => {
                        if (!reconnected) {
                            return throwError(() => error);
                        }
                        return factory();
                    }),
                );
            }),
        );
    }

    getConfigData(): Observable<ConfigData> {
        return this._http.get<ConfigData>(`${this.BASE_URL}/api/config`, { headers: this.getHeaders() });
    }

    updateConfigData(config: ConfigData): Observable<SaveResponse> {
        return this._http.post<SaveResponse>(`${this.BASE_URL}/api/config`, config, { headers: this.getHeaders() });
    }

    getAIModelCatalog(): Observable<AIModelCatalogResponse> {
        return this._http.get<AIModelCatalogResponse>(`${this.BASE_URL}/api/config/ai-models`, {
            headers: this.getHeaders(),
        });
    }

    // Database Information Methods
    getDatabases(): Observable<{
        databases: DatabaseStats[];
        count?: number;
        retrievedAt?: string;
        executionTime?: number;
    }> {
        return this.withReconnect(() => this.dbApi.getDatabases());
    }

    getTables(dbName: string): Observable<DbMetadataTablesResponse> {
        return this.withReconnect(() => this.dbApi.getTables(dbName));
    }

    getCollections(dbName: string): Observable<DbMetadataCollectionsResponse> {
        return this.withReconnect(() => this.dbApi.getCollections(dbName));
    }

    getViews(dbName: string): Observable<DbMetadataViewsResponse> {
        return this.withReconnect(() => this.dbApi.getViews(dbName));
    }

    getProcedures(dbName: string): Observable<DbMetadataProceduresResponse> {
        return this.withReconnect(() => this.dbApi.getProcedures(dbName));
    }

    getStrategyMetadata(): Observable<DbMetadataStrategyResponse> {
        return this.withReconnect(() => this.dbApi.getStrategyMetadata());
    }

    getTableInfo(dbName: string, table: string): Observable<DbMetadataTableInfoResponse> {
        return this.withReconnect(() => this.dbApi.getTableInfo(dbName, table));
    }

    getMultipleTablesInfo(dbName: string, tables: string[]): Observable<DbMetadataMultipleTablesResponse> {
        return this.withReconnect(() => this.dbApi.getMultipleTablesInfo(dbName, tables));
    }

    // Query Execution Methods
    executeQuery(
        query: any,
        dbName: string,
        options: { page?: number; pageSize?: number; timeout?: number } = {},
    ): Observable<DbQueryResponse | DbMultiQueryResponse> {
        const { page = 1, pageSize = 10, timeout } = options;
        const payload: any = { query, page, pageSize, timeout };
        if (dbName) payload.dbName = dbName;
        return this.withReconnect(() => this.dbApi.executeQuery(payload));
    }

    executeBatchQueries(
        dbName: string,
        queries: string[],
        transaction: boolean = false,
    ): Observable<DbBatchQueryResponse> {
        return this.withReconnect(() => this.dbApi.executeBatch(queries, dbName, transaction));
    }

    analyzeQuery(query: string): Observable<DbQueryAnalysisResponse> {
        return this.withReconnect(() => this.dbApi.analyzeQuery(query));
    }

    // Connection Management Methods
    connect(connection: ConnectionConfig): Observable<DbConnectResponse> {
        getSafeSessionStorage().setItem('dbType', connection.dbType);
        return this.dbApi.connect(connection).pipe(
            map((resp) => {
                if (resp?.connectionId) {
                    getSafeSessionStorage().setItem('connectionId', resp.connectionId);
                }
                return resp;
            }),
        );
    }

    switchDatabase(dbName: string): Observable<DbSwitchResponse> {
        return this.withReconnect(() => this.dbApi.switchDatabase(dbName));
    }

    getConnectionHealth(): Observable<DbHealthResponse> {
        return this.withReconnect(() => this.dbApi.getConnectionHealth());
    }

    // AI Integration Methods
    executeRAGPrompt(
        databaseName: string,
        prompt: string,
        options: {
            includeExplanation?: boolean;
            includeSuggestions?: boolean;
            limit?: number;
            minScore?: number;
            force?: boolean;
            useRag?: boolean;
        } = {},
    ): Observable<RAGPromptResponse> {
        const payload: any = { databaseName, prompt, ...options };
        return this.withReconnect(() =>
            this._http.post<RAGPromptResponse>(`${this.BASE_URL}/api/rag/query`, payload, {
                headers: this.getHeaders(),
            }),
        );
    }

    getRAGHistory(limit: number = 10): Observable<RAGHistoryResponse> {
        const url = `${this.BASE_URL}/api/rag/history?limit=${encodeURIComponent(String(limit))}`;
        return this.withReconnect(() => this._http.get<RAGHistoryResponse>(url, { headers: this.getHeaders() }));
    }

    submitRAGFeedback(payload: {
        queryId: string;
        feedback?: string;
        correctedQuery?: string;
        comments?: string;
    }): Observable<{ message: string; timestamp?: string }> {
        return this.withReconnect(() =>
            this._http.post<{ message: string; timestamp?: string }>(`${this.BASE_URL}/api/rag/feedback`, payload, {
                headers: this.getHeaders(),
            }),
        );
    }

    // Query Enrichment
    enrichQuery(
        connectionId: string,
        dbName: string,
        prompt: string,
        dbType: string,
        options: { skipCache?: boolean; forceFullEnrichment?: boolean } = {},
    ): Observable<any> {
        const payload = {
            dbName,
            prompt,
            options,
        };
        const headers = new HttpHeaders({
            'Content-Type': 'application/json',
            'x-db-type': dbType,
            'x-connection-id': connectionId,
            Authorization: getSafeSessionStorage().getItem('token') || '',
        });
        return this.withReconnect(() =>
            this._http.post<any>(`${this.BASE_URL}/api/chat/enrich-query`, payload, { headers }),
        );
    }

    // Utility Methods
    setDatabaseType(dbType: string): void {
        getSafeSessionStorage().setItem('dbType', dbType);
    }

    getDatabaseType(): string {
        return getSafeSessionStorage().getItem('dbType') || 'mysql2';
    }

    clearDatabaseType(): void {
        getSafeSessionStorage().removeItem('dbType');
    }

    // Helper method to update headers after dbType change
    private updateHeaders(): void {
        // This will be called automatically by getHeaders() method
    }
}
