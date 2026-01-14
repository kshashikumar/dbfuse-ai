import { CommonModule } from '@angular/common';
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    EventEmitter,
    Input,
    NgZone,
    OnChanges,
    OnDestroy,
    Output,
    SimpleChanges,
    ViewChild,
} from '@angular/core';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { MonacoLoaderService } from '../../core/monaco-loader.service';
import { MONACO_DEFAULT_LANGUAGE, MONACO_DEFAULT_OPTIONS } from '../../core/monaco-config';
import { MonacoEditorService } from '../../services/monaco-editor.service';
import { MonacoThemeService } from '../../services/monaco-theme.service';
import { MonacoActionService } from '../../services/monaco-action.service';
import { MonacoCodeActionProviderService } from '../../features/code-actions/code-action.provider';
import { InlinePopoverManager } from '../../features/code-actions/inline-popover.manager';

@Component({
    selector: 'app-monaco-editor',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './monaco-editor.component.html',
    styleUrls: ['./monaco-editor.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MonacoEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
    @Input() value = '';
    @Input() language: string = MONACO_DEFAULT_LANGUAGE;
    @Input() options: monaco.editor.IStandaloneEditorConstructionOptions = {};
    @Input() readonly = false;
    @Input() modelUri?: string;

    @Output() valueChange = new EventEmitter<string>();
    @Output() run = new EventEmitter<void>();
    @Output() save = new EventEmitter<void>();
    @Output() editorReady = new EventEmitter<monaco.editor.IStandaloneCodeEditor>();

    @ViewChild('editorContainer', { static: true })
    private editorContainer!: ElementRef<HTMLDivElement>;

    private editor?: monaco.editor.IStandaloneCodeEditor;
    private model?: monaco.editor.ITextModel;
    private monacoApi?: typeof monaco;
    private modelChangeDisposable?: monaco.IDisposable;
    private isProgrammaticUpdate = false;

    constructor(
        private readonly loader: MonacoLoaderService,
        private readonly editorService: MonacoEditorService,
        private readonly themeService: MonacoThemeService,
        private readonly actionService: MonacoActionService,
        private readonly codeActionService: MonacoCodeActionProviderService,
        private readonly popoverManager: InlinePopoverManager,
        private readonly zone: NgZone,
    ) {}

    async ngAfterViewInit(): Promise<void> {
        await this.initEditor();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['value'] && !changes['value'].firstChange) {
            this.updateModelValue(changes['value'].currentValue ?? '');
        }
        if (changes['language'] && !changes['language'].firstChange) {
            this.updateModelLanguage(changes['language'].currentValue ?? MONACO_DEFAULT_LANGUAGE);
        }
        if (changes['readonly'] && this.editor) {
            this.editor.updateOptions({ readOnly: this.readonly });
        }
        if (changes['options'] && this.editor && !changes['options'].firstChange) {
            this.editor.updateOptions(changes['options'].currentValue ?? {});
        }
        if (changes['modelUri'] && !changes['modelUri'].firstChange) {
            this.recreateModel();
        }
    }

    ngOnDestroy(): void {
        this.disposeEditor();
    }

    private async initEditor(): Promise<void> {
        this.monacoApi = await this.loader.load();
        await this.themeService.init();
        await this.themeService.syncWithDocument();
        await this.createModel();

        const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
            ...MONACO_DEFAULT_OPTIONS,
            ...this.options,
            readOnly: this.readonly,
            model: this.model,
        };

        this.zone.runOutsideAngular(() => {
            if (!this.editorContainer?.nativeElement || !this.monacoApi) {
                return;
            }
            this.editor = this.monacoApi.editor.create(this.editorContainer.nativeElement, editorOptions);
        });

        if (!this.editor) return;

        this.modelChangeDisposable = this.editor.onDidChangeModelContent(() => this.handleContentChange());
        this.actionService.registerCoreShortcuts(this.editor, this.monacoApi!, {
            run: () => this.zone.run(() => this.run.emit()),
            save: () => this.zone.run(() => this.save.emit()),
        });
        await this.codeActionService.ensureRegistered();
        this.popoverManager.bind(this.editor);
        this.editorReady.emit(this.editor);
    }

    private handleContentChange(): void {
        if (this.isProgrammaticUpdate) return;
        if (!this.model) return;
        const nextValue = this.model.getValue();
        if (nextValue === this.value) return;
        this.zone.run(() => {
            this.value = nextValue;
            this.valueChange.emit(nextValue);
        });
    }

    private async recreateModel(): Promise<void> {
        if (!this.editor) return;
        await this.createModel();
        if (this.model) {
            this.editor.setModel(this.model);
            this.modelChangeDisposable?.dispose();
            this.modelChangeDisposable = this.editor.onDidChangeModelContent(() => this.handleContentChange());
        }
    }

    private async createModel(): Promise<void> {
        this.editorService.disposeModel(this.model);
        this.model = await this.editorService.createModel(this.value ?? '', this.language, this.buildModelUri());
    }

    private updateModelValue(nextValue: string): void {
        if (!this.model) return;
        if (this.model.getValue() === nextValue) return;
        this.isProgrammaticUpdate = true;
        this.editorService.updateValue(this.model, nextValue ?? '');
        this.isProgrammaticUpdate = false;
    }

    private updateModelLanguage(language: string): void {
        if (!this.monacoApi || !this.model) return;
        this.monacoApi.editor.setModelLanguage(this.model, language || MONACO_DEFAULT_LANGUAGE);
    }

    private buildModelUri(): string | undefined {
        if (!this.modelUri) return undefined;
        const encoded = encodeURIComponent(this.modelUri);
        return `inmemory://dbfuse/${encoded}`;
    }

    private disposeEditor(): void {
        this.modelChangeDisposable?.dispose();
        this.modelChangeDisposable = undefined;
        this.popoverManager.close();
        if (this.editor) {
            this.editor.dispose();
            this.editor = undefined;
        }
        this.editorService.disposeModel(this.model);
        this.model = undefined;
    }
}
