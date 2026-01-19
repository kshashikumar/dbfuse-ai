import { CommonModule } from '@angular/common';
import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    EventEmitter,
    OnDestroy,
    Output,
    ViewChild,
    ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { ResultGridComponent } from '../sql-editor/components/resultgrid/resultgrid.component';
import { DatabaseType, EnrichedQueryContext } from '@core/utils/storage/storage.types';
import { ChatSocketService, ChatEnvelope } from '@core/services/chat/chat-socket.service';
import { BackendService } from '@core/services/backend/backend.service';
import { getSafeSessionStorage } from '@core/utils/browser-adapter';
import { Subject } from 'rxjs';
import { take, takeUntil } from 'rxjs/operators';

type ChatMessage = {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    queryId?: string;
    error?: string;
    steps?: ChatStep[];
    showSteps?: boolean;
    enrichedContext?: EnrichedQueryContext;
    showEnrichmentDetails?: boolean;
    queryResult?: any;
};

type ChatStep = {
    id: string;
    label: string;
    status: string;
    note?: string | null;
};

@Component({
    selector: 'app-chat',
    standalone: true,
    imports: [CommonModule, FormsModule, ScrollingModule, ResultGridComponent],
    templateUrl: './chat.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatComponent implements OnDestroy {
    @Output() sendToEditor = new EventEmitter<{ sql: string; dbName: string }>();
    @ViewChild('tableHeaderScroll', { read: ElementRef }) tableHeaderScroll?: ElementRef;
    @ViewChild('tableBodyScroll', { read: CdkVirtualScrollViewport }) tableBodyScroll?: CdkVirtualScrollViewport;
    promptText = '';
    messages: ChatMessage[] = [];
    loading = false;
    statusMessage = '';
    readonly sqlDbTypes = new Set<DatabaseType>(['mysql2', 'pg', 'sqlite3', 'mssql', 'oracledb']);
    private sessionId: string | null = null;
    private readonly responseTimeoutMs = 45000;
    private readonly pendingRequests = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly pendingSteps = new Map<string, ChatStep[]>();
    currentSteps: ChatStep[] = [];
    isStreaming = false;
    private streamingMessageId: string | null = null;
    enrichedContext: EnrichedQueryContext | null = null;
    showEnrichmentDetails = false;
    currentQueryResult: any = null;
    hasResults = false;
    private readonly destroy$ = new Subject<void>();

    get connectionId(): string {
        return getSafeSessionStorage().getItem('connectionId') || '';
    }

    constructor(
        private readonly chatSocket: ChatSocketService,
        private readonly backendService: BackendService,
        private readonly cdr: ChangeDetectorRef,
    ) {
        this.chatSocket.messages$.pipe(takeUntil(this.destroy$)).subscribe((envelope) => {
            this.handleSocketMessage(envelope);
        });
        this.chatSocket.enrichedQuery$.pipe(takeUntil(this.destroy$)).subscribe((enrichedContext) => {
            this.handleEnrichedQuery(enrichedContext);
        });
        this.chatSocket.status$.pipe(takeUntil(this.destroy$)).subscribe((status) => {
            if (status === 'connected') {
                this.statusMessage = '';
            } else if (status === 'error') {
                this.clearAllPending();
                this.statusMessage = 'Chat connection error. Please retry.';
            } else if (status === 'disconnected' && this.loading) {
                this.clearAllPending();
                this.statusMessage = 'Chat disconnected. Please retry.';
            }
            this.cdr.markForCheck();
        });
    }

    get hasConnection(): boolean {
        const storage = getSafeSessionStorage();
        return Boolean(storage.getItem('connectionId'));
    }

    get currentDbType(): DatabaseType {
        return (getSafeSessionStorage().getItem('dbType') as DatabaseType) || 'mysql2';
    }

    get isSqlBased(): boolean {
        return this.sqlDbTypes.has(this.currentDbType);
    }

    get selectedDatabase(): string {
        return getSafeSessionStorage().getItem('selectedDB') || '';
    }

    sendPrompt(): void {
        const prompt = this.promptText.trim();
        if (!prompt) return;
        if (!this.isSqlBased) {
            this.statusMessage = 'Chat to DB is currently available for SQL databases only.';
            this.cdr.markForCheck();
            return;
        }
        if (!this.hasConnection) {
            this.statusMessage = 'Connect to a database to start a conversation.';
            this.cdr.markForCheck();
            return;
        }
        if (!this.selectedDatabase) {
            this.statusMessage = 'Select a database before using Chat to DB.';
            this.cdr.markForCheck();
            return;
        }

        this.statusMessage = '';
        this.loading = true;
        const userMessage: ChatMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            text: prompt,
        };
        this.messages = [...this.messages, userMessage];
        this.promptText = '';
        this.cdr.markForCheck();

        this.backendService
            .getConnectionHealth()
            .pipe(take(1))
            .subscribe({
                next: () => {
                    this.connectIfNeeded();
                    const requestId = this.chatSocket.sendUserMessage(prompt, this.selectedDatabase);
                    this.trackPending(requestId);
                    this.cdr.markForCheck();
                },
                error: (error) => {
                    this.loading = false;
                    this.handleError(error);
                    this.cdr.markForCheck();
                },
            });
    }

    private handleError(error: any): void {
        const message = this.getAIErrorMessage(error);
        const errorMessage: ChatMessage = {
            id: `error-${Date.now()}`,
            role: 'assistant',
            text: 'AI error',
            error: message,
            steps: Array.isArray(error?.steps) ? error.steps : undefined,
            showSteps: false,
        };
        this.messages = [...this.messages, errorMessage];
        this.loading = false;
        this.statusMessage = message;
    }

    private getAIErrorMessage(error: any): string {
        const fallback = 'Failed to generate a response. Please try again.';
        if (!error) return fallback;
        if (typeof error === 'string') return error;
        const body = error.error;
        if (typeof body === 'string') return body;
        if (body && typeof body.error === 'string') return body.error;
        if (body && typeof body.message === 'string') return body.message;
        if (typeof error.message === 'string') return error.message;
        return fallback;
    }

    private connectIfNeeded(): void {
        if (!this.hasConnection) return;
        const connectionId = getSafeSessionStorage().getItem('connectionId') || '';
        const dbType = getSafeSessionStorage().getItem('dbType') || 'mysql2';
        this.sessionId = this.sessionId || this.chatSocket.getSessionId();
        this.chatSocket.connect({
            connectionId,
            dbType,
            dbName: this.selectedDatabase,
            sessionId: this.sessionId,
        });
    }

    private handleEnrichedQuery(enrichedContext: EnrichedQueryContext): void {
        this.enrichedContext = enrichedContext;
        if (this.streamingMessageId) {
            const messageIndex = this.messages.findIndex((m) => m.id === this.streamingMessageId);
            if (messageIndex !== -1) {
                this.messages[messageIndex].enrichedContext = enrichedContext;
                this.messages = [...this.messages];
            }
        }
        this.cdr.markForCheck();
    }

    private handleSocketMessage(envelope: ChatEnvelope): void {
        if (!envelope) return;
        if (envelope.type === 'session_ready' && envelope.payload?.sessionId) {
            this.sessionId = envelope.payload.sessionId;
            return;
        }
        if (envelope.type === 'assistant_steps') {
            const payload = envelope.payload || {};
            if (payload.requestId && Array.isArray(payload.steps)) {
                this.pendingSteps.set(payload.requestId, payload.steps as ChatStep[]);
                this.currentSteps = payload.steps as ChatStep[];
                if (this.streamingMessageId) {
                    const messageIndex = this.messages.findIndex((m) => m.id === this.streamingMessageId);
                    if (messageIndex !== -1) {
                        this.messages[messageIndex].steps = payload.steps as ChatStep[];
                        this.messages = [...this.messages];
                    }
                }
                this.cdr.markForCheck();
            }
            return;
        }
        if (envelope.type === 'assistant_thinking') {
            this.loading = true;
            this.isStreaming = true;
            this.streamingMessageId = `streaming-${Date.now()}`;
            const streamingMessage: ChatMessage = {
                id: this.streamingMessageId,
                role: 'assistant',
                text: 'Processing your request...',
                steps: [],
                showSteps: true,
            };
            this.messages = [...this.messages, streamingMessage];
            this.cdr.markForCheck();
            return;
        }
        if (envelope.type === 'assistant_message') {
            const payload = envelope.payload || {};
            if (payload.requestId) {
                this.clearPending(payload.requestId);
            } else {
                this.clearAllPending();
            }
            const steps = this.consumeSteps(payload.requestId) || payload.steps;

            console.log('📥 FRONTEND RECEIVED MESSAGE', {
                hasTableData: !!payload.tableData,
                tableName: payload.tableData?.tableName,
                rowCount: payload.tableData?.rows?.length,
                columnCount: payload.tableData?.columns?.length,
            });

            const message: ChatMessage = {
                id: payload.messageId || `assistant-${Date.now()}`,
                role: 'assistant',
                text: payload.content || 'No response returned.',
                queryId: payload.queryId || undefined,
                steps: Array.isArray(steps) ? steps : undefined,
                showSteps: false,
                queryResult: payload.tableData || undefined,
            };

            // If tableData exists, show in result grid
            if (payload.tableData) {
                console.log('✅ SHOWING QUERY RESULT', payload.tableData.tableName);
                this.currentQueryResult = payload.tableData;
                this.hasResults = true;
            } else {
                console.warn('⚠️ NO TABLE DATA IN PAYLOAD');
            }
            if (this.streamingMessageId) {
                const messageIndex = this.messages.findIndex((m) => m.id === this.streamingMessageId);
                if (messageIndex !== -1) {
                    this.messages[messageIndex] = message;
                    this.messages = [...this.messages];
                } else {
                    this.messages = [...this.messages, message];
                }
                this.streamingMessageId = null;
            } else {
                this.messages = [...this.messages, message];
            }
            this.currentSteps = [];
            this.isStreaming = false;
            this.loading = false;
            this.cdr.markForCheck();
            return;
        }
        if (envelope.type === 'assistant_clarify') {
            const payload = envelope.payload || {};
            if (payload.requestId) {
                this.clearPending(payload.requestId);
            } else {
                this.clearAllPending();
            }
            const steps = this.consumeSteps(payload.requestId) || payload.steps;
            const message: ChatMessage = {
                id: payload.messageId || `assistant-${Date.now()}`,
                role: 'assistant',
                text: payload.content || 'Could you clarify?',
                steps: Array.isArray(steps) ? steps : undefined,
                showSteps: false,
            };
            if (this.streamingMessageId) {
                const messageIndex = this.messages.findIndex((m) => m.id === this.streamingMessageId);
                if (messageIndex !== -1) {
                    this.messages[messageIndex] = message;
                    this.messages = [...this.messages];
                } else {
                    this.messages = [...this.messages, message];
                }
                this.streamingMessageId = null;
            } else {
                this.messages = [...this.messages, message];
            }
            this.currentSteps = [];
            this.isStreaming = false;
            this.loading = false;
            this.cdr.markForCheck();
            return;
        }
        if (envelope.type === 'assistant_error') {
            const payload = envelope.payload || {};
            if (payload.requestId) {
                this.clearPending(payload.requestId);
            } else {
                this.clearAllPending();
            }
            const steps = this.consumeSteps(payload.requestId) || payload.steps;
            if (this.streamingMessageId) {
                const messageIndex = this.messages.findIndex((m) => m.id === this.streamingMessageId);
                if (messageIndex !== -1) {
                    this.messages.splice(messageIndex, 1);
                    this.messages = [...this.messages];
                }
                this.streamingMessageId = null;
            }
            this.currentSteps = [];
            this.isStreaming = false;
            this.handleError({ ...(envelope.payload || envelope), steps });
            this.cdr.markForCheck();
        }
    }

    private trackPending(requestId: string): void {
        if (!requestId) return;
        const timeoutId = setTimeout(() => {
            this.pendingRequests.delete(requestId);
            this.handleError({ message: 'Chat response timed out. Please retry.' });
            this.loading = this.pendingRequests.size > 0;
            this.cdr.markForCheck();
        }, this.responseTimeoutMs);
        this.pendingRequests.set(requestId, timeoutId);
    }

    private clearPending(requestId: string): void {
        const timeoutId = this.pendingRequests.get(requestId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.pendingRequests.delete(requestId);
        }
        this.loading = this.pendingRequests.size > 0;
    }

    private clearAllPending(): void {
        for (const timeoutId of this.pendingRequests.values()) {
            clearTimeout(timeoutId);
        }
        this.pendingRequests.clear();
        this.pendingSteps.clear();
        this.currentSteps = [];
        this.isStreaming = false;
        this.streamingMessageId = null;
        this.loading = false;
    }

    private consumeSteps(requestId?: string): ChatStep[] | null {
        if (!requestId) return null;
        const steps = this.pendingSteps.get(requestId) || null;
        if (steps) {
            this.pendingSteps.delete(requestId);
        }
        return steps;
    }

    toggleSteps(message: ChatMessage): void {
        message.showSteps = !message.showSteps;
        this.cdr.markForCheck();
    }

    toggleEnrichmentDetails(message: ChatMessage): void {
        message.showEnrichmentDetails = !message.showEnrichmentDetails;
        this.cdr.markForCheck();
    }

    hasRunningStep(steps: ChatStep[] | undefined): boolean {
        if (!steps) return false;
        return steps.some((step) => step.status === 'running');
    }

    getLastStepLabel(steps: ChatStep[] | undefined): string {
        if (!steps || steps.length === 0) return 'Working steps';

        // Find the last step that is running or done
        for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i].status === 'running' || steps[i].status === 'done') {
                return steps[i].label;
            }
        }

        // If no running or done step, return the first step label
        return steps[0].label;
    }

    closeResults(): void {
        this.hasResults = false;
        this.currentQueryResult = null;
        this.cdr.markForCheck();
    }

    // Synchronize horizontal scroll between header and body
    onTableBodyScroll(event: Event): void {
        if (this.tableHeaderScroll && this.tableBodyScroll) {
            const scrollLeft = this.tableBodyScroll.measureScrollOffset('left');
            this.tableHeaderScroll.nativeElement.scrollLeft = scrollLeft;
        }
    }

    exportToCSV(): void {
        if (!this.currentQueryResult) return;
        const csv = this.convertToCSV(this.currentQueryResult);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentQueryResult.tableName}_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    exportToJSON(): void {
        if (!this.currentQueryResult) return;
        const json = JSON.stringify(this.currentQueryResult.rows, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentQueryResult.tableName}_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    private convertToCSV(data: any): string {
        const headers = data.columns.map((c: any) => c.name).join(',');
        const rows = data.rows
            .map((row: any) =>
                data.columns
                    .map((col: any) => {
                        const value = row[col.name];
                        if (value === null || value === undefined) return '';
                        if (typeof value === 'string' && value.includes(',')) {
                            return `"${value.replace(/"/g, '""')}"`;
                        }
                        return value;
                    })
                    .join(','),
            )
            .join('\n');
        return `${headers}\n${rows}`;
    }

    copyQuery(): void {
        if (this.currentQueryResult?.query) {
            navigator.clipboard.writeText(this.currentQueryResult.query);
        }
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
        this.clearAllPending();
        this.chatSocket.disconnect();
    }
}
