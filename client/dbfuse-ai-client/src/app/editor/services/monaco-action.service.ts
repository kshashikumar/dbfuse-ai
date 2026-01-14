import { Injectable } from '@angular/core';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

export interface EditorActionHandlers {
    save?: () => void;
    run?: () => void;
}

@Injectable({ providedIn: 'root' })
export class MonacoActionService {
    registerCoreShortcuts(
        editor: monaco.editor.IStandaloneCodeEditor,
        monacoApi: typeof monaco,
        handlers: EditorActionHandlers,
    ): void {
        editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => handlers.save?.());
        editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Enter, () => handlers.run?.());
        editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyL, () =>
            editor.getAction('editor.action.formatDocument')?.run(),
        );
        editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyF, () =>
            editor.getAction('actions.find')?.run(),
        );
    }
}
