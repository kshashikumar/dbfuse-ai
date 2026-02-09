import { AppTheme } from '@core/services/theme/theme.config';

type StorageObjectMap = {
    appSession: {
        user: string;
        token: string;
    };
    appTheme: AppTheme;
};

export type StorageObjectType = 'appSession' | 'appTheme';

export type StorageObjectData<T extends StorageObjectType> = {
    type: T;
    data: StorageObjectMap[T];
};

export interface newTabData {
    dbName: string;
    tableName: string;
}

export interface openAIEvent {
    openAIEnabled: boolean;
}

export interface IndTableInfo {
    table_name: string;
    columns: any[];
    indexes: any[];
    foreign_keys: any[];
    triggers: any[];
}

interface Column {
    column_name: string;
    // Optional richer metadata for AI and UI features
    data_type?: string;
    is_nullable?: boolean;
    default_value?: any;
    extra?: string;
    is_primary_key?: boolean;
    length?: number | null;
    precision?: number | null;
    scale?: number | null;
}

interface Table {
    name: string;
    columns: Column[];
}

export interface DbMeta {
    name: string;
    sizeOnDisk: string;
    tables: Table[];
}

export type TaskStepType = 'plan' | 'execute' | 'result' | 'followup';
export type TaskStepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface TaskStep {
    taskId: string;
    stepId: string;
    type: TaskStepType;
    description: string;
    dbType: string;
    operation: string;
    capabilityRequired: string | null;
    payload: any;
    requiresConfirmation: boolean;
    dependsOn: string[];
    status: TaskStepStatus;
    result: any;
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
}

export interface RAGPromptResponse {
    queryId?: string;
    taskId?: string;
    query: string;
    strategy?: string;
    analysis?: Record<string, any>;
    explanation?: string | null;
    suggestions?: string[] | null;
    taskSteps?: TaskStep[];
    context?: {
        tables?: {
            name: string;
            score?: number;
            columns?: string[];
        }[];
        relationships?: {
            from?: string;
            to?: string;
            metadata?: Record<string, any> | null;
        }[];
    } | null;
    timestamp?: string;
}

export interface RAGHistoryEntry {
    id: string;
    nlQuery: string;
    generatedQuery: string;
    strategy?: string | null;
    success?: boolean;
    executionTime?: number | null;
    feedback?: Record<string, any> | null;
    createdAt?: number | null;
}

export interface RAGHistoryResponse {
    history: RAGHistoryEntry[];
    timestamp?: string;
}

// Enhanced storage types to support new backend features

// Database Types
export type DatabaseType =
    | 'mysql2'
    | 'pg'
    | 'sqlite3'
    | 'mssql'
    | 'oracledb'
    | 'mongodb'
    | 'redis'
    | 'couchdb'
    | 'cosmosdb'
    | 'firestore'
    | 'dynamodb'
    | 'cassandra'
    | 'hbase'
    | 'memcached';

// Basic Connection Interface (existing structure)
export interface Connection {
    id: number | string; // Allow both for backward compatibility
    username: string;
    password: string;
    host: string;
    port: number;
    dbType: DatabaseType;
    database?: string;
    databaseDisplay?: string; // For user-friendly display names
    databaseShort?: string; // Shortened display name
    databasePath?: string; // Full path for SQLite
    socketPath?: string;
    status?: string;
    createdAt?: string;
    lastUsed?: string | null;

    // Enhanced optional parameters
    ssl?: boolean | object;
    connectionTimeout?: number;
    poolSize?: number;

    // MySQL specific
    charset?: string;
    timezone?: string;
    acquireTimeout?: number;
    waitForConnections?: boolean;
    queueLimit?: number;
    reconnect?: boolean;
    idleTimeout?: number;

    // PostgreSQL specific
    maxConnections?: number;
    statement_timeout?: number;
    query_timeout?: number;
    application_name?: string;
    schema?: string;

    // MSSQL specific
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    instanceName?: string;
    domain?: string;
    requestTimeout?: number;
    cancelTimeout?: number;
    packetSize?: number;
    appName?: string;

    // Oracle specific
    serviceName?: string;
    sid?: string;
    walletLocation?: string;
    walletPassword?: string;
    edition?: string;
    privilege?: string;
    externalAuth?: boolean;
    poolMin?: number;
    poolTimeout?: number;

    // SQLite specific
    mode?: string;
    verbose?: boolean;
    busyTimeout?: number;
    cacheSize?: number;
    pageSize?: number;
    journalMode?: string;
    synchronous?: string | boolean;
    tempStore?: string;
    lockingMode?: string;
    foreignKeys?: boolean;
    readOnly?: boolean;

    // NoSQL optional fields
    endpoint?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    projectId?: string;
    key?: string;
    primaryKey?: string;
    contactPoints?: string[];
    dataCenter?: string;
    protocol?: string;
    options?: Record<string, any>;
}

// Connection Configuration for creating/editing connections
export interface ConnectionConfig extends Omit<Connection, 'id' | 'status' | 'createdAt' | 'lastUsed'> {
    // All Connection fields except id and status fields
}

// Connection Response from backend
export interface ConnectionResponse {
    message: string;
    connection?: Connection;
    timestamp?: string;
}

// Database Statistics
export interface DatabaseStats {
    name: string;
    sizeOnDisk: number;
    tables: { name: string }[];
    views: { name: string }[];
    error?: string; // For databases with access issues
}

// Enhanced Table Information
export interface TableInfo {
    db_name: string;
    table_name: string;
    columns: {
        column_name: string;
        data_type?: string;
        is_nullable?: boolean;
        default_value?: any;
        extra?: string;
        data_length?: number;
        is_primary_key?: boolean;
        length?: number | null;
        precision?: number | null;
        scale?: number | null;
    }[];
    indexes: {
        index_name: string;
        is_unique?: boolean;
        type?: string;
        column_name?: string;
        definition?: string;
        origin?: string;
    }[];
    foreign_keys: {
        fk_name: string;
        column_name?: string;
        referenced_table?: string;
        referenced_column?: string;
        definition?: string;
        referenced_constraint?: string;
        delete_rule?: string;
        table_name?: string;
    }[];
    triggers: {
        trigger_name: string;
        event?: string;
        timing?: string;
        trigger_type?: string;
        triggering_event?: string;
        status?: string;
        definition?: string;
        sql?: string;
        is_disabled?: boolean;
    }[];
    sampleDocuments?: any[];
    documentCount?: number | null;
    sampleKeys?: {
        key: string;
        type?: string;
        ttl?: number | null;
        valuePreview?: string | null;
    }[];
}

// Multiple Tables Information Response
export interface MultipleTablesInfo {
    tables: TableInfo[];
}

// Query Execution Result
export interface QueryMessage {
    query: string;
    message: string;
    type?: string;
    affectedRows?: number;
    insertId?: number | null;
    warningCount?: number;
}

export interface QueryPagination {
    page: number;
    pageSize: number;
    totalPages: number | null;
    hasMore?: boolean;
}

export interface QueryResultItem {
    type: string; // SELECT / SHOW / INSERT / ...
    query: string; // original statement text
    rows: any[]; // result rows (empty for non-SELECT)
    totalRows: number; // total rows for the statement
    messages: QueryMessage[]; // statement-specific messages
    pagination?: QueryPagination; // per-statement pagination
}

export interface QueryResultMulti {
    queries: QueryResultItem[];
    totalQueries: number;
    executedAt: string;
}

export type QueryResult = QueryResultMulti; // or union with legacy single shape if you still need it

// Query Message
export interface QueryMessage {
    query: string;
    message: string;
    affectedRows?: number;
    insertId?: number | null;
    lastInsertId?: number | null;
    warningCount?: number;
    type?: string;
}

// Batch Query Result
export interface BatchQueryResult {
    results: QueryResult[];
    totalQueries: number;
    executedAt: string;
    mode: 'batch' | 'transaction';
    success: boolean;
}

// Query Analysis
export interface QueryAnalysis {
    type: string;
    isReadOnly: boolean;
    requiresTransaction: boolean;
    supportsPagination: boolean;
    queryLength?: number;
}

// Connection Health
export interface ConnectionHealth {
    status: 'healthy' | 'unhealthy';
    connected?: boolean;
    dbType?: string;
    connectionInfo?: any;
    activeConnections?: number;
    error?: string;
    timestamp: string;
    health?: any;
}

export interface ConfigData {
    AI_MODEL: string;
    AI_API_KEY: string;
    AI_PROVIDER: string;
    PORT: number;
    DBFUSE_USERNAME: string;
    DBFUSE_PASSWORD: string;
    DBFUSE_CONNECTIONS_KEY?: string;
}

export interface SaveResponse {
    message: string;
    requiresRestart?: boolean;
    newPort?: number;
    connectionsCleared?: boolean;
}

export interface ModelOption {
    provider: string;
    models: string[];
}

export interface AIModelCatalogResponse {
    providers: ModelOption[];
    fallbackModel?: string;
    generatedAt?: string;
}

// Query Options
export interface QueryOptions {
    page?: number;
    pageSize?: number;
    timeout?: number;
    analyze?: boolean;
}

// Connection Statistics
export interface ConnectionStats {
    totalConnections?: number;
    activeConnections?: number;
    idleConnections?: number;
    poolTotal?: number;
    poolIdle?: number;
    poolWaiting?: number;
    poolConnected?: boolean;
    poolConnecting?: boolean;
    databaseName?: string;
    tableCount?: number;
    indexCount?: number;
    viewCount?: number;
    isMemoryDb?: boolean;
    totalSessions?: number;
    activeSessions?: number;
    inactiveSessions?: number;
    poolConnections?: number;
}

// Error Response
export interface ErrorResponse {
    error: string;
    timestamp?: string;
    details?: any;
}

// API Response Wrapper
export interface ApiResponse<T> {
    data?: T;
    error?: string;
    message?: string;
    timestamp?: string;
    status?: number;
}

// Connection Validation Result
export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings?: string[];
}
// Query Enrichment Types
export interface EnrichedEntity {
    name: string;
    type: 'table' | 'collection' | 'keyspace';
    score: number;
    schema?: any;
}

export interface QueryCapabilities {
    type: 'sql' | 'nosql' | 'cache';
    operations: string[];
    features: string[];
}

export interface PlannedStep {
    id: string;
    label: string;
    confidence: number;
    reasoning?: string;
}

export interface AlternativeStrategy {
    name: string;
    description: string;
}

export interface EnrichedQueryContext {
    queryIntent: string;
    confidence: number;
    reasoning?: string;
    complexity: 'simple' | 'medium' | 'complex';
    selectedStrategy: string;
    alternativeStrategies: AlternativeStrategy[];
    plannedSteps: PlannedStep[];
    availableEntities?: string[];
    availableEntitiesCount?: number;
    availableEntitiesPreview?: string[];
    relevantEntities: EnrichedEntity[];
    capabilities: QueryCapabilities;
    phase: 'quick' | 'semantic' | 'full' | 'fallback';
    timestamp: string;
    error?: string;
    errorType?: 'timeout' | 'network' | 'schema' | 'strategy' | 'llm' | 'unknown';
    fallbackUsed?: boolean;
    warnings?: string[];
}
// Database Schema Information
export interface SchemaInfo {
    databases: DatabaseStats[];
    currentDatabase?: string;
    connectionInfo?: Connection;
    retrievedAt: string;
}

// Table Schema for detailed view
export interface TableSchema extends TableInfo {
    rowCount?: number;
    estimatedSize?: number;
    lastModified?: string;
    engine?: string;
    collation?: string;
    comment?: string;
}

// View Information
export interface ViewInfo {
    view_name: string;
    definition: string;
    is_updatable?: boolean;
    check_option?: string;
    definer?: string;
    security_type?: string;
}

// Procedure Information
export interface ProcedureInfo {
    procedure_name: string;
    routine_type: string;
    data_type?: string;
    routine_definition?: string;
    is_deterministic?: boolean;
    sql_data_access?: string;
    security_type?: string;
    definer?: string;
    created?: string;
    modified?: string;
}

export type {
    Connection as ConnectionData,
    ConnectionConfig as NewConnection,
    TableInfo as TableData,
    QueryResult as QueryResponse,
};
