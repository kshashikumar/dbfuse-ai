import { Routes } from '@angular/router';
import { AuthGuard } from '@core/guards/auth.guard';

export const routes: Routes = [
    { path: '', pathMatch: 'full', redirectTo: 'landing' },
    {
        path: 'login',
        loadComponent: () => import('@features/auth/login/login.component').then((m) => m.LoginComponent),
    },
    {
        path: 'landing',
        canActivate: [AuthGuard],
        loadComponent: () => import('@features/landing/landing/landing.component').then((m) => m.LandingComponent),
    },
    {
        path: 'connection',
        canActivate: [AuthGuard],
        loadComponent: () =>
            import('@layouts/layout-horizontal/layout-horizontal.component').then((m) => m.LayoutHorizontalComponent),
    },
    {
        path: 'config',
        canActivate: [AuthGuard],
        loadComponent: () => import('@features/settings/config/config.component').then((m) => m.ConfigComponent),
    },
    { path: '**', redirectTo: 'landing' },
];
