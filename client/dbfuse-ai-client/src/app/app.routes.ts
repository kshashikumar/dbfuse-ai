import { Routes } from '@angular/router';
import { AuthGuard } from '@core/guards/auth.guard';
import { LoginComponent } from '@features/auth/login/login.component';
import { LandingComponent } from '@features/landing/landing/landing.component';
import { ConfigComponent } from '@features/settings/config/config.component';
import { LayoutHorizontalComponent } from '@layouts/layout-horizontal/layout-horizontal.component';

export const routes: Routes = [
    { path: '', pathMatch: 'full', redirectTo: 'landing' },
    { path: 'login', component: LoginComponent },
    {
        path: 'landing',
        canActivate: [AuthGuard],
        component: LandingComponent,
    },
    {
        path: 'connection',
        canActivate: [AuthGuard],
        component: LayoutHorizontalComponent,
    },
    {
        path: 'config',
        canActivate: [AuthGuard],
        component: ConfigComponent,
    },
    { path: '**', redirectTo: 'landing' },
];
