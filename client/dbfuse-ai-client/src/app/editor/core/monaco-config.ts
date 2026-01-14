import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

export const MONACO_THEMES = {
    light: 'vs-light',
    dark: 'vs-dark',
    brandDark: 'dbfuse-dark',
} as const;

export const MONACO_DEFAULT_LANGUAGE = 'sql';

export const MONACO_DEFAULT_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 14,
    fontFamily:
        'Space Grotesk, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    renderLineHighlight: 'gutter',
    lineNumbers: 'on',
    wordWrap: 'on',
    fixedOverflowWidgets: true,
};
