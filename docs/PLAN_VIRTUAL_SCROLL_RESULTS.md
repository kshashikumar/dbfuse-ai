# Virtual Scroll Implementation Plan for Result Grid

## Overview

Replace fixed pagination with virtual scrolling to efficiently handle millions of records by loading data on-demand as users scroll.

## Architecture

### Current State

- Fixed pagination: Page 1, 2, 3... with configurable page size
- Loads all data for current page
- Memory-intensive for large datasets
- Works on: SQL Explorer, Chat Results

### Target State

- Virtual scrolling with infinite scroll behavior
- Loads small chunks (e.g., 100 rows) on-demand
- Maintains a sliding window of data in memory
- Reuses DOM elements for rendering
- Database-agnostic API

---

## Frontend Implementation

### 1. Virtual Scroll Component

**Create:** `src/app/shared/components/virtual-scroll-table/virtual-scroll-table.component.ts`

**Features:**

- Uses Angular CDK Virtual Scroll
- Viewport height: Calculate based on container
- Item size: Fixed row height (e.g., 40px)
- Buffer size: 10 items before/after viewport
- Smooth scrolling experience

**Inputs:**

```typescript
@Input() columns: ColumnDef[];          // Column definitions
@Input() dataSource: VirtualDataSource; // Data source with lazy loading
@Input() rowHeight: number = 40;        // Fixed row height in pixels
@Input() bufferSize: number = 10;       // Extra rows to render
```

**Template Structure:**

```html
<cdk-virtual-scroll-viewport
  [itemSize]="rowHeight"
  [minBufferPx]="rowHeight * bufferSize"
  [maxBufferPx]="rowHeight * bufferSize * 2"
  class="virtual-scroll-viewport"
>
  <table>
    <thead>
      <!-- Sticky header -->
    </thead>
    <tbody>
      <tr *cdkVirtualFor="let row of dataSource" [style.height.px]="rowHeight">
        <td *ngFor="let col of columns">{{ row[col.name] }}</td>
      </tr>
    </tbody>
  </table>
</cdk-virtual-scroll-viewport>
```

### 2. Virtual Data Source

**Create:** `src/app/shared/services/virtual-data-source.service.ts`

**Responsibilities:**

- Implements `DataSource` interface
- Tracks scroll position and visible range
- Requests data chunks from backend
- Caches loaded chunks in memory
- Evicts old chunks when memory limit reached

**Key Methods:**

```typescript
class VirtualDataSource extends DataSource<any> {
  private cache = new Map<number, any[]>(); // chunk index -> rows
  private chunkSize = 100;
  private maxCachedChunks = 20; // Keep last 2000 rows in memory

  connect(collectionViewer: CollectionViewer): Observable<any[]> {
    return collectionViewer.viewChange.pipe(
      debounceTime(50),
      switchMap((range) => this.fetchRange(range.start, range.end)),
    );
  }

  private fetchRange(start: number, end: number): Observable<any[]> {
    // Calculate which chunks are needed
    // Check cache, fetch missing chunks
    // Return merged result
  }

  private fetchChunk(chunkIndex: number): Observable<any[]> {
    const offset = chunkIndex * this.chunkSize;
    return this.backendService.fetchRows(offset, this.chunkSize);
  }
}
```

### 3. Update Existing Components

**A. SQL Explorer (home.component.ts):**

- Replace `<app-resultgrid>` with `<app-virtual-scroll-table>`
- Initialize VirtualDataSource with connection and query
- Remove pagination controls

**B. Chat Results (chat.component.ts):**

- Replace inline table with `<app-virtual-scroll-table>`
- Initialize VirtualDataSource from tableData
- Keep export functionality

---

## Backend Implementation

### 1. Database Strategy Interface

**Update:** `src/config/strategies/base/database-strategy.js`

Add new method for range-based queries:

```javascript
/**
 * Fetch rows in a specific range (offset-based pagination)
 * @param {string} query - Base query without LIMIT/OFFSET
 * @param {number} offset - Starting row index (0-based)
 * @param {number} limit - Number of rows to fetch
 * @returns {Promise<{rows: any[], hasMore: boolean}>}
 */
async fetchRowRange(query, offset, limit) {
  throw new Error("fetchRowRange must be implemented by subclass");
}
```

### 2. SQL Database Implementations

**A. MySQL Strategy** (`mysql-strategy.js`):

```javascript
async fetchRowRange(query, offset, limit) {
  const paginatedQuery = `${query} LIMIT ${limit} OFFSET ${offset}`;
  const result = await this.pool.query(paginatedQuery);
  return {
    rows: result[0],
    hasMore: result[0].length === limit // If full page, might have more
  };
}
```

**B. PostgreSQL Strategy** (`pg-strategy.js`):

```javascript
async fetchRowRange(query, offset, limit) {
  const paginatedQuery = `${query} LIMIT ${limit} OFFSET ${offset}`;
  const result = await this.pool.query(paginatedQuery);
  return {
    rows: result.rows,
    hasMore: result.rows.length === limit
  };
}
```

**C. SQL Server Strategy** (`mssql-strategy.js`):

```javascript
async fetchRowRange(query, offset, limit) {
  // SQL Server 2012+ syntax
  const paginatedQuery = `
    ${query}
    ORDER BY (SELECT NULL) -- Required for OFFSET
    OFFSET ${offset} ROWS
    FETCH NEXT ${limit} ROWS ONLY
  `;
  const result = await this.pool.request().query(paginatedQuery);
  return {
    rows: result.recordset,
    hasMore: result.recordset.length === limit
  };
}
```

**D. Oracle Strategy** (`oracledb-strategy.js`):

```javascript
async fetchRowRange(query, offset, limit) {
  const paginatedQuery = `
    ${query}
    OFFSET ${offset} ROWS
    FETCH NEXT ${limit} ROWS ONLY
  `;
  const result = await this.connection.execute(paginatedQuery);
  return {
    rows: result.rows,
    hasMore: result.rows.length === limit
  };
}
```

**E. SQLite Strategy** (`sqlite3-strategy.js`):

```javascript
async fetchRowRange(query, offset, limit) {
  const paginatedQuery = `${query} LIMIT ${limit} OFFSET ${offset}`;
  return new Promise((resolve, reject) => {
    this.db.all(paginatedQuery, [], (err, rows) => {
      if (err) reject(err);
      else resolve({
        rows,
        hasMore: rows.length === limit
      });
    });
  });
}
```

### 3. NoSQL Database Implementations

**A. MongoDB Strategy** (`mongodb-strategy.js`):

```javascript
async fetchRowRange(collectionName, filter, offset, limit) {
  const collection = this.db.collection(collectionName);
  const rows = await collection
    .find(filter)
    .skip(offset)
    .limit(limit)
    .toArray();
  return {
    rows,
    hasMore: rows.length === limit
  };
}
```

**B. Redis Strategy** (`redis-strategy.js`):

```javascript
async fetchRowRange(key, pattern, offset, limit) {
  // For SCAN operations
  const cursor = offset.toString();
  const result = await this.client.scan(
    cursor,
    'MATCH', pattern,
    'COUNT', limit
  );
  return {
    rows: result[1].map(key => ({ key })),
    hasMore: result[0] !== '0', // More if cursor != 0
    nextCursor: result[0]
  };
}
```

**C. Cassandra Strategy** (`cassandra-strategy.js`):

```javascript
async fetchRowRange(query, pageState, limit) {
  const options = {
    prepare: true,
    fetchSize: limit,
    pageState: pageState // From previous request
  };
  const result = await this.client.execute(query, [], options);
  return {
    rows: result.rows,
    hasMore: !!result.pageState,
    pageState: result.pageState // For next request
  };
}
```

### 4. New API Endpoint

**Create:** `src/routes/queryRangeRoutes.js`

```javascript
router.post("/api/query/range", async (req, res) => {
  const { connectionId, query, offset, limit } = req.body;

  // Validate inputs
  if (offset < 0 || limit < 1 || limit > 1000) {
    return res.status(400).json({ error: "Invalid range" });
  }

  const strategy = connectionManager.getStrategy(connectionId);
  const result = await strategy.fetchRowRange(query, offset, limit);

  res.json(result);
});
```

**Update:** `src/services/DatabaseService.js`

```javascript
async fetchQueryRange(connectionId, query, offset, limit) {
  const strategy = this.connectionManager.getStrategy(connectionId);
  return await strategy.fetchRowRange(query, offset, limit);
}
```

---

## Migration Strategy

### Phase 1: Backend Foundation (Week 1)

1. ✅ Add `fetchRowRange()` to base strategy
2. ✅ Implement for MySQL, PostgreSQL, SQLite
3. ✅ Implement for SQL Server, Oracle
4. ✅ Create `/api/query/range` endpoint
5. ✅ Add unit tests for each strategy

### Phase 2: Frontend Core (Week 2)

1. ✅ Install @angular/cdk
2. ✅ Create VirtualScrollTableComponent
3. ✅ Create VirtualDataSource service
4. ✅ Add cache management
5. ✅ Test with sample data

### Phase 3: Integration (Week 3)

1. ✅ Update SQL Explorer to use virtual scroll
2. ✅ Update Chat Results to use virtual scroll
3. ✅ Remove old pagination code
4. ✅ Add loading indicators
5. ✅ Handle edge cases (empty results, errors)

### Phase 4: NoSQL Support (Week 4)

1. ✅ Implement MongoDB range fetching
2. ✅ Implement Redis range fetching
3. ✅ Implement Cassandra pagination
4. ✅ Update Chat to detect database type
5. ✅ Test with large NoSQL datasets

### Phase 5: Performance & Polish (Week 5)

1. ✅ Add scroll position persistence
2. ✅ Optimize memory usage
3. ✅ Add keyboard navigation
4. ✅ Performance testing with 10M+ rows
5. ✅ Documentation and examples

---

## Performance Considerations

### Memory Management

- **Frontend:** Keep max 20 chunks (2000 rows) in memory
- **Backend:** Stream results, don't load all into memory
- **Cache Eviction:** LRU (Least Recently Used) strategy

### Network Optimization

- **Debounce:** 50ms delay before fetching
- **Request Deduplication:** Cancel pending requests
- **Compression:** Enable gzip for API responses
- **Prefetch:** Load next chunk when user is 80% through current

### Database Optimization

- **Indexes:** Ensure queries have proper indexes
- **Query Optimization:** Use covering indexes where possible
- **Connection Pooling:** Reuse database connections
- **Timeout:** Set reasonable query timeouts (30s)

---

## Database-Specific Considerations

### SQL Databases

| Database   | Pagination Syntax                      | Max Offset | Performance Notes      |
| ---------- | -------------------------------------- | ---------- | ---------------------- |
| MySQL      | `LIMIT x OFFSET y`                     | ~2M rows   | Use indexed columns    |
| PostgreSQL | `LIMIT x OFFSET y`                     | ~10M rows  | Better than MySQL      |
| SQL Server | `OFFSET x ROWS FETCH NEXT y ROWS ONLY` | ~1M rows   | Requires ORDER BY      |
| Oracle     | `OFFSET x ROWS FETCH NEXT y ROWS ONLY` | ~5M rows   | Good performance       |
| SQLite     | `LIMIT x OFFSET y`                     | ~1M rows   | File-based limitations |

### NoSQL Databases

| Database  | Pagination Method      | Notes                                    |
| --------- | ---------------------- | ---------------------------------------- |
| MongoDB   | `skip()` + `limit()`   | Slow for large offsets, use cursor-based |
| Redis     | `SCAN` cursor          | Always cursor-based, no true offset      |
| Cassandra | Token-based pagination | Must use pageState from previous query   |
| DynamoDB  | LastEvaluatedKey       | Cursor-based, no offset support          |
| CouchDB   | `skip` + `limit`       | Similar to MongoDB                       |

---

## Alternative: Cursor-Based Pagination

For databases where offset is inefficient, implement cursor-based:

```javascript
// Instead of offset, use last seen value
async fetchRowRangeCursor(query, lastId, limit) {
  const cursorQuery = `
    ${query}
    WHERE id > ${lastId}
    ORDER BY id
    LIMIT ${limit}
  `;
  // More efficient for large datasets
}
```

---

## Testing Checklist

### Unit Tests

- ✅ Each database strategy's `fetchRowRange()`
- ✅ VirtualDataSource cache management
- ✅ Edge cases (offset 0, limit exceeded, empty results)

### Integration Tests

- ✅ Load 1000 rows, scroll to bottom
- ✅ Load 100K rows, random scroll positions
- ✅ Concurrent queries don't conflict
- ✅ Error handling (network failure, query error)

### Performance Tests

- ✅ 1M rows: Smooth scrolling, < 2GB memory
- ✅ 10M rows: No lag, efficient chunk loading
- ✅ Network throttling: Graceful degradation
- ✅ Multiple tabs: Memory isolation

---

## Rollout Plan

### Week 1-2: Backend + Core Frontend

- Deploy backend changes (backward compatible)
- Create virtual scroll component (not used yet)
- Feature flag: `ENABLE_VIRTUAL_SCROLL=false`

### Week 3: Beta Testing

- Enable for SQL Explorer only
- Feature flag: `ENABLE_VIRTUAL_SCROLL=true`
- Monitor performance metrics
- Collect user feedback

### Week 4: Full Rollout

- Enable for Chat Results
- Remove old pagination code
- Update documentation
- Announce to users

### Week 5: Optimization

- Address reported issues
- Tune performance parameters
- Add advanced features (search, filters)

---

## Dependencies

### Frontend

```json
{
  "@angular/cdk": "^17.0.0",
  "rxjs": "^7.8.0"
}
```

### Backend

No new dependencies - use existing database drivers

---

## Rollback Plan

If issues arise:

1. **Feature Flag:** Set `ENABLE_VIRTUAL_SCROLL=false`
2. **Revert Frontend:** Switch back to pagination component
3. **Keep Backend:** New endpoint doesn't break old functionality
4. **Fix Issues:** Address problems in staging environment
5. **Re-deploy:** After thorough testing

---

## Success Metrics

### Performance

- ✅ Scroll 10M rows without lag
- ✅ Memory usage < 500MB for frontend
- ✅ Initial load time < 2 seconds
- ✅ Chunk load time < 100ms

### User Experience

- ✅ Smooth scrolling (60fps)
- ✅ No "jump" when loading new chunks
- ✅ Clear loading indicators
- ✅ Keyboard navigation works

### Reliability

- ✅ Handles network errors gracefully
- ✅ No memory leaks after 1 hour usage
- ✅ Works across all supported databases
- ✅ 99.9% uptime for new endpoint

---

## Documentation Updates

1. **User Guide:** How to navigate large result sets
2. **Developer Guide:** How to extend VirtualDataSource
3. **Database Guide:** Optimization tips per database
4. **Troubleshooting:** Common issues and solutions

---

## Future Enhancements

### Phase 6 (Later)

- ✅ Column virtualization (many columns)
- ✅ Smart prefetching based on scroll velocity
- ✅ Result set filtering without re-query
- ✅ Export large datasets in background
- ✅ Columnar data format for better compression

---

## Questions to Resolve

1. **Chunk Size:** 100 rows optimal? Test with different sizes
2. **Cache Size:** 20 chunks enough? Adjust based on memory
3. **Prefetch Strategy:** When to start loading next chunk?
4. **Error Recovery:** Retry failed chunks? How many times?
5. **Sorting:** How to handle ORDER BY with virtual scroll?
6. **Filtering:** Client-side or server-side?

---

## Risks & Mitigations

| Risk                                | Impact | Mitigation                            |
| ----------------------------------- | ------ | ------------------------------------- |
| Large offset slow in MySQL          | High   | Use cursor-based for >1M rows         |
| Memory leaks in frontend            | High   | Aggressive cache eviction, monitoring |
| Network latency causes jumps        | Medium | Prefetch aggressively, show loaders   |
| Database connection pool exhaustion | High   | Limit concurrent requests, queue      |
| NoSQL cursor invalidation           | Medium | Fallback to offset, retry logic       |

---

## Timeline Summary

- **Week 1-2:** Backend + Core (Ready for testing)
- **Week 3:** SQL Explorer Integration (Beta)
- **Week 4:** Chat Results + NoSQL (Full Release)
- **Week 5:** Polish + Optimization (Production Ready)
- **Total:** 5 weeks to production-ready virtual scrolling

---

## Approval Required

- [ ] Architecture Review
- [ ] Security Review (new API endpoint)
- [ ] Performance Testing Sign-off
- [ ] UI/UX Review
- [ ] Database Team Sign-off
- [ ] Product Owner Approval

---

## References

- Angular CDK Virtual Scroll: https://material.angular.io/cdk/scrolling
- MySQL LIMIT Performance: https://dev.mysql.com/doc/refman/8.0/en/limit-optimization.html
- PostgreSQL Pagination: https://www.postgresql.org/docs/current/queries-limit.html
- MongoDB Cursor-based Pagination: https://docs.mongodb.com/manual/reference/method/cursor.skip/
