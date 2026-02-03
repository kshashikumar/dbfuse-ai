import type { DatabaseType } from '@core/utils/storage/storage.types';

export type DbUiSurface = 'sql' | 'nosql' | 'cache';

export type DbTypeRegistryEntry = {
    dbType: DatabaseType;
    label: string;
    category: DbUiSurface;
    defaultPort?: number;
    supports: {
        sqlEditor: boolean;
        nosqlExplorer: boolean;
        cacheExplorer: boolean;
        aiQueryGeneration: boolean;
        metadata: boolean;
    };
    connection?: {
        isFileBased?: boolean;
        omitUsername?: boolean;
    };
    explorer?: {
        databaseLabel?: string;
        collectionLabel?: string;
        detailLabel?: string;
        defaultEditorText?: string;
        showIndexStats?: boolean;
        showKeyStats?: boolean;
    };
    migrationNotes?: string;
};

export const DB_TYPE_REGISTRY: Record<DatabaseType, DbTypeRegistryEntry> = {
    mysql2: {
        dbType: 'mysql2',
        label: 'MySQL',
        category: 'sql',
        defaultPort: 3306,
        supports: {
            sqlEditor: true,
            nosqlExplorer: false,
            cacheExplorer: false,
            aiQueryGeneration: true,
            metadata: true,
        },
    },
    pg: {
        dbType: 'pg',
        label: 'PostgreSQL',
        category: 'sql',
        defaultPort: 5432,
        supports: {
            sqlEditor: true,
            nosqlExplorer: false,
            cacheExplorer: false,
            aiQueryGeneration: true,
            metadata: true,
        },
    },
    sqlite3: {
        dbType: 'sqlite3',
        label: 'SQLite',
        category: 'sql',
        supports: {
            sqlEditor: true,
            nosqlExplorer: false,
            cacheExplorer: false,
            aiQueryGeneration: true,
            metadata: true,
        },
        connection: {
            isFileBased: true,
        },
        migrationNotes: 'Local file-backed DB; dbName maps to file path.',
    },
    mssql: {
        dbType: 'mssql',
        label: 'MSSQL',
        category: 'sql',
        defaultPort: 1433,
        supports: {
            sqlEditor: true,
            nosqlExplorer: false,
            cacheExplorer: false,
            aiQueryGeneration: true,
            metadata: true,
        },
    },
    oracledb: {
        dbType: 'oracledb',
        label: 'Oracle',
        category: 'sql',
        defaultPort: 1521,
        supports: {
            sqlEditor: true,
            nosqlExplorer: false,
            cacheExplorer: false,
            aiQueryGeneration: true,
            metadata: true,
        },
    },
    mongodb: {
        dbType: 'mongodb',
        label: 'MongoDB',
        category: 'nosql',
        defaultPort: 27017,
        supports: {
            sqlEditor: false,
            nosqlExplorer: true,
            cacheExplorer: false,
            aiQueryGeneration: false,
            metadata: true,
        },
        connection: {
            omitUsername: true,
        },
        explorer: {
            databaseLabel: 'Databases',
            collectionLabel: 'Collections',
            detailLabel: 'Documents',
            defaultEditorText:
                '{\\n  \"operation\": \"find\",\\n  \"collection\": \"your_collection\",\\n  \"filter\": {},\\n  \"options\": { \"limit\": 50 }\\n}\\n',
            showIndexStats: true,
        },
    },
    redis: {
        dbType: 'redis',
        label: 'Redis',
        category: 'cache',
        defaultPort: 6379,
        supports: {
            sqlEditor: false,
            nosqlExplorer: false,
            cacheExplorer: true,
            aiQueryGeneration: false,
            metadata: true,
        },
        connection: {
            omitUsername: true,
        },
        explorer: {
            databaseLabel: 'Keyspaces',
            collectionLabel: 'Key groups',
            detailLabel: 'Keys',
            defaultEditorText: '{\\n  \"operation\": \"get\",\\n  \"key\": \"example:key\"\\n}\\n',
            showKeyStats: true,
        },
    },
    couchdb: {
        dbType: 'couchdb',
        label: 'CouchDB',
        category: 'nosql',
        defaultPort: 5984,
        supports: {
            sqlEditor: false,
            nosqlExplorer: true,
            cacheExplorer: false,
            aiQueryGeneration: false,
            metadata: true,
        },
        connection: {
            omitUsername: true,
        },
        explorer: {
            databaseLabel: 'Databases',
            collectionLabel: 'Collections',
            detailLabel: 'Documents',
        },
    },
    cosmosdb: {
        dbType: 'cosmosdb',
        label: 'Cosmos DB',
        category: 'nosql',
        supports: {
            sqlEditor: false,
            nosqlExplorer: true,
            cacheExplorer: false,
            aiQueryGeneration: false,
            metadata: true,
        },
        connection: {
            omitUsername: true,
        },
        explorer: {
            databaseLabel: 'Databases',
            collectionLabel: 'Collections',
            detailLabel: 'Documents',
        },
    },
    firestore: {
        dbType: 'firestore',
        label: 'Firestore',
        category: 'nosql',
        supports: {
            sqlEditor: false,
            nosqlExplorer: true,
            cacheExplorer: false,
            aiQueryGeneration: false,
            metadata: true,
        },
        connection: {
            omitUsername: true,
        },
        explorer: {
            databaseLabel: 'Projects',
            collectionLabel: 'Collections',
            detailLabel: 'Documents',
        },
    },
    dynamodb: {
        dbType: 'dynamodb',
        label: 'DynamoDB',
        category: 'nosql',
        supports: {
            sqlEditor: false,
            nosqlExplorer: true,
            cacheExplorer: false,
            aiQueryGeneration: false,
            metadata: true,
        },
        connection: {
            omitUsername: true,
        },
        explorer: {
            databaseLabel: 'Regions',
            collectionLabel: 'Tables',
            detailLabel: 'Items',
        },
    },
    cassandra: {
        dbType: 'cassandra',
        label: 'Cassandra',
        category: 'nosql',
        defaultPort: 9042,
        supports: {
            sqlEditor: false,
            nosqlExplorer: true,
            cacheExplorer: false,
            aiQueryGeneration: false,
            metadata: true,
        },
        connection: {
            omitUsername: true,
        },
        explorer: {
            databaseLabel: 'Keyspaces',
            collectionLabel: 'Tables',
            detailLabel: 'Rows',
        },
    },
    hbase: {
        dbType: 'hbase',
        label: 'HBase',
        category: 'nosql',
        defaultPort: 9090,
        supports: {
            sqlEditor: false,
            nosqlExplorer: true,
            cacheExplorer: false,
            aiQueryGeneration: false,
            metadata: true,
        },
        connection: {
            omitUsername: true,
        },
        explorer: {
            databaseLabel: 'Namespaces',
            collectionLabel: 'Tables',
            detailLabel: 'Rows',
        },
    },
    memcached: {
        dbType: 'memcached',
        label: 'Memcached',
        category: 'cache',
        defaultPort: 11211,
        supports: {
            sqlEditor: false,
            nosqlExplorer: false,
            cacheExplorer: true,
            aiQueryGeneration: false,
            metadata: true,
        },
        connection: {
            omitUsername: true,
        },
        explorer: {
            databaseLabel: 'Keyspaces',
            collectionLabel: 'Key groups',
            detailLabel: 'Keys',
        },
    },
};

export const DB_TYPE_REGISTRY_LIST: DbTypeRegistryEntry[] = Object.values(DB_TYPE_REGISTRY);

export const getDbTypeEntry = (dbType: DatabaseType): DbTypeRegistryEntry => DB_TYPE_REGISTRY[dbType];
