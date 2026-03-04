import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = 'http://localhost:5000';

  constructor(private http: HttpClient) { }

  login(body: { email: string; password: string }) {
    return this.http.post(`${this.api}/auth/login`, body);
  }

  saveToken(token: string) {
    localStorage.setItem('token', token); // ✅ مهم
  }

  getToken() {
    return localStorage.getItem('token');
  }

  isLoggedIn() {
    return !!localStorage.getItem('token');
  }

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
  }
}