import { Injectable } from '@angular/core';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { MonacoLoaderService } from '../../core/monaco-loader.service';

@Injectable({ providedIn: 'root' })
export class MonacoCodeActionProviderService {
    private registered = false;

    constructor(private readonly loader: MonacoLoaderService) {}

    async ensureRegistered(): Promise<void> {
        if (this.registered) return;
        const monacoApi = await this.loader.load();
        monacoApi.languages.registerCodeActionProvider('sql', {
            provideCodeActions: (model, range, _context, _token) => {
                const text = model.getValueInRange(range);
                if (!/select\s+\*/i.test(text)) {
                    return { actions: [], dispose: () => {} };
                }

                const editRange = monacoApi.Range.lift(range);
                const workspaceEdit: monaco.languages.WorkspaceEdit = {
                    edits: [
                        {
                            resource: model.uri,
                            versionId: model.getVersionId(),
                            textEdit: {
                                range: editRange,
                                text: 'SELECT column1, column2',
                            },
                        },
                    ],
                };

                const action: monaco.languages.CodeAction = {
                    title: 'Replace * with explicit columns',
                    kind: 'quickfix',
                    edit: workspaceEdit,
                };

                return {
                    actions: [action],
                    dispose: () => {},
                };
            },
        });
        this.registered = true;
    }
}
