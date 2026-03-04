import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { LanguageService } from '../../../core/services/language.service';
import { ThemeService } from '../../../core/services/theme.service';

@Component({
    standalone: true,
    selector: 'app-admin-users',
    templateUrl: './users.html',
    styleUrl: './users.scss',
    imports: [CommonModule, FormsModule]
})
export class AdminUsers {
    private api = 'http://localhost:5000';

    user = {
        name: '',
        email: '',
        password: '',
        role: 'DEVELOPER'
    };

    users: any[] = [];
    editingUser: any = null;
    loading = false;
    message = '';
    isError = false;

    constructor(
        private http: HttpClient,
        private router: Router,
        private cdr: ChangeDetectorRef,
        public langService: LanguageService,
        public themeService: ThemeService
    ) {
        this.loadUsers();
    }

    t(key: string) { return this.langService.translate(key); }

    loadUsers() {
        this.loading = true;
        this.message = '';
        this.http.get(`${this.api}/users`).subscribe({
            next: (res: any) => {
                this.users = res;
                this.loading = false;
                this.cdr.detectChanges();
            },
            error: (err) => {
                console.error("❌ LOAD USERS ERROR:", err);
                this.message = `${this.t('LOADING_USERS_FAIL')}: ${err.status} ❌`;
                this.isError = true;
                this.loading = false;
                this.users = [];
                this.cdr.detectChanges();
            }
        });
    }

    onSubmit() {
        if (this.editingUser) {
            this.updateUser();
        } else {
            this.createUser();
        }
    }

    createUser() {
        this.loading = true;
        this.message = '';

        this.http.post(`${this.api}/auth/register`, this.user).subscribe({
            next: (res: any) => {
                this.message = this.t('USER_CREATED_SUCCESS');
                this.isError = false;
                this.loading = false;
                this.user = { name: '', email: '', password: '', role: 'DEVELOPER' };
                this.loadUsers();
            },
            error: (err) => {
                this.message = err?.error?.error || 'Failed to create user. ❌';
                this.isError = true;
                this.loading = false;
                this.cdr.detectChanges();
            }
        });
    }

    editUser(user: any) {
        this.editingUser = { ...user };
        this.user = {
            name: user.name,
            email: user.email,
            password: '', // Don't show password
            role: user.role
        };
        this.message = '';
        this.isError = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    updateUser() {
        this.loading = true;
        this.message = '';

        const payload: any = { ...this.user };
        if (!payload.password) delete payload.password;

        this.http.patch(`${this.api}/users/${this.editingUser.id}`, payload).subscribe({
            next: (res: any) => {
                this.message = this.t('USER_UPDATED_SUCCESS');
                this.isError = false;
                this.loading = false;
                this.cancelEdit();
                this.loadUsers();
            },
            error: (err) => {
                this.message = err?.error?.error || 'Failed to update user. ❌';
                this.isError = true;
                this.loading = false;
                this.cdr.detectChanges();
            }
        });
    }

    deleteUser(id: string) {
        if (!confirm(this.t('DELETE_CONFIRM'))) return;

        this.loading = true;
        this.http.delete(`${this.api}/users/${id}`).subscribe({
            next: (res: any) => {
                this.message = this.t('USER_DELETED_SUCCESS');
                this.isError = false;
                this.loadUsers();
            },
            error: (err) => {
                this.message = err?.error?.error || 'Failed to delete user. ❌';
                this.isError = true;
                this.loading = false;
                this.cdr.detectChanges();
            }
        });
    }

    cancelEdit() {
        this.editingUser = null;
        this.user = { name: '', email: '', password: '', role: 'DEVELOPER' };
        this.message = '';
        this.isError = false;
    }
}
