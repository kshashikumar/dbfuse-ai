import { Component, EventEmitter, Input, Output, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-confirmation-dialog',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './confirmation-dialog.component.html',
})
export class ConfirmationDialogComponent {
    @Input() isOpen: boolean = false;
    @Input() message: string = 'Are you sure you want to delete this connection?';
    @Input() title: string = 'Confirm Deletion';
    @Input() confirmLabel: string = 'Delete';
    @Input() cancelLabel: string = 'Cancel';
    @Input() confirmVariant: 'danger' | 'primary' = 'danger';
    @Output() onConfirm = new EventEmitter<void>();
    @Output() onCancel = new EventEmitter<void>();

    // Close dialog on escape key
    @HostListener('document:keydown.escape')
    onEscapeKey(): void {
        if (this.isOpen) {
            this.cancel();
        }
    }

    confirm() {
        this.onConfirm.emit();
    }

    cancel() {
        this.onCancel.emit();
    }
}
