import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/auth';
import { Router } from '@angular/router';
import { LanguageService } from '../../core/services/language.service';
import { ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})

export class LoginComponent implements OnInit {

  email = '';
  password = '';
  error = '';
  loading = false;

  constructor(
    private auth: AuthService,
    private router: Router,
    public langService: LanguageService,
    public themeService: ThemeService
  ) { }

  t(key: string) {
    return this.langService.translate(key);
  }

  ngOnInit() {
    if (this.auth.isLoggedIn()) {
      this.router.navigateByUrl('/dashboard');
    }
  }

  onLogin() {
    this.loading = true;
    this.error = '';

    this.auth.login({
      email: this.email,
      password: this.password
    }).subscribe({
      next: (res: any) => {
        this.auth.saveToken(res.token);
        localStorage.setItem('role', res.role);
        this.router.navigateByUrl('/dashboard');
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'Invalid credentials';
      }
    });
  }

}