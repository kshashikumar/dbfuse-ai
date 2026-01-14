import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import loader from '@monaco-editor/loader';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

@Injectable({ providedIn: 'root' })
export class MonacoLoaderService {
    private monacoPromise?: Promise<typeof monaco>;
    private configured = false;
    private readonly document = inject(DOCUMENT);

    load(): Promise<typeof monaco> {
        if (!this.configured) {
            const basePath = this.resolveBasePath();
            loader.config({ paths: { vs: basePath } });
            this.configured = true;
        }

        if (!this.monacoPromise) {
            this.monacoPromise = loader.init();
        }

        return this.monacoPromise;
    }

    private resolveBasePath(): string {
        if (typeof window === 'undefined') {
            return '/assets/monaco/vs';
        }
        const baseHref = this.document?.baseURI ?? '/';
        const normalizedBase = baseHref.endsWith('/') ? baseHref : `${baseHref}/`;
        return `${normalizedBase}assets/monaco/vs`.replace(/([^:]\/)\/+/g, '$1/');
    }
}
