import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

export type DecorationSeverity = 'info' | 'warning' | 'error' | 'ai-hint';

export interface DecorationMeta {
    id?: string;
    message?: string;
    severity?: DecorationSeverity;
    actionId?: string;
    popoverTitle?: string;
    popoverDescription?: string;
}

export interface DecorationDescriptor {
    range: monaco.IRange;
    meta: DecorationMeta;
}
