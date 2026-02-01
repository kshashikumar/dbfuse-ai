import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { environment } from '@env/environment';
import { getSafeSessionStorage } from '@core/utils/browser-adapter';

export type ChatConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type ChatEnvelope = {
    v: number;
    type: string;
    payload?: any;
};

@Injectable({
    providedIn: 'root',
})
export class ChatSocketService {
    private socket: WebSocket | null = null;
    private readonly messageSubject = new Subject<ChatEnvelope>();
    private readonly statusSubject = new BehaviorSubject<ChatConnectionStatus>('disconnected');
    private readonly enrichedQuerySubject = new Subject<any>();
    private pendingMessages: ChatEnvelope[] = [];
    private sessionId: string | null = null;
    private activeParams: {
        connectionId: string;
        dbType: string;
        dbName?: string;
        sessionId?: string | null;
    } | null = null;

    constructor(private readonly zone: NgZone) {}

    get status$(): Observable<ChatConnectionStatus> {
        return this.statusSubject.asObservable();
    }

    get messages$(): Observable<ChatEnvelope> {
        return this.messageSubject.asObservable();
    }

    get enrichedQuery$(): Observable<any> {
        return this.enrichedQuerySubject.asObservable();
    }

    connect(params: { connectionId: string; dbType: string; dbName?: string; sessionId?: string | null }): void {
        const isSameParams =
            this.activeParams &&
            this.activeParams.connectionId === params.connectionId &&
            this.activeParams.dbType === params.dbType &&
            this.activeParams.dbName === params.dbName &&
            this.activeParams.sessionId === params.sessionId;

        if (
            this.socket &&
            (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
        ) {
            if (isSameParams) {
                return;
            }
            this.disconnect();
        }

        const url = this.buildSocketUrl(params);
        this.statusSubject.next('connecting');
        this.activeParams = { ...params };

        const socket = new WebSocket(url);
        this.socket = socket;
        socket.onopen = () => {
            this.zone.run(() => {
                this.statusSubject.next('connected');
                this.flushPending();
            });
        };
        socket.onmessage = (event) => {
            this.zone.run(() => {
                try {
                    const envelope = JSON.parse(event.data) as ChatEnvelope;

                    if (envelope?.type === 'session_ready' && envelope.payload?.sessionId) {
                        this.sessionId = envelope.payload.sessionId;
                    }
                    if (envelope?.type === 'query_enriched') {
                        this.enrichedQuerySubject.next(envelope.payload);
                    }
                    this.messageSubject.next(envelope);
                } catch {
                    this.messageSubject.next({
                        v: 1,
                        type: 'assistant_error',
                        payload: { error: 'Invalid response.' },
                    });
                }
            });
        };
        socket.onerror = () => {
            this.zone.run(() => {
                this.statusSubject.next('error');
            });
        };
        socket.onclose = () => {
            this.zone.run(() => {
                if (this.socket === socket) {
                    this.socket = null;
                }
                this.statusSubject.next('disconnected');
            });
        };
    }

    disconnect(): void {
        if (!this.socket) return;
        this.socket.close();
        this.socket = null;
        this.pendingMessages = [];
        this.activeParams = null;
    }

    sendUserMessage(text: string, dbName?: string): string {
        const messageId = this.createMessageId();
        this.sendEnvelope({
            v: 1,
            type: 'user_message',
            payload: {
                messageId,
                text,
                dbName,
            },
        });
        return messageId;
    }

    sendEnvelope(envelope: ChatEnvelope): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            this.pendingMessages.push(envelope);
            return;
        }
        this.socket.send(JSON.stringify(envelope));
    }

    getSessionId(): string | null {
        return this.sessionId;
    }

    private flushPending(): void {
        const queued = [...this.pendingMessages];
        this.pendingMessages = [];
        queued.forEach((msg) => this.sendEnvelope(msg));
    }

    private buildSocketUrl(params: {
        connectionId: string;
        dbType: string;
        dbName?: string;
        sessionId?: string | null;
    }): string {
        const base =
            environment.apiUrl && environment.apiUrl.trim().length > 0
                ? environment.apiUrl
                : typeof window !== 'undefined'
                  ? window.location.origin
                  : 'http://localhost';
        const url = new URL(base);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = '/api/chat/ws';

        url.searchParams.set('connectionId', params.connectionId);
        url.searchParams.set('dbType', params.dbType);
        if (params.dbName) {
            url.searchParams.set('dbName', params.dbName);
        }
        if (params.sessionId) {
            url.searchParams.set('sessionId', params.sessionId);
        }

        const token = getSafeSessionStorage().getItem('token');
        if (token) {
            url.searchParams.set('auth', token);
        }

        return url.toString();
    }

    private createMessageId(): string {
        return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    }
}
