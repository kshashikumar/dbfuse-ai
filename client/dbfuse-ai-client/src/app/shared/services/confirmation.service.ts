import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type ConfirmationVariant = 'danger' | 'primary';

export interface ConfirmationOptions {
    message: string;
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmVariant?: ConfirmationVariant;
}

export interface ConfirmationState {
    isOpen: boolean;
    message: string;
    title: string;
    confirmLabel: string;
    cancelLabel: string;
    confirmVariant: ConfirmationVariant;
}

@Injectable({ providedIn: 'root' })
export class ConfirmationService {
    private readonly stateSubject = new BehaviorSubject<ConfirmationState | null>(null);
    readonly state$ = this.stateSubject.asObservable();
    private pendingResolve: ((result: boolean) => void) | null = null;

    confirm(options: ConfirmationOptions): Promise<boolean> {
        if (!options?.message) {
            return Promise.resolve(false);
        }

        if (this.pendingResolve) {
            this.pendingResolve(false);
            this.pendingResolve = null;
        }

        const state: ConfirmationState = {
            isOpen: true,
            message: options.message,
            title: options.title ?? 'Confirm action',
            confirmLabel: options.confirmLabel ?? 'Confirm',
            cancelLabel: options.cancelLabel ?? 'Cancel',
            confirmVariant: options.confirmVariant ?? 'danger',
        };

        this.stateSubject.next(state);

        return new Promise((resolve) => {
            this.pendingResolve = resolve;
        });
    }

    resolve(result: boolean): void {
        if (this.pendingResolve) {
            this.pendingResolve(result);
            this.pendingResolve = null;
        }
        this.stateSubject.next(null);
    }
}
