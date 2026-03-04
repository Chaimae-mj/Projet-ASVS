import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';

import { LanguageService } from '../../core/services/language.service';
import { ThemeService } from '../../core/services/theme.service';

@Component({
  standalone: true,
  selector: 'app-members',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './Members.html',
  styleUrl: './Members.scss'
})
export class Members implements OnInit {
  private api = 'http://localhost:5000';
  projectId = '';
  project: any = null;

  members: any[] = [];
  allUsers: any[] = [];
  userSearch = '';
  error = '';

  loadingMembers = false;
  loadingUsers = false;
  removing: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    public langService: LanguageService,
    public themeService: ThemeService
  ) { }

  t(key: string) { return this.langService.translate(key); }

  ngOnInit(): void {
    this.projectId = this.route.snapshot.paramMap.get('projectId') || '';
    this.load();
  }

  load() {
    this.loadingMembers = true;
    this.loadingUsers = true;
    this.error = '';

    forkJoin({
      members: this.http.get<any[]>(`${this.api}/projects/${this.projectId}/members`),
      users: this.http.get<any[]>(`${this.api}/users`),
    }).subscribe({
      next: ({ members, users }) => {
        this.members = members;
        this.allUsers = users;
        this.loadingMembers = false;
        this.loadingUsers = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to load';
        this.loadingMembers = false;
        this.loadingUsers = false;
        this.cdr.detectChanges();
      }
    });
  }

  get filteredUsers(): any[] {
    const q = this.userSearch.toLowerCase().trim();
    return this.allUsers.filter(u =>
      !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }

  isMember(userId: string): boolean {
    return this.members.some(m => m.id === userId);
  }

  addMember(user: any) {
    this.http.post(`${this.api}/projects/${this.projectId}/members`, { userId: user.id }).subscribe({
      next: () => {
        this.members.push({ ...user, added_at: new Date().toISOString() });
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to add member';
        this.cdr.detectChanges();
      }
    });
  }

  removeMember(member: any) {
    this.removing = member.id;
    this.http.delete(`${this.api}/projects/${this.projectId}/members/${member.id}`).subscribe({
      next: () => {
        this.members = this.members.filter(m => m.id !== member.id);
        this.removing = null;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to remove member';
        this.removing = null;
        this.cdr.detectChanges();
      }
    });
  }
}