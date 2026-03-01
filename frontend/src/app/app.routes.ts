import { Routes } from '@angular/router';
import { LoginComponent } from './features/login/login';
import { Dashboard } from './features/dashboard/dashboard';
import { Checklist } from './features/checklist/checklist';

export const routes: Routes = [
  { path: '', component: LoginComponent },
  { path: 'dashboard', component: Dashboard },
  { path: 'projects/:id', component: Checklist },
  { path: '**', redirectTo: '' }
];import { Stats } from './features/stats/stats';

