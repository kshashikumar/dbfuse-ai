import { Injectable } from '@angular/core';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { MonacoLoaderService } from '../core/monaco-loader.service';
import { DecorationMeta } from '../features/decorations/decoration.types';
import { MonacoDecorationRegistry } from '../features/decorations/decoration.registry';

export interface DecorationInput {
    range: monaco.IRange;
    options: monaco.editor.IModelDecorationOptions;
    meta?: DecorationMeta;
}

@Injectable({ providedIn: 'root' })
export class MonacoEditorService {
    private registeredModels = new Map<string, monaco.editor.ITextModel>();

    constructor(
        private readonly loader: MonacoLoaderService,
        private readonly decorationRegistry: MonacoDecorationRegistry,
    ) {}

    async createModel(value: string, language: string, uri?: string): Promise<monaco.editor.ITextModel> {
        const monacoApi = await this.loader.load();
        const modelUri = uri ? monacoApi.Uri.parse(uri) : undefined;
        let model = modelUri ? monacoApi.editor.getModel(modelUri) : undefined;

        if (!model) {
            model = monacoApi.editor.createModel(value, language, modelUri);
        } else {
            model.setValue(value);
        }

        this.registeredModels.set(model.id, model);
        return model;
    }

    disposeModel(model?: monaco.editor.ITextModel | null): void {
        if (!model) return;
        this.registeredModels.delete(model.id);
        model.dispose();
    }

    updateValue(model: monaco.editor.ITextModel, value: string): void {
        if (model.getValue() !== value) {
            model.pushEditOperations(
                [],
                [
                    {
                        range: model.getFullModelRange(),
                        text: value,
                    },
                ],
                () => null,
            );
        }
    }

    applyDecorations(editor: monaco.editor.IStandaloneCodeEditor, items: DecorationInput[]): string[] {
        const decorations = items.map((item) => ({
            range: item.range,
            options: item.options,
        }));
        const ids = editor.deltaDecorations([], decorations);
        this.decorationRegistry.register(
            ids,
            items.map((item) => item.meta),
        );
        return ids;
    }
}
