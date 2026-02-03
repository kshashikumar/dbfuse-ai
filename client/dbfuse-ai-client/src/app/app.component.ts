import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from '@core/services/theme';
import { ConfirmationDialogHostComponent } from '@shared/components/confirmation-dialog/confirmation-dialog-host.component';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [CommonModule, RouterOutlet, ConfirmationDialogHostComponent],
    templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
    private readonly _themeService = inject(ThemeService);

    ngOnInit(): void {
        this._themeService.init();
    }
}
