import type { DatabaseStats, TableInfo, DatabaseType, QueryAnalysis } from '@core/utils/storage/storage.types';

export type DbEnvelopeKind = 'metadata' | 'query';

export type DbCapabilityType = 'sql' | 'nosql' | 'cache' | 'unknown';

export type DbCapabilities = {
    type: DbCapabilityType;
    operations: string[];
    features: string[];
    limits?: Record<string, any>;
};

export type DbEnvelopeRequest = {
    dbType?: string | null;
    connectionId?: string | null;
};

export type DbEnvelopeMeta = {
    timestamp: string;
    operation?: string;
    capabilities?: DbCapabilities;
    [key: string]: any;
};

export type DbEnvelope<T> = {
    contract: string;
    version: string;
    kind: DbEnvelopeKind;
    request?: DbEnvelopeRequest;
    meta?: DbEnvelopeMeta;
    data: T;
};

export type DbEnvelopeResponse<T> = {
    envelope: DbEnvelope<T>;
};

export type DbPagination = {
    page: number;
    pageSize: number;
    totalPages?: number | null;
    hasMore?: boolean | null;
};

export type DbMetadataDatabasesResponse = {
    databases: DatabaseStats[];
    count?: number;
    retrievedAt?: string;
    executionTime?: number;
};

export type DbMetadataTablesResponse = {
    tables: string[];
    count?: number;
    database?: string | null;
    retrievedAt?: string;
    executionTime?: number;
};

export type DbMetadataCollectionsResponse = {
    collections: string[];
    count?: number;
    database?: string | null;
    retrievedAt?: string;
    executionTime?: number;
};

export type DbMetadataKeyPatternsResponse = {
    keys: string[];
    count?: number;
    pattern?: string;
    retrievedAt?: string;
    executionTime?: number;
};

export type DbMetadataTableInfoResponse = TableInfo & {
    retrievedAt?: string;
    executionTime?: number;
};

export type DbMetadataMultipleTablesResponse = {
    tables: DbMetadataTableInfoResponse[];
    count?: number;
    database?: string | null;
    retrievedAt?: string;
    executionTime?: number;
};

export type DbMetadataViewsResponse = {
    views: any[];
    count?: number;
    database?: string | null;
    retrievedAt?: string;
};

export type DbMetadataProceduresResponse = {
    procedures: any[];
    count?: number;
    database?: string | null;
    retrievedAt?: string;
};

export type DbQueryAnalysisResponse = {
    query: string;
    analysis: QueryAnalysis;
    analyzedAt?: string;
};

export type DbMetadataStrategyResponse = {
    dbType: string;
    metadata: {
        name?: string;
        version?: string;
        type?: string;
        capabilities?: string[];
        supportedFeatures?: string[];
    };
    retrievedAt?: string;
};

export type DbQueryResponse = {
    rows?: any[];
    documents?: any[];
    totalRows?: number | null;
    messages?: string[];
    pagination?: DbPagination | null;
    executedAt?: string;
    cached?: boolean;
    query?: string;
};

export type DbMultiQueryResponse = {
    queries: DbQueryResponse[];
    totalQueries?: number;
    executedAt?: string;
};

export type DbBatchQueryResponse = {
    results: DbQueryResponse[];
    totalQueries?: number;
    executedAt?: string;
    executionTime?: number;
    mode?: string;
};

export type DbQueryRangeResponse = {
    rows: any[];
    hasMore: boolean;
    columns?: any[];
};

export type DbConnectResponse = {
    message: string;
    connectionId?: string;
    database?: string;
    timestamp?: string;
};

export type DbSwitchResponse = {
    message: string;
    database: string;
    timestamp?: string;
};

export type DbHealthResponse = {
    status: 'healthy' | 'unhealthy';
    connected?: boolean;
    dbType?: string | null;
    error?: string;
};

export type DbQueryPayload = {
    query: string | Record<string, any>;
    page?: number;
    pageSize?: number;
    dbName?: string;
    useCache?: boolean;
};

export type DbConnectionConfig = {
    dbType: DatabaseType;
    database?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    socketPath?: string;
    [key: string]: any;
};
