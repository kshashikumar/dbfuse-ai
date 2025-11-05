import { Injectable } from '@angular/core';
import { environment } from '@env/environment';
import { Observable, forkJoin, of } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import {
    DbMeta,
    MultipleTablesInfo,
    OpenAIPromptResponse,
    TableInfo,
    DatabaseStats,
    ConnectionHealth,
    QueryResult,
    BatchQueryResult,
    QueryAnalysis,
    ConnectionConfig,
    ConfigData,
    SaveResponse,
} from '@lib/utils/storage/storage.types';
import { getSafeSessionStorage } from '@lib/utils/browser-adapter';

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

    constructor(private _http: HttpClient) {}

    getConfigData(): Observable<ConfigData> {
        return this._http.get<ConfigData>(`${this.BASE_URL}/api/config`, { headers: this.getHeaders() });
    }

    updateConfigData(config: ConfigData): Observable<SaveResponse> {
        return this._http.post<SaveResponse>(`${this.BASE_URL}/api/config`, config, { headers: this.getHeaders() });
    }

    // Database Information Methods
    getDatabases(): Observable<{ databases: DatabaseStats[]; count: number; retrievedAt: string }> {
        return this._http.get<{ databases: DatabaseStats[]; count: number; retrievedAt: string }>(
            `${this.BASE_URL}/api/sql/databases`,
            { headers: this.getHeaders() },
        );
    }

    getTables(dbName: string): Observable<{ tables: string[]; count: number; database: string; retrievedAt: string }> {
        const url = `${this.BASE_URL}/api/sql/tables${dbName ? `?dbName=${encodeURIComponent(dbName)}` : ''}`;
        return this._http.get<{ tables: string[]; count: number; database: string; retrievedAt: string }>(url, {
            headers: this.getHeaders(),
        });
    }

    getViews(dbName: string): Observable<{ views: any[]; count: number; database: string; retrievedAt: string }> {
        const url = `${this.BASE_URL}/api/sql/views${dbName ? `?dbName=${encodeURIComponent(dbName)}` : ''}`;
        return this._http.get<{ views: any[]; count: number; database: string; retrievedAt: string }>(url, {
            headers: this.getHeaders(),
        });
    }

    getProcedures(
        dbName: string,
    ): Observable<{ procedures: any[]; count: number; database: string; retrievedAt: string }> {
        const url = `${this.BASE_URL}/api/sql/procedures${dbName ? `?dbName=${encodeURIComponent(dbName)}` : ''}`;
        return this._http.get<{ procedures: any[]; count: number; database: string; retrievedAt: string }>(url, {
            headers: this.getHeaders(),
        });
    }

    getTableInfo(dbName: string, table: string): Observable<TableInfo & { retrievedAt: string }> {
        const url = `${this.BASE_URL}/api/sql/table-info?table=${encodeURIComponent(table)}${dbName ? `&dbName=${encodeURIComponent(dbName)}` : ''}`;
        return this._http.get<TableInfo & { retrievedAt: string }>(url, { headers: this.getHeaders() });
    }

    getMultipleTablesInfo(
        dbName: string,
        tables: string[],
    ): Observable<MultipleTablesInfo & { count: number; database: string; retrievedAt: string }> {
        const payload: any = { tables };
        if (dbName) payload.dbName = dbName;
        return this._http.post<MultipleTablesInfo & { count: number; database: string; retrievedAt: string }>(
            `${this.BASE_URL}/api/sql/info`,
            payload,
            { headers: this.getHeaders() },
        );
    }

    // Query Execution Methods
    executeQuery(
        query: string,
        dbName: string,
        options: { page?: number; pageSize?: number; timeout?: number } = {},
    ): Observable<QueryResult> {
        const { page = 1, pageSize = 10, timeout } = options;
        const payload: any = { query, page, pageSize, timeout };
        if (dbName) payload.dbName = dbName;
        return this._http.post<QueryResult>(`${this.BASE_URL}/api/sql/query`, payload, {
            headers: this.getHeaders(),
        });
    }

    executeBatchQueries(dbName: string, queries: string[], transaction: boolean = false): Observable<BatchQueryResult> {
        const payload: any = { queries, transaction };
        if (dbName) payload.dbName = dbName;
        return this._http.post<BatchQueryResult>(`${this.BASE_URL}/api/sql/batch`, payload, {
            headers: this.getHeaders(),
        });
    }

    analyzeQuery(query: string): Observable<{ query: string; analysis: QueryAnalysis; analyzedAt: string }> {
        const payload = { query };
        return this._http.post<{ query: string; analysis: QueryAnalysis; analyzedAt: string }>(
            `${this.BASE_URL}/api/sql/analyze-query`,
            payload,
            { headers: this.getHeaders() },
        );
    }

    // Connection Management Methods
    connect(connection: ConnectionConfig): Observable<{
        message: string;
        connectionId?: string;
        timestamp: string;
        database?: string;
    }> {
        getSafeSessionStorage().setItem('dbType', connection.dbType);
        return this._http
            .post<{
                message: string;
                connectionId?: string;
                timestamp: string;
                database?: string;
            }>(`${this.BASE_URL}/api/sql/connect`, connection, { headers: this.getHeaders() })
            .pipe(
                map((resp) => {
                    if (resp?.connectionId) {
                        getSafeSessionStorage().setItem('connectionId', resp.connectionId);
                    }
                    return resp;
                }),
            );
    }

    switchDatabase(dbName: string): Observable<{
        message: string;
        database: string;
        timestamp: string;
    }> {
        return this._http.post<{
            message: string;
            database: string;
            timestamp: string;
        }>(`${this.BASE_URL}/api/sql/switch-database`, { dbName }, { headers: this.getHeaders() });
    }

    getConnectionHealth(): Observable<ConnectionHealth> {
        return this._http.get<ConnectionHealth>(`${this.BASE_URL}/api/sql/health`, { headers: this.getHeaders() });
    }

    // AI Integration Methods
    // Server now fetches schema using x-connection-id; client sends only databaseName (optional) and prompt
    executeOpenAIPrompt(_dbMeta: DbMeta[], databaseName: string, prompt: string): Observable<OpenAIPromptResponse> {
        const payload = { databaseName, prompt };
        return this._http.post<OpenAIPromptResponse>(`${this.BASE_URL}/api/openai/prompt`, payload, {
            headers: this.getHeaders(),
        });
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
