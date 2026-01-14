import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@core/services/auth/auth.service';
import { Observable, map, catchError, of } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { getSafeSessionStorage } from '@core/utils/browser-adapter';

@Injectable({
    providedIn: 'root',
})
export class AuthGuard {
    constructor(
        private authService: AuthService,
        private router: Router,
    ) {}

    canActivate(): Observable<boolean> {
        return this.authService.isAuthenticated().pipe(
            map((response: any) => {
                const isAuthenticated = response && response.authenticated === true;
                if (isAuthenticated) {
                    return true;
                } else {
                    this.router.navigate(['/login'], { replaceUrl: true }); // Absolute path with replaceUrl
                    return false;
                }
            }),
            catchError((error: HttpErrorResponse) => {
                if (this.isTransientAuthError(error) && this.hasStoredToken()) {
                    return of(true);
                }
                const state =
                    error?.status === 401
                        ? { authError: 'Invalid username or password. Please try again.' }
                        : { authError: 'Unable to verify authentication. Please sign in.' };
                this.router.navigate(['/login'], { replaceUrl: true, state }); // Absolute path with replaceUrl
                return of(false);
            }),
        );
    }

    private hasStoredToken(): boolean {
        return Boolean(getSafeSessionStorage().getItem('token'));
    }

    private isTransientAuthError(error: HttpErrorResponse): boolean {
        const status = error?.status ?? 0;
        return status === 0 || status === 502 || status === 503 || status === 504;
    }
}
