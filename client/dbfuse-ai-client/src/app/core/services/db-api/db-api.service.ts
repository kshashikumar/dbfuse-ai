import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
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

    getDatabases(): Observable<DbEnvelopeResponse<DbMetadataDatabasesResponse>> {
        return this.http.get<DbEnvelopeResponse<DbMetadataDatabasesResponse>>(
            `${this.BASE_URL}${this.API_BASE}/databases`,
            { headers: this.getHeaders() },
        );
    }

    getTables(dbName?: string): Observable<DbEnvelopeResponse<DbMetadataTablesResponse>> {
        const url = `${this.BASE_URL}${this.API_BASE}/tables${dbName ? `?dbName=${encodeURIComponent(dbName)}` : ''}`;
        return this.http.get<DbEnvelopeResponse<DbMetadataTablesResponse>>(url, {
            headers: this.getHeaders(),
        });
    }

    getCollections(dbName?: string): Observable<DbEnvelopeResponse<DbMetadataCollectionsResponse>> {
        const url = `${this.BASE_URL}${this.API_BASE}/collections${dbName ? `?dbName=${encodeURIComponent(dbName)}` : ''}`;
        return this.http.get<DbEnvelopeResponse<DbMetadataCollectionsResponse>>(url, {
            headers: this.getHeaders(),
        });
    }

    getCollectionInfo(
        collection: string,
        dbName?: string,
    ): Observable<DbEnvelopeResponse<DbMetadataTableInfoResponse>> {
        const url = `${this.BASE_URL}${this.API_BASE}/collection-info?collection=${encodeURIComponent(collection)}${
            dbName ? `&dbName=${encodeURIComponent(dbName)}` : ''
        }`;
        return this.http.get<DbEnvelopeResponse<DbMetadataTableInfoResponse>>(url, {
            headers: this.getHeaders(),
        });
    }

    getKeyPatterns(pattern?: string): Observable<DbEnvelopeResponse<DbMetadataKeyPatternsResponse>> {
        const url = `${this.BASE_URL}${this.API_BASE}/key-patterns${pattern ? `?pattern=${encodeURIComponent(pattern)}` : ''}`;
        return this.http.get<DbEnvelopeResponse<DbMetadataKeyPatternsResponse>>(url, {
            headers: this.getHeaders(),
        });
    }

    getTableInfo(dbName: string, table: string): Observable<DbEnvelopeResponse<DbMetadataTableInfoResponse>> {
        const url = `${this.BASE_URL}${this.API_BASE}/table-info?table=${encodeURIComponent(table)}${
            dbName ? `&dbName=${encodeURIComponent(dbName)}` : ''
        }`;
        return this.http.get<DbEnvelopeResponse<DbMetadataTableInfoResponse>>(url, {
            headers: this.getHeaders(),
        });
    }

    getMultipleTablesInfo(
        dbName: string,
        tables: string[],
    ): Observable<DbEnvelopeResponse<DbMetadataMultipleTablesResponse>> {
        const payload: any = { tables };
        if (dbName) payload.dbName = dbName;
        return this.http.post<DbEnvelopeResponse<DbMetadataMultipleTablesResponse>>(
            `${this.BASE_URL}${this.API_BASE}/info`,
            payload,
            { headers: this.getHeaders() },
        );
    }

    getViews(dbName?: string): Observable<DbEnvelopeResponse<DbMetadataViewsResponse>> {
        const url = `${this.BASE_URL}${this.API_BASE}/views${dbName ? `?dbName=${encodeURIComponent(dbName)}` : ''}`;
        return this.http.get<DbEnvelopeResponse<DbMetadataViewsResponse>>(url, {
            headers: this.getHeaders(),
        });
    }

    getProcedures(dbName?: string): Observable<DbEnvelopeResponse<DbMetadataProceduresResponse>> {
        const url = `${this.BASE_URL}${this.API_BASE}/procedures${dbName ? `?dbName=${encodeURIComponent(dbName)}` : ''}`;
        return this.http.get<DbEnvelopeResponse<DbMetadataProceduresResponse>>(url, {
            headers: this.getHeaders(),
        });
    }

    getStrategyMetadata(): Observable<DbEnvelopeResponse<DbMetadataStrategyResponse>> {
        return this.http.get<DbEnvelopeResponse<DbMetadataStrategyResponse>>(
            `${this.BASE_URL}${this.API_BASE}/strategy-metadata`,
            { headers: this.getHeaders() },
        );
    }

    executeQuery(payload: DbQueryPayload): Observable<DbEnvelopeResponse<DbQueryResponse | DbMultiQueryResponse>> {
        return this.http.post<DbEnvelopeResponse<DbQueryResponse | DbMultiQueryResponse>>(
            `${this.BASE_URL}${this.API_BASE}/query`,
            payload,
            { headers: this.getHeaders() },
        );
    }

    executeBatch(
        queries: string[],
        dbName?: string,
        transaction?: boolean,
    ): Observable<DbEnvelopeResponse<DbBatchQueryResponse>> {
        const payload: any = { queries };
        if (dbName) payload.dbName = dbName;
        if (typeof transaction === 'boolean') payload.transaction = transaction;
        return this.http.post<DbEnvelopeResponse<DbBatchQueryResponse>>(
            `${this.BASE_URL}${this.API_BASE}/batch`,
            payload,
            { headers: this.getHeaders() },
        );
    }

    analyzeQuery(query: string): Observable<DbEnvelopeResponse<DbQueryAnalysisResponse>> {
        return this.http.post<DbEnvelopeResponse<DbQueryAnalysisResponse>>(
            `${this.BASE_URL}${this.API_BASE}/analyze-query`,
            { query },
            { headers: this.getHeaders() },
        );
    }

    connect(connection: DbConnectionConfig): Observable<DbEnvelopeResponse<DbConnectResponse>> {
        getSafeSessionStorage().setItem('dbType', connection.dbType);
        return this.http.post<DbEnvelopeResponse<DbConnectResponse>>(
            `${this.BASE_URL}${this.API_BASE}/connect`,
            connection,
            { headers: this.getHeaders() },
        );
    }

    switchDatabase(dbName: string): Observable<DbEnvelopeResponse<DbSwitchResponse>> {
        return this.http.post<DbEnvelopeResponse<DbSwitchResponse>>(
            `${this.BASE_URL}${this.API_BASE}/switch-database`,
            { dbName },
            { headers: this.getHeaders() },
        );
    }

    getConnectionHealth(): Observable<DbEnvelopeResponse<DbHealthResponse>> {
        return this.http.get<DbEnvelopeResponse<DbHealthResponse>>(`${this.BASE_URL}${this.API_BASE}/health`, {
            headers: this.getHeaders(),
        });
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
    }): Observable<DbEnvelopeResponse<{ success: boolean; data: DbQueryRangeResponse }>> {
        return this.http.post<DbEnvelopeResponse<{ success: boolean; data: DbQueryRangeResponse }>>(
            `${this.BASE_URL}/api/query/range`,
            payload,
            { headers: this.getHeaders() },
        );
    }
}
