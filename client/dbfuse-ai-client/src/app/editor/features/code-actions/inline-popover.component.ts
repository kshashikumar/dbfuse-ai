import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'app-inline-popover',
    standalone: true,
    template: `
        <div class="popover">
            <div class="popover-header">
                <p class="title">{{ title }}</p>
                <button
                    type="button"
                    class="close"
                    (click)="close.emit()"
                >
                    ×
                </button>
            </div>
            <p class="description">{{ description }}</p>
            <button
                *ngIf="actionLabel"
                type="button"
                class="btn btn-primary w-full"
                (click)="action.emit()"
            >
                {{ actionLabel }}
            </button>
        </div>
    `,
    styles: [
        `
            :host {
                position: absolute;
                z-index: 50;
            }
            .popover {
                border-radius: 0.75rem;
                border: 1px solid rgba(15, 23, 42, 0.1);
                background: var(--popover-bg, #fff);
                padding: 0.75rem;
                box-shadow: 0 15px 30px rgba(15, 23, 42, 0.15);
                min-width: 200px;
            }
            .popover-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 0.5rem;
            }
            .title {
                margin: 0;
                font-size: 0.875rem;
                font-weight: 600;
                color: #0f172a;
            }
            .description {
                margin: 0 0 0.5rem;
                font-size: 0.75rem;
                color: #475569;
            }
            .close {
                border: none;
                background: transparent;
                color: #94a3b8;
                font-size: 0.875rem;
                cursor: pointer;
            }
            .close:hover {
                color: #475569;
            }
        `,
    ],
})
export class InlinePopoverComponent {
    @Input() title = '';
    @Input() description = '';
    @Input() actionLabel?: string;

    @Output() action = new EventEmitter<void>();
    @Output() close = new EventEmitter<void>();
}
