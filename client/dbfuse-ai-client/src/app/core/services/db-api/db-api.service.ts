import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '@env/environment';
import { getSafeSessionStorage } from '@core/utils/browser-adapter';
import type {
    DbEnvelopeResponse,
    DbMetadataDatabasesResponse,
    DbMetadataTablesResponse,
    DbMetadataCollectionsResponse,
    DbMetadataKeyPatternsResponse,
    DbMetadataTableInfoResponse,
    DbMetadataMultipleTablesResponse,
    DbMetadataViewsResponse,
    DbMetadataProceduresResponse,
    DbQueryAnalysisResponse,
    DbMetadataStrategyResponse,
    DbQueryResponse,
    DbMultiQueryResponse,
    DbBatchQueryResponse,
    DbQueryRangeResponse,
    DbConnectResponse,
    DbSwitchResponse,
    DbHealthResponse,
    DbQueryPayload,
    DbConnectionConfig,
} from './db-api.types';

@Injectable({
    providedIn: 'root',
})
export class DbApiService {
    private readonly BASE_URL = environment.apiUrl;
    private readonly API_BASE = '/api/db';

    constructor(private readonly http: HttpClient) {}

    private unwrapEnvelopeData<T>(response: DbEnvelopeResponse<T>): T {
        return response.envelope.data;
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

    getDatabases(): Observable<DbMetadataDatabasesResponse> {
        return this.http
            .get<
                DbEnvelopeResponse<DbMetadataDatabasesResponse>
            >(`${this.BASE_URL}${this.API_BASE}/databases`, { headers: this.getHeaders() })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    getTables(dbName?: string): Observable<DbMetadataTablesResponse> {
        const url = `${this.BASE_URL}${this.API_BASE}/tables${dbName ? `?dbName=${encodeURIComponent(dbName)}` : ''}`;
        return this.http
            .get<DbEnvelopeResponse<DbMetadataTablesResponse>>(url, {
                headers: this.getHeaders(),
            })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    getCollections(dbName?: string): Observable<DbMetadataCollectionsResponse> {
        const url = `${this.BASE_URL}${this.API_BASE}/collections${dbName ? `?dbName=${encodeURIComponent(dbName)}` : ''}`;
        return this.http
            .get<DbEnvelopeResponse<DbMetadataCollectionsResponse>>(url, {
                headers: this.getHeaders(),
            })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    getCollectionInfo(collection: string, dbName?: string): Observable<DbMetadataTableInfoResponse> {
        const url = `${this.BASE_URL}${this.API_BASE}/collection-info?collection=${encodeURIComponent(collection)}${
            dbName ? `&dbName=${encodeURIComponent(dbName)}` : ''
        }`;
        return this.http
            .get<DbEnvelopeResponse<DbMetadataTableInfoResponse>>(url, {
                headers: this.getHeaders(),
            })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    getKeyPatterns(pattern?: string): Observable<DbMetadataKeyPatternsResponse> {
        const url = `${this.BASE_URL}${this.API_BASE}/key-patterns${pattern ? `?pattern=${encodeURIComponent(pattern)}` : ''}`;
        return this.http
            .get<DbEnvelopeResponse<DbMetadataKeyPatternsResponse>>(url, {
                headers: this.getHeaders(),
            })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    getTableInfo(dbName: string, table: string): Observable<DbMetadataTableInfoResponse> {
        const url = `${this.BASE_URL}${this.API_BASE}/table-info?table=${encodeURIComponent(table)}${
            dbName ? `&dbName=${encodeURIComponent(dbName)}` : ''
        }`;
        return this.http
            .get<DbEnvelopeResponse<DbMetadataTableInfoResponse>>(url, {
                headers: this.getHeaders(),
            })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    getMultipleTablesInfo(dbName: string, tables: string[]): Observable<DbMetadataMultipleTablesResponse> {
        const payload: any = { tables };
        if (dbName) payload.dbName = dbName;
        return this.http
            .post<
                DbEnvelopeResponse<DbMetadataMultipleTablesResponse>
            >(`${this.BASE_URL}${this.API_BASE}/info`, payload, { headers: this.getHeaders() })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    getViews(dbName?: string): Observable<DbMetadataViewsResponse> {
        const url = `${this.BASE_URL}${this.API_BASE}/views${dbName ? `?dbName=${encodeURIComponent(dbName)}` : ''}`;
        return this.http
            .get<DbEnvelopeResponse<DbMetadataViewsResponse>>(url, {
                headers: this.getHeaders(),
            })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    getProcedures(dbName?: string): Observable<DbMetadataProceduresResponse> {
        const url = `${this.BASE_URL}${this.API_BASE}/procedures${dbName ? `?dbName=${encodeURIComponent(dbName)}` : ''}`;
        return this.http
            .get<DbEnvelopeResponse<DbMetadataProceduresResponse>>(url, {
                headers: this.getHeaders(),
            })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    getStrategyMetadata(): Observable<DbMetadataStrategyResponse> {
        return this.http
            .get<
                DbEnvelopeResponse<DbMetadataStrategyResponse>
            >(`${this.BASE_URL}${this.API_BASE}/strategy-metadata`, { headers: this.getHeaders() })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    executeQuery(payload: DbQueryPayload): Observable<DbQueryResponse | DbMultiQueryResponse> {
        return this.http
            .post<
                DbEnvelopeResponse<DbQueryResponse | DbMultiQueryResponse>
            >(`${this.BASE_URL}${this.API_BASE}/query`, payload, { headers: this.getHeaders() })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    executeBatch(queries: string[], dbName?: string, transaction?: boolean): Observable<DbBatchQueryResponse> {
        const payload: any = { queries };
        if (dbName) payload.dbName = dbName;
        if (typeof transaction === 'boolean') payload.transaction = transaction;
        return this.http
            .post<
                DbEnvelopeResponse<DbBatchQueryResponse>
            >(`${this.BASE_URL}${this.API_BASE}/batch`, payload, { headers: this.getHeaders() })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    analyzeQuery(query: string): Observable<DbQueryAnalysisResponse> {
        return this.http
            .post<
                DbEnvelopeResponse<DbQueryAnalysisResponse>
            >(`${this.BASE_URL}${this.API_BASE}/analyze-query`, { query }, { headers: this.getHeaders() })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    connect(connection: DbConnectionConfig): Observable<DbConnectResponse> {
        getSafeSessionStorage().setItem('dbType', connection.dbType);
        return this.http
            .post<
                DbEnvelopeResponse<DbConnectResponse>
            >(`${this.BASE_URL}${this.API_BASE}/connect`, connection, { headers: this.getHeaders() })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    switchDatabase(dbName: string): Observable<DbSwitchResponse> {
        return this.http
            .post<
                DbEnvelopeResponse<DbSwitchResponse>
            >(`${this.BASE_URL}${this.API_BASE}/switch-database`, { dbName }, { headers: this.getHeaders() })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    getConnectionHealth(): Observable<DbHealthResponse> {
        return this.http
            .get<DbEnvelopeResponse<DbHealthResponse>>(`${this.BASE_URL}${this.API_BASE}/health`, {
                headers: this.getHeaders(),
            })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }

    queryRange(payload: {
        connectionId: string;
        query?: string;
        offset: number;
        limit: number;
        collectionName?: string;
        filter?: Record<string, any>;
        options?: Record<string, any>;
        paginationMode?: string;
        cursor?: string;
    }): Observable<{ success: boolean; data: DbQueryRangeResponse }> {
        return this.http
            .post<
                DbEnvelopeResponse<{ success: boolean; data: DbQueryRangeResponse }>
            >(`${this.BASE_URL}/api/query/range`, payload, { headers: this.getHeaders() })
            .pipe(map((response) => this.unwrapEnvelopeData(response)));
    }
}
