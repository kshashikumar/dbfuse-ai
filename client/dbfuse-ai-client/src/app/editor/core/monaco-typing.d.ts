import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

declare global {
    const monaco: typeof import('monaco-editor');
}

export type Monaco = typeof monaco;
