import { ApplicationRef, ComponentRef, EnvironmentInjector, Injectable, createComponent } from '@angular/core';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { Subscription } from 'rxjs';
import { MonacoDecorationRegistry } from '../decorations/decoration.registry';
import { InlinePopoverComponent } from './inline-popover.component';
import { InlinePopoverPayload } from './code-action.types';

@Injectable({ providedIn: 'root' })
export class InlinePopoverManager {
    private componentRef?: ComponentRef<InlinePopoverComponent>;
    private hostElement?: HTMLElement;
    private subscriptions: Subscription[] = [];

    constructor(
        private readonly appRef: ApplicationRef,
        private readonly environmentInjector: EnvironmentInjector,
        private readonly decorationRegistry: MonacoDecorationRegistry,
    ) {}

    bind(editor: monaco.editor.IStandaloneCodeEditor): void {
        const clickDisposable = editor.onMouseDown((event) => {
            if (!event.target?.position) {
                this.close();
                return;
            }

            const model = editor.getModel();
            if (!model) return;

            const range: monaco.IRange = {
                startLineNumber: event.target.position.lineNumber,
                startColumn: event.target.position.column,
                endLineNumber: event.target.position.lineNumber,
                endColumn: event.target.position.column,
            };

            const decorations = model.getDecorationsInRange(range) ?? [];
            const targetDecoration = decorations.find((decoration) => this.decorationRegistry.getMeta(decoration.id));
            if (!targetDecoration) {
                this.close();
                return;
            }

            const meta = this.decorationRegistry.getMeta(targetDecoration.id);
            if (!meta?.popoverTitle) {
                return;
            }

            const coords = editor.getScrolledVisiblePosition(event.target.position);
            const domNode = editor.getDomNode();
            if (!coords || !domNode) return;
            const rect = domNode.getBoundingClientRect();

            this.open(
                {
                    x: rect.left + coords.left,
                    y: rect.top + coords.top + coords.height,
                },
                {
                    title: meta.popoverTitle,
                    description: meta.popoverDescription ?? meta.message ?? '',
                    actionLabel: meta.actionId ? 'Run Action' : undefined,
                    onAction: () => {
                        editor.trigger('inline-popover', meta.actionId ?? '', null);
                        this.close();
                    },
                },
            );
        });

        editor.onDidDispose(() => {
            clickDisposable.dispose();
            this.close();
        });
    }

    private open(position: { x: number; y: number }, payload: InlinePopoverPayload): void {
        this.close();

        this.hostElement = document.createElement('div');
        this.hostElement.style.position = 'absolute';
        this.hostElement.style.left = `${position.x}px`;
        this.hostElement.style.top = `${position.y}px`;
        document.body.appendChild(this.hostElement);

        this.componentRef = createComponent(InlinePopoverComponent, {
            environmentInjector: this.environmentInjector,
        });
        this.componentRef.instance.title = payload.title;
        this.componentRef.instance.description = payload.description;
        this.componentRef.instance.actionLabel = payload.actionLabel;

        this.subscriptions.push(
            this.componentRef.instance.action.subscribe(() => payload.onAction?.()),
            this.componentRef.instance.close.subscribe(() => this.close()),
        );

        this.appRef.attachView(this.componentRef.hostView);
        this.hostElement.appendChild(this.componentRef.location.nativeElement);
    }

    close(): void {
        this.subscriptions.forEach((sub) => sub.unsubscribe());
        this.subscriptions = [];

        if (this.componentRef) {
            this.appRef.detachView(this.componentRef.hostView);
            this.componentRef.destroy();
            this.componentRef = undefined;
        }
        if (this.hostElement?.parentNode) {
            this.hostElement.parentNode.removeChild(this.hostElement);
        }
        this.hostElement = undefined;
    }
}
