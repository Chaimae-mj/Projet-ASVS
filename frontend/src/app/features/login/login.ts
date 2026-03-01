import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/auth';
import { Router } from '@angular/router';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})

export class LoginComponent {

  email = '';
  password = '';
  error = '';

  constructor(private auth: AuthService, private router: Router) {}

  onLogin() {
    this.auth.login({
      email: this.email,
      password: this.password
    }).subscribe({
  next: (res: any) => {
  this.auth.saveToken(res.token);
  localStorage.setItem('role', res.role);   
  this.router.navigateByUrl('/dashboard');
  
},
      error: () => {
        this.error = 'Invalid credentials';
      }
    });
  }
  
}