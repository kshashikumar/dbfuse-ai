import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmationService } from '@shared/services/confirmation.service';
import { ConfirmationDialogComponent } from './confirmation-dialog.component';

@Component({
    selector: 'app-confirmation-dialog-host',
    standalone: true,
    imports: [CommonModule, ConfirmationDialogComponent],
    templateUrl: './confirmation-dialog-host.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmationDialogHostComponent {
    private readonly confirmation = inject(ConfirmationService);
    readonly state$ = this.confirmation.state$;

    handleConfirm(): void {
        this.confirmation.resolve(true);
    }

    handleCancel(): void {
        this.confirmation.resolve(false);
    }
}
