import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { LanguageService } from '../../../core/services/language.service';
import { ThemeService } from '../../../core/services/theme.service';

interface AdminMessage {
    requirement_id: string;
    admin_comment: string;
    project_id: string;
    project_name: string;
    status: string;
    evidence: string;
}

@Component({
    standalone: true,
    selector: 'app-admin-messages',
    imports: [CommonModule, RouterModule],
    templateUrl: './messages.html',
    styleUrl: './messages.scss'
})
export class AdminMessages implements OnInit {
    messages: AdminMessage[] = [];
    loading = true;
    error = '';

    constructor(
        private http: HttpClient,
        public langService: LanguageService,
        public themeService: ThemeService
    ) { }

    t(key: string) { return this.langService.translate(key); }

    ngOnInit(): void {
        this.fetchMessages();
    }

    fetchMessages() {
        this.loading = true;
        const token = localStorage.getItem('token');
        this.http.get<AdminMessage[]>('http://localhost:5000/admin/messages', {
            headers: { Authorization: `Bearer ${token}` }
        }).subscribe({
            next: (data) => {
                this.messages = data;
                this.loading = false;
            },
            error: (err) => {
                this.error = 'Failed to load messages';
                this.loading = false;
                console.error(err);
            }
        });
    }

    statusClass(s: string) {
        if (!s) return 'UNTESTED';
        return s.toUpperCase().replace(' ', '_');
    }
}
