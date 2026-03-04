import { Routes } from '@angular/router';
import { LoginComponent } from './features/login/login';
import { Dashboard } from './features/dashboard/dashboard';
import { Checklist } from './features/checklist/checklist';
import { Members } from './features/Members/Members';
import { AdminUsers } from './features/admin/users/users';
import { AdminMessages } from './features/admin/messages/messages';

export const routes: Routes = [
  { path: '', component: LoginComponent },
  { path: 'dashboard', component: Dashboard },
  { path: 'projects/:id', component: Checklist },
  { path: 'projects/:projectId/members', component: Members },
  { path: 'admin/users', component: AdminUsers },
  { path: 'admin/messages', component: AdminMessages },
  { path: '**', redirectTo: '' }
];

