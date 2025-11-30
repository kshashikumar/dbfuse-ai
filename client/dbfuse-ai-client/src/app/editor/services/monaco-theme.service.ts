import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { MonacoLoaderService } from '../core/monaco-loader.service';
import { MONACO_THEMES } from '../core/monaco-config';

@Injectable({ providedIn: 'root' })
export class MonacoThemeService {
    private readonly document = inject(DOCUMENT);
    private currentTheme: string = MONACO_THEMES.light;
    private themesRegistered = false;

    constructor(private readonly loader: MonacoLoaderService) {}

    async init(): Promise<void> {
        const monacoApi = await this.loader.load();
        if (this.themesRegistered) {
            return;
        }
        this.themesRegistered = true;

        monacoApi.editor.defineTheme(MONACO_THEMES.brandDark, {
            base: 'vs-dark',
            inherit: true,
            rules: [{ background: '0f172a', token: '' }],
            colors: {
                'editor.background': '#0f172a',
                'editorLineNumber.foreground': '#475569',
                'editorLineNumber.activeForeground': '#93c5fd',
                'editorCursor.foreground': '#38bdf8',
                'editor.selectionBackground': '#1d4ed840',
                'editorSuggestWidget.background': '#0f172a',
                'editorHoverWidget.background': '#0f172a',
            },
        });
    }

    async syncWithDocument(isDark?: boolean): Promise<string> {
        const monacoApi = await this.loader.load();
        const dark = typeof isDark === 'boolean' ? isDark : (this.document.body?.classList.contains('dark') ?? false);

        this.currentTheme = dark ? MONACO_THEMES.brandDark : MONACO_THEMES.light;
        monacoApi.editor.setTheme(this.currentTheme);
        return this.currentTheme;
    }

    get activeTheme(): string {
        return this.currentTheme;
    }
}
